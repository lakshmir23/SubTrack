import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import {
  lifecycleActionSchema, lifecycleRenewSchema, lifecycleAddonSchema, lifecycleProcessSchema,
  type LifecycleState, type LifecycleEvent, type LifecycleAction, type LifecycleAddon, type LifecycleProcessResult,
} from '../shared/lifecycle.js';
import type { SubscriptionTerms, SubscriptionLine, SubscriptionStage, SubscriptionServiceState } from '../shared/subscriptions.js';
import type { User } from '../shared/contracts.js';
import { transaction } from './database.js';
import { DomainError } from './errors.js';
import { audit, digest, requireRole } from './security.js';
import { businessDate, periodBoundary, periodIndex } from './calendar.js';
import { multiplyMinor, sumMinor } from './money.js';

interface ServiceRow {
  id: string; number: string; customer_id: string; stage: SubscriptionStage; service_state: SubscriptionServiceState; version: number;
  start_date: string; expiry_date: string; term_periods: number; accepted_terms_json: string | null; next_period_index: number;
  next_billing_date: string | null; closure_cause: 'early' | 'expiry' | null; early_close_effective: string | null;
}
interface EventRow {
  id: string; subscription_id: string; actor_id: string | null; kind: LifecycleEvent['kind']; requested_date: string; effective_date: string;
  status: 'scheduled' | 'applied'; created_at: string; applied_at: string | null; line_id: string | null; enabled: number | null;
  previous_expiry: string | null; new_expiry: string | null; message: string; actor_name: string | null;
}
export interface LifecyclePeriodEvaluation { billable: boolean; reason: string | null; lines: SubscriptionLine[] }
export interface LifecycleApplyResult { changed: boolean; paused: number; resumed: number; closed: number; termEnded: number; addons: number }
const idSchema = z.string().uuid('Select an existing record.');
function source(db: DatabaseSync, id: string, user?: User): ServiceRow {
  const row = (user?.role === 'customer' ? db.prepare('SELECT * FROM subscriptions WHERE id=? AND customer_id=?').get(id, user.id) : db.prepare('SELECT * FROM subscriptions WHERE id=?').get(id)) as unknown as ServiceRow | undefined;
  if (!row) throw new DomainError(404, 'NOT_FOUND', 'This subscription was not found or is unavailable to your account.');
  if (!row.accepted_terms_json) throw new DomainError(409, 'AGREEMENT_NOT_CONFIRMED', 'Confirm the quotation before managing service.');
  return row;
}
function terms(row: ServiceRow): SubscriptionTerms { return JSON.parse(row.accepted_terms_json!) as SubscriptionTerms; }
function events(db: DatabaseSync, id: string): EventRow[] {
  return db.prepare('SELECT e.*,u.name AS actor_name FROM lifecycle_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.subscription_id=? ORDER BY e.effective_date,e.rowid').all(id) as unknown as EventRow[];
}
function pausedAt(history: EventRow[], date: string): boolean {
  const changes = history.filter(event => event.effective_date <= date && (event.kind === 'pause' || event.kind === 'resume'));
  return changes.at(-1)?.kind === 'pause';
}
function enabledAt(history: EventRow[], line: SubscriptionLine, date: string): boolean {
  if (line.isPrimary) return true;
  const changes = history.filter(event => event.line_id === line.id && event.effective_date <= date);
  return changes.length ? Boolean(changes.at(-1)!.enabled) : true;
}

