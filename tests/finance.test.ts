import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import request from 'supertest';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { fixture, signIn, assertNoSecrets } from './fixtures.js';
import { openDatabase, transaction } from '../server/database.js';
import { recordPayment } from '../server/payments.js';
import { summarizeFinance } from '../server/finance.js';
import type { Invoice } from '../shared/billing.js';
import type { Subscription } from '../shared/subscriptions.js';
import type { FinanceFilters, FinanceSummary } from '../shared/finance.js';
import { buildNovemberDemo } from '../server/demo-fixture.js';

async function setup(t: TestContext, price = 100_000) {
  const current = await fixture(t, { appOptions: { billingWorkerOptions: { autoStart: false } } });
  let admin = await signIn(current.app); let now = new Date('2026-11-01T04:00:00.000Z');
  const post = (path: string, input: object) => admin.agent.post(`/api/${path}`).set('X-CSRF-Token', admin.csrfToken).send(input);
  const product = await post('products', { name: 'Finance service', type: 'software', salesPrice: price, costPrice: 1, notes: 'FINANCE PRIVATE COST NOTE', active: true, variants: [] }); assert.equal(product.status, 201);
  const plan = await post('plans', { name: 'Finance monthly', primaryProductId: product.body.id, price, interval: 'monthly', minQuantity: 1, availableFrom: null, availableTo: null, autoClose: true, allowPause: true, allowRenew: true, allowEarlyClose: true, active: true }); assert.equal(plan.status, 201);
  const mayaId = String(current.db.prepare('SELECT id FROM users WHERE email=?').get('maya@brightloop.test')?.id);
  const arunId = String(current.db.prepare('SELECT id FROM users WHERE email=?').get('arun@brightloop.test')?.id);
  async function agreement(customerId = mayaId, changes: object = {}): Promise<Subscription> {
    const created = await post('subscriptions', { customerId, planId: plan.body.id, templateId: null, startDate: '2026-11-01', termPeriods: 12, paymentTermDays: 7, validDays: 7, lines: [{ productId: product.body.id, variantId: null, quantity: 1 }], ...changes, idempotencyKey: randomUUID() }); assert.equal(created.status, 201);
    assert.equal((await post(`subscriptions/${created.body.id}/issue`, { version: 1 })).status, 200);
    const confirmed = await post(`subscriptions/${created.body.id}/confirm`, { version: 2 }); assert.equal(confirmed.status, 200);
    if (confirmed.body.startDate > now.toISOString().slice(0, 10)) return confirmed.body;
    const activated = await post(`subscriptions/${created.body.id}/activate`, { version: confirmed.body.version }); assert.equal(activated.status, 200); return activated.body;
  }
  async function invoice(source: Subscription, confirmed = true): Promise<Invoice> {
    const generated = await post(`subscriptions/${source.id}/invoices`, { expectedPeriodStart: source.startDate, idempotencyKey: randomUUID() }); assert.equal(generated.status, 201);
    if (!confirmed) return generated.body;
    const result = await post(`invoices/${generated.body.id}/confirm`, { version: generated.body.version }); assert.equal(result.status, 200); return result.body;
  }
  async function pay(invoiceId: string, amount: number, paymentDate = now.toISOString().slice(0, 10)) {
    const result = await post(`invoices/${invoiceId}/payments`, { amount, currency: 'INR', method: 'bank_transfer', paymentDate, note: 'FINANCE PRIVATE PAYMENT NOTE', idempotencyKey: randomUUID() }); assert.equal(result.status, 201); return result.body;
  }
  async function summary(filters: FinanceFilters = {}): Promise<FinanceSummary> { const result = await admin.agent.get('/api/finance/summary').query(filters); assert.equal(result.status, 200); return result.body; }
  return { ...current, get admin() { return admin; }, post, agreement, invoice, pay, summary, mayaId, arunId, product: product.body, plan: plan.body,
    async advanceTo(date: string) { const next = new Date(`${date}T04:00:00.000Z`); current.advanceTime(next.getTime() - now.getTime()); now = next; admin = await signIn(current.app); }, clock: () => new Date(now) };
}

