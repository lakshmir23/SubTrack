import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import test, { type TestContext } from 'node:test';
import request from 'supertest';
import { fixture, signIn } from './fixtures.js';
import type { Subscription, SubscriptionCommercialInput } from '../shared/subscriptions.js';
import type { Invoice, DiscountInput } from '../shared/billing.js';
import { createBillingRun, processBillingRun, createBillingWorker } from '../server/billing-workbench.js';
import { migrateBillingWorkbench } from '../server/billing-workbench-schema.js';
import { openDatabase, transaction } from '../server/database.js';

async function setup(t: TestContext, autoStart = false) {
  const current = await fixture(t, { appOptions: { billingWorkerOptions: { autoStart } } }); let admin = await signIn(current.app);
  const post = (path: string, body: object) => admin.agent.post(`/api/${path}`).set('X-CSRF-Token', admin.csrfToken).send(body);
  const put = (path: string, body: object) => admin.agent.put(`/api/${path}`).set('X-CSRF-Token', admin.csrfToken).send(body);
  const productBody = { name: 'Batch software', type: 'software', salesPrice: 10_000, costPrice: 2000, notes: 'Private operations note', active: true, variants: [] };
  const product = (await post('products', productBody)).body;
  const planBody = { name: 'Batch monthly', primaryProductId: product.id, price: 10_000, interval: 'monthly', minQuantity: 1, availableFrom: null, availableTo: null, autoClose: true, allowPause: true, allowRenew: true, allowEarlyClose: true, active: true };
  const plan = (await post('plans', planBody)).body;
  const tax = (await post('taxes', { name: 'Fictional tax', rateBps: 1000, productId: null, priority: 10, active: true })).body;
  const customerId = String(current.db.prepare('SELECT id FROM users WHERE email=?').get('maya@brightloop.test')?.id);
  const input: SubscriptionCommercialInput = { customerId, planId: plan.id, templateId: null, startDate: '2026-11-01', termPeriods: 1, paymentTermDays: 7, validDays: 7, lines: [{ productId: product.id, variantId: null, quantity: 1 }] };
  async function agreement(changes: Partial<SubscriptionCommercialInput> = {}, activate = true): Promise<Subscription> {
    const draft = await post('subscriptions', { ...input, ...changes, idempotencyKey: randomUUID() }); assert.equal(draft.status, 201);
    assert.equal((await post(`subscriptions/${draft.body.id}/issue`, { version: 1 })).status, 200);
    const confirmed = await post(`subscriptions/${draft.body.id}/confirm`, { version: 2 }); assert.equal(confirmed.status, 200);
    if (!activate) return confirmed.body;
    const active = await post(`subscriptions/${draft.body.id}/activate`, { version: 3 }); assert.equal(active.status, 200); return active.body;
  }
  const generate = (source: Subscription, key = randomUUID()) => post(`subscriptions/${source.id}/invoices`, { expectedPeriodStart: source.nextBillingDate || source.startDate, idempotencyKey: key });
  async function canceled(source: Subscription, confirmed = false) {
    const generated = await generate(source); assert.equal(generated.status, 201); let invoice = generated.body as Invoice;
    if (confirmed) { const response = await post(`invoices/${invoice.id}/confirm`, { version: invoice.version }); assert.equal(response.status, 200); invoice = response.body; }
    const response = await post(`invoices/${invoice.id}/cancel`, { version: invoice.version }); assert.equal(response.status, 200); return response.body as Invoice;
  }
  async function discount(changes: Partial<DiscountInput> = {}) {
    const body: DiscountInput = { name: 'One-use offer', kind: 'percentage', amountMinor: null, percentBps: 1000, minAmount: null, minQuantity: null,
      startDate: null, endDate: null, maxUses: 1, priority: 1, active: true, scope: 'subscription', subscriptionId: null, productIds: [], ...changes };
    const response = await post('discounts', body); assert.equal(response.status, 201); return { body, rule: response.body };
  }
  return { ...current, post, put, product, productBody, plan, planBody, tax, input, customerId, agreement, generate, canceled, discount,
    get admin() { return admin; }, clock: () => new Date('2026-11-01T04:00:00.000Z'),
    async advanceDays(days: number) { current.advanceTime(days * 24 * 60 * 60_000); admin = await signIn(current.app); },
  };
}
async function waitRun(current: Awaited<ReturnType<typeof setup>>, id: string) {
  for (let attempt = 0; attempt < 5000; attempt++) {
    const response = await current.admin.agent.get(`/api/billing/runs/${id}`); assert.equal(response.status, 200);
    if (response.body.status === 'completed' || response.body.status === 'failed') return response.body;
    await delay(5);
  }
  assert.fail('The bounded billing run did not complete within the test deadline.');
}

