import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import request from 'supertest';
import type { PlanInput } from '../shared/catalog.js';
import type { Subscription, SubscriptionCommercialInput } from '../shared/subscriptions.js';
import type { LifecycleState } from '../shared/lifecycle.js';
import { fixture, signIn, demoPassword } from './fixtures.js';
import { evaluateLifecyclePeriod, processLifecycleDue } from '../server/lifecycle.js';
import { createBillingRun, processBillingRun } from '../server/billing-workbench.js';
import { migrateLifecycle } from '../server/lifecycle-schema.js';
import { migrateCatalog } from '../server/catalog-schema.js';
import { migrateSubscriptions } from '../server/subscriptions-schema.js';
import { migrateBilling } from '../server/billing-schema.js';
import { migrateBillingWorkbench } from '../server/billing-workbench-schema.js';
import { migratePayments } from '../server/payments-schema.js';
import { transaction } from '../server/database.js';
import { seedDemo } from '../server/seed.js';
import { buildSubscriptionPreview } from '../server/subscriptions.js';

async function setup(t: TestContext, flags: Partial<PlanInput> = {}) {
  const current = await fixture(t, { appOptions: { billingWorkerOptions: { autoStart: false } } }); let admin = await signIn(current.app); let now = new Date('2026-11-01T04:00:00.000Z');
  const post = (path: string, body: object) => admin.agent.post(`/api/${path}`).set('X-CSRF-Token', admin.csrfToken).send(body);
  const put = (path: string, body: object) => admin.agent.put(`/api/${path}`).set('X-CSRF-Token', admin.csrfToken).send(body);
  const productBody = { name: 'Service software', type: 'software', salesPrice: 120_000, costPrice: 40_000, notes: 'Private internal note', active: true, variants: [] };
  const product = (await post('products', productBody)).body;
  const addonBody = { ...productBody, name: 'Support add-on', type: 'addon', salesPrice: 30_000 };
  const addon = (await post('products', addonBody)).body;
  const planBody: PlanInput = { name: 'Service monthly', primaryProductId: product.id, price: 100_000, interval: 'monthly', minQuantity: 1, availableFrom: null, availableTo: null,
    autoClose: true, allowPause: true, allowRenew: true, allowEarlyClose: true, active: true, ...flags };
  const plan = (await post('plans', planBody)).body;
  assert.equal((await post('taxes', { name: 'Fictional demo tax', rateBps: 1000, productId: null, priority: 10, active: true })).status, 201);
  const mayaId = String(current.db.prepare('SELECT id FROM users WHERE email=?').get('maya@brightloop.test')?.id); const arunId = String(current.db.prepare('SELECT id FROM users WHERE email=?').get('arun@brightloop.test')?.id);
  const input: SubscriptionCommercialInput = { customerId: mayaId, planId: plan.id, templateId: null, startDate: '2026-11-01', termPeriods: 6, validDays: 7, paymentTermDays: 7,
    lines: [{ productId: product.id, variantId: null, quantity: 1 }, { productId: addon.id, variantId: null, quantity: 1 }] };
  async function agreement(changes: Partial<SubscriptionCommercialInput> = {}, activate = true): Promise<Subscription> {
    const draft = await post('subscriptions', { ...input, ...changes, idempotencyKey: randomUUID() }); assert.equal(draft.status, 201);
    assert.equal((await post(`subscriptions/${draft.body.id}/issue`, { version: 1 })).status, 200);
    const confirmed = await post(`subscriptions/${draft.body.id}/confirm`, { version: 2 }); assert.equal(confirmed.status, 200);
    if (!activate) return confirmed.body;
    const active = await post(`subscriptions/${draft.body.id}/activate`, { version: 3 }); assert.equal(active.status, 200); return active.body;
  }
  async function state(id: string): Promise<LifecycleState> { const response = await admin.agent.get(`/api/subscriptions/${id}/lifecycle`); assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body; }
  async function act(id: string, path: string, extra: object = {}, key = randomUUID()) { const value = await state(id); return post(`subscriptions/${id}/${path}`, { version: value.version, idempotencyKey: key, ...extra }); }
  const generate = (id: string, start: string, key = randomUUID()) => post(`subscriptions/${id}/invoices`, { expectedPeriodStart: start, idempotencyKey: key });
  return { ...current, post, put, product, productBody, addon, addonBody, plan, planBody, input, mayaId, arunId, agreement, state, act, generate,
    get admin() { return admin; }, clock: () => new Date(now),
    async advanceTo(date: string) { const next = new Date(`${date}T04:00:00.000Z`); current.advanceTime(next.getTime() - now.getTime()); now = next; admin = await signIn(current.app); },
  };
}

