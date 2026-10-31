import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import test, { type TestContext } from 'node:test';
import request from 'supertest';
import type { DiscountInput, DiscountRule, Invoice } from '../shared/billing.js';
import type { Subscription, SubscriptionCommercialInput } from '../shared/subscriptions.js';
import type { ProductInput, PlanInput } from '../shared/catalog.js';
import { generateInvoice } from '../server/billing.js';
import { fixture, signIn, demoPassword } from './fixtures.js';

const discountBody = (changes: Partial<DiscountInput> = {}): DiscountInput => ({
  name: 'Automatic offer', kind: 'percentage', amountMinor: null, percentBps: 1000,
  minAmount: null, minQuantity: null, startDate: null, endDate: null, maxUses: null, priority: 10, active: true,
  scope: 'subscription', subscriptionId: null, productIds: [], ...changes,
});
async function setup(t: TestContext, options: { interval?: PlanInput['interval']; price?: number; taxBps?: number; adjustment?: number } = {}) {
  const current = await fixture(t); let admin = await signIn(current.app);
  const post = (path: string, body: object) => admin.agent.post(`/api/${path}`).set('X-CSRF-Token', admin.csrfToken).send(body);
  const put = (path: string, body: object) => admin.agent.put(`/api/${path}`).set('X-CSRF-Token', admin.csrfToken).send(body);
  const productBody: ProductInput = { name: 'Business Software', type: 'software', salesPrice: 120_000, costPrice: 40_000, notes: 'Private internal note', active: true, variants: [{ name: 'Odoo', adjustment: options.adjustment ?? 56_000, active: true }] };
  const product = (await post('products', productBody)).body;
  const planBody: PlanInput = { name: 'Business recurring', primaryProductId: product.id, price: options.price ?? 100_000, interval: options.interval || 'monthly', minQuantity: 1, availableFrom: null, availableTo: null, autoClose: true, allowPause: true, allowRenew: true, allowEarlyClose: true, active: true };
  const plan = (await post('plans', planBody)).body;
  const taxBody = { name: 'Fictional demo tax', rateBps: options.taxBps ?? 1000, productId: null, priority: 10, active: true };
  const tax = (await post('taxes', taxBody)).body;
  const mayaId = String(current.db.prepare('SELECT id FROM users WHERE email=?').get('maya@brightloop.test')?.id);
  const arunId = String(current.db.prepare('SELECT id FROM users WHERE email=?').get('arun@brightloop.test')?.id);
  const input: SubscriptionCommercialInput = { customerId: mayaId, planId: plan.id, templateId: null, startDate: '2026-11-01', termPeriods: 12, paymentTermDays: 7, validDays: 7,
    lines: [{ productId: product.id, variantId: product.variants[0].id, quantity: 2 }] };
  async function agreement(changes: Partial<SubscriptionCommercialInput> = {}, activate = true): Promise<Subscription> {
    const draft = await post('subscriptions', { ...input, ...changes, idempotencyKey: randomUUID() }); assert.equal(draft.status, 201, JSON.stringify(draft.body));
    const issue = await post(`subscriptions/${draft.body.id}/issue`, { version: 1 }); assert.equal(issue.status, 200);
    const confirm = await post(`subscriptions/${draft.body.id}/confirm`, { version: 2 }); assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
    if (!activate) return confirm.body;
    const active = await post(`subscriptions/${draft.body.id}/activate`, { version: 3 }); assert.equal(active.status, 200); return active.body;
  }
  async function discount(changes: Partial<DiscountInput> = {}): Promise<DiscountRule> {
    const response = await post('discounts', discountBody(changes)); assert.equal(response.status, 201, JSON.stringify(response.body)); return response.body;
  }
  const generate = (subscription: Subscription, idempotencyKey = randomUUID(), expectedPeriodStart = subscription.nextBillingDate || subscription.startDate) => post(`subscriptions/${subscription.id}/invoices`, { expectedPeriodStart, idempotencyKey });
  const confirm = (invoice: Invoice, version = invoice.version) => post(`invoices/${invoice.id}/confirm`, { version });
  const cancel = (invoice: Invoice, version = invoice.version) => post(`invoices/${invoice.id}/cancel`, { version });
  return { ...current, post, put, product, productBody, plan, planBody, tax, taxBody, mayaId, arunId, input, agreement, discount, generate, confirm, cancel,
    get admin() { return admin; }, async advanceDays(days: number) { current.advanceTime(days * 24 * 60 * 60_000); admin = await signIn(current.app); },
  };
}

