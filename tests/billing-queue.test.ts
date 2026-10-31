import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { Subscription } from '../shared/subscriptions.js';
import type { Invoice } from '../shared/billing.js';
import { fixture, signIn } from './fixtures.js';
import { createBillingRun, processBillingRun } from '../server/billing-workbench.js';

test('BILL-05/FIN-02: queue counts only current canceled revisions and preserves customer/search/failed scopes across pages', async t => {
  const current = await fixture(t, { appOptions: { billingWorkerOptions: { autoStart: false } } });
  const admin = await signIn(current.app);
  const post = (path: string, body: object) => admin.agent.post(`/api/${path}`).set('X-CSRF-Token', admin.csrfToken).send(body);
  const product = await post('products', { name: 'Queue count service', type: 'software', salesPrice: 10000, costPrice: 2000, notes: '', active: true, variants: [] }); assert.equal(product.status, 201);
  const plan = await post('plans', { name: 'Queue count monthly', primaryProductId: product.body.id, price: 10000, interval: 'monthly', minQuantity: 1, availableFrom: null, availableTo: null, autoClose: true, allowPause: true, allowRenew: true, allowEarlyClose: true, active: true }); assert.equal(plan.status, 201);
  const maya = current.db.prepare("SELECT id,name FROM users WHERE email='maya@brightloop.test'").get() as { id: string; name: string };
  const arun = current.db.prepare("SELECT id,name FROM users WHERE email='arun@brightloop.test'").get() as { id: string; name: string };
  async function agreement(customerId: string): Promise<Subscription> {
    const draft = await post('subscriptions', { customerId, planId: plan.body.id, templateId: null, startDate: '2026-11-01', termPeriods: 2, paymentTermDays: 7, validDays: 7, lines: [{ productId: product.body.id, variantId: null, quantity: 1 }], idempotencyKey: randomUUID() }); assert.equal(draft.status, 201);
    const issued = await post(`subscriptions/${draft.body.id}/issue`, { version: draft.body.version }); assert.equal(issued.status, 200);
    const confirmed = await post(`subscriptions/${draft.body.id}/confirm`, { version: issued.body.version }); assert.equal(confirmed.status, 200);
    const active = await post(`subscriptions/${draft.body.id}/activate`, { version: confirmed.body.version }); assert.equal(active.status, 200); return active.body;
  }
  async function cancel(source: Subscription): Promise<Invoice> {
    const generated = await post(`subscriptions/${source.id}/invoices`, { expectedPeriodStart: source.startDate, idempotencyKey: randomUUID() }); assert.equal(generated.status, 201);
    const canceled = await post(`invoices/${generated.body.id}/cancel`, { version: generated.body.version }); assert.equal(canceled.status, 200); return canceled.body;
  }
  const ownCurrent = await agreement(maya.id), historical = await agreement(maya.id), otherCurrent = await agreement(arun.id), failed = await agreement(maya.id);
  const ownCanceled = await cancel(ownCurrent); const oldCanceled = await cancel(historical); const otherCanceled = await cancel(otherCurrent);
  const preview = await post(`invoices/${oldCanceled.id}/replacement/preview`, { version: oldCanceled.version }); assert.equal(preview.status, 200);
  const replacement = await post(`invoices/${oldCanceled.id}/replace`, { version: oldCanceled.version, previewHash: preview.body.previewHash, idempotencyKey: randomUUID() }); assert.equal(replacement.status, 201);
  const run = createBillingRun(current.db, { limit: 1, subscriptionIds: [failed.id], idempotencyKey: randomUUID() }, admin.user.id, new Date('2026-11-01T04:00:00.000Z'));
  await processBillingRun(current.db, run.id, () => new Date('2026-11-01T04:00:00.000Z'), { failGeneration(_item, point) { if (point === 'before-commit') throw new Error('Trusted queue failure fixture.'); } });
  async function queue(query: Record<string, string | number> = {}) { const response = await admin.agent.get('/api/billing/queue').query(query); assert.equal(response.status, 200); return response.body; }
  assert.equal(current.db.prepare("SELECT count(*) AS count FROM invoices WHERE status='Canceled'").get()?.count, 3);
  const due = await queue({ pageSize: 1 }); assert.equal(due.summary.canceledInvoices, 2); assert.equal(due.summary.failedPeriods, 1); assert.equal(due.summary.dueSubscriptions, 1); assert.equal(due.summary.notDueSubscriptions, 3); assert.equal(due.total, 1); assert.equal(due.items[0].subscriptionId, failed.id);
  const exceptions = await queue({ view: 'exceptions', pageSize: 1 }); assert.equal(exceptions.total, 3); assert.equal(exceptions.items.length, 1); assert.deepEqual(exceptions.summary, due.summary);
  const all = await queue({ view: 'exceptions', pageSize: 20 }); assert.deepEqual(new Set(all.items.filter((row: { outcome: string }) => row.outcome === 'canceled').map((row: { invoiceId: string }) => row.invoiceId)), new Set([ownCanceled.id, otherCanceled.id]));
  const own = await queue({ view: 'exceptions', customerId: maya.id, pageSize: 1 }); assert.equal(own.total, 2); assert.equal(own.summary.canceledInvoices, 1); assert.equal(own.summary.failedPeriods, 1);
  const byNumber = await queue({ view: 'exceptions', q: ownCurrent.number }); assert.equal(byNumber.total, 1); assert.equal(byNumber.summary.canceledInvoices, 1); assert.equal(byNumber.summary.failedPeriods, 0);
  const byName = await queue({ view: 'exceptions', q: maya.name }); assert.equal(byName.total, 2); assert.equal(byName.summary.canceledInvoices, 1); assert.equal(byName.summary.failedPeriods, 1);
  const other = await queue({ view: 'exceptions', customerId: arun.id, q: arun.name }); assert.equal(other.total, 1); assert.equal(other.summary.canceledInvoices, 1); assert.equal(other.summary.failedPeriods, 0);
  const emptyQueries: Record<string, string | number>[] = [{ customerId: maya.id, q: arun.name }, { q: '%' }, { q: "' OR 1=1 --" }, { customerId: randomUUID() }];
  for (const query of emptyQueries) {
    const empty = await queue({ ...query, view: 'exceptions' }); assert.equal(empty.total, 0); assert.deepEqual(empty.summary, { dueSubscriptions: 0, failedPeriods: 0, canceledInvoices: 0, notDueSubscriptions: 0 });
  }
  // A second canceled revision on the same period counts once, not once per history row.
  assert.equal((await post(`invoices/${replacement.body.id}/cancel`, { version: replacement.body.version })).status, 200);
  assert.equal(current.db.prepare("SELECT count(*) AS count FROM invoices WHERE status='Canceled'").get()?.count, 4);
  const after = await queue({ view: 'exceptions', customerId: maya.id }); assert.equal(after.summary.canceledInvoices, 2); assert.equal(after.summary.failedPeriods, 1); assert.equal(after.total, 3);
  assert.equal((await queue({ view: 'exceptions', q: historical.number })).summary.canceledInvoices, 1);
});
