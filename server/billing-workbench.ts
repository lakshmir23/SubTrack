import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { z } from 'zod';
import { billingRunInputSchema, billingRetrySchema, type BillingRun, type BillingRunInput, type BillingRunItem, type BillingQueue, type BillingQueueItem } from '../shared/billing-workbench.js';
import type { SubscriptionTerms } from '../shared/subscriptions.js';
import type { User } from '../shared/contracts.js';
import { transaction } from './database.js';
import { DomainError } from './errors.js';
import { requireRole, digest, audit } from './security.js';
import { businessDate, periodBoundary } from './calendar.js';
import { nextReference } from './subscriptions.js';
import { generateInvoice, type GenerationOptions, type GenerationResult } from './billing.js';
import { evaluateLifecyclePeriod } from './lifecycle.js';
import { sumMinor } from './money.js';

interface RunRow {
  id: string; number: string; actor_id: string; actor_name: string; idempotency_key: string; payload_hash: string; requested_limit: number;
  scope_json: string | null; retry_of: string | null; fixed_items_json: string | null; status: BillingRun['status']; processed: number;
  created_count: number; existing_count: number; nonbillable_count: number; failed_count: number; remaining_due_subscriptions: number;
  worker_token: string | null; claimed_at: string | null; created_at: string; started_at: string | null; finished_at: string | null; error: string | null;
}
interface ItemRow {
  id: string; run_id: string; position: number; subscription_id: string; subscription_number: string; customer_name: string;
  period_start: string; period_end: string; generation_key: string; outcome: BillingRunItem['outcome']; invoice_id: string | null;
  invoice_number: string | null; logical_charge_id: string | null; reason: string; retryable: number; created_at: string; updated_at: string;
}
interface Candidate { id: string; number: string; customer_name: string; next_billing_date: string; start_date: string; expiry_date: string; next_period_index: number; accepted_terms_json: string }
interface FixedPeriod { subscriptionId: string; periodStart: string; periodEnd: string }
const idSchema = z.string().uuid('Select an existing record.');
const pages = { page: z.coerce.number().int().min(1).max(1_000_000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) };
const queueSchema = z.object({ ...pages, q: z.string().trim().max(100).optional(), customerId: idSchema.optional(), view: z.enum(['due', 'exceptions']).default('due') }).strict();
const runListSchema = z.object({ ...pages, q: z.string().trim().max(100).optional() }).strict();
const itemListSchema = z.object({ ...pages, outcome: z.enum(['processing', 'created', 'alreadyExisting', 'nonbillable', 'failed']).optional() }).strict();
const runSelect = 'SELECT r.*,u.name AS actor_name FROM billing_runs r JOIN users u ON u.id=r.actor_id';
const leaseMs = 60_000;
const marks = (values: unknown[]) => values.map(() => '?').join(',');
const wallNow = () => new Date().toISOString();
function staff(db: DatabaseSync, actorId: string) {
  const row = db.prepare('SELECT role FROM users WHERE id=?').get(actorId);
  if (!row || !['admin', 'staff'].includes(String(row.role))) throw new DomainError(403, 'FORBIDDEN', 'Your account cannot run billing.');
}
function getRun(db: DatabaseSync, id: string): RunRow {
  const row = db.prepare(`${runSelect} WHERE r.id=?`).get(id);
  if (!row) throw new DomainError(404, 'NOT_FOUND', 'This billing run was not found.');
  return row as unknown as RunRow;
}
function runDTO(row: RunRow): BillingRun {
  return { id: row.id, number: row.number, status: row.status, actorName: row.actor_name, limit: row.requested_limit,
    subscriptionIds: row.scope_json ? JSON.parse(row.scope_json) as string[] : null, retryOf: row.retry_of,
    processed: row.processed, created: row.created_count, alreadyExisting: row.existing_count, nonbillable: row.nonbillable_count, failed: row.failed_count,
    remainingDueSubscriptions: row.remaining_due_subscriptions, createdAt: row.created_at, startedAt: row.started_at, finishedAt: row.finished_at, error: row.error };
}
function itemDTO(row: ItemRow): BillingRunItem {
  return { id: row.id, runId: row.run_id, position: row.position, subscriptionId: row.subscription_id, subscriptionNumber: row.subscription_number, customerName: row.customer_name,
    periodStart: row.period_start, periodEnd: row.period_end, outcome: row.outcome, invoiceId: row.invoice_id, invoiceNumber: row.invoice_number,
    logicalChargeId: row.logical_charge_id, reason: row.reason, retryable: Boolean(row.retryable), createdAt: row.created_at, updatedAt: row.updated_at };
}
function scopeFor(row: RunRow): string[] | null { return row.scope_json ? JSON.parse(row.scope_json) as string[] : null; }
function remaining(db: DatabaseSync, date: string, scope: string[] | null): number {
  return Number(db.prepare(`SELECT count(*) AS count FROM subscriptions WHERE accepted_terms_json IS NOT NULL AND next_billing_date<=? AND next_billing_date<expiry_date ${scope ? `AND id IN (${marks(scope)})` : ''}`).get(date, ...(scope || []))?.count);
}
function refreshCounts(db: DatabaseSync, runId: string, token: string, now: Date) {
  const counts = db.prepare(`SELECT sum(CASE WHEN outcome='created' THEN 1 ELSE 0 END) AS created,sum(CASE WHEN outcome='alreadyExisting' THEN 1 ELSE 0 END) AS existing,
    sum(CASE WHEN outcome='nonbillable' THEN 1 ELSE 0 END) AS nonbillable,sum(CASE WHEN outcome='failed' THEN 1 ELSE 0 END) AS failed FROM billing_run_items WHERE run_id=?`).get(runId)!;
  const created = Number(counts.created || 0), existing = Number(counts.existing || 0), nonbillable = Number(counts.nonbillable || 0), failed = Number(counts.failed || 0);
  db.prepare('UPDATE billing_runs SET processed=?,created_count=?,existing_count=?,nonbillable_count=?,failed_count=?,claimed_at=?,remaining_due_subscriptions=? WHERE id=? AND worker_token=?')
    .run(created + existing + nonbillable + failed, created, existing, nonbillable, failed, wallNow(), remaining(db, businessDate(now), scopeFor(getRun(db, runId))), runId, token);
}
function owns(db: DatabaseSync, runId: string, token: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM billing_runs WHERE id=? AND worker_token=? AND status='running'").get(runId, token));
}

