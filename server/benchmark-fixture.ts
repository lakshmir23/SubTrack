import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import request from 'supertest';
import type { Product, Plan } from '../shared/catalog.js';
import type { Subscription, SubscriptionTerms } from '../shared/subscriptions.js';
import type { Invoice } from '../shared/billing.js';
import { createApp } from './app.js';
import { seedDemo } from './seed.js';
import { transaction } from './database.js';
import { digest } from './security.js';
import { addDays, periodBoundary, type Cadence } from './calendar.js';
import { processBillingRun } from './billing-workbench.js';
import { BENCHMARK_BUSINESS_DATE, BENCHMARK_INSTANT, type BenchmarkManifest } from './benchmark-data.js';
import { validateBenchmarkDatabase } from './benchmark-validation.js';

const password = 'Brightloop!2026';
const cadences: Cadence[] = ['daily', 'weekly', 'monthly', 'yearly'];
const anchors: Record<Cadence, string> = { daily: '2026-11-01', weekly: '2026-09-28', monthly: '2026-01-31', yearly: '2020-02-29' };
const fullTerm: Record<Cadence, number> = { daily: 90, weekly: 60, monthly: 60, yearly: 12 };
type Row = Record<string, SQLInputValue>;
interface Prototype { subscription: Subscription; invoice: Invoice; row: Row; invoiceRow: Row; lines: Row[]; application: Row; cadence: Cadence; style: number; autoClose: boolean }

function inserter(db: DatabaseSync, table: string) {
  // Table names are fixed generator constants, never request input.
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(row => String(row.name));
  const statement = db.prepare(`INSERT INTO ${table}(${columns.map(name => `"${name}"`).join(',')}) VALUES(${columns.map(() => '?').join(',')})`);
  return (row: Row) => statement.run(...columns.map(column => row[column] ?? null));
}
const instant = (date: string) => `${date}T04:00:00.000Z`;