test('BILL-01/BILL-02/DISC-04: canonical A is 308880 minor units, B is 110000, with saved period/customer/lines and one reserved use', async t => {
  const current = await setup(t); const a = await current.agreement();
  const b = await current.agreement({ customerId: current.arunId, lines: [{ productId: current.product.id, variantId: null, quantity: 1 }] });
  const rule = await current.discount({ name: 'LAUNCH10', minQuantity: 2, startDate: '2026-11-01', endDate: '2026-11-30', maxUses: 1, subscriptionId: a.id });
  const preview = await current.post(`subscriptions/${a.id}/invoices/preview`, { expectedPeriodStart: '2026-11-01' });
  assert.equal(preview.status, 200, JSON.stringify(preview.body)); assert.equal(preview.body.total, 308_880);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM discount_applications').get()?.count, 0, 'Preview must not reserve uses.');
  const generatedA = await current.generate(a); assert.equal(generatedA.status, 201, JSON.stringify(generatedA.body));
  const invoiceA = generatedA.body as Invoice;
  assert.equal(invoiceA.status, 'Draft'); assert.equal(invoiceA.subtotal, 312_000); assert.equal(invoiceA.discount, 31_200); assert.equal(invoiceA.tax, 28_080); assert.equal(invoiceA.total, 308_880);
  assert.equal(invoiceA.customerId, current.mayaId); assert.equal(invoiceA.periodStart, '2026-11-01'); assert.equal(invoiceA.periodEnd, '2026-12-01'); assert.equal(invoiceA.dueDate, '2026-11-08');
  assert.equal(invoiceA.lines[0].unitPrice, 156_000); assert.equal(invoiceA.lines[0].taxableAmount, 280_800); assert.equal(invoiceA.discountApplicationState, 'reserved');
  const generatedB = await current.generate(b); assert.equal(generatedB.status, 201); assert.equal(generatedB.body.total, 110_000); assert.equal(generatedB.body.discount, 0);
  assert.equal(invoiceA.total + generatedB.body.total, 418_880);
  const usage = await current.admin.agent.get(`/api/discounts/${rule.id}`);
  assert.equal(usage.body.reserved, 1); assert.equal(usage.body.consumed, 0); assert.equal(usage.body.remaining, 0);
  assert.equal(usage.body.holdingDrafts[0].id, invoiceA.id);
  assert.equal((await current.admin.agent.get(`/api/subscriptions/${a.id}`)).body.nextBillingDate, '2026-12-01');
});

test('DISC-01/DISC-02: only admin configures validated rules; edits are versioned and unknown IDs fail safely', async t => {
  const current = await setup(t);
  const rule = await current.discount();
  for (const email of ['staff@brightloop.test', 'maya@brightloop.test']) {
    const signed = await signIn(current.app, email);
    assert.equal((await signed.agent.post('/api/discounts').set('X-CSRF-Token', signed.csrfToken).send(discountBody())).status, 403);
    assert.equal((await signed.agent.put(`/api/discounts/${rule.id}`).set('X-CSRF-Token', signed.csrfToken).send({ ...discountBody(), version: 1 })).status, 403);
    assert.equal((await signed.agent.get('/api/discounts')).status, email.startsWith('staff') ? 200 : 403);
  }
  for (const change of [
    { percentBps: -1 }, { percentBps: 10_001 }, { percentBps: 10.5 }, { kind: 'fixed', amountMinor: -1, percentBps: null },
    { minQuantity: 0 }, { maxUses: 0 }, { startDate: '2026-11-30', endDate: '2026-11-01' },
    { startDate: '2026-02-30' }, { scope: 'products', productIds: [] }, { productIds: [current.product.id] },
    { subscriptionId: randomUUID() }, { scope: 'products', productIds: [randomUUID()] }, { kind: 'fixed', amountMinor: 100 },
  ]) assert.equal((await current.post('discounts', { ...discountBody(), ...change })).status, 400);
  const updated = await current.put(`discounts/${rule.id}`, { ...discountBody({ name: 'Changed offer', maxUses: 3 }), version: 1 });
  assert.equal(updated.status, 200); assert.equal(updated.body.version, 2); assert.equal(updated.body.maxUses, 3);
  assert.equal((await current.put(`discounts/${rule.id}`, { ...discountBody(), version: 1 })).status, 409);
  assert.equal((await current.admin.agent.get(`/api/discounts/${randomUUID()}`)).status, 404);
  assert.equal((await current.admin.agent.get('/api/discounts').query({ active: 'true', pageSize: 1 })).body.total, 1);
});

test('DISC-02: minimum amount/quantity and inclusive validity boundaries are independently enforced', async t => {
  const cases: { name: string; change: Partial<DiscountInput>; applies: boolean; reason?: string }[] = [
    { name: 'both exact minimums pass', change: { minAmount: 312_000, minQuantity: 2 }, applies: true },
    { name: 'amount above base fails even when quantity passes', change: { minAmount: 312_001, minQuantity: 2 }, applies: false, reason: 'minimum purchase' },
    { name: 'quantity above count fails even when amount passes', change: { minAmount: 312_000, minQuantity: 3 }, applies: false, reason: 'minimum quantity' },
    { name: 'inclusive first and final day applies', change: { startDate: '2026-11-01', endDate: '2026-11-01' }, applies: true },
    { name: 'before start does not apply', change: { startDate: '2026-11-02' }, applies: false, reason: 'Not yet valid' },
    { name: 'after end does not apply', change: { endDate: '2026-10-31' }, applies: false, reason: 'Expired' },
    { name: 'disabled rule does not apply', change: { active: false }, applies: false, reason: 'disabled' },
  ];
  for (const scenario of cases) await t.test(scenario.name, async sub => {
    const current = await setup(sub); const agreement = await current.agreement(); const rule = await current.discount(scenario.change);
    const response = await current.generate(agreement); assert.equal(response.status, 201);
    assert.equal(response.body.discount, scenario.applies ? 31_200 : 0);
    if (scenario.reason) assert.ok(response.body.discountDecisions.find((decision: { ruleId: string }) => decision.ruleId === rule.id).reason.includes(scenario.reason));
  });
});