test('FIN-01: invoice issue and payment event filters are independent; current balances never pretend to be historical', async t => {
  const current = await setup(t); const old = await current.invoice(await current.agreement(current.mayaId, { startDate: '2026-10-01' }));
  // This old service period was invoiced in November, so it belongs to November's
  // issue cohort. Service period dates never substitute for financial event dates.
  assert.equal(old.issueDate, '2026-11-01'); assert.equal(old.periodStart, '2026-10-01');
  await current.pay(old.id, 25_000, '2026-10-31'); await current.advanceTo('2026-11-02'); await current.pay(old.id, 30_000);
  const filters = { invoiceFrom: '2026-11-01', invoiceTo: '2026-11-01', paymentFrom: '2026-11-02', paymentTo: '2026-11-02' };
  const summary = await current.summary(filters); assert.equal(summary.invoicedRevenue, '100000'); assert.equal(summary.paymentsReceived, '30000'); assert.equal(summary.outstanding, '45000'); assert.equal(summary.invoiceCount, 1); assert.equal(summary.paymentCount, 1);
  const invoiceAxisEmpty = await current.summary({ ...filters, invoiceFrom: '2026-10-01', invoiceTo: '2026-10-31' }); assert.equal(invoiceAxisEmpty.invoicedRevenue, '0'); assert.equal(invoiceAxisEmpty.outstanding, '0'); assert.equal(invoiceAxisEmpty.paymentsReceived, '30000'); assert.equal(invoiceAxisEmpty.activeAgreements, 1);
  const paymentAxisEmpty = await current.summary({ ...filters, paymentFrom: '2026-09-01', paymentTo: '2026-09-30' }); assert.equal(paymentAxisEmpty.paymentsReceived, '0'); assert.equal(paymentAxisEmpty.invoicedRevenue, '100000'); assert.equal(paymentAxisEmpty.outstanding, '45000');
  const cashRows = (await current.admin.agent.get('/api/finance/payments').query(filters)).body; assert.equal(cashRows.total, 1); assert.equal(cashRows.items[0].paymentDate, '2026-11-02'); assert.equal(cashRows.items[0].amount, 30_000);
  assert.deepEqual((await current.summary(filters)).filters, filters); assert.match(summary.definitions.outstanding, /not a historical/);
});

test('FIN-01: invoice lines and multiple payments cannot multiply totals; filters/counts cover every page', async t => {
  const current = await setup(t); const extra = await current.post('products', { name: 'Finance optional line', type: 'addon', salesPrice: 30_000, costPrice: 10_000, notes: 'PRIVATE ADDON NOTE', active: true, variants: [] }); assert.equal(extra.status, 201);
  const first = await current.invoice(await current.agreement(current.mayaId, { lines: [{ productId: current.product.id, variantId: null, quantity: 1 }, { productId: extra.body.id, variantId: null, quantity: 2 }] }));
  const second = await current.invoice(await current.agreement(current.arunId));
  await current.pay(first.id, 10_000); await current.pay(first.id, 20_000); await current.pay(first.id, 30_000);
  const summary = await current.summary(); assert.equal(summary.invoiceCount, 2); assert.equal(summary.invoicedRevenue, '260000'); assert.equal(summary.paymentsReceived, '60000'); assert.equal(summary.outstanding, '200000');
  const invoices = (await current.admin.agent.get('/api/finance/invoices').query({ pageSize: 1 })).body; assert.equal(invoices.total, 2); assert.equal(invoices.items.length, 1);
  const next = (await current.admin.agent.get('/api/finance/invoices').query({ pageSize: 1, page: 2 })).body; assert.equal(next.page, 2); assert.notEqual(invoices.items[0].id, next.items[0].id);
  assert.equal(invoices.items[0].total + next.items[0].total, Number(summary.invoicedRevenue));
  const payments = (await current.admin.agent.get('/api/finance/payments').query({ pageSize: 1, page: 999 })).body; assert.equal(payments.total, 3); assert.equal(payments.page, 3); assert.equal(payments.items.length, 1);
  const own = await current.summary({ customerId: current.mayaId }); assert.equal(own.invoicedRevenue, '160000'); assert.equal(own.paymentsReceived, '60000'); assert.equal(own.outstanding, '100000'); assert.equal(own.activeAgreements, 1);
  const other = await current.summary({ customerId: current.arunId }); assert.equal(other.invoicedRevenue, String(second.total)); assert.equal(other.paymentsReceived, '0');
  for (const path of ['invoices', 'payments', 'agreements']) {
    const response = await current.admin.agent.get(`/api/finance/${path}`).query({ customerId: current.mayaId, pageSize: 1 });
    assert.ok(response.body.items.every((row: { customerId: string }) => row.customerId === current.mayaId));
    const text = JSON.stringify(response.body); assert.equal(text.includes('PRIVATE'), false); assert.equal(text.includes('costPrice'), false); assert.equal(text.includes('note'), false);
  }
});