test('P5: indexed projection initializes on confirmation and queue exposes due, future and canceled exceptions', async t => {
  const current = await setup(t); const due = await current.agreement(); const future = await current.agreement({ startDate: '2026-11-15' }, false);
  assert.equal(current.db.prepare('SELECT next_billing_date FROM subscriptions WHERE id=?').get(due.id)?.next_billing_date, '2026-11-01');
  const queue = await current.admin.agent.get('/api/billing/queue'); assert.equal(queue.status, 200); assert.equal(queue.body.total, 1); assert.equal(queue.body.summary.notDueSubscriptions, 1);
  assert.equal(queue.body.items[0].subscriptionId, due.id); assert.equal(queue.body.items[0].periodEnd, '2026-12-01');
  assert.equal((await current.admin.agent.get('/api/billing/queue').query({ q: "' OR 1=1 --" })).body.total, 0);
  const canceled = await current.canceled(due);
  const exceptions = await current.admin.agent.get('/api/billing/queue').query({ view: 'exceptions' }); assert.equal(exceptions.body.summary.canceledInvoices, 1); assert.equal(exceptions.body.items[0].invoiceId, canceled.id);
  const run = createBillingRun(current.db, { limit: 10, subscriptionIds: [future.id], idempotencyKey: randomUUID() }, current.admin.user.id, current.clock());
  await processBillingRun(current.db, run.id, current.clock);
  const result = (await current.admin.agent.get(`/api/billing/runs/${run.id}`)).body; assert.equal(result.nonbillable, 1); assert.equal(result.created, 0);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM logical_charges WHERE subscription_id=?').get(future.id)?.count, 0);
  assert.equal(current.db.prepare('SELECT next_period_index FROM subscriptions WHERE id=?').get(future.id)?.next_period_index, 0);
  await current.advanceDays(14);
  assert.ok((await current.admin.agent.get('/api/billing/queue')).body.items.some((item: { subscriptionId: string }) => item.subscriptionId === future.id));
});

test('P5: 260 persisted due agreements reconcile in bounded async runs, replay is safe and pages respond during processing', { timeout: 60_000 }, async t => {
  const current = await setup(t, true);
  for (let index = 0; index < 260; index++) await current.agreement();
  const key = randomUUID(); const started = await current.post('billing/runs', { limit: 250, idempotencyKey: key }); assert.equal(started.status, 202);
  for (let probe = 0; probe < 3; probe++) {
    const start = performance.now(); const response = await request(current.app).get('/api/health'); assert.equal(response.status, 200); assert.ok(performance.now() - start < 2000, 'Health must remain responsive between item transactions.');
  }
  const first = await waitRun(current, started.body.id); assert.equal(first.status, 'completed'); assert.equal(first.processed, 250); assert.equal(first.created, 250); assert.equal(first.failed, 0); assert.equal(first.remainingDueSubscriptions, 10);
  const items = await current.admin.agent.get(`/api/billing/runs/${first.id}/items`).query({ pageSize: 100 }); assert.equal(items.body.total, 250); assert.equal(items.body.items.length, 100);
  const replay = await current.post('billing/runs', { limit: 250, idempotencyKey: key }); assert.equal(replay.status, 202); assert.equal(replay.body.id, first.id);
  const next = await current.post('billing/runs', { limit: 250, idempotencyKey: randomUUID() }); const last = await waitRun(current, next.body.id);
  assert.equal(last.created, 10); assert.equal(last.remainingDueSubscriptions, 0); assert.equal(current.db.prepare('SELECT count(*) AS count FROM invoices').get()?.count, 260); assert.equal(current.db.prepare('SELECT count(*) AS count FROM logical_charges').get()?.count, 260);
});