test('PLAN-03/BILL-05: future pause preserves issued debt, records a real full-period waiver, then resumes on the original anchor', async t => {
  const current = await setup(t); const source = await current.agreement(); const oldInvoice = await current.generate(source.id, '2026-11-01'); assert.equal(oldInvoice.status, 201);
  await current.advanceTo('2026-11-15'); const paused = await current.act(source.id, 'pause'); assert.equal(paused.status, 200);
  assert.equal(paused.body.serviceState, 'Running'); assert.equal(paused.body.scheduled[0].requestedDate, '2026-11-15'); assert.equal(paused.body.scheduled[0].effectiveDate, '2026-12-01');
  await current.advanceTo('2026-12-01'); assert.equal((await current.state(source.id)).serviceState, 'Paused');
  const preview = await current.post(`subscriptions/${source.id}/invoices/preview`, { expectedPeriodStart: '2026-12-01' }); assert.equal(preview.status, 200); assert.equal(preview.body.outcome, 'nonbillable'); assert.equal(preview.body.previewOnly, true);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM logical_charges').get()?.count, 1);
  const key = randomUUID(); const waiver = await current.generate(source.id, '2026-12-01', key); assert.equal(waiver.status, 201); assert.equal(waiver.body.outcome, 'nonbillable'); assert.ok(waiver.body.reason.includes('paused'));
  const replay = await current.generate(source.id, '2026-12-01', key); assert.equal(replay.status, 200); assert.equal(replay.body.logicalChargeId, waiver.body.logicalChargeId);
  assert.equal(current.db.prepare('SELECT next_period_index FROM subscriptions WHERE id=?').get(source.id)?.next_period_index, 2); assert.equal(current.db.prepare('SELECT count(*) AS count FROM invoices').get()?.count, 1);
  const resumed = await current.act(source.id, 'resume'); assert.equal(resumed.status, 200); assert.equal(resumed.body.scheduled[0].effectiveDate, '2027-01-01');
  await current.advanceTo('2027-01-01'); assert.equal((await current.state(source.id)).serviceState, 'Running');
  const invoice = await current.generate(source.id, '2027-01-01'); assert.equal(invoice.status, 201); assert.equal(invoice.body.total, 143_000);
  const original = await current.admin.agent.get(`/api/invoices/${oldInvoice.body.id}`); assert.equal(original.body.total, 143_000); assert.equal(original.body.amountPaid, 0);
  assert.equal(current.db.prepare("SELECT count(*) AS count FROM logical_charges WHERE outcome='nonbillable'").get()?.count, 1);
});

test('BILL-05: a currently paused badge cannot erase an older unbilled owed period; batch outcomes reconcile', async t => {
  const current = await setup(t); const source = await current.agreement();
  await current.advanceTo('2026-11-15'); assert.equal((await current.act(source.id, 'pause')).status, 200);
  await current.advanceTo('2026-12-01'); assert.equal((await current.state(source.id)).serviceState, 'Paused');
  const run = createBillingRun(current.db, { limit: 10, idempotencyKey: randomUUID() }, current.admin.user.id, current.clock()); await processBillingRun(current.db, run.id, current.clock);
  const result = (await current.admin.agent.get(`/api/billing/runs/${run.id}`)).body; assert.equal(result.created, 1); assert.equal(result.nonbillable, 1); assert.equal(result.failed, 0);
  assert.equal(current.db.prepare('SELECT period_start FROM invoices').get()?.period_start, '2026-11-01');
  assert.equal(current.db.prepare("SELECT period_start FROM logical_charges WHERE outcome='nonbillable'").get()?.period_start, '2026-12-01');
});