test('FIN-01: Draft/Canceled are excluded, zero Paid adds no cash, due-today is not overdue', async t => {
  const current = await setup(t); const paid = await current.invoice(await current.agreement()); await current.pay(paid.id, paid.total);
  const open = await current.invoice(await current.agreement(current.arunId));
  await current.invoice(await current.agreement(), false);
  const canceled = await current.invoice(await current.agreement()); assert.equal((await current.post(`invoices/${canceled.id}/cancel`, { version: canceled.version })).status, 200);
  const free = await current.agreement(); assert.equal((await current.post('discounts', { name: 'Free test period', kind: 'percentage', amountMinor: null, percentBps: 10000, minAmount: null, minQuantity: null, startDate: null, endDate: null, maxUses: 1, priority: 0, active: true, scope: 'subscription', subscriptionId: free.id, productIds: [] })).status, 201);
  const zero = await current.invoice(free); assert.equal(zero.status, 'Paid'); assert.equal(zero.total, 0); assert.equal(zero.paymentCount, 0);
  await current.advanceTo('2026-11-08'); const today = await current.summary(); assert.equal(today.invoicedRevenue, '200000'); assert.equal(today.invoiceCount, 3); assert.equal(today.paymentsReceived, '100000'); assert.equal(today.paymentCount, 1); assert.equal(today.outstanding, '100000'); assert.equal(today.overdue, '0');
  assert.equal((await current.admin.agent.get('/api/finance/invoices').query({ view: 'overdue' })).body.total, 0);
  await current.advanceTo('2026-11-09'); const late = await current.summary(); assert.equal(late.overdue, '100000'); assert.equal(late.overdueInvoiceCount, 1);
  const rows = (await current.admin.agent.get('/api/finance/invoices').query({ view: 'overdue', pageSize: 1 })).body; assert.equal(rows.total, 1); assert.equal(rows.items[0].id, open.id); assert.equal(rows.items[0].overdue, true);
  assert.equal((await current.admin.agent.get('/api/finance/invoices').query({ view: 'outstanding' })).body.total, 1);
});

test('FIN-01/PLAN-03: active agreement count includes paused open service and excludes future, expired and effective early closure', async t => {
  const current = await setup(t); const running = await current.agreement(); const paused = await current.agreement();
  assert.equal((await current.post(`subscriptions/${paused.id}/pause`, { version: paused.version, idempotencyKey: randomUUID() })).status, 200);
  const early = await current.agreement(); assert.equal((await current.post(`subscriptions/${early.id}/close-early`, { version: early.version, idempotencyKey: randomUUID() })).status, 200);
  await current.agreement(current.mayaId, { startDate: '2026-12-01' }); await current.agreement(current.mayaId, { termPeriods: 1 });
  // No lifecycle sweep has run: the expired short agreement still has its Active
  // badge, so finance must check the actual service dates independently.
  await current.advanceTo('2026-12-01');
  const summary = await current.summary({ invoiceFrom: '2000-01-01', invoiceTo: '2000-01-02' }); assert.equal(summary.activeAgreements, 2); assert.equal(summary.pausedAgreements, 1); assert.equal(summary.invoicedRevenue, '0');
  const rows = (await current.admin.agent.get('/api/finance/agreements').query({ pageSize: 1 })).body; assert.equal(rows.total, 2);
  const all = (await current.admin.agent.get('/api/finance/agreements')).body.items; assert.deepEqual(new Set(all.map((row: { id: string }) => row.id)), new Set([running.id, paused.id])); assert.equal(all.find((row: { id: string }) => row.id === paused.id).serviceState, 'Paused');
  await current.advanceTo('2027-11-01'); assert.equal((await current.summary()).activeAgreements, 0); // future agreement remains Confirmed until activation
});