test('P5: a failed period remains owed, other items succeed, and explicit retry targets only original failures', async t => {
  const current = await setup(t); const failed = await current.agreement(); await current.agreement(); await current.agreement();
  const run = createBillingRun(current.db, { limit: 3, idempotencyKey: randomUUID() }, current.admin.user.id, current.clock());
  await processBillingRun(current.db, run.id, current.clock, { failGeneration(item, point) { if (item.subscriptionId === failed.id && point === 'before-commit') throw new Error('Trusted injected worker failure.'); } });
  const first = (await current.admin.agent.get(`/api/billing/runs/${run.id}`)).body;
  assert.equal(first.status, 'completed'); assert.equal(first.created, 2); assert.equal(first.failed, 1); assert.equal(first.processed, 3); assert.equal(first.remainingDueSubscriptions, 1);
  assert.equal(current.db.prepare('SELECT next_period_index FROM subscriptions WHERE id=?').get(failed.id)?.next_period_index, 0);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM invoices').get()?.count, 2);
  const failures = await current.admin.agent.get(`/api/billing/runs/${run.id}/items`).query({ outcome: 'failed' }); assert.equal(failures.body.total, 1); assert.equal(failures.body.items[0].retryable, true);
  const retry = await current.post(`billing/runs/${run.id}/retry`, { idempotencyKey: randomUUID() }); assert.equal(retry.status, 202);
  await processBillingRun(current.db, retry.body.id, current.clock);
  const recovered = (await current.admin.agent.get(`/api/billing/runs/${retry.body.id}`)).body; assert.equal(recovered.created, 1); assert.equal(recovered.failed, 0); assert.equal(recovered.retryOf, run.id);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM invoices').get()?.count, 3); assert.equal(current.db.prepare('SELECT count(*) AS count FROM logical_charges').get()?.count, 3);
  assert.equal((await current.admin.agent.get('/api/billing/queue').query({ view: 'exceptions' })).body.summary.failedPeriods, 0);
  const repeatedRetry = await current.post(`billing/runs/${run.id}/retry`, { idempotencyKey: randomUUID() }); await processBillingRun(current.db, repeatedRetry.body.id, current.clock);
  assert.equal((await current.admin.agent.get(`/api/billing/runs/${repeatedRetry.body.id}`)).body.alreadyExisting, 1);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM invoices').get()?.count, 3);
});

test('P5: oldest backlog is processed across agreements after expiry/Closed without skipping historical debt', async t => {
  const current = await setup(t); const oldest = await current.agreement({ startDate: '2026-09-01', termPeriods: 3 }); const newer = await current.agreement({ startDate: '2026-10-01', termPeriods: 3 });
  await current.advanceDays(31); const now = () => new Date('2026-12-02T04:00:00.000Z');
  // Isolated expired-and-closed fixture; P6 separately proves the actual closure operation.
  current.db.prepare("UPDATE subscriptions SET stage='Closed',service_state='Closed' WHERE id=?").run(oldest.id);
  const run = createBillingRun(current.db, { limit: 2, idempotencyKey: randomUUID() }, current.admin.user.id, now()); await processBillingRun(current.db, run.id, now);
  const items = (await current.admin.agent.get(`/api/billing/runs/${run.id}/items`)).body.items;
  assert.deepEqual(items.map((item: { periodStart: string }) => item.periodStart), ['2026-09-01', '2026-10-01']);
  const rest = createBillingRun(current.db, { limit: 20, idempotencyKey: randomUUID() }, current.admin.user.id, now()); await processBillingRun(current.db, rest.id, now);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM invoices WHERE subscription_id=?').get(oldest.id)?.count, 3);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM invoices WHERE subscription_id=?').get(newer.id)?.count, 3);
  assert.equal((await current.admin.agent.get(`/api/billing/runs/${rest.id}`)).body.remainingDueSubscriptions, 0);
});

