import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import test, { type TestContext } from 'node:test';
import request from 'supertest';
import type { Subscription, SubscriptionCommercialInput } from '../shared/subscriptions.js';
import type { ProductInput, PlanInput } from '../shared/catalog.js';
import { fixture, signIn, demoPassword } from './fixtures.js';

async function setup(t: TestContext) {
  const current = await fixture(t); let admin = await signIn(current.app);
  const post = (path: string, body: object) => admin.agent.post(`/api/${path}`).set('X-CSRF-Token', admin.csrfToken).send(body);
  const put = (path: string, body: object) => admin.agent.put(`/api/${path}`).set('X-CSRF-Token', admin.csrfToken).send(body);
  const productBody: ProductInput = { name: 'Business Software', type: 'software', salesPrice: 120_000, costPrice: 40_000, notes: 'Private internal product note', active: true, variants: [{ name: 'Odoo', adjustment: 56_000, active: true }] };
  const product = (await post('products', productBody)).body;
  const planBody: PlanInput = { name: 'Business Monthly', primaryProductId: product.id, price: 100_000, interval: 'monthly', minQuantity: 1, availableFrom: null, availableTo: null, autoClose: true, allowPause: true, allowRenew: true, allowEarlyClose: true, active: true };
  const plan = (await post('plans', planBody)).body;
  const tax = await post('taxes', { name: 'Fictional 10% tax', rateBps: 1000, productId: null, priority: 10, active: true });
  assert.equal(tax.status, 201);
  const templateBody = { name: 'Business quote template', planId: plan.id, validDays: 7, active: true, lines: [{ productId: product.id, variantId: product.variants[0].id, quantity: 2 }] };
  const template = (await post('quotation-templates', templateBody)).body;
  const mayaId = String(current.db.prepare('SELECT id FROM users WHERE email=?').get('maya@brightloop.test')?.id);
  const arunId = String(current.db.prepare('SELECT id FROM users WHERE email=?').get('arun@brightloop.test')?.id);
  const input: SubscriptionCommercialInput = { customerId: mayaId, planId: plan.id, templateId: template.id, startDate: '2026-11-01', termPeriods: 12, paymentTermDays: 7 };
  async function quote(changes: Partial<SubscriptionCommercialInput> = {}, idempotencyKey = randomUUID()): Promise<Subscription> {
    const response = await post('subscriptions', { ...input, ...changes, idempotencyKey });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    return response.body;
  }
  const action = (row: Subscription, name: 'issue' | 'confirm' | 'activate', version = row.version) => post(`subscriptions/${row.id}/${name}`, { version });
  async function confirmed(changes: Partial<SubscriptionCommercialInput> = {}) {
    const draft = await quote(changes); const issued = await action(draft, 'issue'); assert.equal(issued.status, 200);
    const accepted = await action(issued.body, 'confirm'); assert.equal(accepted.status, 200, JSON.stringify(accepted.body)); return accepted.body as Subscription;
  }
  return {
    ...current, post, put, quote, action, confirmed, productBody, product, planBody, plan, templateBody, template, input, mayaId, arunId,
    get admin() { return admin; }, async refreshAdmin() { admin = await signIn(current.app); },
  };
}