test('DISC-03: fixed and percentage product scopes affect only eligible lines and thresholds ignore unrelated products', async t => {
  for (const kind of ['fixed', 'percentage'] as const) await t.test(kind, async sub => {
    const current = await setup(sub);
    const addon = await current.post('products', { ...current.productBody, name: 'Support add-on', type: 'addon', salesPrice: 30_000, variants: [] }); assert.equal(addon.status, 201);
    const agreement = await current.agreement({ lines: [{ productId: current.product.id, variantId: null, quantity: 1 }, { productId: addon.body.id, variantId: null, quantity: 1 }] });
    const changes: Partial<DiscountInput> = { kind, amountMinor: kind === 'fixed' ? 5000 : null, percentBps: kind === 'percentage' ? 5000 : null, scope: 'products', productIds: [addon.body.id], minAmount: 30_000, minQuantity: 1 };
    await current.discount(changes);
    const response = await current.generate(agreement); assert.equal(response.status, 201);
    const lines = response.body.lines as Invoice['lines'];
    assert.equal(lines.find(line => line.productId === current.product.id)?.discount, 0);
    assert.equal(lines.find(line => line.productId === addon.body.id)?.discount, kind === 'fixed' ? 5000 : 15_000);
    assert.equal(response.body.discountSnapshot.eligibleBase, 30_000); assert.equal(response.body.discountSnapshot.eligibleQuantity, 1);
    assert.equal(response.body.total, kind === 'fixed' ? 137_500 : 126_500);
  });
  await t.test('unrelated base and quantity cannot satisfy product-scoped thresholds', async sub => {
    const current = await setup(sub); const addon = await current.post('products', { ...current.productBody, name: 'Small add-on', salesPrice: 1000, variants: [] });
    const agreement = await current.agreement({ lines: [{ productId: current.product.id, variantId: null, quantity: 10 }, { productId: addon.body.id, variantId: null, quantity: 1 }] });
    await current.discount({ scope: 'products', productIds: [addon.body.id], minAmount: 1001, minQuantity: 2 });
    const invoice = await current.generate(agreement); assert.equal(invoice.status, 201); assert.equal(invoice.body.discount, 0);
  });
});

test('DISC-02/DISC-03: fixed allocations use stable largest remainders; percentages round once for the scope', async t => {
  for (const kind of ['fixed', 'percentage'] as const) await t.test(kind, async sub => {
    const current = await setup(sub, { price: 1, taxBps: 0, adjustment: 0 });
    const one = await current.post('products', { ...current.productBody, name: 'One-paisa add-on', salesPrice: 1, variants: [] });
    const two = await current.post('products', { ...current.productBody, name: 'Another one-paisa add-on', salesPrice: 1, variants: [] });
    const lines = [{ productId: current.product.id, variantId: null, quantity: 1 }, { productId: one.body.id, variantId: null, quantity: 1 }];
    if (kind === 'fixed') lines.push({ productId: two.body.id, variantId: null, quantity: 1 });
    const agreement = await current.agreement({ lines });
    await current.discount({ kind, amountMinor: kind === 'fixed' ? 2 : null, percentBps: kind === 'percentage' ? 5000 : null });
    const generated = await current.generate(agreement); assert.equal(generated.status, 201);
    assert.equal(generated.body.discount, kind === 'fixed' ? 2 : 1);
    assert.equal(generated.body.total, 1);
    const expected = agreement.acceptedTerms!.lines.map(line => line.id).sort().slice(0, kind === 'fixed' ? 2 : 1);
    const discounted = (generated.body.lines as Invoice['lines']).filter(line => line.discount === 1).map(line => line.subscriptionLineId).sort();
    assert.deepEqual(discounted, expected);
    assert.equal((generated.body.lines as Invoice['lines']).reduce((sum, line) => sum + line.discount, 0), generated.body.discount);
  });
});

test('DISC-02/DISC-04: priority then stable ID selects one rule without stacking or choosing the largest saving', async t => {
  const current = await setup(t); const agreement = await current.agreement();
  const first = await current.discount({ name: 'First priority small fixed', kind: 'fixed', amountMinor: 100, percentBps: null, priority: 1 });
  await current.discount({ name: 'Later priority larger saving', percentBps: 9000, priority: 2 });
  const tied = await current.discount({ name: 'Tied first priority', kind: 'fixed', amountMinor: 200, percentBps: null, priority: 1 });
  const winner = [first, tied].sort((a, b) => a.id.localeCompare(b.id))[0];
  const response = await current.generate(agreement); assert.equal(response.status, 201);
  assert.equal(response.body.discountSnapshot.id, winner.id); assert.equal(response.body.discount, winner.amountMinor);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM discount_applications').get()?.count, 1);
});