test('P5: explicit replacement preserves canceled history, current pointers, cursor and ordinary generation receipts', async t => {
  const current = await setup(t); const source = await current.agreement(); const rule = await current.discount(); const originalKey = randomUUID();
  const generated = await current.generate(source, originalKey); assert.equal(generated.status, 201);
  const canceled = (await current.post(`invoices/${generated.body.id}/cancel`, { version: 1 })).body as Invoice;
  const beforeCursor = current.db.prepare('SELECT next_period_index,next_billing_date FROM subscriptions WHERE id=?').get(source.id);
  const preview = await current.post(`invoices/${canceled.id}/replacement/preview`, { version: canceled.version }); assert.equal(preview.status, 200); assert.equal(preview.body.total, 9900);
  const secondPreview = await current.post(`invoices/${canceled.id}/replacement/preview`, { version: canceled.version }); assert.equal(secondPreview.body.previewHash, preview.body.previewHash, 'Random new invoice-line IDs must not invalidate an unchanged preview.');
  const key = randomUUID(); const input = { version: canceled.version, idempotencyKey: key, previewHash: preview.body.previewHash };
  const replacement = await current.post(`invoices/${canceled.id}/replace`, input); assert.equal(replacement.status, 201, JSON.stringify(replacement.body));
  assert.equal(replacement.body.revisionNumber, 2); assert.equal(replacement.body.predecessorId, canceled.id); assert.equal(replacement.body.status, 'Draft'); assert.equal(replacement.body.logicalChargeId, canceled.logicalChargeId);
  assert.equal((await current.post(`invoices/${canceled.id}/replace`, input)).body.id, replacement.body.id);
  assert.equal((await current.post(`invoices/${canceled.id}/replace`, { ...input, idempotencyKey: randomUUID() })).status, 409);
  const old = await current.admin.agent.get(`/api/invoices/${canceled.id}`); assert.equal(old.body.status, 'Canceled'); assert.equal(old.body.total, canceled.total); assert.equal(old.body.currentInvoiceId, replacement.body.id); assert.deepEqual(old.body.allowedActions, []);
  assert.deepEqual(current.db.prepare('SELECT next_period_index,next_billing_date FROM subscriptions WHERE id=?').get(source.id), beforeCursor);
  const replay = await current.generate(source, originalKey); assert.equal(replay.status, 200); assert.equal(replay.body.id, replacement.body.id);
  assert.equal((await current.generate(source)).body.id, replacement.body.id);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM invoices').get()?.count, 2); assert.equal(current.db.prepare('SELECT count(*) AS count FROM logical_charges').get()?.count, 1);
  const usage = await current.admin.agent.get(`/api/discounts/${rule.rule.id}`); assert.equal(usage.body.reserved, 1); assert.equal(usage.body.consumed, 0);
});

test('P5: Confirmed cancellation retains consumed capacity and replacement preview openly reflects its higher new total', async t => {
  const current = await setup(t); const source = await current.agreement(); await current.discount(); const canceled = await current.canceled(source, true);
  assert.equal(canceled.total, 9900); const preview = await current.post(`invoices/${canceled.id}/replacement/preview`, { version: canceled.version });
  assert.equal(preview.status, 200); assert.equal(preview.body.discount, 0); assert.equal(preview.body.total, 11_000);
  const replacement = await current.post(`invoices/${canceled.id}/replace`, { version: canceled.version, idempotencyKey: randomUUID(), previewHash: preview.body.previewHash }); assert.equal(replacement.status, 201);
  assert.equal(replacement.body.status, 'Draft'); assert.equal(replacement.body.discountApplicationState, null);
  assert.equal(current.db.prepare("SELECT count(*) AS count FROM discount_applications WHERE state='consumed'").get()?.count, 1);
});