test('FIN-01/AUTH-04: all finance URLs enforce internal roles, validate filters, clamp empty pages and omit private fields', async t => {
  const current = await setup(t); const customer = await signIn(current.app, 'maya@brightloop.test'); const other = await signIn(current.app, 'arun@brightloop.test'); const staff = await signIn(current.app, 'staff@brightloop.test');
  for (const path of ['summary', 'agreements', 'invoices', 'payments']) {
    const url = `/api/finance/${path}`; assert.equal((await request(current.app).get(url)).status, 401);
    for (const user of [customer, other]) assert.equal((await user.agent.get(url).query({ customerId: user.user.id })).status, 403);
    const response = await staff.agent.get(url); assert.equal(response.status, 200); assertNoSecrets(response.body);
    for (const query of [{ invoiceFrom: '2026-02-30' }, { paymentTo: '1899-01-01' }, { invoiceFrom: '2026-11-02', invoiceTo: '2026-11-01' }, { paymentFrom: '2026-11-02', paymentTo: '2026-11-01' }, { customerId: 'malformed' }, { role: 'admin' }, { asOf: '2026-11-01' }]) assert.equal((await staff.agent.get(url).query(query)).status, 400);
    if (path !== 'summary') {
      const empty = await staff.agent.get(url).query({ customerId: randomUUID(), page: 999, pageSize: 2 }); assert.equal(empty.status, 200); assert.deepEqual(empty.body, { items: [], total: 0, page: 1, pageSize: 2 });
      for (const query of [{ page: 0 }, { pageSize: 101 }, { page: '1 OR 1=1' }]) assert.equal((await staff.agent.get(url).query(query)).status, 400);
    }
  }
  assert.equal((await staff.agent.get('/api/finance/invoices').query({ view: 'Draft' })).status, 400);
});

test('FIN-01/PAY-01: one read snapshot reconciles cash and balances while another connection commits a payment', async t => {
  const current = await setup(t); const invoice = await current.invoice(await current.agreement()); const other = openDatabase(current.databasePath);
  try {
    const snapshot = transaction(current.db, () => {
      current.db.prepare('SELECT count(*) FROM invoices').get(); // establish SQLite's read snapshot
      recordPayment(other, invoice.id, { amount: 25_000, currency: 'INR', method: 'cash', paymentDate: '2026-11-01', note: '', idempotencyKey: randomUUID() }, current.admin.user.id, current.clock());
      return summarizeFinance(current.db, {}, current.clock());
    }, 'read');
    assert.equal(snapshot.paymentsReceived, '0'); assert.equal(snapshot.outstanding, '100000');
    const latest = await current.summary(); assert.equal(latest.paymentsReceived, '25000'); assert.equal(latest.outstanding, '75000');
  } finally { other.close(); }
});

test('FIN-01/PAY-02: real November demo reconciles 4,188.80 billed, 3,088.80 cash and 1,100 overdue while retaining C’s paid October history', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'subtrack-finance-demo-'));
  const current = await buildNovemberDemo(join(directory, 'november.sqlite'));
  t.after(async () => { await current.app.locals.billingWorker.stop(); await current.app.locals.deliverPending.stop(); current.app.locals.db.close(); rmSync(directory, { recursive: true, force: true }); });
  const admin = await signIn(current.app);
  const filters = { invoiceFrom: '2026-11-01', invoiceTo: '2026-11-30', paymentFrom: '2026-11-01', paymentTo: '2026-11-30' };
  const summary = (await admin.agent.get('/api/finance/summary').query(filters)).body as FinanceSummary;
  assert.equal(summary.businessDate, '2026-11-09'); assert.equal(summary.activeAgreements, 3); assert.equal(summary.pausedAgreements, 0);
  assert.equal(summary.invoicedRevenue, '418880'); assert.equal(summary.invoiceCount, 2); assert.equal(summary.paymentsReceived, '308880'); assert.equal(summary.paymentCount, 2); assert.equal(summary.outstanding, '110000'); assert.equal(summary.overdue, '110000'); assert.equal(summary.overdueInvoiceCount, 1);
  let billed = 0n; let cash = 0n;
  for (let page = 1; page <= 2; page++) {
    const invoices = (await admin.agent.get('/api/finance/invoices').query({ ...filters, pageSize: 1, page })).body; assert.equal(invoices.total, 2); billed += BigInt(invoices.items[0].total);
    const payments = (await admin.agent.get('/api/finance/payments').query({ ...filters, pageSize: 1, page })).body; assert.equal(payments.total, 2); cash += BigInt(payments.items[0].amount);
  }
  assert.equal(billed.toString(), summary.invoicedRevenue); assert.equal(cash.toString(), summary.paymentsReceived);
  const overdue = (await admin.agent.get('/api/finance/invoices').query({ ...filters, view: 'overdue' })).body; assert.equal(overdue.total, 1); assert.equal(overdue.items[0].id, current.records.invoices.B);
  const lifetime = (await admin.agent.get('/api/finance/summary')).body; assert.equal(lifetime.invoiceCount, 3); assert.equal(lifetime.invoicedRevenue, '528880'); assert.equal(lifetime.paymentsReceived, '418880');
  const octoberCash = (await admin.agent.get('/api/finance/summary').query({ ...filters, paymentFrom: '2026-10-01', paymentTo: '2026-10-31' })).body; assert.equal(octoberCash.invoicedRevenue, '418880'); assert.equal(octoberCash.paymentsReceived, '110000');
  const c = (await admin.agent.get(`/api/subscriptions/${current.records.subscriptions.C}`)).body; assert.equal(c.stage, 'Active'); assert.equal(c.nextBillingDate, '2026-11-15');
  const prior = (await admin.agent.get(`/api/invoices/${current.records.invoices.C}`)).body; assert.equal(prior.issueDate, '2026-10-15'); assert.equal(prior.status, 'Paid'); assert.equal(prior.amountPaid, prior.total);
});