export function createBillingRun(db: DatabaseSync, input: BillingRunInput, actorId: string, now: Date): BillingRun {
  const parsed = billingRunInputSchema.parse(input); staff(db, actorId);
  const scope = parsed.subscriptionIds ? [...parsed.subscriptionIds].sort() : null;
  const hash = digest(JSON.stringify([parsed.limit, scope]));
  const id = transaction(db, () => {
    const existing = db.prepare('SELECT id,actor_id,payload_hash FROM billing_runs WHERE idempotency_key=?').get(parsed.idempotencyKey) as { id: string; actor_id: string; payload_hash: string } | undefined;
    if (existing) {
      if (existing.actor_id !== actorId || existing.payload_hash !== hash) throw new DomainError(409, 'IDEMPOTENCY_CONFLICT', 'This run key was already used for a different billing request.');
      return existing.id;
    }
    if (scope) {
      const count = Number(db.prepare(`SELECT count(*) AS count FROM subscriptions WHERE id IN (${marks(scope)}) AND accepted_terms_json IS NOT NULL`).get(...scope)?.count);
      if (count !== scope.length) throw new DomainError(400, 'INVALID_SELECTION', 'Select existing confirmed agreements from the billing queue.');
    }
    const id = randomUUID();
    db.prepare(`INSERT INTO billing_runs(id,number,actor_id,idempotency_key,payload_hash,requested_limit,scope_json,status,remaining_due_subscriptions,created_at) VALUES(?,?,?,?,?,?,?,'queued',?,?)`)
      .run(id, nextReference(db, 'billing_run', 'RUN'), actorId, parsed.idempotencyKey, hash, parsed.limit, scope ? JSON.stringify(scope) : null, remaining(db, businessDate(now), scope), now.toISOString());
    audit(db, actorId, 'billing_run.queued', id, now, { limit: parsed.limit }); return id;
  });
  return runDTO(getRun(db, id));
}
export function retryBillingRun(db: DatabaseSync, sourceRunId: string, key: string, actorId: string, now: Date): BillingRun {
  staff(db, actorId); idSchema.parse(key); const hash = digest(JSON.stringify(['retry', sourceRunId]));
  const id = transaction(db, () => {
    const prior = db.prepare('SELECT id,actor_id,payload_hash FROM billing_runs WHERE idempotency_key=?').get(key) as { id: string; actor_id: string; payload_hash: string } | undefined;
    if (prior) { if (prior.actor_id !== actorId || prior.payload_hash !== hash) throw new DomainError(409, 'IDEMPOTENCY_CONFLICT', 'This retry key was already used for another request.'); return prior.id; }
    const source = getRun(db, sourceRunId);
    if (source.status === 'queued' || source.status === 'running') throw new DomainError(409, 'RUN_IN_PROGRESS', 'Wait for this billing run to finish before retrying failures.');
    const failures = db.prepare("SELECT subscription_id AS subscriptionId,period_start AS periodStart,period_end AS periodEnd FROM billing_run_items WHERE run_id=? AND outcome IN ('failed','processing') ORDER BY period_start,subscription_id").all(sourceRunId) as unknown as FixedPeriod[];
    if (!failures.length) throw new DomainError(409, 'NOTHING_TO_RETRY', 'This run has no failed periods to retry.');
    const scope = [...new Set(failures.map(row => row.subscriptionId))].sort(); const id = randomUUID();
    db.prepare(`INSERT INTO billing_runs(id,number,actor_id,idempotency_key,payload_hash,requested_limit,scope_json,retry_of,fixed_items_json,status,remaining_due_subscriptions,created_at) VALUES(?,?,?,?,?,?,?,?,?,'queued',?,?)`)
      .run(id, nextReference(db, 'billing_run', 'RUN'), actorId, key, hash, failures.length, JSON.stringify(scope), sourceRunId, JSON.stringify(failures), remaining(db, businessDate(now), scope), now.toISOString());
    audit(db, actorId, 'billing_run.retry_queued', id, now, { sourceRunId, periods: failures.length }); return id;
  });
  return runDTO(getRun(db, id));
}