test('P5: changed replacement previews conflict atomically; review/retry works without losing typed submission key', async t => {
  const current = await setup(t); const source = await current.agreement(); const rule = await current.discount(); const canceled = await current.canceled(source);
  const preview = await current.post(`invoices/${canceled.id}/replacement/preview`, { version: canceled.version }); const key = randomUUID();
  assert.equal((await current.put(`discounts/${rule.rule.id}`, { ...rule.body, percentBps: 2000, version: 1 })).status, 200);
  const rejected = await current.post(`invoices/${canceled.id}/replace`, { version: canceled.version, idempotencyKey: key, previewHash: preview.body.previewHash }); assert.equal(rejected.status, 409); assert.equal(rejected.body.error.code, 'PREVIEW_CHANGED');
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM invoices').get()?.count, 1); assert.equal(current.db.prepare('SELECT current_invoice_id FROM logical_charges WHERE id=?').get(canceled.logicalChargeId)?.current_invoice_id, canceled.id);
  assert.equal((await current.admin.agent.get(`/api/discounts/${rule.rule.id}`)).body.reserved, 0);
  const fresh = await current.post(`invoices/${canceled.id}/replacement/preview`, { version: canceled.version });
  const replaced = await current.post(`invoices/${canceled.id}/replace`, { version: canceled.version, idempotencyKey: key, previewHash: fresh.body.previewHash }); assert.equal(replaced.status, 201); assert.equal(replaced.body.total, 8800);
  assert.equal((await current.put(`discounts/${rule.rule.id}`, { ...rule.body, active: false, version: 2 })).status, 200);
  const replay = await current.post(`invoices/${canceled.id}/replace`, { version: canceled.version, idempotencyKey: key, previewHash: fresh.body.previewHash }); assert.equal(replay.status, 200); assert.equal(replay.body.id, replaced.body.id);
});

test('P5: generation onResult failure rolls back money/cursor and is exposed as retryable persisted failure', async t => {
  const current = await setup(t); const source = await current.agreement(); await current.discount();
  current.db.exec("CREATE TEMP TRIGGER fail_run_outcome BEFORE UPDATE OF outcome ON billing_run_items WHEN NEW.outcome='created' BEGIN SELECT RAISE(ABORT,'Trusted outcome fault'); END");
  const run = createBillingRun(current.db, { limit: 1, idempotencyKey: randomUUID() }, current.admin.user.id, current.clock()); await processBillingRun(current.db, run.id, current.clock);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM invoices').get()?.count, 0); assert.equal(current.db.prepare('SELECT count(*) AS count FROM discount_applications').get()?.count, 0);
  assert.equal(current.db.prepare('SELECT next_period_index FROM subscriptions WHERE id=?').get(source.id)?.next_period_index, 0);
  assert.equal((await current.admin.agent.get(`/api/billing/runs/${run.id}`)).body.failed, 1);
  current.db.exec('DROP TRIGGER fail_run_outcome');
  const retry = await current.post(`billing/runs/${run.id}/retry`, { idempotencyKey: randomUUID() }); await processBillingRun(current.db, retry.body.id, current.clock);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM invoices').get()?.count, 1); assert.equal(current.db.prepare('SELECT count(*) AS count FROM discount_applications').get()?.count, 1);
});

