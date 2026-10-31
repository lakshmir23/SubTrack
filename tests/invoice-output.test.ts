import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import request from 'supertest';
import type { Invoice } from '../shared/billing.js';
import type { InvoiceDelivery } from '../shared/invoice-output.js';
import { fixture, signIn, demoPassword } from './fixtures.js';

async function setup(t: TestContext, options: { malicious?: boolean; zero?: boolean } = {}) {
  const current = await fixture(t); const admin = await signIn(current.app);
  const post = (path: string, body: object) => admin.agent.post(`/api/${path}`).set('X-CSRF-Token', admin.csrfToken).send(body);
  const customer = options.malicious ? request.agent(current.app) : (await signIn(current.app, 'maya@brightloop.test')).agent;
  let customerId = String(current.db.prepare('SELECT id FROM users WHERE email=?').get('maya@brightloop.test')?.id);
  let email = 'maya@brightloop.test';
  if (options.malicious) {
    email = 'print-safe@example.test';
    const registered = await customer.post('/api/auth/signup').send({ name: 'Maya <img src=x onerror=alert(1)> & "quoted"', email, password: demoPassword });
    assert.equal(registered.status, 201); customerId = registered.body.user.id;
  }
  const product = await post('products', {
    name: options.malicious ? 'Software <script>alert(2)</script> & Co' : 'Business Software', type: 'software',
    salesPrice: 120_000, costPrice: 40_000, notes: 'PRIVATE INTERNAL COST NOTE', active: true,
    variants: [{ name: options.malicious ? 'Odoo <svg onload=alert(3)>' : 'Odoo', adjustment: options.zero ? 0 : 56_000, active: true }],
  });
  assert.equal(product.status, 201);
  const plan = await post('plans', {
    name: 'Monthly operations', primaryProductId: product.body.id, price: options.zero ? 0 : 100_000, interval: 'monthly', minQuantity: 1,
    availableFrom: null, availableTo: null, autoClose: true, allowPause: true, allowRenew: true, allowEarlyClose: true, active: true,
  });
  assert.equal(plan.status, 201);
  const tax = await post('taxes', { name: options.malicious ? 'Tax <img src=x onerror=alert(4)>' : 'Fictional demo tax', rateBps: 1000, productId: null, priority: 0, active: true });
  assert.equal(tax.status, 201);
  const draft = await post('subscriptions', {
    customerId, planId: plan.body.id, templateId: null, startDate: '2026-11-01', termPeriods: 3, paymentTermDays: 7, validDays: 7,
    lines: [{ productId: product.body.id, variantId: product.body.variants[0].id, quantity: 2 }], idempotencyKey: randomUUID(),
  });
  assert.equal(draft.status, 201);
  const issued = await post(`subscriptions/${draft.body.id}/issue`, { version: draft.body.version }); assert.equal(issued.status, 200);
  const confirmed = await post(`subscriptions/${draft.body.id}/confirm`, { version: issued.body.version }); assert.equal(confirmed.status, 200);
  const active = await post(`subscriptions/${draft.body.id}/activate`, { version: confirmed.body.version }); assert.equal(active.status, 200);
  const generated = await post(`subscriptions/${draft.body.id}/invoices`, { expectedPeriodStart: '2026-11-01', idempotencyKey: randomUUID() });
  assert.equal(generated.status, 201);
  return { ...current, admin, customer, email, post, invoice: generated.body as Invoice };
}

test('P5/BILL-03: a send queues one controlled notice for the saved recipient without changing settlement', async t => {
  const current = await setup(t); const key = randomUUID();
  const before = current.db.prepare('SELECT status,version,total,amount_paid,payment_count FROM invoices WHERE id=?').get(current.invoice.id);
  const first = await current.post(`invoices/${current.invoice.id}/send`, { idempotencyKey: key });
  assert.equal(first.status, 201); const delivery = first.body as InvoiceDelivery;
  assert.equal(delivery.invoiceId, current.invoice.id); assert.equal(delivery.recipient, current.email); assert.equal(delivery.status, 'generated');
  assert.ok(delivery.subject.startsWith('TEST · SubTrack invoice ')); assert.ok(delivery.subject.includes('Draft'));
  const saved = current.db.prepare('SELECT recipient,subject,body,status FROM outbox WHERE id=?').get(delivery.id);
  assert.equal(saved?.recipient, current.email); assert.equal(saved?.status, 'generated');
  const body = String(saved?.body);
  for (const value of ['CONTROLLED TEST MESSAGE', 'NOT A PAYMENT REQUEST', 'Do not transfer money', current.invoice.number, current.invoice.subscriptionNumber, 'Draft', 'review copy; not collectible', current.invoice.periodStart, current.invoice.periodEnd]) assert.ok(body.includes(value));
  assert.equal(body.includes('PRIVATE INTERNAL COST NOTE'), false);
  assert.equal('body' in delivery, false); assert.equal('provider_id' in delivery, false);
  const replay = await current.post(`invoices/${current.invoice.id}/send`, { idempotencyKey: key });
  assert.equal(replay.status, 200); assert.equal(replay.body.id, delivery.id);
  await current.app.locals.deliverPending();
  assert.equal(current.db.prepare('SELECT status FROM outbox WHERE id=?').get(delivery.id)?.status, 'generated', 'Development mode proves generation only.');
  assert.deepEqual(current.db.prepare('SELECT status,version,total,amount_paid,payment_count FROM invoices WHERE id=?').get(current.invoice.id), before);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM outbox').get()?.count, 1);
  assert.equal(current.db.prepare("SELECT count(*) AS count FROM invoice_history WHERE kind='email_queued'").get()?.count, 1);
  assert.equal(current.db.prepare("SELECT count(*) AS count FROM audit_events WHERE kind='invoice.email_queued'").get()?.count, 1);
});