function claimItem(db: DatabaseSync, run: RunRow, token: string, now: Date): ItemRow | null {
  return transaction(db, () => {
    if (!owns(db, run.id, token)) return null;
    const pending = db.prepare("SELECT * FROM billing_run_items WHERE run_id=? AND outcome='processing' ORDER BY position LIMIT 1").get(run.id) as unknown as ItemRow | undefined;
    if (pending) return pending;
    const count = Number(db.prepare('SELECT count(*) AS count FROM billing_run_items WHERE run_id=?').get(run.id)?.count);
    if (count >= run.requested_limit) return null;
    let source: Candidate | undefined; let start: string; let end: string; let notDue = false;
    if (run.fixed_items_json) {
      const fixed = JSON.parse(run.fixed_items_json) as FixedPeriod[];
      const attempted = db.prepare('SELECT subscription_id,period_start FROM billing_run_items WHERE run_id=?').all(run.id) as { subscription_id: string; period_start: string }[];
      const next = fixed.find(period => !attempted.some(item => item.subscription_id === period.subscriptionId && item.period_start === period.periodStart));
      if (!next) return null;
      source = db.prepare('SELECT * FROM subscriptions WHERE id=?').get(next.subscriptionId) as unknown as Candidate | undefined;
      if (!source) throw new DomainError(409, 'SOURCE_MISSING', 'A retry agreement no longer exists.');
      start = next.periodStart; end = next.periodEnd;
    } else {
      const scope = scopeFor(run);
      source = db.prepare(`SELECT s.* FROM subscriptions s WHERE s.accepted_terms_json IS NOT NULL AND s.next_billing_date<=? AND s.next_billing_date<s.expiry_date
        ${scope ? `AND s.id IN (${marks(scope)})` : ''}
        AND NOT EXISTS(SELECT 1 FROM billing_run_items i WHERE i.run_id=? AND i.subscription_id=s.id AND i.period_start=s.next_billing_date)
        ORDER BY s.next_billing_date,s.id LIMIT 1`).get(businessDate(now), ...(scope || []), run.id) as unknown as Candidate | undefined;
      if (!source && scope) {
        source = db.prepare(`SELECT s.* FROM subscriptions s WHERE s.accepted_terms_json IS NOT NULL AND s.next_billing_date>? AND s.next_billing_date<s.expiry_date
          AND s.id IN (${marks(scope)}) AND NOT EXISTS(SELECT 1 FROM billing_run_items i WHERE i.run_id=? AND i.subscription_id=s.id)
          ORDER BY s.next_billing_date,s.id LIMIT 1`).get(businessDate(now), ...scope, run.id) as unknown as Candidate | undefined;
        notDue = Boolean(source);
      }
      if (!source) return null;
      const terms = JSON.parse(source.accepted_terms_json) as SubscriptionTerms;
      start = source.next_billing_date; end = periodBoundary(source.start_date, terms.plan.interval, source.next_period_index + 1);
    }
    const id = randomUUID(); const stamp = now.toISOString();
    db.prepare(`INSERT INTO billing_run_items(id,run_id,position,subscription_id,subscription_number,customer_name,period_start,period_end,generation_key,outcome,reason,retryable,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,0,?,?)`).run(id, run.id, count + 1, source.id, source.number, source.customer_name, start, end, randomUUID(), notDue ? 'nonbillable' : 'processing',
        notDue ? `Not due until ${start}. No charge, waiver or cursor change was recorded; the period can become eligible later.` : 'Generating this period.', stamp, stamp);
    db.prepare('UPDATE billing_runs SET claimed_at=? WHERE id=? AND worker_token=?').run(wallNow(), run.id, token);
    if (notDue) refreshCounts(db, run.id, token, now);
    return db.prepare('SELECT * FROM billing_run_items WHERE id=?').get(id) as unknown as ItemRow;
  });
}
function recordGeneration(db: DatabaseSync, item: ItemRow, token: string, result: GenerationResult, now: Date) {
  if (!owns(db, item.run_id, token)) throw new DomainError(409, 'RUN_LEASE_LOST', 'Another worker resumed this billing run.');
  if (result.invoiceId === null) {
    db.prepare("UPDATE billing_run_items SET outcome='nonbillable',invoice_id=NULL,logical_charge_id=?,reason=?,retryable=0,updated_at=? WHERE id=?")
      .run(result.logicalChargeId, result.reason, now.toISOString(), item.id);
    refreshCounts(db, item.run_id, token, now);
    return;
  }
  const invoice = db.prepare('SELECT status FROM invoices WHERE id=?').get(result.invoiceId);
  const reason = result.created ? 'Invoice created from accepted terms.' : invoice?.status === 'Canceled' ? 'This period has a Canceled invoice. Review its explicit replacement action; ordinary replay does not rebill it.' : 'The period already has its current invoice.';
  db.prepare('UPDATE billing_run_items SET outcome=?,invoice_id=?,logical_charge_id=?,reason=?,retryable=0,updated_at=? WHERE id=?')
    .run(result.created ? 'created' : 'alreadyExisting', result.invoiceId, result.logicalChargeId, reason, now.toISOString(), item.id);
  refreshCounts(db, item.run_id, token, now);
}
function recordFailure(db: DatabaseSync, item: ItemRow, token: string, error: unknown, now: Date) {
  transaction(db, () => {
    if (!owns(db, item.run_id, token)) return;
    const charge = db.prepare("SELECT * FROM logical_charges WHERE subscription_id=? AND period_start=? AND period_end=? AND kind='recurring'").get(item.subscription_id, item.period_start, item.period_end) as { id: string; current_invoice_id: string | null; outcome: string; reason: string | null } | undefined;
    if (charge?.current_invoice_id) { recordGeneration(db, item, token, { invoiceId: charge.current_invoice_id, logicalChargeId: charge.id, created: false }, now); return; }
    if (charge?.outcome === 'nonbillable') {
      db.prepare("UPDATE billing_run_items SET outcome='nonbillable',logical_charge_id=?,reason=?,retryable=0,updated_at=? WHERE id=?").run(charge.id, charge.reason || 'This period is explicitly non-billable.', now.toISOString(), item.id);
    } else {
      const reason = error instanceof DomainError ? error.message : 'Invoice generation failed before commit. The period remains owed and can be retried.';
      const chargeId = charge?.id || randomUUID();
      if (charge) db.prepare("UPDATE logical_charges SET outcome='failed',reason=?,updated_at=? WHERE id=? AND current_invoice_id IS NULL").run(reason, now.toISOString(), charge.id);
      else db.prepare("INSERT INTO logical_charges(id,subscription_id,period_start,period_end,kind,outcome,reason,current_invoice_id,created_at,updated_at) VALUES(?,?,?,?,'recurring','failed',?,NULL,?,?)")
        .run(chargeId, item.subscription_id, item.period_start, item.period_end, reason, now.toISOString(), now.toISOString());
      db.prepare("UPDATE billing_run_items SET outcome='failed',logical_charge_id=?,reason=?,retryable=1,updated_at=? WHERE id=?").run(chargeId, reason, now.toISOString(), item.id);
    }
    refreshCounts(db, item.run_id, token, now);
  });
}
export interface BillingWorkerOptions {
  autoStart?: boolean;
  failGeneration?: (item: { subscriptionId: string; periodStart: string }, point: 'after-reservation' | 'before-commit') => void;
}
export async function processBillingRun(db: DatabaseSync, runId: string, clock: () => Date, options: BillingWorkerOptions & { shouldStop?: () => boolean } = {}): Promise<void> {
  const token = randomUUID();
  const claimed = transaction(db, () => {
    const row = getRun(db, runId); const stale = !row.claimed_at || row.claimed_at < new Date(Date.now() - leaseMs).toISOString();
    if (row.status !== 'queued' && !(row.status === 'running' && stale)) return false;
    db.prepare("UPDATE billing_runs SET status='running',worker_token=?,claimed_at=?,started_at=coalesce(started_at,?),finished_at=NULL,error=NULL WHERE id=?").run(token, wallNow(), clock().toISOString(), runId); return true;
  });
  if (!claimed) return;
  try {
    const run = getRun(db, runId);
    while (!options.shouldStop?.()) {
      const item = claimItem(db, run, token, clock()); if (!item) break;
      if (item.outcome === 'nonbillable') { await yieldTurn(); continue; }
      try {
        const generationOptions: GenerationOptions = { onResult: result => recordGeneration(db, item, token, result, clock()), failpoint: point => options.failGeneration?.({ subscriptionId: item.subscription_id, periodStart: item.period_start }, point) };
        generateInvoice(db, item.subscription_id, { expectedPeriodStart: item.period_start, idempotencyKey: item.generation_key }, run.actor_id, clock(), generationOptions);
      } catch (error) { if (!owns(db, runId, token)) return; recordFailure(db, item, token, error, clock()); }
      await yieldTurn();
    }
    transaction(db, () => {
      if (!owns(db, runId, token)) return;
      const stopped = options.shouldStop?.() || false;
      db.prepare('UPDATE billing_runs SET status=?,worker_token=NULL,claimed_at=NULL,finished_at=?,remaining_due_subscriptions=? WHERE id=? AND worker_token=?')
        .run(stopped ? 'queued' : 'completed', stopped ? null : clock().toISOString(), remaining(db, businessDate(clock()), scopeFor(run)), runId, token);
    });
  } catch {
    transaction(db, () => {
      if (!owns(db, runId, token)) return;
      db.prepare("UPDATE billing_runs SET status='failed',worker_token=NULL,claimed_at=NULL,finished_at=?,error=? WHERE id=? AND worker_token=?")
        .run(clock().toISOString(), 'The billing worker stopped unexpectedly. Completed outcomes are preserved; retry the remaining failed or interrupted periods.', runId, token);
    });
  }
}