test('BILL-04/DISC-02: 100-percent and capped fixed discounts settle zero totals without fake payments', async t => {
  for (const kind of ['fixed', 'percentage'] as const) await t.test(kind, async sub => {
    const current = await setup(sub); const agreement = await current.agreement();
    await current.discount({ kind, amountMinor: kind === 'fixed' ? 1_000_000 : null, percentBps: kind === 'percentage' ? 10_000 : null, maxUses: 1 });
    const generated = await current.generate(agreement); assert.equal(generated.status, 201); assert.equal(generated.body.total, 0);
    assert.equal(generated.body.discount, 312_000); assert.equal(generated.body.tax, 0);
    const confirmed = await current.confirm(generated.body); assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.status, 'Paid'); assert.equal(confirmed.body.settlementReason, 'zero amount due');
    assert.equal(confirmed.body.amountPaid, 0); assert.equal(confirmed.body.paymentCount, 0); assert.equal(confirmed.body.outstanding, 0);
    assert.equal(confirmed.body.discountApplicationState, 'consumed');
    assert.equal((await current.confirm(generated.body)).body.version, 2);
    assert.equal((await current.cancel(confirmed.body)).status, 409);
    if (current.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='payments'").get()) assert.equal(current.db.prepare('SELECT count(*) AS count FROM payments WHERE invoice_id=?').get(generated.body.id)?.count, 0);
  });
});

test('DISC-04: Draft cancellation releases once, allows another invoice to reserve, and canceled periods stay occupied', async t => {
  const current = await setup(t); const first = await current.agreement(); const second = await current.agreement({ customerId: current.arunId });
  const rule = await current.discount({ maxUses: 1 }); const key = randomUUID();
  const generated = await current.generate(first, key); assert.equal(generated.status, 201);
  const canceled = await current.cancel(generated.body); assert.equal(canceled.status, 200); assert.equal(canceled.body.status, 'Canceled'); assert.equal(canceled.body.discountApplicationState, 'released');
  assert.equal((await current.cancel(generated.body)).body.version, 2);
  const usage = await current.admin.agent.get(`/api/discounts/${rule.id}`); assert.equal(usage.body.reserved, 0); assert.equal(usage.body.consumed, 0); assert.equal(usage.body.remaining, 1);
  const another = await current.generate(second); assert.equal(another.status, 201); assert.equal(another.body.discount, 31_200);
  const replay = await current.generate(first, key); assert.equal(replay.status, 200); assert.equal(replay.body.id, generated.body.id); assert.equal(replay.body.status, 'Canceled');
  const ordinary = await current.generate(first); assert.equal(ordinary.status, 200); assert.equal(ordinary.body.id, generated.body.id);
  assert.equal((await current.post(`subscriptions/${first.id}/invoices/preview`, { expectedPeriodStart: first.startDate })).body.existingInvoiceId, generated.body.id);
  assert.equal((await current.confirm(canceled.body)).status, 409);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM logical_charges').get()?.count, 2);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM invoices').get()?.count, 2);
  assert.equal(current.db.prepare("SELECT count(*) AS count FROM discount_applications WHERE state='released'").get()?.count, 1);
  assert.equal(current.db.prepare("SELECT count(*) AS count FROM discount_applications WHERE state='reserved'").get()?.count, 1);
});

test('DISC-04/BILL-04: confirmation consumes once after rule expiry/edit, and Confirmed cancellation retains the consumed use', async t => {
  const current = await setup(t, { interval: 'daily' }); const agreement = await current.agreement();
  const original = discountBody({ minAmount: 100_000, minQuantity: 2, startDate: '2026-11-01', endDate: '2026-11-01', maxUses: 1, priority: 3, subscriptionId: agreement.id }); const rule = await current.discount(original);
  const generated = await current.generate(agreement); assert.equal(generated.status, 201); assert.equal(generated.body.total, 308_880);
  const changed = await current.put(`discounts/${rule.id}`, { ...original, percentBps: 9000, active: false, minAmount: 999_999, minQuantity: 99,
    startDate: '2025-01-01', endDate: '2025-12-31', maxUses: 2, priority: 99, subscriptionId: null, version: 1 }); assert.equal(changed.status, 200);
  await current.advanceDays(1);
  const confirmed = await current.confirm(generated.body); assert.equal(confirmed.status, 200); assert.equal(confirmed.body.total, 308_880); assert.equal(confirmed.body.discountSnapshot.version, 1);
  for (const key of ['minAmount', 'minQuantity', 'startDate', 'endDate', 'maxUses', 'priority', 'subscriptionId'] as const) assert.equal(confirmed.body.discountSnapshot[key], original[key]);
  assert.equal(confirmed.body.discountApplicationState, 'consumed'); assert.equal((await current.confirm(generated.body)).body.version, 2);
  const canceled = await current.cancel(confirmed.body); assert.equal(canceled.status, 200); assert.equal(canceled.body.discountApplicationState, 'consumed');
  const usage = await current.admin.agent.get(`/api/discounts/${rule.id}`); assert.equal(usage.body.reserved, 0); assert.equal(usage.body.consumed, 1); assert.equal(usage.body.remaining, 1);
  const replayConfirm = await current.confirm(generated.body); assert.equal(replayConfirm.status, 200); assert.equal(replayConfirm.body.status, 'Canceled');
  assert.equal(current.db.prepare("SELECT count(*) AS count FROM discount_applications WHERE state='consumed'").get()?.count, 1);
});