test('PLAN-03: pause and add-on scheduling skip retryable failed periods rather than reclassifying owed debt', async t => {
  const current = await setup(t); const source = await current.agreement();
  const run = createBillingRun(current.db, { limit: 1, idempotencyKey: randomUUID() }, current.admin.user.id, current.clock());
  await processBillingRun(current.db, run.id, current.clock, { failGeneration(_item, point) { if (point === 'before-commit') throw new Error('Trusted failure.'); } });
  const failedId = current.db.prepare("SELECT id FROM logical_charges WHERE outcome='failed'").get()?.id; assert.ok(failedId);
  const state = await current.state(source.id); assert.equal(state.actionEffectiveDates.pause, '2026-12-01');
  const optional = state.addons.find(line => !line.primary)!;
  assert.equal((await current.act(source.id, `addons/${optional.lineId}`, { enabled: false })).body.scheduled[0].effectiveDate, '2026-12-01');
  assert.equal((await current.act(source.id, 'pause')).status, 200);
  assert.equal(evaluateLifecyclePeriod(current.db, source.id, '2026-11-01', '2026-12-01').billable, true);
  assert.equal(evaluateLifecyclePeriod(current.db, source.id, '2026-11-01', '2026-12-01').lines.length, 2);
  assert.equal((await current.generate(source.id, '2026-11-01')).status, 201);
  assert.equal(current.db.prepare('SELECT outcome FROM logical_charges WHERE id=?').get(failedId)?.outcome, 'invoiced');
});

test('PLAN-03: switches with no remaining boundary fail clearly and month-end pause/resume recover the original day', async t => {
  await t.test('boundary equal to expiry is not a meaningful service change', async sub => {
    const current = await setup(sub); const source = await current.agreement({ termPeriods: 1 }); await current.generate(source.id, '2026-11-01');
    for (const action of ['pause', 'close-early']) { const result = await current.act(source.id, action); assert.equal(result.status, 409); assert.ok(result.body.error.message.includes('expiry')); }
    const optional = (await current.state(source.id)).addons.find(line => !line.primary)!; assert.equal((await current.act(source.id, `addons/${optional.lineId}`, { enabled: false })).status, 409);
  });
  await t.test('January31 monthly anchor', async sub => {
    const current = await setup(sub); const source = await current.agreement({ startDate: '2026-01-31', termPeriods: 12 }); await current.advanceTo('2026-11-15');
    const pause = await current.act(source.id, 'pause'); assert.equal(pause.body.scheduled[0].effectiveDate, '2026-11-30');
    await current.advanceTo('2026-11-30'); assert.equal((await current.state(source.id)).serviceState, 'Paused');
    await current.advanceTo('2026-12-01'); const resume = await current.act(source.id, 'resume'); assert.equal(resume.body.scheduled[0].effectiveDate, '2026-12-31');
    assert.equal(evaluateLifecyclePeriod(current.db, source.id, '2026-11-30', '2026-12-31').billable, false);
    assert.equal(evaluateLifecyclePeriod(current.db, source.id, '2026-12-31', '2027-01-31').billable, true);
  });
});

test('SUB-03/PLAN-03: early closure preserves original term/snapshots and older debt while forbidding renewal', async t => {
  const current = await setup(t); const source = await current.agreement(); const accepted = source.acceptedTerms;
  await current.advanceTo('2026-11-15'); const close = await current.act(source.id, 'close-early'); assert.equal(close.status, 200); assert.equal(close.body.scheduled[0].effectiveDate, '2026-12-01');
  assert.equal((await current.act(source.id, 'renew', { periods: 1 })).status, 409);
  await current.advanceTo('2026-12-01'); const closed = await current.state(source.id); assert.equal(closed.stage, 'Closed'); assert.equal(closed.closureCause, 'early'); assert.equal(closed.expiryDate, '2027-05-01');
  assert.equal(closed.nextPeriod?.start, '2026-11-01'); assert.equal(closed.nextPeriod?.billable, true);
  assert.equal((await current.generate(source.id, '2026-11-01')).status, 201);
  assert.equal((await current.state(source.id)).nextPeriod, null); assert.equal(current.db.prepare('SELECT next_billing_date FROM subscriptions WHERE id=?').get(source.id)?.next_billing_date, null);
  assert.deepEqual((await current.admin.agent.get(`/api/subscriptions/${source.id}`)).body.acceptedTerms, accepted);
  assert.equal((await current.act(source.id, 'renew', { periods: 1 })).status, 409);
});