export interface BillingWorker { enqueue(id: string): void; recover(): void; stop(): Promise<void> }
export function createBillingWorker(db: DatabaseSync, clock: () => Date, options: BillingWorkerOptions = {}): BillingWorker {
  let stopping = false; let task: Promise<void> | null = null; const queue = new Set<string>();
  const pump = () => {
    if (task || stopping || options.autoStart === false) return;
    task = (async () => {
      while (queue.size && !stopping) { const id = queue.values().next().value!; queue.delete(id); await processBillingRun(db, id, clock, { ...options, shouldStop: () => stopping }); }
    })().catch(() => { console.error('Billing worker interrupted. Persisted run outcomes remain available for review and recovery.'); }).finally(() => { task = null; if (queue.size && !stopping) pump(); });
  };
  const enqueue = (id: string) => { if (stopping || options.autoStart === false) return; queue.add(id); setImmediate(pump); };
  const recover = () => {
    if (stopping || options.autoStart === false) return;
    const rows = db.prepare("SELECT id FROM billing_runs WHERE status='queued' OR (status='running' AND (claimed_at IS NULL OR claimed_at<?)) ORDER BY created_at,id LIMIT 20").all(new Date(Date.now() - leaseMs).toISOString()) as { id: string }[];
    for (const row of rows) enqueue(row.id);
  };
  const timer = options.autoStart === false ? null : setInterval(recover, 10_000); timer?.unref();
  if (options.autoStart !== false) setImmediate(recover);
  return { enqueue, recover, async stop() { stopping = true; if (timer) clearInterval(timer); queue.clear(); await task; } };
}