test('DISC-02/DISC-04: exhaustion and expiry stop later invoices in separate still-eligible fixtures', async t => {
  await t.test('exhausted inside valid dates', async sub => {
    const current = await setup(sub, { interval: 'daily' }); const agreement = await current.agreement();
    const rule = await current.discount({ maxUses: 1, startDate: '2026-11-01', endDate: '2026-11-30' });
    const first = await current.generate(agreement); assert.equal(first.status, 201); await current.confirm(first.body);
    await current.advanceDays(1);
    const next = (await current.admin.agent.get(`/api/subscriptions/${agreement.id}`)).body as Subscription;
    const second = await current.generate(next); assert.equal(second.status, 201); assert.equal(second.body.discount, 0);
    assert.ok(second.body.discountDecisions.find((decision: { ruleId: string }) => decision.ruleId === rule.id).reason.includes('exhausted'));
  });
  await t.test('expired while capacity remains', async sub => {
    const current = await setup(sub, { interval: 'daily' }); const agreement = await current.agreement();
    const rule = await current.discount({ maxUses: 10, endDate: '2026-11-01' });
    const first = await current.generate(agreement); assert.equal(first.status, 201); await current.confirm(first.body);
    await current.advanceDays(1);
    const second = await current.generate((await current.admin.agent.get(`/api/subscriptions/${agreement.id}`)).body); assert.equal(second.status, 201); assert.equal(second.body.discount, 0);
    assert.ok(second.body.discountDecisions.find((decision: { ruleId: string }) => decision.ruleId === rule.id).reason.includes('Expired'));
    assert.equal((await current.admin.agent.get(`/api/discounts/${rule.id}`)).body.remaining, 9);
  });
});

test('DISC-02: administrator cannot reduce capacity below reserved plus consumed applications', async t => {
  const current = await setup(t); const first = await current.agreement(); const second = await current.agreement(); const original = discountBody({ maxUses: 2 });
  const rule = await current.discount(original); const a = await current.generate(first); const b = await current.generate(second); assert.equal(a.status, 201); assert.equal(b.status, 201);
  await current.confirm(a.body);
  const reduced = await current.put(`discounts/${rule.id}`, { ...original, maxUses: 1, version: 1 }); assert.equal(reduced.status, 400); assert.equal(reduced.body.error.code, 'DISCOUNT_LIMIT');
  assert.equal((await current.admin.agent.get(`/api/discounts/${rule.id}`)).body.version, 1);
  assert.throws(() => current.db.prepare('UPDATE discount_rules SET max_uses=1 WHERE id=?').run(rule.id));
  const unlimited = await current.put(`discounts/${rule.id}`, { ...original, maxUses: null, version: 1 }); assert.equal(unlimited.status, 200);
  assert.equal(unlimited.body.reserved, 1); assert.equal(unlimited.body.consumed, 1); assert.equal(unlimited.body.remaining, null);
});

test('BILL-01/BILL-02: accepted prices survive archived catalog changes; invoice taxes use generation date and then freeze', async t => {
  const current = await setup(t); const agreement = await current.agreement();
  assert.equal((await current.put(`products/${current.product.id}`, { ...current.productBody, name: 'New catalog name', active: false, salesPrice: 900_000, variants: [{ ...current.product.variants[0], active: false, adjustment: 100_000 }], version: 1 })).status, 200);
  assert.equal((await current.put(`plans/${current.plan.id}`, { ...current.planBody, active: false, price: 900_000, version: 1 })).status, 200);
  assert.equal((await current.put(`taxes/${current.tax.id}`, { ...current.taxBody, rateBps: 2000, version: 1 })).status, 200);
  const generated = await current.generate(agreement); assert.equal(generated.status, 201, JSON.stringify(generated.body));
  assert.equal(generated.body.lines[0].productName, 'Business Software'); assert.equal(generated.body.lines[0].unitPrice, 156_000);
  assert.equal(generated.body.subtotal, 312_000); assert.equal(generated.body.tax, 62_400); assert.equal(generated.body.total, 374_400);
  await current.put(`taxes/${current.tax.id}`, { ...current.taxBody, rateBps: 5000, version: 2 }); await current.discount({ percentBps: 9000 });
  const frozen = await current.admin.agent.get(`/api/invoices/${generated.body.id}`); assert.equal(frozen.body.total, 374_400); assert.equal(frozen.body.lines[0].taxRateBps, 2000);
  assert.equal((await current.confirm(generated.body)).body.total, 374_400);
  assert.throws(() => current.db.prepare('UPDATE invoices SET total=1 WHERE id=?').run(generated.body.id));
  assert.throws(() => current.db.prepare('UPDATE invoice_lines SET quantity=1 WHERE invoice_id=?').run(generated.body.id));
  assert.throws(() => current.db.prepare('DELETE FROM invoice_lines WHERE invoice_id=?').run(generated.body.id));
  assert.throws(() => current.db.prepare('UPDATE logical_charges SET period_start=? WHERE id=?').run('2026-11-02', generated.body.logicalChargeId));
});