test('PLAN-03: accepted plan flags govern real actions; later catalog policies do not rewrite accepted capabilities', async t => {
  await t.test('forbidden accepted flags', async sub => {
    const current = await setup(sub, { allowPause: false, allowRenew: false, allowEarlyClose: false }); const source = await current.agreement();
    for (const action of ['pause', 'resume', 'renew', 'close-early']) assert.equal((await current.act(source.id, action, action === 'renew' ? { periods: 1 } : {})).status, 409);
    assert.equal(current.db.prepare('SELECT count(*) AS count FROM lifecycle_events').get()?.count, 0);
  });
  await t.test('offered capabilities remain accepted', async sub => {
    const current = await setup(sub); const source = await current.agreement();
    assert.equal((await current.put(`plans/${current.plan.id}`, { ...current.planBody, allowPause: false, allowRenew: false, allowEarlyClose: false, version: 1 })).status, 200);
    const state = await current.state(source.id); assert.equal(state.policies.allowPause, true); assert.ok(state.allowedActions.includes('pause')); assert.ok(state.allowedActions.includes('renew'));
    assert.equal((await current.act(source.id, 'renew', { periods: 1 })).status, 200);
  });
});

test('PLAN-03/SUB-03: automatic expiry on/off and explicit end closure preserve owed periods, including unactivated Confirmed recovery', async t => {
  for (const autoClose of [true, false]) for (const activated of [true, false]) await t.test(`autoClose=${autoClose},activated=${activated}`, async sub => {
    const current = await setup(sub, { interval: 'daily', autoClose, allowEarlyClose: false }); const source = await current.agreement({ termPeriods: 1 }, activated);
    await current.advanceTo('2026-11-02'); const state = await current.state(source.id);
    assert.equal(state.serviceState, autoClose ? 'Closed' : 'TermEnded'); assert.equal(state.stage, autoClose ? 'Closed' : activated ? 'Active' : 'Confirmed');
    if (!autoClose) { const close = await current.act(source.id, 'close-term'); assert.equal(close.status, 200); assert.equal(close.body.stage, 'Closed'); assert.equal(close.body.closureCause, 'expiry'); }
    const invoice = await current.generate(source.id, '2026-11-01'); assert.equal(invoice.status, 201, JSON.stringify(invoice.body)); assert.equal(invoice.body.periodEnd, '2026-11-02');
    assert.equal((await current.state(source.id)).nextPeriod, null);
  });
});

test('PLAN-03: renewals extend whole anchored terms once, preserve paused state/cursor, and reject late gaps', async t => {
  const current = await setup(t, { interval: 'daily' }); const source = await current.agreement({ termPeriods: 1 });
  assert.equal((await current.act(source.id, 'pause')).body.serviceState, 'Paused');
  await current.advanceTo('2026-11-02'); const expired = await current.state(source.id); assert.equal(expired.stage, 'Closed'); assert.equal(expired.closureCause, 'expiry');
  const key = randomUUID(); const input = { version: expired.version, idempotencyKey: key, periods: 2 };
  const renewed = await current.post(`subscriptions/${source.id}/renew`, input); assert.equal(renewed.status, 200); assert.equal(renewed.body.expiryDate, '2026-11-04'); assert.equal(renewed.body.stage, 'Active'); assert.equal(renewed.body.serviceState, 'Paused');
  assert.equal(current.db.prepare('SELECT next_period_index FROM subscriptions WHERE id=?').get(source.id)?.next_period_index, 0);
  assert.equal((await current.post(`subscriptions/${source.id}/renew`, input)).body.expiryDate, '2026-11-04');
  assert.equal((await current.post(`subscriptions/${source.id}/renew`, { ...input, periods: 3 })).status, 409);
  processLifecycleDue(current.db, current.clock()); assert.equal((await current.state(source.id)).stage, 'Active');
  await current.advanceTo('2026-11-05'); assert.equal((await current.act(source.id, 'renew', { periods: 1 })).status, 409);
  assert.equal(current.db.prepare("SELECT count(*) AS count FROM lifecycle_events WHERE kind='renew'").get()?.count, 1);
});