test('P5/BILL-03: send keys bind actor and invoice; customer or browser recipient overrides are rejected', async t => {
  const current = await setup(t); const key = randomUUID();
  assert.equal((await current.post(`invoices/${current.invoice.id}/send`, { idempotencyKey: key, recipient: 'unapproved@example.test' })).status, 400);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM outbox').get()?.count, 0);
  assert.equal((await request(current.app).post(`/api/invoices/${current.invoice.id}/send`).send({ idempotencyKey: key })).status, 401);
  const customerSession = await current.customer.get('/api/session');
  assert.equal((await current.customer.post(`/api/invoices/${current.invoice.id}/send`).set('X-CSRF-Token', customerSession.body.csrfToken).send({ idempotencyKey: key })).status, 403);
  assert.equal((await current.customer.get(`/api/invoices/${current.invoice.id}/deliveries`)).status, 403);
  assert.equal((await current.post(`invoices/${current.invoice.id}/send`, { idempotencyKey: key })).status, 201);
  assert.equal((await current.post(`invoices/${randomUUID()}/send`, { idempotencyKey: key })).status, 409);
  const staff = await signIn(current.app, 'staff@brightloop.test');
  assert.equal((await staff.agent.post(`/api/invoices/${current.invoice.id}/send`).set('X-CSRF-Token', staff.csrfToken).send({ idempotencyKey: key })).status, 409);
  assert.equal((await staff.agent.post(`/api/invoices/${current.invoice.id}/send`).set('X-CSRF-Token', staff.csrfToken).send({ idempotencyKey: randomUUID() })).status, 201);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM outbox').get()?.count, 2);
});

test('P5/BILL-03: delivery metadata reflects sending, accepted, failed and unknown without exposing message bodies', async t => {
  const current = await setup(t); const key = randomUUID();
  const queued = await current.post(`invoices/${current.invoice.id}/send`, { idempotencyKey: key }); assert.equal(queued.status, 201);
  current.db.prepare('UPDATE outbox SET claimed_at=? WHERE id=?').run('2026-11-01T04:00:01.000Z', queued.body.id);
  assert.equal((await current.admin.agent.get(`/api/invoices/${current.invoice.id}/deliveries`)).body.items[0].status, 'sending');
  for (const status of ['accepted', 'failed', 'unknown']) {
    current.db.prepare('UPDATE outbox SET status=?,error=? WHERE id=?').run(status, status === 'accepted' ? null : 'Safe delivery failure reason.', queued.body.id);
    const response = await current.admin.agent.get(`/api/invoices/${current.invoice.id}/deliveries`).query({ page: 999, pageSize: 1 });
    assert.equal(response.status, 200); assert.equal(response.body.page, 1); assert.equal(response.body.pageSize, 1); assert.equal(response.body.total, 1);
    assert.equal(response.body.items[0].status, status); assert.equal('body' in response.body.items[0], false);
    const replay = await current.post(`invoices/${current.invoice.id}/send`, { idempotencyKey: key });
    assert.equal(replay.status, 200); assert.equal(replay.body.id, queued.body.id); assert.equal(replay.body.status, status);
  }
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM outbox').get()?.count, 1);
});