test('DISC-04: backlog eligibility uses generation business date rather than historical period start', async t => {
  const current = await setup(t); const agreement = await current.agreement({ startDate: '2026-10-01' });
  await current.discount({ startDate: '2026-11-01', endDate: '2026-11-30', subscriptionId: agreement.id });
  const generated = await current.generate(agreement); assert.equal(generated.status, 201);
  assert.equal(generated.body.periodStart, '2026-10-01'); assert.equal(generated.body.issueDate, '2026-11-01'); assert.equal(generated.body.dueDate, '2026-11-08');
  assert.equal(generated.body.discount, 31_200); assert.equal(generated.body.discountSnapshot.eligibilityDate, '2026-11-01');
});

test('BILL-05: failure before commit rolls back invoice, logical charge, cursor, usage, receipt, reference and audit', async t => {
  const current = await setup(t); const agreement = await current.agreement(); const rule = await current.discount({ maxUses: 1 }); const key = randomUUID();
  const sourceBefore = current.db.prepare('SELECT next_period_index,version FROM subscriptions WHERE id=?').get(agreement.id);
  assert.throws(() => generateInvoice(current.db, agreement.id, { expectedPeriodStart: '2026-11-01', idempotencyKey: key }, current.admin.user.id, new Date('2026-11-01T04:00:00.000Z'), {
    failpoint(point) { if (point === 'before-commit') throw new Error('Trusted test failure before commit.'); },
  }));
  for (const table of ['invoices', 'invoice_lines', 'logical_charges', 'discount_applications', 'invoice_generation_requests', 'invoice_history']) assert.equal(current.db.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count, 0);
  assert.deepEqual(current.db.prepare('SELECT next_period_index,version FROM subscriptions WHERE id=?').get(agreement.id), sourceBefore);
  assert.equal(current.db.prepare("SELECT 1 FROM reference_counters WHERE kind='invoice'").get(), undefined);
  assert.equal(current.db.prepare("SELECT count(*) AS count FROM audit_events WHERE kind LIKE 'invoice.%'").get()?.count, 0);
  assert.equal((await current.admin.agent.get(`/api/discounts/${rule.id}`)).body.remaining, 1);
  const retried = await current.generate(agreement, key); assert.equal(retried.status, 201); assert.equal(retried.body.number, 'INV-000001'); assert.equal(retried.body.discount, 31_200);
});

test('BILL-05: period and receipt replay never advance into another period or consume another use', async t => {
  const current = await setup(t, { interval: 'daily' }); const agreement = await current.agreement(); const key = randomUUID(); await current.discount({ maxUses: 10 });
  const first = await current.generate(agreement, key); assert.equal(first.status, 201);
  const replay = await current.generate(agreement, key); assert.equal(replay.status, 200); assert.equal(replay.body.id, first.body.id);
  const anotherKey = await current.generate(agreement); assert.equal(anotherKey.status, 200); assert.equal(anotherKey.body.id, first.body.id);
  const conflict = await current.generate(agreement, key, '2026-11-02'); assert.equal(conflict.status, 409); assert.equal(conflict.body.error.code, 'IDEMPOTENCY_CONFLICT');
  const staff = await signIn(current.app, 'staff@brightloop.test');
  const crossActor = await staff.agent.post(`/api/subscriptions/${agreement.id}/invoices`).set('X-CSRF-Token', staff.csrfToken).send({ expectedPeriodStart: '2026-11-01', idempotencyKey: key }); assert.equal(crossActor.status, 409);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM invoices').get()?.count, 1);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM logical_charges').get()?.count, 1);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM discount_applications').get()?.count, 1);
  assert.equal(current.db.prepare('SELECT next_period_index FROM subscriptions WHERE id=?').get(agreement.id)?.next_period_index, 1);
  assert.equal(current.db.prepare('SELECT logical_charge_id FROM invoice_generation_requests WHERE idempotency_key=?').get(key)?.logical_charge_id, first.body.logicalChargeId);
});