test('CAT-02/PLAN-03: optional line intervals affect only future original periods at accepted prices; primary line cannot be disabled', async t => {
  const current = await setup(t); const source = await current.agreement(); const first = await current.generate(source.id, '2026-11-01'); assert.equal(first.body.lines.length, 2);
  const optional = (await current.state(source.id)).addons.find(line => !line.primary)!; const primary = (await current.state(source.id)).addons.find(line => line.primary)!;
  assert.equal((await current.act(source.id, `addons/${primary.lineId}`, { enabled: false })).status, 409);
  await current.advanceTo('2026-11-02'); const disable = await current.act(source.id, `addons/${optional.lineId}`, { enabled: false }); assert.equal(disable.status, 200); assert.equal(disable.body.scheduled[0].effectiveDate, '2026-12-01');
  await current.advanceTo('2026-12-01'); const december = await current.state(source.id); assert.equal(december.nextPeriod?.subtotal, 100_000); assert.equal(december.nextPeriod?.lines.length, 1);
  const second = await current.generate(source.id, '2026-12-01'); assert.equal(second.status, 201); assert.equal(second.body.total, 110_000); assert.equal(second.body.lines.length, 1);
  assert.equal((await current.put(`products/${current.addon.id}`, { ...current.addonBody, salesPrice: 900_000, version: 1 })).status, 200);
  await current.advanceTo('2026-12-02'); const enable = await current.act(source.id, `addons/${optional.lineId}`, { enabled: true }); assert.equal(enable.status, 200); assert.equal(enable.body.scheduled[0].effectiveDate, '2027-01-01');
  await current.advanceTo('2027-01-01'); const third = await current.generate(source.id, '2027-01-01'); assert.equal(third.status, 201); assert.equal(third.body.total, 143_000); assert.equal(third.body.lines.find((line: { productId: string }) => line.productId === current.addon.id).unitPrice, 30_000);
  assert.equal((await current.admin.agent.get(`/api/invoices/${first.body.id}`)).body.lines.length, 2); assert.equal((await current.admin.agent.get(`/api/invoices/${second.body.id}`)).body.total, 110_000);
  assert.deepEqual((await current.state(source.id)).addons.find(line => !line.primary)?.intervals.map(interval => interval.enabled), [true, false, true]);
});

test('AUTH-04/PLAN-03: own customer actions are permitted, cross-record access is denied and action receipts reject conflicts', async t => {
  const current = await setup(t); const own = await current.agreement(); const other = await current.agreement({ customerId: current.arunId });
  const customer = await signIn(current.app, 'maya@brightloop.test');
  assert.equal((await customer.agent.get(`/api/subscriptions/${other.id}/lifecycle`)).status, 404);
  const read = await customer.agent.get(`/api/subscriptions/${own.id}/lifecycle`); assert.equal(read.status, 200); assert.ok(read.body.allowedActions.includes('pause')); assert.equal(read.body.allowedActions.includes('closeTerm'), false);
  for (const secret of ['costPrice', 'cost_price', 'notes', 'Private internal note', 'arun@brightloop.test']) assert.equal(JSON.stringify(read.body).includes(secret), false);
  const key = randomUUID(); const body = { version: read.body.version, idempotencyKey: key };
  const first = await customer.agent.post(`/api/subscriptions/${own.id}/pause`).set('X-CSRF-Token', customer.csrfToken).send(body); assert.equal(first.status, 200); assert.equal(first.body.serviceState, 'Paused');
  const replay = await customer.agent.post(`/api/subscriptions/${own.id}/pause`).set('X-CSRF-Token', customer.csrfToken).send(body); assert.equal(replay.status, 200); assert.equal(replay.body.version, first.body.version);
  assert.equal((await customer.agent.post(`/api/subscriptions/${own.id}/pause`).set('X-CSRF-Token', customer.csrfToken).send({ ...body, version: body.version + 1 })).status, 409);
  for (const path of ['pause', 'resume', 'renew', 'close-early']) assert.equal((await customer.agent.post(`/api/subscriptions/${other.id}/${path}`).set('X-CSRF-Token', customer.csrfToken).send(path === 'renew' ? { version: other.version, idempotencyKey: randomUUID(), periods: 1 } : { version: other.version, idempotencyKey: randomUUID() })).status, 404);
  assert.equal((await customer.agent.post(`/api/subscriptions/${own.id}/close-term`).set('X-CSRF-Token', customer.csrfToken).send(body)).status, 403);
  assert.equal((await customer.agent.post('/api/subscriptions/process-lifecycle').set('X-CSRF-Token', customer.csrfToken).send({ limit: 1 })).status, 403);
  const state = await current.state(own.id);
  for (const extra of [{ effectiveDate: '1900-01-01' }, { role: 'admin' }, { unitPrice: 0 }]) assert.equal((await current.post(`subscriptions/${own.id}/resume`, { version: state.version, idempotencyKey: randomUUID(), ...extra })).status, 400);
  for (const periods of [0, -1, 1.1, 1201]) assert.equal((await current.post(`subscriptions/${own.id}/renew`, { version: state.version, idempotencyKey: randomUUID(), periods })).status, 400);
  assert.equal(current.db.prepare("SELECT count(*) AS count FROM lifecycle_events WHERE kind='pause'").get()?.count, 1);
});