test('QUOTE-01/SUB-01/SUB-02: two template instances are independent persisted server-priced drafts', async t => {
  const current = await setup(t);
  const first = await current.quote();
  const second = await current.quote({ customerId: current.arunId, validDays: 10, lines: [{ productId: current.product.id, variantId: current.product.variants[0].id, quantity: 3 }] });
  assert.notEqual(first.id, second.id); assert.notEqual(first.number, second.number);
  assert.match(first.number, /^SUB-\d+$/); assert.equal(first.customerId, current.mayaId);
  assert.equal(first.startDate, '2026-11-01'); assert.equal(first.expiryDate, '2027-11-01'); assert.equal(first.paymentTermDays, 7);
  assert.equal(first.templateName, current.templateBody.name); assert.equal(first.validDays, 7);
  assert.equal(first.terms.lines[0].quantity, 2); assert.equal(second.terms.lines[0].quantity, 3);
  assert.notEqual(first.terms.lines[0].id, second.terms.lines[0].id);
  assert.equal(first.terms.lines[0].unitPrice, 156_000); assert.equal(first.terms.subtotal, 312_000);
  assert.equal(first.terms.estimatedTax, 31_200); assert.equal(first.terms.estimatedTotal, 343_200); assert.equal(first.terms.taxesAreEstimates, true);
  const changed = await current.put(`subscriptions/${first.id}`, { ...current.input, validDays: 5, lines: [{ productId: current.product.id, variantId: current.product.variants[0].id, quantity: 4 }], version: first.version });
  assert.equal(changed.status, 200); assert.equal(changed.body.version, 2); assert.equal(changed.body.terms.lines[0].quantity, 4);
  assert.equal((await current.admin.agent.get(`/api/subscriptions/${second.id}`)).body.terms.lines[0].quantity, 3);
  assert.equal((await current.admin.agent.get(`/api/quotation-templates/${current.template.id}`)).body.lines[0].quantity, 2);
  const laterTemplate = await current.put(`quotation-templates/${current.template.id}`, { ...current.templateBody, name: 'Later template', validDays: 1, lines: [{ ...current.templateBody.lines[0], quantity: 9 }], version: 1 });
  assert.equal(laterTemplate.status, 200);
  assert.equal((await current.admin.agent.get(`/api/subscriptions/${second.id}`)).body.validDays, 10);
  assert.equal((await current.admin.agent.get(`/api/subscriptions/${second.id}`)).body.templateName, 'Business quote template');
  assert.equal((await current.put(`subscriptions/${first.id}`, { ...current.input, version: 1 })).status, 409);
});

test('SUB-02: draft reads retain saved prices and explicit draft edits reprice from current configuration', async t => {
  const current = await setup(t); const draft = await current.quote();
  assert.equal((await current.put(`products/${current.product.id}`, { ...current.productBody, salesPrice: 900_000, variants: [{ ...current.product.variants[0], name: 'Updated brand', adjustment: 60_000 }], version: 1 })).status, 200);
  assert.equal((await current.put(`plans/${current.plan.id}`, { ...current.planBody, price: 200_000, version: 1 })).status, 200);
  const saved = await current.admin.agent.get(`/api/subscriptions/${draft.id}`);
  assert.equal(saved.body.terms.lines[0].unitPrice, 156_000); assert.equal(saved.body.terms.lines[0].variantName, 'Odoo');
  const edited = await current.put(`subscriptions/${draft.id}`, { ...current.input, version: 1 });
  assert.equal(edited.status, 200); assert.equal(edited.body.terms.lines[0].unitPrice, 260_000); assert.equal(edited.body.terms.lines[0].variantName, 'Updated brand');
});

test('SUB-03: legal transitions persist ordered history and replay without regressions or duplicate events', async t => {
  const current = await setup(t); const draft = await current.quote();
  assert.equal((await current.action(draft, 'confirm')).status, 409);
  assert.equal((await current.action(draft, 'activate')).status, 409);
  const issued = await current.action(draft, 'issue'); assert.equal(issued.status, 200); assert.equal(issued.body.stage, 'Quotation');
  assert.equal(issued.body.issuedDate, '2026-11-01'); assert.equal(issued.body.validUntil, '2026-11-07');
  assert.deepEqual(issued.body.offeredTerms, draft.terms);
  assert.equal((await current.action(draft, 'issue')).body.version, 2);
  assert.equal((await current.put(`subscriptions/${draft.id}`, { ...current.input, version: 2 })).body.error.code, 'OFFER_FROZEN');
  const accepted = await current.action(issued.body, 'confirm'); assert.equal(accepted.status, 200); assert.equal(accepted.body.stage, 'Confirmed');
  assert.deepEqual(accepted.body.acceptedTerms, issued.body.offeredTerms);
  assert.equal((await current.action(issued.body, 'confirm')).body.version, 3);
  const oldIssue = await current.action(draft, 'issue'); assert.equal(oldIssue.status, 200); assert.equal(oldIssue.body.stage, 'Confirmed');
  const active = await current.action(accepted.body, 'activate'); assert.equal(active.status, 200); assert.equal(active.body.stage, 'Active');
  assert.equal(active.body.serviceState, 'Running'); assert.equal(active.body.nextBillingDate, '2026-11-01');
  const replay = await current.action(accepted.body, 'activate'); assert.equal(replay.status, 200); assert.equal(replay.body.version, 4);
  const reloaded = await current.admin.agent.get(`/api/subscriptions/${draft.id}`);
  assert.deepEqual(reloaded.body.history.map((event: { toStage: string }) => event.toStage), ['Draft', 'Quotation', 'Confirmed', 'Active']);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM subscription_history WHERE subscription_id=?').get(draft.id)?.count, 4);
});