export function billingWorkbenchRoutes(db: DatabaseSync, clock: () => Date, worker: BillingWorker): Router {
  const router = Router();
  router.get('/billing/queue', requireRole('admin', 'staff'), (req, res) => {
    const input = queueSchema.parse(req.query);
    res.json(transaction(db, () => {
      const now = businessDate(clock()); const filter: string[] = []; const params: SQLInputValue[] = [];
      if (input.customerId) { filter.push('s.customer_id=?'); params.push(input.customerId); }
      if (input.q) { const q = `%${input.q.replace(/[\\%_]/g, '\\$&')}%`; filter.push("(s.number LIKE ? ESCAPE '\\' OR s.customer_name LIKE ? ESCAPE '\\')"); params.push(q, q); }
      const common = filter.length ? ` AND ${filter.join(' AND ')}` : '';
      const dueWhere = `s.accepted_terms_json IS NOT NULL AND s.next_billing_date<=? AND s.next_billing_date<s.expiry_date${common}`;
      const dueSubscriptions = Number(db.prepare(`SELECT count(*) AS count FROM subscriptions s WHERE ${dueWhere}`).get(now, ...params)?.count);
      const failedPeriods = Number(db.prepare(`SELECT count(*) AS count FROM logical_charges c JOIN subscriptions s ON s.id=c.subscription_id WHERE c.outcome='failed'${common}`).get(...params)?.count);
      const canceledInvoices = Number(db.prepare(`SELECT count(*) AS count FROM logical_charges c JOIN subscriptions s ON s.id=c.subscription_id JOIN invoices i ON i.id=c.current_invoice_id WHERE i.status='Canceled'${common}`).get(...params)?.count);
      const notDueSubscriptions = Number(db.prepare(`SELECT count(*) AS count FROM subscriptions s WHERE s.accepted_terms_json IS NOT NULL AND s.next_billing_date>? AND s.next_billing_date<s.expiry_date${common}`).get(now, ...params)?.count);
      const source = input.view === 'due'
        ? `FROM subscriptions s LEFT JOIN logical_charges c ON c.subscription_id=s.id AND c.period_start=s.next_billing_date AND c.kind='recurring' LEFT JOIN invoices i ON i.id=c.current_invoice_id WHERE ${dueWhere}`
        : `FROM logical_charges c JOIN subscriptions s ON s.id=c.subscription_id LEFT JOIN invoices i ON i.id=c.current_invoice_id WHERE (c.outcome='failed' OR i.status='Canceled')${common}`;
      const values = input.view === 'due' ? [now, ...params] : params;
      const total = Number(db.prepare(`SELECT count(*) AS count ${source}`).get(...values)?.count); const page = Math.min(input.page, Math.max(1, Math.ceil(total / input.pageSize)));
      const rows = db.prepare(`SELECT s.*,c.id AS charge_id,c.reason AS charge_reason,c.period_start AS charge_start,c.period_end AS charge_end,c.outcome AS charge_outcome,i.id AS invoice_id,i.number AS invoice_number,i.status AS invoice_status ${source} ORDER BY ${input.view === 'due' ? 's.next_billing_date' : 'c.period_start'},s.id LIMIT ? OFFSET ?`).all(...values, input.pageSize, (page - 1) * input.pageSize) as unknown as (Candidate & { customer_id: string; charge_id: string | null; charge_reason: string | null; charge_start: string | null; charge_end: string | null; charge_outcome: string | null; invoice_id: string | null; invoice_number: string | null; invoice_status: string | null })[];
      const items: BillingQueueItem[] = rows.map(row => {
        const terms = JSON.parse(row.accepted_terms_json) as SubscriptionTerms;
        const periodStart = input.view === 'due' ? row.next_billing_date : row.charge_start!;
        const periodEnd = input.view === 'due' ? periodBoundary(row.start_date, terms.plan.interval, row.next_period_index + 1) : row.charge_end!;
        const selection = evaluateLifecyclePeriod(db, row.id, periodStart, periodEnd);
        return { subscriptionId: row.id, subscriptionNumber: row.number, customerId: row.customer_id, customerName: row.customer_name,
          periodStart, periodEnd,
          outcome: row.invoice_status === 'Canceled' ? 'canceled' : row.charge_outcome === 'failed' ? 'failed' : 'due',
          reason: row.invoice_status === 'Canceled' ? 'The current invoice was canceled. Use explicit replacement after reviewing a fresh preview.' : row.charge_reason || selection.reason,
          invoiceId: row.invoice_id, invoiceNumber: row.invoice_number, logicalChargeId: row.charge_id, acceptedSubtotal: sumMinor(selection.lines.map(line => line.subtotal)), billable: selection.billable };
      });
      const result: BillingQueue = { items, total, page, pageSize: input.pageSize, businessDate: now, summary: { dueSubscriptions, failedPeriods, canceledInvoices, notDueSubscriptions } }; return result;
    }, 'read'));
  });
  router.post('/billing/runs', requireRole('admin', 'staff'), (req, res) => {
    const input = billingRunInputSchema.parse(req.body); const run = createBillingRun(db, input, (res.locals.user as User).id, clock()); worker.enqueue(run.id); res.status(202).json(run);
  });
  router.get('/billing/runs', requireRole('admin', 'staff'), (req, res) => {
    const input = runListSchema.parse(req.query);
    res.json(transaction(db, () => {
      const values: SQLInputValue[] = []; let where = '';
      if (input.q) { where = "WHERE r.number LIKE ? ESCAPE '\\'"; values.push(`%${input.q.replace(/[\\%_]/g, '\\$&')}%`); }
      const total = Number(db.prepare(`SELECT count(*) AS count FROM billing_runs r ${where}`).get(...values)?.count); const page = Math.min(input.page, Math.max(1, Math.ceil(total / input.pageSize)));
      const rows = db.prepare(`${runSelect} ${where} ORDER BY r.created_at DESC,r.id LIMIT ? OFFSET ?`).all(...values, input.pageSize, (page - 1) * input.pageSize) as unknown as RunRow[];
      return { items: rows.map(runDTO), total, page, pageSize: input.pageSize };
    }, 'read'));
  });
  router.get('/billing/runs/:id', requireRole('admin', 'staff'), (req, res) => { const id = idSchema.parse(req.params.id); res.json(transaction(db, () => runDTO(getRun(db, id)), 'read')); });
  router.get('/billing/runs/:id/items', requireRole('admin', 'staff'), (req, res) => {
    const id = idSchema.parse(req.params.id); const input = itemListSchema.parse(req.query);
    res.json(transaction(db, () => {
      getRun(db, id); const values: SQLInputValue[] = [id]; const where = `i.run_id=?${input.outcome ? ' AND i.outcome=?' : ''}`; if (input.outcome) values.push(input.outcome);
      const total = Number(db.prepare(`SELECT count(*) AS count FROM billing_run_items i WHERE ${where}`).get(...values)?.count); const page = Math.min(input.page, Math.max(1, Math.ceil(total / input.pageSize)));
      const rows = db.prepare(`SELECT i.*,v.number AS invoice_number FROM billing_run_items i LEFT JOIN invoices v ON v.id=i.invoice_id WHERE ${where} ORDER BY i.position LIMIT ? OFFSET ?`).all(...values, input.pageSize, (page - 1) * input.pageSize) as unknown as ItemRow[];
      return { items: rows.map(itemDTO), total, page, pageSize: input.pageSize };
    }, 'read'));
  });
  router.post('/billing/runs/:id/retry', requireRole('admin', 'staff'), (req, res) => {
    const id = idSchema.parse(req.params.id); const input = billingRetrySchema.parse(req.body); const run = retryBillingRun(db, id, input.idempotencyKey, (res.locals.user as User).id, clock()); worker.enqueue(run.id); res.status(202).json(run);
  });
  return router;
}