function copyRow(db: DatabaseSync, table: 'subscriptions' | 'invoices' | 'invoice_lines', original: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(row => String(row.name));
  const statement = db.prepare(`INSERT INTO ${table}(${columns.map(name => `"${name}"`).join(',')}) VALUES(${columns.map(() => '?').join(',')})`);
  const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(original)!;
  return (changes: Record<string, SQLInputValue>) => statement.run(...columns.map(name => changes[name] ?? row[name]) as SQLInputValue[]);
}

test('FIN-01: legitimate bounded invoices aggregate exactly above JavaScript safe integer range', async t => {
  // This is a numeric correctness fixture, not the later P8 latency benchmark.
  const current = await setup(t, 999_999_999_999); const subscription = await current.agreement(); const invoice = await current.invoice(subscription);
  const cloneSubscription = copyRow(current.db, 'subscriptions', subscription.id); const cloneInvoice = copyRow(current.db, 'invoices', invoice.id);
  const sourceLine = String(current.db.prepare('SELECT id FROM invoice_lines WHERE invoice_id=?').get(invoice.id)?.id); const cloneLine = copyRow(current.db, 'invoice_lines', sourceLine);
  const charge = current.db.prepare('INSERT INTO logical_charges(id,subscription_id,period_start,period_end,kind,outcome,reason,current_invoice_id,created_at,updated_at) VALUES(?,?,?,?,?,?,NULL,NULL,?,?)');
  transaction(current.db, () => {
    for (let index = 1; index < 9009; index++) {
      const subId = randomUUID(); const invoiceId = randomUUID(); const chargeId = randomUUID();
      cloneSubscription({ id: subId, number: `EXACT-SUB-${index}` });
      // Deferred circular relation is assembled as the ordinary generation path does.
      charge.run(chargeId, subId, invoice.periodStart, invoice.periodEnd, 'recurring', 'failed', current.clock().toISOString(), current.clock().toISOString());
      cloneInvoice({ id: invoiceId, number: `EXACT-INV-${index}`, logical_charge_id: chargeId, subscription_id: subId, subscription_number: `EXACT-SUB-${index}` });
      cloneLine({ id: randomUUID(), invoice_id: invoiceId });
      current.db.prepare("UPDATE logical_charges SET outcome='invoiced',current_invoice_id=? WHERE id=?").run(invoiceId, chargeId);
    }
  });
  await current.advanceTo('2026-11-09');
  const expected = (999_999_999_999n * 9009n).toString(); assert.ok(BigInt(expected) > BigInt(Number.MAX_SAFE_INTEGER));
  const summary = await current.summary(); assert.equal(summary.invoicedRevenue, expected); assert.equal(summary.outstanding, expected); assert.equal(summary.overdue, expected); assert.equal(typeof summary.invoicedRevenue, 'string'); assert.equal(summary.invoiceCount, 9009);
  assert.equal((await current.admin.agent.get('/api/finance/invoices').query({ pageSize: 1 })).body.total, 9009);
  assert.equal(current.db.prepare('PRAGMA foreign_key_check').all().length, 0);
});