/** Build a fresh isolated 10k/30k fixture; all FK, CHECK and financial triggers stay on. */
export async function buildBenchmarkFixture(targetPath: string): Promise<BenchmarkManifest> {
  const databasePath = resolve(targetPath);
  if (targetPath === ':memory:' || [databasePath, `${databasePath}-wal`, `${databasePath}-shm`, `${databasePath}.manifest.json`].some(path => existsSync(path))) throw new Error('Benchmark requires a new file path; existing data was preserved.');
  mkdirSync(dirname(databasePath), { recursive: true });
  let current = new Date('2020-02-29T04:00:00.000Z');
  const clock = () => new Date(current);
  const app = createApp({ databasePath, clock, mailMode: 'outbox', billingWorkerOptions: { autoStart: false }, demoLabel: 'Synthetic 10,000-agreement benchmark' });
  const db = app.locals.db as DatabaseSync;
  const agent = request.agent(app); let csrf = ''; let sessionUntil = 0;
  const post = async <T>(path: string, body: object): Promise<T> => { const response = await agent.post(`/api/${path}`).set('X-CSRF-Token', csrf).send(body); assert(response.status >= 200 && response.status < 300, `Benchmark prototype ${path}: HTTP ${response.status} ${JSON.stringify(response.body)}`); return response.body as T; };
  const login = async () => { csrf = (await post<{ csrfToken: string }>('auth/login', { email: 'admin@brightloop.test', password })).csrfToken; sessionUntil = current.getTime() + 11 * 60 * 60 * 1000; };
  const day = async (date: string) => { current = new Date(instant(date)); if (current.getTime() >= sessionUntil) await login(); };
  try {
    await seedDemo(db); await login();
    const primary = await post<Product>('products', { name: 'Benchmark business software', type: 'software', salesPrice: 100000, costPrice: 40000, notes: 'Synthetic internal catalog note.', active: true, variants: [{ name: 'Odoo', adjustment: 56000, active: true }] });
    const standard = await post<Product>('products', { name: 'Benchmark standard support', type: 'addon', salesPrice: 25000, costPrice: 8000, notes: 'Synthetic internal support note.', active: true, variants: [] });
    const premium = await post<Product>('products', { name: 'Benchmark premium support', type: 'service', salesPrice: 40000, costPrice: 12000, notes: 'Synthetic internal premium note.', active: true, variants: [] });
    const tax = await post<{ id: string }>('taxes', { name: 'Synthetic 10% exclusive tax', rateBps: 1000, productId: null, priority: 10, active: true });
    const percentage = await post<{ id: string }>('discounts', { name: 'Benchmark ten percent', kind: 'percentage', amountMinor: null, percentBps: 1000, minAmount: null, minQuantity: 1, startDate: '2010-01-01', endDate: '2035-12-31', maxUses: null, priority: 10, active: true, scope: 'subscription', subscriptionId: null, productIds: [] });
    await post('discounts', { name: 'Benchmark premium fixed', kind: 'fixed', amountMinor: 5000, percentBps: null, minAmount: 40000, minQuantity: 1, startDate: '2010-01-01', endDate: '2035-12-31', maxUses: null, priority: 5, active: true, scope: 'products', subscriptionId: null, productIds: [premium.id] });
    const plans = new Map<string, Plan>();
    for (const autoClose of [true, false]) for (const cadence of cadences) {
      plans.set(`${cadence}:${autoClose}`, await post<Plan>('plans', { name: `Benchmark ${cadence}${autoClose ? '' : ' manual expiry'}`, primaryProductId: primary.id, price: 100000, interval: cadence, minQuantity: 1, availableFrom: null, availableTo: null, autoClose, allowPause: true, allowRenew: true, allowEarlyClose: true, active: true }));
    }
    const template = await post<{ id: string }>('quotation-templates', { name: 'Benchmark reusable monthly offer', planId: plans.get('monthly:true')!.id, validDays: 7, lines: [{ productId: primary.id, variantId: null, quantity: 2 }, { productId: standard.id, variantId: null, quantity: 1 }], active: true });
    const admin = db.prepare("SELECT * FROM users WHERE role='admin'").get() as Row;
    const staff = db.prepare("SELECT * FROM users WHERE role='staff'").get() as Row;
    const customerRows: Row[] = [];
    transaction(db, () => {
      const insertUser = inserter(db, 'users');
      for (let index = 0; index < 200; index++) {
        const row: Row = { id: randomUUID(), name: `Benchmark Customer ${String(index + 1).padStart(3, '0')}`, email: `benchmark${String(index + 1).padStart(3, '0')}@brightloop.test`, password_hash: admin.password_hash, role: 'customer', created_at: instant('2020-02-29') };
        insertUser(row); customerRows.push(row);
      }
    });
    const prototypes: Prototype[] = [];
    async function makePrototype(cadence: Cadence, style: number, autoClose: boolean) {
      await day(anchors[cadence]);
      let source = await post<Subscription>('subscriptions', { customerId: customerRows[0].id, planId: plans.get(`${cadence}:${autoClose}`)!.id, templateId: null, startDate: anchors[cadence], termPeriods: fullTerm[cadence], validDays: 7, paymentTermDays: 7,
        lines: [{ productId: primary.id, variantId: style ? primary.variants[0].id : null, quantity: 2 }, { productId: style ? premium.id : standard.id, variantId: null, quantity: 1 }], idempotencyKey: randomUUID() });
      for (const action of ['issue', 'confirm', 'activate']) source = await post(`subscriptions/${source.id}/${action}`, { version: source.version });
      return { source, cadence, style, autoClose };
    }
    const sources: Awaited<ReturnType<typeof makePrototype>>[] = [];
    // Array cadence order aligns with its eventual stable subscription index.
    for (const autoClose of [true, false]) for (const style of [0, 1]) for (const cadence of cadences) sources.push(await makePrototype(cadence, style, autoClose));
    await day('2026-11-01');
    // One real bounded run supplies the result/detail benchmark. Other prototypes
    // are generated at their original dates, never by skipping their old cursor.
    const run = await post<{ id: string }>('billing/runs', { limit: 1, subscriptionIds: [sources[0].source.id], idempotencyKey: randomUUID() });
    await processBillingRun(db, run.id, clock);
    for (const item of sources) {
      await day(anchors[item.cadence]);
      const invoice = await post<Invoice>(`subscriptions/${item.source.id}/invoices`, { expectedPeriodStart: item.source.startDate, idempotencyKey: randomUUID() });
      prototypes.push({ subscription: item.source, invoice, row: db.prepare('SELECT * FROM subscriptions WHERE id=?').get(item.source.id) as Row, invoiceRow: db.prepare('SELECT * FROM invoices WHERE id=?').get(invoice.id) as Row,
        lines: db.prepare('SELECT * FROM invoice_lines WHERE invoice_id=? ORDER BY position').all(invoice.id) as Row[], application: db.prepare('SELECT * FROM discount_applications WHERE invoice_id=?').get(invoice.id) as Row, cadence: item.cadence, style: item.style, autoClose: item.autoClose });
    }
    await day('2026-11-01');
    // A separate real 100%-discount snapshot demonstrates zero Paid without any payment.
    const zeroRule = await post<{ id: string; version: number }>('discounts', { name: 'Benchmark historical free period', kind: 'percentage', amountMinor: null, percentBps: 10000, minAmount: null, minQuantity: null, startDate: '2026-11-01', endDate: '2026-11-01', maxUses: null, priority: 0, active: true, scope: 'subscription', subscriptionId: null, productIds: [] });
    const zeroSource = await makePrototype('daily', 0, true); await day('2026-11-01');
    const zeroInvoice = await post<Invoice>(`subscriptions/${zeroSource.source.id}/invoices`, { expectedPeriodStart: zeroSource.source.startDate, idempotencyKey: randomUUID() }); assert.equal(zeroInvoice.total, 0);
    const zeroPrototype: Prototype = { subscription: zeroSource.source, invoice: zeroInvoice, row: db.prepare('SELECT * FROM subscriptions WHERE id=?').get(zeroSource.source.id) as Row, invoiceRow: db.prepare('SELECT * FROM invoices WHERE id=?').get(zeroInvoice.id) as Row,
      lines: db.prepare('SELECT * FROM invoice_lines WHERE invoice_id=? ORDER BY position').all(zeroInvoice.id) as Row[], application: db.prepare('SELECT * FROM discount_applications WHERE invoice_id=?').get(zeroInvoice.id) as Row, cadence: 'daily', style: 0, autoClose: true };
    const zeroDisabled = { name: 'Benchmark historical free period', kind: 'percentage', amountMinor: null, percentBps: 10000, minAmount: null, minQuantity: null, startDate: '2026-11-01', endDate: '2026-11-01', maxUses: null, priority: 0, active: false, scope: 'subscription', subscriptionId: null, productIds: [], version: zeroRule.version };
    assert.equal((await agent.put(`/api/discounts/${zeroRule.id}`).set('X-CSRF-Token', csrf).send(zeroDisabled)).status, 200);
    prototypes.push(zeroPrototype);
    await day(BENCHMARK_BUSINESS_DATE);

    const insertSubscription = inserter(db, 'subscriptions'), insertInvoice = inserter(db, 'invoices'), insertLine = inserter(db, 'invoice_lines'), insertApplication = inserter(db, 'discount_applications');
    const insertCharge = inserter(db, 'logical_charges'), insertPayment = inserter(db, 'payments'), insertHistory = inserter(db, 'invoice_history'), insertSubHistory = inserter(db, 'subscription_history'), insertEvent = inserter(db, 'lifecycle_events');
    const receipt = db.prepare('INSERT INTO invoice_generation_requests VALUES(?,?,?,?,?)');
    const updateCursor = db.prepare('UPDATE subscriptions SET next_period_index=?,next_billing_date=?,stage=?,service_state=?,expiry_date=?,term_periods=?,closure_cause=?,early_close_effective=?,updated_at=?,version=version+1 WHERE id=?');
    const confirm = db.prepare("UPDATE invoices SET status=CASE WHEN total=0 THEN 'Paid' ELSE 'Confirmed' END,confirmed_at=?,settled_at=CASE WHEN total=0 THEN ? ELSE NULL END,settlement_reason=CASE WHEN total=0 THEN 'zero amount due' ELSE NULL END,version=version+1 WHERE id=?");
    const consume = db.prepare("UPDATE discount_applications SET state='consumed',consumed_at=? WHERE invoice_id=?");
    const cancel = db.prepare("UPDATE invoices SET status='Canceled',canceled_at=?,version=version+1 WHERE id=?");
    const release = db.prepare("UPDATE discount_applications SET state='released',released_at=? WHERE invoice_id=?");
    const samples = { productId: primary.id, variantId: primary.variants[0].id, addonProductId: standard.id, planId: plans.get('monthly:true')!.id, taxId: tax.id, templateId: template.id, discountId: percentage.id,
      plans: Object.fromEntries(cadences.map(cadence => [cadence, plans.get(`${cadence}:true`)!.id])) as BenchmarkManifest['samples']['plans'], subscriptions: {} as BenchmarkManifest['samples']['subscriptions'], invoices: {} as BenchmarkManifest['samples']['invoices'], billingRunId: run.id, resetToken: '' };
    const remember = (kind: keyof typeof samples.subscriptions, id: string) => { samples.subscriptions[kind] ||= id; };
    const history = (invoiceId: string, kind: string, from: string | null, to: string, date: string, message: string) => insertHistory({ id: randomUUID(), invoice_id: invoiceId, actor_id: admin.id, kind, created_at: instant(date), from_status: from, to_status: to, message, request_version: null });

    transaction(db, () => {
      for (let index = 0; index < 10000; index++) {
        const cadence = cadences[index % 4]; const style = Math.floor(index / 4) % 2;
        const existing = index >= 2000 && index < 2017 ? prototypes[index - 2000] : undefined;
        const termEnded = index >= 8400 && index < 8500;
        const prototype = existing || prototypes.find(item => item.cadence === cadence && item.style === style && item.autoClose === !termEnded)!;
        const customer = existing ? customerRows[0] : customerRows[index % 200];
        const id = existing ? String(existing.row.id) : randomUUID(); const number = existing ? String(existing.row.number) : `BENCH-SUB-${String(index + 1).padStart(5, '0')}`;
        const isDraft = index < 500, quotation = index >= 500 && index < 1000, future = index >= 1000 && index < 1500, confirmed = index >= 1500 && index < 2000;
        const paused = index >= 7400 && index < 8400, expired = index >= 8500 && index < 9500, early = index >= 9500;
        const count = index < 1500 ? 0 : index < 5500 ? 3 : 4;
        const start = future ? '2026-11-15' : anchors[prototype.cadence];
        const term = termEnded || expired ? count + 1 : fullTerm[prototype.cadence]; const expiry = periodBoundary(start, prototype.cadence, term);
        const terms = JSON.parse(String(prototype.row.accepted_terms_json)) as SubscriptionTerms;
        const lineMap = new Map(terms.lines.map(line => [line.id, existing ? line.id : randomUUID()]));
        for (const line of terms.lines) line.id = lineMap.get(line.id)!;
        const termsJson = JSON.stringify(terms); const issued = isDraft ? null : (quotation || future ? BENCHMARK_BUSINESS_DATE : start);
        if (!existing) insertSubscription({ ...prototype.row, id, number, customer_id: customer.id, customer_name: customer.name, customer_email: customer.email, start_date: start, expiry_date: expiry, term_periods: term,
          stage: isDraft ? 'Draft' : quotation ? 'Quotation' : future || confirmed ? 'Confirmed' : 'Active', service_state: 'Running', version: 4, terms_json: termsJson, offered_terms_json: isDraft ? null : termsJson,
          accepted_terms_json: isDraft || quotation ? null : termsJson, issued_date: issued, valid_until: issued ? addDays(issued, 6) : null, accepted_at: isDraft || quotation ? null : instant(issued!), next_period_index: 0, next_billing_date: isDraft || quotation ? null : start, created_at: instant(issued || BENCHMARK_BUSINESS_DATE), updated_at: instant(BENCHMARK_BUSINESS_DATE), closure_cause: null, early_close_effective: null });
        if (!existing) {
          for (const stage of isDraft ? ['Draft'] : quotation ? ['Draft', 'Quotation'] : future || confirmed ? ['Draft', 'Quotation', 'Confirmed'] : ['Draft', 'Quotation', 'Confirmed', 'Active']) insertSubHistory({ id: randomUUID(), subscription_id: id, actor_id: admin.id, kind: stage.toLowerCase(), created_at: instant(issued || BENCHMARK_BUSINESS_DATE), from_stage: stage === 'Draft' ? null : stage === 'Quotation' ? 'Draft' : stage === 'Confirmed' ? 'Quotation' : 'Confirmed', to_stage: stage, message: 'Synthetic benchmark agreement created from validated domain terms.', request_version: null });
        }
        if (isDraft) remember('draft', id); else if (quotation) remember('quotation', id); else if (future) remember('future', id); else if (confirmed) remember('confirmed', id); else if (paused) remember('paused', id); else if (termEnded) remember('termEnded', id); else if (expired) remember('closed', id); else if (early) remember('earlyClosed', id); else remember('running', id);
        for (let period = 0; period < count; period++) {
          const original = existing && period === 0;
          const base = prototype === zeroPrototype && period > 0 ? prototypes[0] : prototype;
          const invoiceId = original ? String(prototype.invoiceRow.id) : randomUUID(); const chargeId = original ? String(prototype.invoiceRow.logical_charge_id) : randomUUID();
          const periodStart = periodBoundary(start, prototype.cadence, period), periodEnd = periodBoundary(start, prototype.cadence, period + 1);
          if (!original) {
            insertCharge({ id: chargeId, subscription_id: id, period_start: periodStart, period_end: periodEnd, kind: 'recurring', outcome: 'failed', reason: null, current_invoice_id: null, created_at: instant(periodStart), updated_at: instant(periodStart) });
            const snapshot = JSON.parse(String(base.invoiceRow.discount_snapshot_json)) as Record<string, unknown>; snapshot.eligibilityDate = periodStart;
            insertInvoice({ ...base.invoiceRow, id: invoiceId, number: `BENCH-INV-${String(index + 1).padStart(5, '0')}-${period + 1}`, logical_charge_id: chargeId, subscription_id: id, subscription_number: number, customer_id: customer.id, customer_name: customer.name, customer_email: customer.email,
              period_start: periodStart, period_end: periodEnd, issue_date: periodStart, due_date: addDays(periodStart, 7), discount_snapshot_json: JSON.stringify(snapshot), created_at: instant(periodStart) });
            for (const line of base.lines) {
              const sourceLine = base.subscription.acceptedTerms!.lines.find(candidate => candidate.id === line.subscription_line_id)!;
              const acceptedLine = terms.lines.find(candidate => candidate.productId === sourceLine.productId)!;
              insertLine({ ...line, id: randomUUID(), invoice_id: invoiceId, subscription_line_id: acceptedLine.id });
            }
            insertApplication({ ...base.application, id: randomUUID(), invoice_id: invoiceId, created_at: instant(periodStart) });
            db.prepare("UPDATE logical_charges SET current_invoice_id=?,outcome='invoiced' WHERE id=?").run(invoiceId, chargeId);
            receipt.run(randomUUID(), admin.id, digest(JSON.stringify([id, periodStart])), chargeId, instant(periodStart));
            history(invoiceId, 'generated', null, 'Draft', periodStart, 'Synthetic benchmark invoice generated from accepted prices.');
          }
          const total = Number(base.invoiceRow.total); const mode = prototype === zeroPrototype && period === 0 ? 'zero' : (index * 4 + period) % 20 < 4 ? 'draft' : (index * 4 + period) % 20 < 10 ? 'confirmed' : (index * 4 + period) % 20 < 14 ? 'partial' : (index * 4 + period) % 20 < 19 ? 'paid' : 'canceled';
          samples.invoices[mode] ||= invoiceId;
          if (mode === 'canceled') { cancel.run(instant(periodStart), invoiceId); release.run(instant(periodStart), invoiceId); history(invoiceId, 'canceled', 'Draft', 'Canceled', periodStart, 'Synthetic unpaid Draft cancellation; its charge remains occupied.'); }
          else if (mode !== 'draft') {
            confirm.run(instant(periodStart), instant(periodStart), invoiceId); consume.run(instant(periodStart), invoiceId); history(invoiceId, 'confirmed', 'Draft', mode === 'zero' ? 'Paid' : 'Confirmed', periodStart, mode === 'zero' ? 'Zero amount due; settled without a payment.' : 'Synthetic invoice confirmed.');
            if (mode === 'partial' || mode === 'paid') {
              const amounts = mode === 'partial' ? [Math.floor(total / 4), Math.floor(total / 3)] : [Math.floor(total / 2), total - Math.floor(total / 2)];
              for (let part = 0; part < amounts.length; part++) {
                const date = addDays(periodStart, part + 1); const amount = amounts[part];
                insertPayment({ id: randomUUID(), invoice_id: invoiceId, amount, currency: 'INR', method: part ? 'cash' : 'bank_transfer', payment_date: date, note: 'Synthetic benchmark internal bank match note.', actor_id: admin.id, recorded_by_name: admin.name, idempotency_key: randomUUID(), payload_hash: digest(JSON.stringify([invoiceId, amount, 'INR', part ? 'cash' : 'bank_transfer', date, 'Synthetic benchmark internal bank match note.'])), created_at: instant(date) });
                history(invoiceId, 'payment_recorded', 'Confirmed', mode === 'paid' && part === 1 ? 'Paid' : 'Confirmed', date, 'Synthetic payment recorded; invoice balance derives from immutable payment facts.');
              }
            }
          }
          if (customer.id === customerRows[0].id && mode === 'paid') { samples.invoices.customerOwn ||= invoiceId; samples.subscriptions.customerOwn ||= id; }
        }
        const boundary = periodBoundary(start, prototype.cadence, count); let cursor = count;
        const event = (kind: string, date: string, message: string) => insertEvent({ id: randomUUID(), subscription_id: id, actor_id: kind === 'expiry' || kind === 'termEnded' ? null : admin.id, kind, requested_date: date, effective_date: date, status: 'applied', created_at: instant(date), applied_at: instant(date), line_id: null, enabled: null, previous_expiry: null, new_expiry: null, message });
        if (paused) {
          event('pause', boundary, 'Synthetic pause at an original boundary, preserving every earlier invoice.');
          insertCharge({ id: randomUUID(), subscription_id: id, period_start: boundary, period_end: periodBoundary(start, prototype.cadence, count + 1), kind: 'recurring', outcome: 'nonbillable', reason: 'Service was paused for this complete original billing period.', current_invoice_id: null, created_at: instant(boundary), updated_at: instant(boundary) }); cursor++;
        }
        if (expired || termEnded) event(expired ? 'expiry' : 'termEnded', expiry, expired ? 'Accepted auto-close at exclusive expiry.' : 'Term ended with automatic closure disabled.');
        const closeDate = early ? periodBoundary(start, prototype.cadence, count + 1) : null;
        if (early) event('closeEarly', closeDate!, 'Synthetic early closure; the earlier unprocessed owed period remains billable.');
        const next = isDraft || quotation ? null : periodBoundary(start, prototype.cadence, cursor);
        updateCursor.run(cursor, next && next < expiry && (!closeDate || next < closeDate) ? next : null, isDraft ? 'Draft' : quotation ? 'Quotation' : future || confirmed ? 'Confirmed' : expired || early ? 'Closed' : 'Active', paused ? 'Paused' : termEnded ? 'TermEnded' : expired || early ? 'Closed' : 'Running', expiry, term, early ? 'early' : expired ? 'expiry' : null, closeDate, BENCHMARK_INSTANT, id);
        if (index >= 2000 && index < 7400 && index % 97 === 0) {
          insertCharge({ id: randomUUID(), subscription_id: id, period_start: boundary, period_end: periodBoundary(start, prototype.cadence, count + 1), kind: 'recurring', outcome: 'failed', reason: 'Synthetic retryable billing exception; no financial snapshot or cursor advance.', current_invoice_id: null, created_at: BENCHMARK_INSTANT, updated_at: BENCHMARK_INSTANT }); remember('failed', id);
        }
        if (count && !paused && !expired && !early && !termEnded) remember('due', id);
      }
      // A local-only test-account token enables read-only reset-form readiness checks.
      samples.resetToken = randomBytes(32).toString('hex');
      db.prepare('INSERT INTO password_resets(id,user_id,token_hash,expires_at,used_at,created_at) VALUES(?,?,?,?,NULL,?)').run(randomUUID(), customerRows[0].id, digest(samples.resetToken), '2026-11-09T04:30:00.000Z', BENCHMARK_INSTANT);
      // Counter values remain beyond every genuine prototype reference.
      db.prepare("UPDATE reference_counters SET value=max(value,10000) WHERE kind='subscription'").run();
      db.prepare("UPDATE reference_counters SET value=max(value,30000) WHERE kind='invoice'").run();
    });
    const validation = validateBenchmarkDatabase(db);
    if (!validation.passed) throw new Error(`Benchmark validation failed: ${validation.errors.join('; ')}`);
    const count = (table: string) => Number(db.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count);
    const group = (sql: string) => Object.fromEntries((db.prepare(sql).all() as { key: string; count: number }[]).map(row => [row.key, row.count]));
    const finance = db.prepare("SELECT CAST(sum(total) AS TEXT) AS billed,CAST(sum(total-amount_paid) AS TEXT) AS outstanding,CAST(sum(CASE WHEN due_date<? THEN total-amount_paid ELSE 0 END) AS TEXT) AS overdue FROM invoices WHERE status IN ('Confirmed','Paid')").get(BENCHMARK_BUSINESS_DATE) as { billed: string; outstanding: string; overdue: string };
    const account = (row: Row) => ({ id: String(row.id), email: String(row.email), password });
    const manifest: BenchmarkManifest = { version: 1, databasePath, createdAt: new Date().toISOString(), businessDate: BENCHMARK_BUSINESS_DATE, instant: BENCHMARK_INSTANT, schemaVersion: Number(db.prepare('SELECT max(version) AS version FROM schema_migrations').get()?.version),
      counts: { customers: Number(db.prepare("SELECT count(*) AS count FROM users WHERE role='customer'").get()?.count), subscriptions: count('subscriptions'), invoices: count('invoices'), invoiceLines: count('invoice_lines'), payments: count('payments'), logicalCharges: count('logical_charges'), lifecycleEvents: count('lifecycle_events'), discountApplications: count('discount_applications') },
      groups: { stages: group('SELECT stage AS key,count(*) AS count FROM subscriptions GROUP BY stage'), serviceStates: group('SELECT service_state AS key,count(*) AS count FROM subscriptions GROUP BY service_state'), cadences: group("SELECT json_extract(terms_json,'$.plan.interval') AS key,count(*) AS count FROM subscriptions GROUP BY key"), invoiceStatuses: group('SELECT status AS key,count(*) AS count FROM invoices GROUP BY status'), chargeOutcomes: group('SELECT outcome AS key,count(*) AS count FROM logical_charges GROUP BY outcome') },
      totals: { ...finance, received: String(db.prepare('SELECT CAST(sum(amount) AS TEXT) AS amount FROM payments').get()?.amount) }, accounts: { admin: account(admin), staff: account(staff), customer: account(customerRows[0]), otherCustomer: account(customerRows[1]) }, samples, validation };
    assert.equal(manifest.counts.subscriptions, 10000); assert.equal(manifest.counts.invoices, 30000);
    writeFileSync(`${databasePath}.manifest.json`, JSON.stringify(manifest, null, 2));
    return manifest;
  } finally { await app.locals.billingWorker.stop(); await app.locals.deliverPending.stop(); db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argument = process.argv[2];
  const target = argument?.startsWith('--output=') ? argument.slice('--output='.length) : argument || `data/benchmark-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`;
  if (process.argv.length > 3 || !target || (argument?.startsWith('--') && !argument.startsWith('--output='))) throw new Error('Usage: npx tsx server/benchmark-fixture.ts [--output=<NEW database path>]');
  const result = await buildBenchmarkFixture(target);
  console.log(JSON.stringify({ databasePath: result.databasePath, manifestPath: `${result.databasePath}.manifest.json`, counts: result.counts, validation: result.validation }, null, 2));
}