test('SUB-02/SUB-03: issued prices, minimum and capabilities survive catalog edits and confirmation accepts the exact offer', async t => {
  const current = await setup(t); const draft = await current.quote(); const issued = (await current.action(draft, 'issue')).body as Subscription;
  assert.equal((await current.put(`plans/${current.plan.id}`, { ...current.planBody, price: 900_000, minQuantity: 10, interval: 'yearly', allowPause: false, allowRenew: false, version: 1 })).status, 200);
  assert.equal((await current.put(`products/${current.product.id}`, { ...current.productBody, name: 'Renamed product', variants: [{ ...current.product.variants[0], adjustment: 100_000 }], version: 1 })).status, 200);
  const accepted = await current.action(issued, 'confirm'); assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.deepEqual(accepted.body.acceptedTerms, issued.offeredTerms);
  assert.equal(accepted.body.acceptedTerms.plan.minQuantity, 1); assert.equal(accepted.body.acceptedTerms.plan.interval, 'monthly');
  assert.equal(accepted.body.acceptedTerms.plan.allowPause, true); assert.equal(accepted.body.acceptedTerms.plan.allowRenew, true);
  assert.equal(accepted.body.acceptedTerms.lines[0].productName, 'Business Software'); assert.equal(accepted.body.acceptedTerms.lines[0].unitPrice, 156_000);
  assert.throws(() => current.db.prepare("UPDATE subscriptions SET terms_json='{}' WHERE id=?").run(draft.id));
  assert.throws(() => current.db.prepare("UPDATE subscriptions SET offered_terms_json='{}' WHERE id=?").run(draft.id));
  assert.throws(() => current.db.prepare("UPDATE subscriptions SET accepted_terms_json='{}' WHERE id=?").run(draft.id));
  assert.throws(() => current.db.prepare('UPDATE subscriptions SET customer_id=? WHERE id=?').run(current.arunId, draft.id));
});

test('PLAN-01/SUB-01: every cadence uses the original calendar anchor and explicit expiry must align', async t => {
  const current = await setup(t);
  for (const [interval, startDate, termPeriods, expiryDate] of [
    ['daily', '2026-11-01', 3, '2026-11-04'], ['weekly', '2026-11-01', 3, '2026-11-22'],
    ['monthly', '2026-01-31', 2, '2026-03-31'], ['yearly', '2024-02-29', 4, '2028-02-29'],
  ] as const) {
    const plan = await current.post('plans', { ...current.planBody, name: `${interval} agreement`, interval });
    assert.equal(plan.status, 201);
    const quoted = await current.quote({ templateId: null, planId: plan.body.id, startDate, termPeriods, validDays: 7, lines: current.templateBody.lines });
    assert.equal(quoted.expiryDate, expiryDate);
  }
  const { termPeriods: _termPeriods, ...explicit } = current.input;
  assert.equal(_termPeriods, 12);
  const invalid = await current.post('subscriptions', { ...explicit, startDate: '2026-01-31', expiryDate: '2026-03-30', idempotencyKey: randomUUID() });
  assert.equal(invalid.status, 400); assert.equal(invalid.body.error.code, 'UNALIGNED_TERM');
  const aligned = await current.post('subscriptions', { ...explicit, startDate: '2026-01-31', expiryDate: '2026-03-31', idempotencyKey: randomUUID() });
  assert.equal(aligned.status, 201); assert.equal(aligned.body.termPeriods, 2);
  assert.equal((await current.post('subscriptions', { ...current.input, expiryDate: '2027-11-01', idempotencyKey: randomUUID() })).status, 400);
});

test('QUOTE-01: quotation validity is inclusive and expires on the following business date', async t => {
  const current = await setup(t);
  const first = await current.quote({ startDate: '2026-11-15' }); const second = await current.quote({ startDate: '2026-11-15' });
  const issuedFirst = (await current.action(first, 'issue')).body as Subscription; const issuedSecond = (await current.action(second, 'issue')).body as Subscription;
  current.advanceTime(6 * 24 * 60 * 60_000); await current.refreshAdmin();
  assert.equal((await current.action(issuedFirst, 'confirm')).status, 200, 'November7 is the last included day.');
  current.advanceTime(24 * 60 * 60_000); await current.refreshAdmin();
  const expired = await current.action(issuedSecond, 'confirm'); assert.equal(expired.status, 400); assert.equal(expired.body.error.code, 'QUOTATION_EXPIRED');
  assert.equal((await current.admin.agent.get(`/api/subscriptions/${second.id}`)).body.stage, 'Quotation');
});