test('P5: live leases are not stolen; an abandoned processing item resumes once after lease expiry', async t => {
  const current = await setup(t); const source = await current.agreement(); const run = createBillingRun(current.db, { limit: 1, idempotencyKey: randomUUID() }, current.admin.user.id, current.clock());
  current.db.prepare("UPDATE billing_runs SET status='running',worker_token='other-live-worker',claimed_at=?,started_at=? WHERE id=?").run(new Date().toISOString(), current.clock().toISOString(), run.id);
  await processBillingRun(current.db, run.id, current.clock); assert.equal(current.db.prepare('SELECT count(*) AS count FROM invoices').get()?.count, 0); assert.equal(current.db.prepare('SELECT worker_token FROM billing_runs WHERE id=?').get(run.id)?.worker_token, 'other-live-worker');
  const key = randomUUID();
  current.db.prepare(`INSERT INTO billing_run_items(id,run_id,position,subscription_id,subscription_number,customer_name,period_start,period_end,generation_key,outcome,reason,retryable,created_at,updated_at)
    VALUES(?,?,1,?,?,?,?,?,?,'processing','Interrupted fixture',0,?,?)`).run(randomUUID(), run.id, source.id, source.number, source.customerName, '2026-11-01', '2026-12-01', key, current.clock().toISOString(), current.clock().toISOString());
  current.db.prepare('UPDATE billing_runs SET claimed_at=? WHERE id=?').run(new Date(Date.now() - 120_000).toISOString(), run.id);
  await processBillingRun(current.db, run.id, current.clock);
  const result = (await current.admin.agent.get(`/api/billing/runs/${run.id}`)).body; assert.equal(result.status, 'completed'); assert.equal(result.created, 1); assert.equal(result.processed, 1);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM invoices').get()?.count, 1); assert.equal(current.db.prepare('SELECT count(*) AS count FROM billing_run_items').get()?.count, 1);
  assert.equal(current.db.prepare('SELECT idempotency_key FROM invoice_generation_requests').get()?.idempotency_key, key);
});

test('P5: graceful stop waits for current work, prevents new claims and leaves a resumable queued run', async t => {
  const current = await setup(t); await current.agreement(); await current.agreement(); await current.agreement();
  const run = createBillingRun(current.db, { limit: 3, idempotencyKey: randomUUID() }, current.admin.user.id, current.clock());
  let stopPromise: Promise<void> | undefined;
  const worker = createBillingWorker(current.db, current.clock, { failGeneration(_item, point) { if (point === 'before-commit' && !stopPromise) setImmediate(() => { stopPromise = worker.stop(); }); } });
  t.after(async () => { await worker.stop(); }); worker.enqueue(run.id);
  for (let index = 0; index < 1000 && !stopPromise; index++) await delay(1);
  assert.ok(stopPromise); await stopPromise;
  const stopped = (await current.admin.agent.get(`/api/billing/runs/${run.id}`)).body; assert.equal(stopped.status, 'queued'); assert.equal(stopped.processed, 1);
  worker.enqueue(run.id); await delay(5); assert.equal(current.db.prepare('SELECT count(*) AS count FROM invoices').get()?.count, 1);
  await processBillingRun(current.db, run.id, current.clock);
  assert.equal((await current.admin.agent.get(`/api/billing/runs/${run.id}`)).body.created, 3); assert.equal(current.db.prepare('SELECT count(*) AS count FROM invoices').get()?.count, 3);
});

test('P5: v6 to v7 migration backfills accepted cursors and preserves financial snapshots', async t => {
  const current = await setup(t); const source = await current.agreement({ termPeriods: 3 }); const future = await current.agreement({ startDate: '2026-11-15' }, false);
  const invoice = await current.generate(source); assert.equal(invoice.status, 201);
  // Remove only v7 structures in this isolated fixture to model the exact pre-projection schema.
  transaction(current.db, () => {
    current.db.exec('DROP TABLE invoice_send_requests; DROP TABLE invoice_replacement_requests; DROP TABLE billing_run_items; DROP TABLE billing_runs; DROP INDEX subscriptions_due_cursor; ALTER TABLE subscriptions DROP COLUMN next_billing_date; DELETE FROM schema_migrations WHERE version=7;');
  });
  migrateBillingWorkbench(current.db); migrateBillingWorkbench(current.db);
  assert.equal(current.db.prepare('SELECT next_billing_date FROM subscriptions WHERE id=?').get(source.id)?.next_billing_date, '2026-12-01');
  assert.equal(current.db.prepare('SELECT next_billing_date FROM subscriptions WHERE id=?').get(future.id)?.next_billing_date, '2026-11-15');
  assert.equal(current.db.prepare('SELECT total FROM invoices WHERE id=?').get(invoice.body.id)?.total, 11_000);
  const reopened = openDatabase(current.databasePath); try { assert.equal(reopened.prepare('SELECT count(*) AS count FROM invoices').get()?.count, 1); } finally { reopened.close(); }
});