test('P5/BILL-03: current Draft, Confirmed and zero-total Paid invoices can be sent; new canceled sends are blocked', async t => {
  await t.test('Confirmed then canceled', async sub => {
    const current = await setup(sub);
    const confirmed = await current.post(`invoices/${current.invoice.id}/confirm`, { version: current.invoice.version }); assert.equal(confirmed.status, 200);
    const sent = await current.post(`invoices/${current.invoice.id}/send`, { idempotencyKey: randomUUID() }); assert.equal(sent.status, 201); assert.ok(sent.body.subject.includes('Confirmed'));
    const canceled = await current.post(`invoices/${current.invoice.id}/cancel`, { version: confirmed.body.version }); assert.equal(canceled.status, 200);
    const blocked = await current.post(`invoices/${current.invoice.id}/send`, { idempotencyKey: randomUUID() }); assert.equal(blocked.status, 409); assert.equal(blocked.body.error.code, 'INVOICE_CANCELED');
    const printed = await current.customer.get(`/api/invoices/${current.invoice.id}/print`); assert.equal(printed.status, 200); assert.ok(printed.text.includes('Canceled · not collectible'));
    assert.equal(current.db.prepare('SELECT count(*) AS count FROM outbox').get()?.count, 1);
  });
  await t.test('zero amount settled without money', async sub => {
    const current = await setup(sub, { zero: true }); assert.equal(current.invoice.total, 0);
    const confirmed = await current.post(`invoices/${current.invoice.id}/confirm`, { version: current.invoice.version }); assert.equal(confirmed.body.status, 'Paid');
    assert.equal((await current.post(`invoices/${current.invoice.id}/send`, { idempotencyKey: randomUUID() })).status, 201);
    const row = current.db.prepare('SELECT status,amount_paid,payment_count FROM invoices WHERE id=?').get(current.invoice.id);
    assert.equal(row?.status, 'Paid'); assert.equal(row.amount_paid, 0); assert.equal(row.payment_count, 0);
  });
});

test('P5/BILL-03: replay after cancellation returns the prior notice without queuing a new obsolete document', async t => {
  const current = await setup(t); const key = randomUUID();
  const sent = await current.post(`invoices/${current.invoice.id}/send`, { idempotencyKey: key }); assert.equal(sent.status, 201);
  assert.equal((await current.post(`invoices/${current.invoice.id}/cancel`, { version: current.invoice.version })).status, 200);
  const replay = await current.post(`invoices/${current.invoice.id}/send`, { idempotencyKey: key }); assert.equal(replay.status, 200); assert.equal(replay.body.id, sent.body.id);
  assert.equal((await current.post(`invoices/${current.invoice.id}/send`, { idempotencyKey: randomUUID() })).status, 409);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM outbox').get()?.count, 1);
});

test('P5/AUTH-04: print uses escaped saved invoice data with nonce CSP and enforces ownership without mutating records', async t => {
  const current = await setup(t, { malicious: true });
  const before = current.db.prepare('SELECT * FROM invoices WHERE id=?').get(current.invoice.id);
  const historyBefore = current.db.prepare('SELECT count(*) AS count FROM invoice_history WHERE invoice_id=?').get(current.invoice.id)?.count;
  const printed = await current.customer.get(`/api/invoices/${current.invoice.id}/print`);
  assert.equal(printed.status, 200); assert.match(printed.headers['content-type'], /text\/html/); assert.equal(printed.headers['cache-control'], 'no-store');
  assert.match(printed.headers['content-disposition'], /^inline; filename="INV-\d+\.html"$/);
  const policy = String(printed.headers['content-security-policy']); assert.ok(policy.includes("default-src 'none'")); assert.equal(policy.includes('unsafe-inline'), false);
  const nonce = policy.match(/script-src 'nonce-([^']+)'/)?.[1]; assert.ok(nonce); assert.ok(printed.text.includes(`<script nonce="${nonce}">`)); assert.ok(printed.text.includes(`<style nonce="${nonce}">`));
  for (const text of ['&lt;script&gt;alert(2)&lt;/script&gt;', '&lt;img src=x onerror=alert(1)&gt;', '&lt;svg onload=alert(3)&gt;', '&amp; Co', '&quot;quoted&quot;', 'Draft · review copy', 'Print invoice', 'Save as PDF']) assert.ok(printed.text.includes(text), text);
  assert.doesNotMatch(printed.text, /<img\s|<svg\s|<script>alert/);
  assert.equal(printed.text.includes('PRIVATE INTERNAL COST NOTE'), false); assert.equal(printed.text.includes('costPrice'), false);
  assert.deepEqual(current.db.prepare('SELECT * FROM invoices WHERE id=?').get(current.invoice.id), before);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM invoice_history WHERE invoice_id=?').get(current.invoice.id)?.count, historyBefore);
  const foreign = await signIn(current.app, 'arun@brightloop.test');
  assert.equal((await foreign.agent.get(`/api/invoices/${current.invoice.id}/print`)).status, 404);
  assert.equal((await request(current.app).get(`/api/invoices/${current.invoice.id}/print`)).status, 401);
  const staff = await signIn(current.app, 'staff@brightloop.test'); assert.equal((await staff.agent.get(`/api/invoices/${current.invoice.id}/print`)).status, 200);
});