test('PLAN-02: confirmation rechecks current inclusive availability and publication without repricing', async t => {
  const current = await setup(t);
  assert.equal((await current.put(`plans/${current.plan.id}`, { ...current.planBody, availableFrom: '2026-11-01', availableTo: '2026-11-01', version: 1 })).status, 200);
  const first = await current.quote(); const second = await current.quote();
  const firstIssued = (await current.action(first, 'issue')).body as Subscription; const secondIssued = (await current.action(second, 'issue')).body as Subscription;
  assert.equal((await current.action(firstIssued, 'confirm')).status, 200);
  current.advanceTime(24 * 60 * 60_000); await current.refreshAdmin();
  const unavailable = await current.action(secondIssued, 'confirm'); assert.equal(unavailable.status, 400); assert.equal(unavailable.body.error.code, 'PLAN_UNAVAILABLE');
  const held = await current.admin.agent.get(`/api/subscriptions/${second.id}`); assert.deepEqual(held.body.offeredTerms, secondIssued.offeredTerms); assert.equal(held.body.acceptedTerms, null);
});

test('PLAN-02/AUTH-04: archived products and variants reject confirmation but keep immutable offers available', async t => {
  const current = await setup(t); const first = await current.quote(); const second = await current.quote();
  const issuedFirst = (await current.action(first, 'issue')).body as Subscription; const issuedSecond = (await current.action(second, 'issue')).body as Subscription;
  assert.equal((await current.put(`products/${current.product.id}`, { ...current.productBody, variants: [{ ...current.product.variants[0], active: false }], version: 1 })).status, 200);
  assert.equal((await current.action(issuedFirst, 'confirm')).body.error.code, 'VARIANT_UNAVAILABLE');
  assert.equal((await current.put(`products/${current.product.id}`, { ...current.productBody, active: false, variants: current.product.variants, version: 2 })).status, 200);
  assert.equal((await current.action(issuedSecond, 'confirm')).body.error.code, 'PRODUCT_UNAVAILABLE');
  assert.deepEqual((await current.admin.agent.get(`/api/subscriptions/${first.id}`)).body.offeredTerms, issuedFirst.offeredTerms);
});

test('SUB-03: future-start agreements remain Confirmed until server-owned due processing, independent of payment', async t => {
  const current = await setup(t); const future = await current.confirmed({ startDate: '2026-11-15' });
  const early = await current.action(future, 'activate'); assert.equal(early.status, 400); assert.equal(early.body.error.code, 'NOT_STARTED');
  assert.equal((await current.post('subscriptions/process-due', { limit: 1 })).body.activated, 0);
  assert.equal((await current.admin.agent.get(`/api/subscriptions/${future.id}`)).body.stage, 'Confirmed');
  current.advanceTime(14 * 24 * 60 * 60_000); await current.refreshAdmin();
  const processed = await current.post('subscriptions/process-due', { limit: 1 }); assert.equal(processed.status, 200); assert.equal(processed.body.activated, 1); assert.equal(processed.body.remaining, 0);
  const active = await current.admin.agent.get(`/api/subscriptions/${future.id}`); assert.equal(active.body.stage, 'Active');
  assert.equal(active.body.history.filter((event: { kind: string }) => event.kind === 'activated').length, 1);
  assert.equal((await current.post('subscriptions/process-due', { limit: 1 })).body.activated, 0);
  assert.equal((await current.post('subscriptions/process-due', { limit: 1, businessDate: '2099-01-01' })).status, 400);
});

test('SUB-03: ended confirmed terms are explicitly blocked and cannot starve a bounded actionable queue', async t => {
  const current = await setup(t);
  const daily = await current.post('plans', { ...current.planBody, interval: 'daily', name: 'Daily activation' }); assert.equal(daily.status, 201);
  const commercial = { templateId: null, planId: daily.body.id, validDays: 7, lines: current.templateBody.lines, termPeriods: 1 };
  const old = await current.confirmed({ ...commercial, startDate: '2026-11-02' });
  const valid = await current.confirmed({ ...commercial, startDate: '2026-11-04' });
  current.advanceTime(3 * 24 * 60 * 60_000); await current.refreshAdmin();
  const processed = await current.post('subscriptions/process-due', { limit: 1 });
  assert.equal(processed.status, 200); assert.equal(processed.body.activated, 1); assert.equal(processed.body.blocked, 1); assert.equal(processed.body.remaining, 0);
  assert.ok(processed.body.items.some((item: { id: string; outcome: string }) => item.id === old.id && item.outcome === 'blocked'));
  assert.equal((await current.admin.agent.get(`/api/subscriptions/${valid.id}`)).body.stage, 'Active');
  const blocked = await current.admin.agent.get(`/api/subscriptions/${old.id}`); assert.equal(blocked.body.stage, 'Closed'); assert.equal(blocked.body.allowedActions.includes('activate'), false, 'P6 applies the accepted auto-close policy before showing an expired agreement.');
});