async function raceWorkers(t: TestContext, current: Awaited<ReturnType<typeof setup>>, tasks: { kind: 'run' | 'replace'; id: string; body?: object }[]) {
  const login = await request(current.app).post('/api/auth/login').send({ email: 'admin@brightloop.test', password: 'Brightloop!2026' }); assert.equal(login.status, 200);
  const cookie = (login.headers['set-cookie'] as unknown as string[]).map(value => value.split(';')[0]).join('; ');
  const script = `import request from'supertest';import{createApp}from'./server/app.ts';import{processBillingRun}from'./server/billing-workbench.ts';
    const clock=()=>new Date('2026-11-01T04:00:00.000Z');const app=createApp({databasePath:process.env.SUBTRACK_TEST_DB,clock,mailMode:'outbox',billingWorkerOptions:{autoStart:false}});
    process.send({type:'ready'});process.once('message',async m=>{try{
      if(m.task.kind==='run'){await processBillingRun(app.locals.db,m.task.id,clock);const row=app.locals.db.prepare('SELECT status FROM billing_runs WHERE id=?').get(m.task.id);process.send({type:'result',runStatus:row.status});}
      else{const r=await request(app).post('/api/invoices/'+m.task.id+'/replace').set('Cookie',m.cookie).set('X-CSRF-Token',m.csrf).send(m.task.body);process.send({type:'result',httpStatus:r.status,id:r.body.id});}
    }catch(e){process.send({type:'error',message:e.message});process.exitCode=1;}finally{await app.locals.billingWorker.stop();await app.locals.deliverPending.stop();app.locals.db.close();process.disconnect();}});`;
  type Message = { type: string; runStatus?: string; httpStatus?: number; id?: string; message?: string };
  function worker() {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { cwd: process.cwd(), env: { ...process.env, SUBTRACK_TEST_DB: current.databasePath }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    t.after(() => { if (child.exitCode === null) child.kill(); }); let stderr = ''; child.stderr?.on('data', value => { stderr += String(value); });
    const ready = new Promise<void>((resolve, reject) => { child.on('message', raw => { if ((raw as Message).type === 'ready') resolve(); }); child.on('error', reject); child.on('exit', code => { if (code !== 0) reject(new Error(`Worker exited ${code}: ${stderr}`)); }); });
    const result = new Promise<Message>((resolve, reject) => { child.on('message', raw => { const message = raw as Message; if (message.type === 'result') resolve(message); if (message.type === 'error') reject(new Error(message.message)); }); child.on('error', reject); });
    const exited = new Promise<void>((resolve, reject) => { child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Worker exited ${code}: ${stderr}`))); });
    return { child, ready, result, exited };
  }
  const workers = tasks.map(worker); await Promise.all(workers.map(value => value.ready));
  workers.forEach((value, index) => value.child.send({ task: tasks[index], cookie, csrf: login.body.csrfToken }));
  const results = await Promise.all(workers.map(value => value.result)); await Promise.all(workers.map(value => value.exited)); return results;
}

test('P5: independent workers on overlapping runs preserve one charge per period and reconciled outcomes', { timeout: 30_000 }, async t => {
  const current = await setup(t); for (let index = 0; index < 12; index++) await current.agreement();
  const left = createBillingRun(current.db, { limit: 20, idempotencyKey: randomUUID() }, current.admin.user.id, current.clock()); const right = createBillingRun(current.db, { limit: 20, idempotencyKey: randomUUID() }, current.admin.user.id, current.clock());
  await raceWorkers(t, current, [{ kind: 'run', id: left.id }, { kind: 'run', id: right.id }]);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM invoices').get()?.count, 12); assert.equal(current.db.prepare('SELECT count(*) AS count FROM logical_charges').get()?.count, 12);
  assert.equal(current.db.prepare('SELECT sum(created_count) AS count FROM billing_runs').get()?.count, 12);
  for (const run of [left, right]) { const row = (await current.admin.agent.get(`/api/billing/runs/${run.id}`)).body; assert.equal(row.status, 'completed'); assert.equal(row.processed, row.created + row.alreadyExisting + row.nonbillable + row.failed); }
  assert.equal((await current.admin.agent.get('/api/billing/queue')).body.total, 0);
});

test('P5: independent workers cannot claim the same live run or duplicate its persisted items', { timeout: 30_000 }, async t => {
  const current = await setup(t); for (let index = 0; index < 8; index++) await current.agreement();
  const run = createBillingRun(current.db, { limit: 20, idempotencyKey: randomUUID() }, current.admin.user.id, current.clock());
  await raceWorkers(t, current, [{ kind: 'run', id: run.id }, { kind: 'run', id: run.id }]);
  const result = (await current.admin.agent.get(`/api/billing/runs/${run.id}`)).body; assert.equal(result.status, 'completed'); assert.equal(result.created, 8); assert.equal(result.processed, 8);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM billing_run_items WHERE run_id=?').get(run.id)?.count, 8); assert.equal(current.db.prepare('SELECT count(*) AS count FROM invoices').get()?.count, 8);
});

test('P5: independent replacement race creates one linked successor and one current reservation', { timeout: 30_000 }, async t => {
  const current = await setup(t); const source = await current.agreement(); await current.discount(); const canceled = await current.canceled(source);
  const preview = await current.post(`invoices/${canceled.id}/replacement/preview`, { version: canceled.version }); assert.equal(preview.status, 200);
  const results = await raceWorkers(t, current, [0, 1].map(() => ({ kind: 'replace', id: canceled.id, body: { version: canceled.version, idempotencyKey: randomUUID(), previewHash: preview.body.previewHash } })));
  assert.deepEqual(results.map(value => value.httpStatus).sort(), [201, 409]);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM invoices').get()?.count, 2); assert.equal(current.db.prepare("SELECT count(*) AS count FROM invoices WHERE status<>'Canceled'").get()?.count, 1);
  assert.equal(current.db.prepare("SELECT count(*) AS count FROM discount_applications WHERE state='reserved'").get()?.count, 1);
});

test('AUTH-04/P5: run/queue/retry/replacement APIs enforce internal roles and reject forged control fields', async t => {
  const current = await setup(t); const source = await current.agreement(); const canceled = await current.canceled(source);
  const run = createBillingRun(current.db, { limit: 1, idempotencyKey: randomUUID() }, current.admin.user.id, current.clock());
  const customer = await signIn(current.app, 'maya@brightloop.test');
  for (const path of ['billing/queue', 'billing/runs', `billing/runs/${run.id}`, `billing/runs/${run.id}/items`]) assert.equal((await customer.agent.get(`/api/${path}`)).status, 403);
  for (const [path, body] of [
    ['billing/runs', { limit: 1, idempotencyKey: randomUUID() }], [`billing/runs/${run.id}/retry`, { idempotencyKey: randomUUID() }],
    [`invoices/${canceled.id}/replacement/preview`, { version: canceled.version }], [`invoices/${canceled.id}/replace`, { version: canceled.version, idempotencyKey: randomUUID(), previewHash: 'f'.repeat(64) }],
  ] as const) assert.equal((await customer.agent.post(`/api/${path}`).set('X-CSRF-Token', customer.csrfToken).send(body)).status, 403);
  assert.equal((await current.post('billing/runs', { limit: 1, idempotencyKey: randomUUID(), businessDate: '2099-01-01' })).status, 400);
  assert.equal((await current.post('billing/runs', { limit: 1, idempotencyKey: randomUUID(), failGeneration: source.id })).status, 400);
  assert.equal((await current.post('billing/runs', { limit: 501, idempotencyKey: randomUUID() })).status, 400);
  assert.equal((await current.post('billing/runs', { limit: 1, subscriptionIds: [source.id, source.id], idempotencyKey: randomUUID() })).status, 400);
});