/** Read-only effective-period authority. Current status badges never determine old debt. */
export function evaluateLifecyclePeriod(db: DatabaseSync, subscriptionId: string, periodStart: string, periodEnd: string): LifecyclePeriodEvaluation {
  const row = source(db, subscriptionId); const accepted = terms(row); const history = events(db, subscriptionId);
  if (periodStart < row.start_date || periodStart >= row.expiry_date || periodEnd > row.expiry_date) return { billable: false, reason: 'Outside the accepted exclusive service term.', lines: [] };
  if (row.early_close_effective && periodStart >= row.early_close_effective) return { billable: false, reason: `Service closed early effective ${row.early_close_effective}.`, lines: [] };
  if (pausedAt(history, periodStart)) return { billable: false, reason: 'Service was paused for this complete original billing period.', lines: [] };
  return { billable: true, reason: null, lines: accepted.lines.filter(line => enabledAt(history, line, periodStart)) };
}
/** Projection from the oldest unprocessed original boundary; closed badges cannot erase backlog. */
export function nextLifecycleBillingDate(db: DatabaseSync, subscriptionId: string): string | null {
  const row = source(db, subscriptionId); const date = periodBoundary(row.start_date, terms(row).plan.interval, row.next_period_index);
  if (date >= row.expiry_date || (row.early_close_effective && date >= row.early_close_effective)) return null;
  return date;
}
function firstOpenBoundary(db: DatabaseSync, row: ServiceRow, date: string, after?: string): string {
  const interval = terms(row).plan.interval; let low = 0; let high = row.term_periods;
  while (low < high) { const middle = Math.floor((low + high) / 2); if (periodBoundary(row.start_date, interval, middle) < date) low = middle + 1; else high = middle; }
  let index = low; let boundary = periodBoundary(row.start_date, interval, index);
  if (after && boundary <= after) { index = periodIndex(row.start_date, interval, after) + 1; boundary = periodBoundary(row.start_date, interval, index); }
  while (index < row.term_periods && db.prepare("SELECT 1 FROM logical_charges WHERE subscription_id=? AND period_start=? AND kind='recurring'").get(row.id, boundary)) {
    index++; boundary = periodBoundary(row.start_date, interval, index);
  }
  if (boundary >= row.expiry_date) throw new DomainError(409, 'NO_SERVICE_PERIOD', 'The first available original boundary reaches expiry. Renew the term or close the ended agreement instead.');
  return boundary;
}
function eventDTO(row: EventRow): LifecycleEvent {
  return { id: row.id, kind: row.kind, actorName: row.actor_name || 'System', requestedDate: row.requested_date, effectiveDate: row.effective_date,
    status: row.status, createdAt: row.created_at, appliedAt: row.applied_at, lineId: row.line_id, enabled: row.enabled === null ? null : Boolean(row.enabled),
    previousExpiry: row.previous_expiry, newExpiry: row.new_expiry, message: row.message };
}
function addEvent(db: DatabaseSync, row: ServiceRow, actorId: string | null, kind: EventRow['kind'], date: string, effective: string, now: Date,
  details: { lineId?: string; enabled?: boolean; previousExpiry?: string; newExpiry?: string; applied?: boolean; message: string }): string {
  const id = randomUUID();
  db.prepare(`INSERT INTO lifecycle_events(id,subscription_id,actor_id,kind,requested_date,effective_date,status,created_at,applied_at,line_id,enabled,previous_expiry,new_expiry,message) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, row.id, actorId, kind, date, effective, details.applied ? 'applied' : 'scheduled', now.toISOString(), details.applied ? now.toISOString() : null,
      details.lineId || null, details.enabled === undefined ? null : Number(details.enabled), details.previousExpiry || null, details.newExpiry || null, details.message);
  audit(db, actorId, `subscription.${kind}`, row.id, now, { requestedDate: date, effectiveDate: effective, ...(details.lineId ? { lineId: details.lineId, enabled: details.enabled } : {}) });
  return id;
}

/** Caller owns an immediate write transaction. Safe to call before financial/state mutations. */
export function applyLifecycleDueForSubscription(db: DatabaseSync, subscriptionId: string, now: Date): LifecycleApplyResult {
  let row = source(db, subscriptionId); const date = businessDate(now); const result: LifecycleApplyResult = { changed: false, paused: 0, resumed: 0, closed: 0, termEnded: 0, addons: 0 };
  const due = events(db, subscriptionId).filter(event => event.status === 'scheduled' && event.effective_date <= date);
  for (const event of due) {
    if (event.kind === 'closeEarly' && row.stage !== 'Closed') {
      db.prepare("UPDATE subscriptions SET stage='Closed',service_state='Closed',closure_cause='early' WHERE id=?").run(row.id); result.closed++;
    } else if (event.kind === 'pause' && row.stage === 'Active') { db.prepare("UPDATE subscriptions SET service_state='Paused' WHERE id=?").run(row.id); result.paused++; }
    else if (event.kind === 'resume' && row.stage === 'Active') { db.prepare("UPDATE subscriptions SET service_state='Running' WHERE id=?").run(row.id); result.resumed++; }
    else if (event.kind === 'addonEnabled' || event.kind === 'addonDisabled') result.addons++;
    db.prepare("UPDATE lifecycle_events SET status='applied',applied_at=? WHERE id=? AND status='scheduled'").run(now.toISOString(), event.id);
    result.changed = true; row = source(db, row.id);
  }
  if (date >= row.expiry_date && row.stage !== 'Closed') {
    const autoClose = terms(row).plan.autoClose;
    const kind = autoClose ? 'expiry' : 'termEnded';
    if (!db.prepare('SELECT 1 FROM lifecycle_events WHERE subscription_id=? AND kind=? AND effective_date=?').get(row.id, kind, row.expiry_date)) {
      addEvent(db, row, null, kind, date, row.expiry_date, now, { applied: true, message: autoClose ? 'The accepted term expired and closed automatically. Historical owed periods remain recoverable.' : 'The accepted term ended. New service periods stop; staff can close the term or renew at its exact expiry boundary.' });
      result.changed = true;
    }
    if (autoClose) {
      db.prepare("UPDATE subscriptions SET stage='Closed',service_state='Closed',closure_cause='expiry' WHERE id=?").run(row.id); result.closed++;
    } else {
      if (row.service_state !== 'TermEnded') { result.termEnded++; result.changed = true; }
      db.prepare("UPDATE subscriptions SET service_state='TermEnded' WHERE id=?").run(row.id);
    }
  }
  if (result.changed) db.prepare('UPDATE subscriptions SET version=version+1,updated_at=? WHERE id=?').run(now.toISOString(), subscriptionId);
  const next = nextLifecycleBillingDate(db, subscriptionId);
  db.prepare('UPDATE subscriptions SET next_billing_date=? WHERE id=?').run(next, subscriptionId);
  return result;
}

function permissions(db: DatabaseSync, row: ServiceRow, history: EventRow[], user: User, date: string) {
  const plan = terms(row).plan; const reasons: LifecycleState['deniedReasons'] = { pause: null, resume: null, renew: null, closeEarly: null, closeTerm: null };
  const dates: LifecycleState['actionEffectiveDates'] = { pause: null, resume: null, closeEarly: null, closeTerm: null };
  const active = row.stage === 'Active' && date < row.expiry_date && !row.early_close_effective;
  const pending = history.find(event => event.status === 'scheduled' && (event.kind === 'pause' || event.kind === 'resume'));
  const paused = pausedAt(history, date);
  if (!plan.allowPause) reasons.pause = reasons.resume = 'The accepted plan does not permit pausing.';
  else if (!active) reasons.pause = reasons.resume = row.early_close_effective ? 'Early closure has already been requested.' : 'Service must be Active within its term.';
  else if (pending) reasons.pause = reasons.resume = `A ${pending.kind} change is already scheduled for ${pending.effective_date}.`;
  else if (paused) reasons.pause = 'Service is already paused.';
  else reasons.resume = 'Service is not currently paused.';
  if (!plan.allowEarlyClose) reasons.closeEarly = 'The accepted plan does not permit early closure.';
  else if (!active) reasons.closeEarly = row.early_close_effective ? 'Early closure has already been requested.' : 'Early closure requires Active service before expiry.';
  if (!plan.allowRenew) reasons.renew = 'The accepted plan does not permit renewal.';
  else if (row.early_close_effective || row.closure_cause === 'early') reasons.renew = 'An early-closed agreement requires a fresh quotation.';
  else if (date > row.expiry_date) reasons.renew = 'Late renewal is not allowed. Create a fresh quotation so no expired gap is back-billed.';
  else if (!['Confirmed', 'Active'].includes(row.stage) && !(row.stage === 'Closed' && row.closure_cause === 'expiry' && date === row.expiry_date)) reasons.renew = 'This closed agreement requires a fresh quotation.';
  if (user.role === 'customer') reasons.closeTerm = 'Only the internal team may close an ended term.';
  else if (date < row.expiry_date) reasons.closeTerm = 'The accepted term has not ended.';
  else if (row.stage === 'Closed') reasons.closeTerm = 'This agreement is already closed.';
  else dates.closeTerm = date;
  for (const action of ['pause', 'resume', 'closeEarly'] as const) {
    if (reasons[action]) continue;
    try {
      const latestPause = history.filter(event => event.kind === 'pause' && event.effective_date <= date).at(-1);
      dates[action] = firstOpenBoundary(db, row, date, action === 'resume' ? latestPause?.effective_date : undefined);
    } catch (error) { reasons[action] = error instanceof DomainError ? error.message : 'No remaining service boundary is available.'; }
  }
  return { reasons, dates };
}
function addonIntervals(row: ServiceRow, history: EventRow[], line: SubscriptionLine): LifecycleAddon['intervals'] {
  const result: LifecycleAddon['intervals'] = [{ from: row.start_date, to: row.expiry_date, enabled: true }];
  for (const event of history.filter(item => item.line_id === line.id)) {
    const current = result.at(-1)!;
    if (event.effective_date === current.from) { current.enabled = Boolean(event.enabled); continue; }
    current.to = event.effective_date; result.push({ from: event.effective_date, to: row.expiry_date, enabled: Boolean(event.enabled) });
  }
  return result;
}
export function serializeLifecycle(db: DatabaseSync, subscriptionId: string, user: User, now: Date): LifecycleState {
  const row = source(db, subscriptionId, user); const accepted = terms(row); const history = events(db, row.id); const date = businessDate(now);
  const policy = permissions(db, row, history, user, date);
  const addons: LifecycleAddon[] = accepted.lines.map(line => {
    let deniedReason: string | null = line.isPrimary ? 'The primary product cannot be disabled.' : null;
    if (!deniedReason && (row.stage !== 'Active' || date >= row.expiry_date || row.early_close_effective)) deniedReason = 'Optional line changes require Active service within an open term.';
    if (!deniedReason) { try { firstOpenBoundary(db, row, date); } catch (error) { deniedReason = error instanceof DomainError ? error.message : 'No remaining boundary is available.'; } }
    const pending = history.filter(event => event.line_id === line.id && event.effective_date > date).at(-1);
    return { lineId: line.id, productId: line.productId, productName: line.productName, quantity: line.quantity, unitPrice: line.unitPrice, primary: line.isPrimary,
      enabled: enabledAt(history, line, date), nextChange: pending ? { enabled: Boolean(pending.enabled), requestedDate: pending.requested_date, effectiveDate: pending.effective_date } : null,
      intervals: addonIntervals(row, history, line), canToggle: !deniedReason, deniedReason };
  });
  const next = nextLifecycleBillingDate(db, row.id);
  let nextPeriod: LifecycleState['nextPeriod'] = null;
  if (next) {
    const end = periodBoundary(row.start_date, accepted.plan.interval, row.next_period_index + 1); const evaluated = evaluateLifecyclePeriod(db, row.id, next, end);
    const lines = evaluated.lines.map(line => ({ lineId: line.id, productName: line.productName, quantity: line.quantity, unitPrice: line.unitPrice, subtotal: multiplyMinor(line.unitPrice, line.quantity) }));
    nextPeriod = { start: next, end, billable: evaluated.billable, reason: evaluated.reason, lines, subtotal: sumMinor(lines.map(line => line.subtotal)) };
  }
  return { subscriptionId: row.id, number: row.number, version: row.version, stage: row.stage, serviceState: row.service_state, businessDate: date,
    startDate: row.start_date, expiryDate: row.expiry_date, closureCause: row.closure_cause, policies: accepted.plan,
    allowedActions: (Object.keys(policy.reasons) as LifecycleAction[]).filter(action => !policy.reasons[action]), deniedReasons: policy.reasons, actionEffectiveDates: policy.dates,
    history: history.map(eventDTO), scheduled: history.filter(event => event.status === 'scheduled').map(eventDTO), addons, nextPeriod,
    estimateExplanation: 'The immutable agreement shows the full accepted selection. The next unprocessed period above uses historical enabled lines and saved prices; taxes and discounts are decided only when its invoice is generated.' };
}

function mutate(db: DatabaseSync, subscriptionId: string, action: LifecycleAction | 'addon', input: { version: number; idempotencyKey: string; periods?: number; enabled?: boolean }, user: User, now: Date, lineId?: string): LifecycleState {
  const payloadHash = digest(JSON.stringify([subscriptionId, action, input.version, input.periods ?? null, input.enabled ?? null, lineId || null]));
  transaction(db, () => {
    source(db, subscriptionId, user);
    const replay = db.prepare('SELECT actor_id,payload_hash FROM lifecycle_requests WHERE idempotency_key=?').get(input.idempotencyKey) as { actor_id: string; payload_hash: string } | undefined;
    if (replay) {
      if (replay.actor_id !== user.id || replay.payload_hash !== payloadHash) throw new DomainError(409, 'IDEMPOTENCY_CONFLICT', 'This service-action key was already used for different inputs.');
      applyLifecycleDueForSubscription(db, subscriptionId, now); return;
    }
    const before = source(db, subscriptionId, user); if (before.version !== input.version) throw new DomainError(409, 'VERSION_CONFLICT', 'This agreement changed after you opened it. Reload before trying again. Your request has not been applied.');
    applyLifecycleDueForSubscription(db, subscriptionId, now);
    const row = source(db, subscriptionId, user);
    const date = businessDate(now); const history = events(db, row.id); const accepted = terms(row); let eventId: string;
    if (action === 'addon') {
      const line = accepted.lines.find(line => line.id === lineId);
      if (!line) throw new DomainError(404, 'NOT_FOUND', 'This optional line does not belong to the agreement.');
      if (line.isPrimary) throw new DomainError(409, 'PRIMARY_REQUIRED', 'The primary product cannot be disabled.');
      if (row.stage !== 'Active' || date >= row.expiry_date || row.early_close_effective) throw new DomainError(409, 'ACTION_NOT_ALLOWED', 'Optional line changes require Active service within an open term.');
      const effective = firstOpenBoundary(db, row, date);
      if (enabledAt(history, line, effective) === input.enabled) throw new DomainError(409, 'NO_CHANGE', 'This line already has the requested state at the selected boundary.');
      eventId = addEvent(db, row, user.id, input.enabled ? 'addonEnabled' : 'addonDisabled', date, effective, now, { lineId: line.id, enabled: input.enabled!, message: `${line.productName} ${input.enabled ? 'enabled' : 'disabled'} from ${effective}, without repricing or proration.` });
    } else {
      const permission = permissions(db, row, history, user, date);
      if (permission.reasons[action]) throw new DomainError(action === 'closeTerm' && user.role === 'customer' ? 403 : 409, 'ACTION_NOT_ALLOWED', permission.reasons[action]!);
      if (action === 'renew') {
        const periods = input.periods!; const previousExpiry = row.expiry_date; const total = row.term_periods + periods;
        if (total > 100_000) throw new DomainError(400, 'TERM_LIMIT', 'The renewed agreement exceeds the supported number of original periods.');
        const newExpiry = periodBoundary(row.start_date, accepted.plan.interval, total);
        const stage = row.stage === 'Confirmed' ? 'Confirmed' : 'Active'; const state = stage === 'Active' && pausedAt(history, date) ? 'Paused' : 'Running';
        db.prepare('UPDATE subscriptions SET expiry_date=?,term_periods=?,stage=?,service_state=?,closure_cause=NULL WHERE id=?').run(newExpiry, total, stage, state, row.id);
        eventId = addEvent(db, row, user.id, 'renew', date, date, now, { applied: true, previousExpiry, newExpiry, message: `Accepted term renewed from ${previousExpiry} to ${newExpiry} at its existing prices and original calendar anchor.` });
      } else if (action === 'closeTerm') {
        db.prepare("UPDATE subscriptions SET stage='Closed',service_state='Closed',closure_cause='expiry' WHERE id=?").run(row.id);
        eventId = addEvent(db, row, user.id, 'closeTerm', date, date, now, { applied: true, message: 'Ended term explicitly closed by the internal team. Historical debt is preserved.' });
      } else {
        const effective = permission.dates[action]!;
        if (action === 'closeEarly') db.prepare('UPDATE subscriptions SET early_close_effective=? WHERE id=?').run(effective, row.id);
        eventId = addEvent(db, row, user.id, action, date, effective, now, { message: `${action === 'closeEarly' ? 'Early closure' : action === 'pause' ? 'Pause' : 'Resume'} requested on ${date}; effective at the original boundary ${effective}. Previously decided and owed periods remain unchanged.` });
      }
    }
    db.prepare('UPDATE subscriptions SET version=version+1,updated_at=? WHERE id=?').run(now.toISOString(), row.id);
    db.prepare('INSERT INTO lifecycle_requests(idempotency_key,actor_id,subscription_id,action,payload_hash,event_id,created_at) VALUES(?,?,?,?,?,?,?)').run(input.idempotencyKey, user.id, row.id, action, payloadHash, eventId, now.toISOString());
    applyLifecycleDueForSubscription(db, row.id, now);
  });
  return transaction(db, () => serializeLifecycle(db, subscriptionId, user, now), 'read');
}

export function processLifecycleDue(db: DatabaseSync, now: Date, limit = 100): LifecycleProcessResult {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new DomainError(400, 'INVALID_LIMIT', 'Process between one and 500 service agreements at a time.');
  const date = businessDate(now);
  const where = `s.accepted_terms_json IS NOT NULL AND (EXISTS(SELECT 1 FROM lifecycle_events e WHERE e.subscription_id=s.id AND e.status='scheduled' AND e.effective_date<=?) OR (s.expiry_date<=? AND s.stage<>'Closed' AND s.service_state<>'TermEnded'))`;
  const rows = db.prepare(`SELECT s.id,s.number FROM subscriptions s WHERE ${where} ORDER BY s.expiry_date,s.id LIMIT ?`).all(date, date, limit) as { id: string; number: string }[];
  const result: LifecycleProcessResult = { processed: 0, paused: 0, resumed: 0, closed: 0, termEnded: 0, failed: 0, remaining: 0, items: [] };
  for (const row of rows) {
    try {
      const applied = transaction(db, () => applyLifecycleDueForSubscription(db, row.id, now));
      result.processed++; result.paused += applied.paused; result.resumed += applied.resumed; result.closed += applied.closed; result.termEnded += applied.termEnded;
      result.items.push({ subscriptionId: row.id, number: row.number, outcome: 'processed', message: 'Due service actions and accepted expiry policy were applied without changing financial history.' });
    } catch (error) { result.failed++; result.items.push({ subscriptionId: row.id, number: row.number, outcome: 'failed', message: error instanceof DomainError ? error.message : 'Service processing failed. No partial change was saved; retry this agreement.' }); }
  }
  result.remaining = Number(db.prepare(`SELECT count(*) AS count FROM subscriptions s WHERE ${where}`).get(date, date)?.count);
  return result;
}
export function lifecycleRoutes(db: DatabaseSync, clock: () => Date): Router {
  const router = Router();
  router.post('/subscriptions/process-lifecycle', requireRole('admin', 'staff'), (req, res) => { const input = lifecycleProcessSchema.parse(req.body); res.json(processLifecycleDue(db, clock(), input.limit)); });
  router.get('/subscriptions/:id/lifecycle', requireRole(), (req, res) => {
    const id = idSchema.parse(req.params.id); const user = res.locals.user as User;
    res.json(transaction(db, () => { source(db, id, user); applyLifecycleDueForSubscription(db, id, clock()); return serializeLifecycle(db, id, user, clock()); }));
  });
  for (const [path, action] of [['pause', 'pause'], ['resume', 'resume'], ['renew', 'renew'], ['close-early', 'closeEarly'], ['close-term', 'closeTerm']] as const) {
    router.post(`/subscriptions/:id/${path}`, path === 'close-term' ? requireRole('admin', 'staff') : requireRole(), (req, res) => {
      const id = idSchema.parse(req.params.id); const input = action === 'renew' ? lifecycleRenewSchema.parse(req.body) : lifecycleActionSchema.parse(req.body);
      res.json(mutate(db, id, action, input, res.locals.user as User, clock()));
    });
  }
  router.post('/subscriptions/:id/addons/:lineId', requireRole(), (req, res) => {
    const id = idSchema.parse(req.params.id); const lineId = idSchema.parse(req.params.lineId); const input = lifecycleAddonSchema.parse(req.body);
    res.json(mutate(db, id, 'addon', input, res.locals.user as User, clock(), lineId));
  });
  return router;
}