test('BILL-01/BILL-05: only accepted due oldest periods generate, forged amounts fail, and earlier debt survives expiry', async t => {
  const current = await setup(t, { interval: 'daily' });
  const draft = await current.post('subscriptions', { ...current.input, idempotencyKey: randomUUID() }); assert.equal(draft.status, 201);
  const payload = { expectedPeriodStart: '2026-11-01', idempotencyKey: randomUUID() };
  assert.equal((await current.post(`subscriptions/${draft.body.id}/invoices`, payload)).body.error.code, 'AGREEMENT_NOT_CONFIRMED');
  await current.post(`subscriptions/${draft.body.id}/issue`, { version: 1 });
  assert.equal((await current.post(`subscriptions/${draft.body.id}/invoices`, payload)).body.error.code, 'AGREEMENT_NOT_CONFIRMED');
  const future = await current.agreement({ startDate: '2026-11-15' }, false);
  assert.equal((await current.generate(future)).body.error.code, 'NOT_DUE');
  const accepted = await current.agreement({ termPeriods: 1 });
  assert.equal((await current.generate(accepted, randomUUID(), '2026-11-02')).status, 409);
  assert.equal((await current.post(`subscriptions/${accepted.id}/invoices`, { ...payload, total: 1 })).status, 400);
  assert.equal((await current.post(`subscriptions/${accepted.id}/invoices`, { ...payload, failpoint: 'before-commit' })).status, 400);
  assert.throws(() => generateInvoice(current.db, accepted.id, payload, current.mayaId, new Date('2026-11-01T04:00:00.000Z')));
  await current.advanceDays(2);
  const oldDebt = await current.generate(accepted); assert.equal(oldDebt.status, 201); assert.equal(oldDebt.body.periodStart, '2026-11-01'); assert.equal(oldDebt.body.periodEnd, '2026-11-02'); assert.equal(oldDebt.body.issueDate, '2026-11-03');
  const ended = (await current.admin.agent.get(`/api/subscriptions/${accepted.id}`)).body as Subscription;
  assert.equal(ended.nextBillingDate, null);
  const noNewPeriod = await current.generate(ended, randomUUID(), '2026-11-02'); assert.equal(noNewPeriod.status, 400); assert.equal(noNewPeriod.body.error.code, 'TERM_ENDED');
});

test('AUTH-04: customer invoice lists/details/actions remain owner-scoped and omit global usage/decisions/internal fields', async t => {
  const current = await setup(t); const a = await current.agreement(); const b = await current.agreement({ customerId: current.arunId }); await current.discount({ maxUses: 1, subscriptionId: a.id });
  const first = await current.generate(a); const second = await current.generate(b); assert.equal(first.status, 201); assert.equal(second.status, 201);
  const maya = await signIn(current.app, 'maya@brightloop.test');
  const list = await maya.agent.get('/api/invoices'); assert.equal(list.status, 200); assert.equal(list.body.total, 1); assert.equal(list.body.items[0].id, first.body.id);
  assert.equal((await maya.agent.get('/api/invoices').query({ customerId: current.arunId })).body.total, 0);
  assert.equal((await maya.agent.get(`/api/invoices/${second.body.id}`)).status, 404);
  const own = await maya.agent.get(`/api/invoices/${first.body.id}`); assert.equal(own.status, 200); assert.deepEqual(own.body.allowedActions, []);
  for (const field of ['discountDecisions', 'holdingDrafts', 'reserved', 'consumed', 'remaining', 'costPrice', 'cost_price', 'notes']) assert.equal(JSON.stringify(own.body).includes(`"${field}":`), false);
  for (const value of ['Private internal note', 'arun@brightloop.test']) assert.equal(JSON.stringify(own.body).includes(value), false);
  assert.equal((await maya.agent.get('/api/discounts')).status, 403);
  for (const id of [first.body.id, second.body.id]) for (const action of ['confirm', 'cancel']) assert.equal((await maya.agent.post(`/api/invoices/${id}/${action}`).set('X-CSRF-Token', maya.csrfToken).send({ version: 1 })).status, 403);
  for (const suffix of ['', '/preview']) assert.equal((await maya.agent.post(`/api/subscriptions/${a.id}/invoices${suffix}`).set('X-CSRF-Token', maya.csrfToken).send({ expectedPeriodStart: '2026-11-01', idempotencyKey: randomUUID() })).status, 403);
  assert.equal((await request(current.app).get(`/api/invoices/${first.body.id}`)).status, 401);
});

test('BILL-04: due today is not overdue; saved confirmed balances and full-filter totals survive pagination', async t => {
  const current = await setup(t); const first = await current.generate(await current.agreement()); const second = await current.generate(await current.agreement());
  await current.confirm(first.body); await current.confirm(second.body);
  const page = await current.admin.agent.get('/api/invoices').query({ status: 'Confirmed', pageSize: 1, page: 99 }); assert.equal(page.body.total, 2); assert.equal(page.body.page, 2); assert.equal(page.body.items.length, 1);
  await current.advanceDays(7);
  assert.equal((await current.admin.agent.get('/api/invoices').query({ overdue: 'true' })).body.total, 0);
  await current.advanceDays(1);
  const overdue = await current.admin.agent.get('/api/invoices').query({ overdue: 'true', pageSize: 1 }); assert.equal(overdue.body.total, 2); assert.equal(overdue.body.items[0].overdue, true);
  assert.equal((await current.admin.agent.get(`/api/invoices/${first.body.id}`)).body.outstanding, first.body.total);
});