test('AUTH-04/SUB-04: customers see only their own records and cannot mutate ownership, prices or stages', async t => {
  const current = await setup(t); const maya = await current.quote(); const arun = await current.quote({ customerId: current.arunId });
  const signed = await signIn(current.app, 'maya@brightloop.test');
  const list = await signed.agent.get('/api/subscriptions'); assert.equal(list.status, 200); assert.equal(list.body.total, 1); assert.equal(list.body.items[0].id, maya.id);
  assert.equal((await signed.agent.get('/api/subscriptions').query({ customerId: current.arunId })).body.total, 0);
  assert.equal((await signed.agent.get(`/api/subscriptions/${arun.id}`)).status, 404);
  const own = await signed.agent.get(`/api/subscriptions/${maya.id}`); assert.equal(own.status, 200); assert.deepEqual(own.body.allowedActions, []);
  const serialized = JSON.stringify(own.body);
  for (const forbidden of ['costPrice', 'cost_price', 'notes', 'password', 'Private internal product note', 'arun@brightloop.test']) assert.equal(serialized.includes(forbidden), false);
  const mutation = (path: string, body: object) => signed.agent.post(`/api/${path}`).set('X-CSRF-Token', signed.csrfToken).send(body);
  assert.equal((await mutation('subscriptions', { ...current.input, idempotencyKey: randomUUID() })).status, 403);
  assert.equal((await mutation('subscriptions/preview', current.input)).status, 403);
  assert.equal((await mutation('subscriptions/process-due', { limit: 1 })).status, 403);
  for (const id of [maya.id, arun.id]) {
    assert.equal((await signed.agent.put(`/api/subscriptions/${id}`).set('X-CSRF-Token', signed.csrfToken).send({ ...current.input, customerId: current.arunId, version: 1 })).status, 403);
    for (const action of ['issue', 'confirm', 'activate']) assert.equal((await mutation(`subscriptions/${id}/${action}`, { version: 1 })).status, 403);
  }
  const staff = await signIn(current.app, 'staff@brightloop.test');
  assert.equal((await staff.agent.get('/api/subscriptions')).body.total, 2);
  assert.equal((await staff.agent.get(`/api/subscriptions/${arun.id}`)).status, 200);
});

test('P3: invalid references, incomplete or forged commercial fields fail without records or counter consumption', async t => {
  const current = await setup(t);
  const staffId = String(current.db.prepare('SELECT id FROM users WHERE email=?').get('staff@brightloop.test')?.id);
  const invalids = [
    { ...current.input, customerId: staffId }, { ...current.input, customerId: randomUUID() },
    { ...current.input, total: 1 }, { ...current.input, role: 'admin' }, { ...current.input, stage: 'Active' },
    { ...current.input, termPeriods: 0 }, { ...current.input, termPeriods: 1_201 },
    { ...current.input, templateId: null }, { ...current.input, planId: randomUUID() },
  ];
  for (const input of invalids) assert.equal((await current.post('subscriptions', { ...input, idempotencyKey: randomUUID() })).status, 400);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM subscriptions').get()?.count, 0);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM subscription_requests').get()?.count, 0);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM reference_counters').get()?.count, 0);
});

test('P3: create replay is actor-bound and payload-bound, survives later configuration changes and exposes the original record', async t => {
  const current = await setup(t); const key = randomUUID(); const first = await current.quote({}, key);
  const replay = await current.post('subscriptions', { ...current.input, idempotencyKey: key }); assert.equal(replay.status, 200); assert.equal(replay.body.id, first.id);
  assert.equal((await current.post('subscriptions', { ...current.input, paymentTermDays: 8, idempotencyKey: key })).status, 409);
  const staff = await signIn(current.app, 'staff@brightloop.test');
  const crossActor = await staff.agent.post('/api/subscriptions').set('X-CSRF-Token', staff.csrfToken).send({ ...current.input, idempotencyKey: key }); assert.equal(crossActor.status, 409);
  await current.put(`plans/${current.plan.id}`, { ...current.planBody, active: false, version: 1 });
  const repeated = await current.post('subscriptions', { ...current.input, idempotencyKey: key }); assert.equal(repeated.status, 200); assert.equal(repeated.body.id, first.id);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM subscriptions').get()?.count, 1);
  assert.equal(current.db.prepare("SELECT value FROM reference_counters WHERE kind='subscription'").get()?.value, 1);
});