test('PLAN-03: renewal and expiry in independent processes serialize safely at the exact boundary', { timeout: 30_000 }, async t => {
  const current = await setup(t, { interval: 'daily' }); const source = await current.agreement({ termPeriods: 1 }); const paused = await current.act(source.id, 'pause'); assert.equal(paused.status, 200);
  const version = paused.body.version; await current.advanceTo('2026-11-02');
  const login = await request(current.app).post('/api/auth/login').send({ email: 'admin@brightloop.test', password: demoPassword }); assert.equal(login.status, 200);
  const cookie = (login.headers['set-cookie'] as unknown as string[]).map(value => value.split(';')[0]).join('; '); const key = randomUUID(); let committed = { version, idempotencyKey: key, periods: 2 };
  const code = `import request from'supertest';import{createApp}from'./server/app.ts';import{processLifecycleDue}from'./server/lifecycle.ts';
    const clock=()=>new Date('2026-11-02T04:00:00.000Z');const app=createApp({databasePath:process.env.SUBTRACK_TEST_DB,clock,mailMode:'outbox',billingWorkerOptions:{autoStart:false}});
    process.send({type:'ready'});process.once('message',async m=>{try{if(m.kind==='expiry'){const result=processLifecycleDue(app.locals.db,clock(),100);process.send({type:'result',kind:'expiry',closed:result.closed});}
      else{const r=await request(app).post('/api/subscriptions/'+m.id+'/renew').set('Cookie',m.cookie).set('X-CSRF-Token',m.csrf).send(m.body);process.send({type:'result',kind:'renew',status:r.status});}}
      catch(e){process.send({type:'error',message:e.message});process.exitCode=1;}finally{await app.locals.billingWorker.stop();await app.locals.deliverPending.stop();app.locals.db.close();process.disconnect();}});`;
  type Message = { type: string; kind?: string; status?: number; closed?: number; message?: string };
  function worker() {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { cwd: process.cwd(), env: { ...process.env, SUBTRACK_TEST_DB: current.databasePath }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    t.after(() => { if (child.exitCode === null) child.kill(); }); let stderr = ''; child.stderr?.on('data', chunk => { stderr += String(chunk); });
    const ready = new Promise<void>((resolve, reject) => { child.on('message', raw => { if ((raw as Message).type === 'ready') resolve(); }); child.on('error', reject); child.on('exit', exit => { if (exit !== 0) reject(new Error(`Lifecycle worker exited ${exit}: ${stderr}`)); }); });
    const result = new Promise<Message>((resolve, reject) => { child.on('message', raw => { const value = raw as Message; if (value.type === 'result') resolve(value); if (value.type === 'error') reject(new Error(value.message)); }); child.on('error', reject); });
    const exited = new Promise<void>((resolve, reject) => { child.on('exit', exit => exit === 0 ? resolve() : reject(new Error(`Lifecycle worker exited ${exit}: ${stderr}`))); });
    return { child, ready, result, exited };
  }
  const expiry = worker(); const renew = worker(); await Promise.all([expiry.ready, renew.ready]);
  expiry.child.send({ kind: 'expiry' }); renew.child.send({ kind: 'renew', id: source.id, cookie, csrf: login.body.csrfToken, body: committed });
  const results = await Promise.all([expiry.result, renew.result]); await Promise.all([expiry.exited, renew.exited]);
  const status = results.find(value => value.kind === 'renew')!.status; assert.ok(status === 200 || status === 409, 'A stale-version conflict is recoverable when the expiry worker wins.');
  if (status === 409) { const fresh = await current.state(source.id); committed = { ...committed, version: fresh.version }; assert.equal((await current.post(`subscriptions/${source.id}/renew`, committed)).status, 200); }
  const active = await current.state(source.id); assert.equal(active.stage, 'Active'); assert.equal(active.serviceState, 'Paused'); assert.equal(active.expiryDate, '2026-11-04');
  assert.equal((await current.post(`subscriptions/${source.id}/renew`, committed)).body.expiryDate, '2026-11-04');
  processLifecycleDue(current.db, current.clock()); assert.equal((await current.state(source.id)).stage, 'Active');
  assert.equal(current.db.prepare("SELECT count(*) AS count FROM lifecycle_events WHERE kind='renew'").get()?.count, 1); assert.equal(current.db.prepare('SELECT next_period_index FROM subscriptions WHERE id=?').get(source.id)?.next_period_index, 0);
});

async function legacyPaymentStore(t: TestContext) {
  const db = new DatabaseSync(':memory:'); t.after(() => { db.close(); });
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL) STRICT;
    CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,role TEXT NOT NULL,created_at TEXT NOT NULL) STRICT;
    CREATE TABLE audit_events(id TEXT PRIMARY KEY,actor_id TEXT REFERENCES users(id),kind TEXT NOT NULL,subject_id TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL) STRICT;
    CREATE TABLE outbox(id TEXT PRIMARY KEY,recipient TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL,status TEXT NOT NULL,error TEXT,provider_id TEXT,claimed_at TEXT) STRICT;
    INSERT INTO schema_migrations VALUES(1,'2026-11-01'),(2,'2026-11-01'),(3,'2026-11-01');`);
  await seedDemo(db); migrateCatalog(db); migrateSubscriptions(db); migrateBilling(db); migrateBillingWorkbench(db); migratePayments(db);
  const stamp = '2026-11-01T04:00:00.000Z'; const productId = randomUUID(); const planId = randomUUID();
  db.prepare("INSERT INTO products VALUES(?,'Legacy software','software',10000,1000,'Internal note',1,1,?,?)").run(productId, stamp, stamp);
  db.prepare("INSERT INTO plans VALUES(?,'Legacy plan',?,10000,'monthly',1,NULL,NULL,1,1,1,1,1,1,?,?)").run(planId, productId, stamp, stamp);
  const customerId = String(db.prepare("SELECT id FROM users WHERE email='maya@brightloop.test'").get()?.id); const actorId = String(db.prepare("SELECT id FROM users WHERE email='admin@brightloop.test'").get()?.id);
  const preview = buildSubscriptionPreview(db, { customerId, planId, templateId: null, startDate: '2026-11-01', termPeriods: 2, validDays: 7, paymentTermDays: 7, lines: [{ productId, variantId: null, quantity: 1 }] }, new Date(stamp));
  const subscriptionId = randomUUID(); const snapshot = JSON.stringify(preview.terms);
  db.prepare(`INSERT INTO subscriptions(id,number,customer_id,customer_name,customer_email,plan_id,start_date,expiry_date,term_periods,payment_term_days,valid_days,stage,service_state,version,terms_json,offered_terms_json,accepted_terms_json,issued_date,valid_until,accepted_at,next_period_index,created_at,updated_at,next_billing_date)
    VALUES(?,'LEGACY-SUB',?,'Maya Shah','maya@brightloop.test',?,'2026-11-01','2027-01-01',2,7,7,'Active','Running',4,?,?,?,'2026-11-01','2026-11-07',?,0,?,?,'2026-11-01')`).run(subscriptionId, customerId, planId, snapshot, snapshot, snapshot, stamp, stamp, stamp);
  const chargeId = randomUUID(); const invoiceId = randomUUID();
  transaction(db, () => {
    db.prepare("INSERT INTO logical_charges VALUES(?,?,'2026-11-01','2026-12-01','recurring','failed','Fixture pending',NULL,?,?)").run(chargeId, subscriptionId, stamp, stamp);
    db.prepare(`INSERT INTO invoices(id,number,logical_charge_id,revision_number,subscription_id,subscription_number,customer_id,customer_name,customer_email,period_start,period_end,issue_date,due_date,currency,status,subtotal,discount,tax,total,amount_paid,payment_count,discount_reason,discount_decisions_json,discount_decisions_truncated,version,created_at,confirmed_at)
      VALUES(?,'LEGACY-INV',?,1,?,'LEGACY-SUB',?,'Maya Shah','maya@brightloop.test','2026-11-01','2026-12-01','2026-11-01','2026-11-08','INR','Confirmed',10000,0,0,10000,0,0,'No discount','[]',0,1,?,?)`).run(invoiceId, chargeId, subscriptionId, customerId, stamp, stamp);
    db.prepare(`INSERT INTO invoice_lines(id,invoice_id,position,subscription_line_id,product_id,product_name,variant_id,variant_name,quantity,base_unit_price,variant_adjustment,unit_price,subtotal,discount,taxable_amount,tax_rule_id,tax_rule_name,tax_rule_version,tax_rate_bps,tax,total)
      VALUES(?,?,0,?,?,'Legacy software',NULL,NULL,1,10000,0,10000,10000,0,10000,NULL,NULL,NULL,0,0,10000)`).run(randomUUID(), invoiceId, preview.terms.lines[0].id, productId);
    db.prepare("UPDATE logical_charges SET outcome='invoiced',reason=NULL,current_invoice_id=? WHERE id=?").run(invoiceId, chargeId);
    db.prepare(`INSERT INTO payments(id,invoice_id,amount,currency,method,payment_date,note,actor_id,recorded_by_name,idempotency_key,payload_hash,created_at)
      VALUES(?,?,2500,'INR','bank_transfer','2026-11-01','Private legacy allocation',?,'Alex Morgan',?,?,?)`).run(randomUUID(), invoiceId, actorId, randomUUID(), 'f'.repeat(64), stamp);
  });
  db.exec(`ALTER TABLE subscriptions ADD COLUMN teammate_tag TEXT NOT NULL DEFAULT 'preserve-me'; CREATE INDEX teammate_subscription_tag ON subscriptions(teammate_tag);
    CREATE TABLE teammate_audit(subscription_id TEXT NOT NULL) STRICT;
    CREATE TRIGGER teammate_subscription_update AFTER UPDATE OF updated_at ON subscriptions BEGIN INSERT INTO teammate_audit VALUES(NEW.id); END;`);
  return { db, subscriptionId, invoiceId };
}

test('P6 migration9: populated v8 upgrade preserves all columns, unknown teammate indexes/triggers, invoice/payment links and immutable snapshots', async t => {
  const current = await legacyPaymentStore(t); const beforeSub = current.db.prepare('SELECT * FROM subscriptions').get()!; const beforeInvoice = current.db.prepare('SELECT * FROM invoices').get(); const beforePayment = current.db.prepare('SELECT * FROM payments').get();
  migrateLifecycle(current.db); migrateLifecycle(current.db);
  const after = current.db.prepare('SELECT * FROM subscriptions').get()!;
  for (const [key, value] of Object.entries(beforeSub)) assert.deepEqual(after[key], value, `Existing column ${key} must remain unchanged.`);
  assert.deepEqual(current.db.prepare('SELECT * FROM invoices').get(), beforeInvoice); assert.deepEqual(current.db.prepare('SELECT * FROM payments').get(), beforePayment);
  assert.equal(current.db.prepare('PRAGMA foreign_keys').get()?.foreign_keys, 1); assert.deepEqual(current.db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.ok(current.db.prepare("SELECT 1 FROM sqlite_master WHERE name='teammate_subscription_tag'").get()); assert.ok(current.db.prepare("SELECT 1 FROM sqlite_master WHERE name='teammate_subscription_update'").get());
  current.db.prepare('UPDATE subscriptions SET updated_at=updated_at WHERE id=?').run(current.subscriptionId); assert.equal(current.db.prepare('SELECT count(*) AS count FROM teammate_audit').get()?.count, 1);
  assert.throws(() => current.db.prepare("UPDATE subscriptions SET accepted_terms_json='{}' WHERE id=?").run(current.subscriptionId));
  assert.throws(() => current.db.prepare('UPDATE subscriptions SET id=? WHERE id=?').run(randomUUID(), current.subscriptionId));
  assert.equal(current.db.prepare('SELECT amount_paid FROM invoices WHERE id=?').get(current.invoiceId)?.amount_paid, 2500);
});

test('P6 migration9: a mid-migration collision rolls back parent rebuild and always restores FK enforcement', async t => {
  const current = await legacyPaymentStore(t); const before = current.db.prepare('SELECT * FROM subscriptions').get();
  current.db.exec('CREATE TABLE lifecycle_events(teammate_owned TEXT) STRICT');
  assert.throws(() => migrateLifecycle(current.db));
  assert.deepEqual(current.db.prepare('SELECT * FROM subscriptions').get(), before); assert.equal(current.db.prepare('PRAGMA foreign_keys').get()?.foreign_keys, 1); assert.deepEqual(current.db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(current.db.prepare('SELECT 1 FROM schema_migrations WHERE version=9').get(), undefined);
  assert.ok(String(current.db.prepare("SELECT sql FROM sqlite_master WHERE name='subscriptions'").get()?.sql).includes("'Draft','Quotation','Confirmed'"));
  assert.ok(current.db.prepare("SELECT 1 FROM sqlite_master WHERE name='teammate_subscription_update'").get());
});