async function raceGenerate(t: TestContext, current: Awaited<ReturnType<typeof setup>>, bodies: { subscriptionId: string; expectedPeriodStart: string; idempotencyKey: string }[]) {
  const login = await request(current.app).post('/api/auth/login').send({ email: 'admin@brightloop.test', password: demoPassword }); assert.equal(login.status, 200);
  const cookie = (login.headers['set-cookie'] as unknown as string[]).map(value => value.split(';')[0]).join('; ');
  const script = `import request from 'supertest';import{createApp}from'./server/app.ts';
    const app=createApp({databasePath:process.env.SUBTRACK_TEST_DB,mailMode:'outbox',clock:()=>new Date('2026-11-01T04:00:00.000Z')});
    process.send({type:'ready'});process.once('message',async m=>{try{const r=await request(app).post('/api/subscriptions/'+m.body.subscriptionId+'/invoices')
      .set('Cookie',m.cookie).set('X-CSRF-Token',m.csrf).send({expectedPeriodStart:m.body.expectedPeriodStart,idempotencyKey:m.body.idempotencyKey});
      process.send({type:'result',status:r.status,id:r.body.id,discount:r.body.discount,error:r.body.error?.code});}
    catch(e){process.send({type:'error',message:e.message});process.exitCode=1;}finally{app.locals.db.close();process.disconnect();}});`;
  type Message = { type: string; status: number; id: string; discount: number; error?: string; message?: string };
  function worker() {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { cwd: process.cwd(), env: { ...process.env, SUBTRACK_TEST_DB: current.databasePath }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    t.after(() => { if (child.exitCode === null) child.kill(); }); let stderr = ''; child.stderr?.on('data', value => { stderr += String(value); });
    const ready = new Promise<void>((resolve, reject) => { child.on('message', raw => { if ((raw as Message).type === 'ready') resolve(); }); child.on('error', reject); child.on('exit', code => { if (code !== 0) reject(new Error(`Worker exited ${code}: ${stderr}`)); }); });
    const result = new Promise<Message>((resolve, reject) => { child.on('message', raw => { const message = raw as Message; if (message.type === 'result') resolve(message); if (message.type === 'error') reject(new Error(message.message)); }); child.on('error', reject); });
    const exited = new Promise<void>((resolve, reject) => { child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Worker exited ${code}: ${stderr}`))); });
    return { child, ready, result, exited };
  }
  const workers = bodies.map(worker); await Promise.all(workers.map(value => value.ready));
  workers.forEach((value, index) => value.child.send({ cookie, csrf: login.body.csrfToken, body: bodies[index] }));
  const results = await Promise.all(workers.map(value => value.result)); await Promise.all(workers.map(value => value.exited)); return results;
}

test('DISC-02: two independent workers compete for the final use and only one reserves it', { timeout: 30_000 }, async t => {
  const current = await setup(t); const a = await current.agreement(); const b = await current.agreement(); const rule = await current.discount({ maxUses: 1 });
  const results = await raceGenerate(t, current, [a, b].map(source => ({ subscriptionId: source.id, expectedPeriodStart: '2026-11-01', idempotencyKey: randomUUID() })));
  assert.deepEqual(results.map(value => value.status), [201, 201]); assert.deepEqual(results.map(value => value.discount).sort((x, y) => x - y), [0, 31_200]);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM invoices').get()?.count, 2);
  assert.equal(current.db.prepare("SELECT count(*) AS count FROM discount_applications WHERE state='reserved'").get()?.count, 1);
  const usage = await current.admin.agent.get(`/api/discounts/${rule.id}`); assert.equal(usage.body.reserved, 1); assert.equal(usage.body.remaining, 0);
});

test('BILL-05: two independent workers cannot invoice the same logical period or reserve its discount twice', { timeout: 30_000 }, async t => {
  const current = await setup(t); const agreement = await current.agreement(); await current.discount({ maxUses: 2 });
  const bodies = [0, 1].map(() => ({ subscriptionId: agreement.id, expectedPeriodStart: '2026-11-01', idempotencyKey: randomUUID() }));
  const results = await raceGenerate(t, current, bodies); assert.deepEqual(results.map(value => value.status).sort(), [200, 201]); assert.equal(results[0].id, results[1].id);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM invoices').get()?.count, 1); assert.equal(current.db.prepare('SELECT count(*) AS count FROM logical_charges').get()?.count, 1);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM discount_applications').get()?.count, 1); assert.equal(current.db.prepare('SELECT next_period_index FROM subscriptions WHERE id=?').get(agreement.id)?.next_period_index, 1);
});