test('P3: independent workers racing the same create key commit one agreement and one reference', { timeout: 30_000 }, async t => {
  const current = await setup(t); const key = randomUUID();
  const signed = await request(current.app).post('/api/auth/login').send({ email: 'admin@brightloop.test', password: demoPassword }); assert.equal(signed.status, 200);
  const cookies = signed.headers['set-cookie'] as unknown as string[]; const cookie = cookies.map(value => value.split(';')[0]).join('; ');
  const workerSource = `
    import request from 'supertest';
    import { createApp } from './server/app.ts';
    const app=createApp({databasePath:process.env.SUBTRACK_TEST_DB,mailMode:'outbox',clock:()=>new Date('2026-11-01T04:00:00.000Z')});
    process.send({type:'ready'});
    process.once('message',async message=>{
      try{const response=await request(app).post('/api/subscriptions').set('Cookie',message.cookie).set('X-CSRF-Token',message.csrfToken).send(message.body);
        process.send({type:'result',status:response.status,id:response.body.id});}
      catch(error){process.send({type:'error',message:error.message});process.exitCode=1;}
      finally{await app.locals.billingWorker.stop();await app.locals.deliverPending.stop();app.locals.db.close();process.disconnect();}
    });`;
  type Message = { type: string; status: number; id: string; message: string };
  function worker() {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', workerSource], {
      cwd: process.cwd(), env: { ...process.env, SUBTRACK_TEST_DB: current.databasePath }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    let stderr = ''; child.stderr?.on('data', data => { stderr += String(data); });
    const ready = new Promise<void>((resolve, reject) => { child.on('message', raw => { if ((raw as Message).type === 'ready') resolve(); }); child.on('error', reject); child.on('exit', code => { if (code !== 0) reject(new Error(`Worker exited ${code}: ${stderr}`)); }); });
    const result = new Promise<Message>((resolve, reject) => { child.on('message', raw => { const message = raw as Message; if (message.type === 'result') resolve(message); if (message.type === 'error') reject(new Error(message.message)); }); child.on('error', reject); });
    const exited = new Promise<void>((resolve, reject) => { child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Worker exited ${code}: ${stderr}`))); });
    return { child, ready, result, exited };
  }
  const left = worker(); const right = worker(); await Promise.all([left.ready, right.ready]);
  const message = { cookie, csrfToken: signed.body.csrfToken, body: { ...current.input, idempotencyKey: key } };
  left.child.send(message); right.child.send(message);
  const results = await Promise.all([left.result, right.result]); await Promise.all([left.exited, right.exited]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 201]); assert.equal(results[0].id, results[1].id);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM subscriptions').get()?.count, 1);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM subscription_requests').get()?.count, 1);
  assert.equal(current.db.prepare("SELECT value FROM reference_counters WHERE kind='subscription'").get()?.value, 1);
});

test('SUB-04: filtered paginated staff list uses full persisted totals and bounded safe search', async t => {
  const current = await setup(t); const first = await current.quote(); await current.quote({ customerId: current.arunId }); await current.quote();
  await current.action(first, 'issue');
  const filtered = await current.admin.agent.get('/api/subscriptions').query({ customerId: current.mayaId, pageSize: 1, page: 100 });
  assert.equal(filtered.status, 200); assert.equal(filtered.body.total, 2); assert.equal(filtered.body.page, 2); assert.equal(filtered.body.items.length, 1);
  assert.equal((await current.admin.agent.get('/api/subscriptions').query({ stage: 'Quotation' })).body.total, 1);
  assert.equal((await current.admin.agent.get('/api/subscriptions').query({ q: first.number })).body.total, 1);
  assert.equal((await current.admin.agent.get('/api/subscriptions').query({ q: "' OR 1=1 --" })).body.total, 0);
  assert.equal((await current.admin.agent.get('/api/subscriptions').query({ pageSize: 101 })).status, 400);
});
