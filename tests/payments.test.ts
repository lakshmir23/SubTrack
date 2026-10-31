import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import test, { type TestContext } from 'node:test';
import request from 'supertest';
import type { Invoice } from '../shared/billing.js';
import type { PaymentInput } from '../shared/payments.js';
import { migratePaymentFactsGuard } from '../server/payments-schema.js';
import { fixture, signIn, demoPassword } from './fixtures.js';

async function setup(t: TestContext, options: { confirmed?: boolean; zero?: boolean } = {}) {
  const current = await fixture(t, { appOptions: { billingWorkerOptions: { autoStart: false } } });
  let admin = await signIn(current.app);
  const post = (path: string, body: object) => admin.agent.post(`/api/${path}`).set('X-CSRF-Token', admin.csrfToken).send(body);
  const product = await post('products', { name: 'Business Software', type: 'software', salesPrice: 120_000, costPrice: 40_000, notes: 'Private catalog note', active: true, variants: [{ name: 'Odoo', adjustment: options.zero ? 0 : 56_000, active: true }] }); assert.equal(product.status, 201);
  const plan = await post('plans', { name: 'Monthly operations', primaryProductId: product.body.id, price: options.zero ? 0 : 100_000, interval: 'monthly', minQuantity: 1, availableFrom: null, availableTo: null, autoClose: true, allowPause: true, allowRenew: true, allowEarlyClose: true, active: true }); assert.equal(plan.status, 201);
  assert.equal((await post('taxes', { name: 'Fictional demo tax', rateBps: 1000, productId: null, priority: 0, active: true })).status, 201);
  const customerId = String(current.db.prepare('SELECT id FROM users WHERE email=?').get('maya@brightloop.test')?.id);
  const draft = await post('subscriptions', { customerId, planId: plan.body.id, templateId: null, startDate: '2026-11-01', termPeriods: 3, paymentTermDays: 7, validDays: 7, lines: [{ productId: product.body.id, variantId: product.body.variants[0].id, quantity: 2 }], idempotencyKey: randomUUID() }); assert.equal(draft.status, 201);
  const issued = await post(`subscriptions/${draft.body.id}/issue`, { version: draft.body.version }); assert.equal(issued.status, 200);
  const accepted = await post(`subscriptions/${draft.body.id}/confirm`, { version: issued.body.version }); assert.equal(accepted.status, 200);
  assert.equal((await post(`subscriptions/${draft.body.id}/activate`, { version: accepted.body.version })).status, 200);
  assert.equal((await post('discounts', { name: 'Launch ten percent', kind: 'percentage', amountMinor: null, percentBps: 1000, minAmount: null, minQuantity: 2, startDate: null, endDate: null, maxUses: 1, priority: 0, active: true, scope: 'subscription', subscriptionId: draft.body.id, productIds: [] })).status, 201);
  const generated = await post(`subscriptions/${draft.body.id}/invoices`, { expectedPeriodStart: '2026-11-01', idempotencyKey: randomUUID() }); assert.equal(generated.status, 201);
  const invoice = options.confirmed === false ? generated.body as Invoice : (await post(`invoices/${generated.body.id}/confirm`, { version: generated.body.version })).body as Invoice;
  assert.equal(invoice.total, options.zero ? 0 : 308_880);
  return { ...current, get admin() { return admin; }, invoice, post,
    async advance(milliseconds: number) { current.advanceTime(milliseconds); admin = await signIn(current.app); },
    payment(changes: Partial<PaymentInput> = {}): PaymentInput { return { amount: 100_000, currency: 'INR', method: 'bank_transfer', paymentDate: '2026-11-01', note: 'INTERNAL BANK MATCH NOTE <script>private</script>', idempotencyKey: randomUUID(), ...changes }; },
  };
}

test('PAY-01/PAY-02: 1,000 then 2,088.80 on different days settles the correct invoice atomically', async t => {
  const current = await setup(t); const firstBody = current.payment();
  const first = await current.post(`invoices/${current.invoice.id}/payments`, firstBody);
  assert.equal(first.status, 201); assert.equal(first.body.replayed, false); assert.equal(first.body.invoice.status, 'Confirmed');
  assert.equal(first.body.invoice.amountPaid, 100_000); assert.equal(first.body.invoice.outstanding, 208_880); assert.equal(first.body.invoice.paymentCount, 1);
  assert.equal(first.body.payment.amount, 100_000); assert.equal(first.body.payment.method, 'bank_transfer'); assert.equal(first.body.payment.paymentDate, '2026-11-01'); assert.equal(first.body.payment.recordedAt, '2026-11-01T04:00:00.000Z'); assert.equal(first.body.payment.note, firstBody.note);
  assert.equal((await current.post(`invoices/${current.invoice.id}/cancel`, { version: first.body.invoice.version })).status, 409);
  await current.advance(24 * 60 * 60 * 1000);
  const finalBody = current.payment({ amount: 208_880, method: 'cash', paymentDate: '2026-11-02', note: 'SECOND INTERNAL NOTE' });
  const final = await current.post(`invoices/${current.invoice.id}/payments`, finalBody);
  assert.equal(final.status, 201); assert.equal(final.body.invoice.status, 'Paid'); assert.equal(final.body.invoice.amountPaid, 308_880); assert.equal(final.body.invoice.outstanding, 0); assert.equal(final.body.invoice.paymentCount, 2); assert.equal(final.body.invoice.settlementReason, 'fully paid'); assert.equal(final.body.invoice.settledAt, '2026-11-02T04:00:00.000Z');
  const replayFirst = await current.post(`invoices/${current.invoice.id}/payments`, firstBody);
  assert.equal(replayFirst.status, 200); assert.equal(replayFirst.body.payment.id, first.body.payment.id); assert.equal(replayFirst.body.replayed, true); assert.equal(replayFirst.body.invoice.status, 'Paid');
  const replayFinal = await current.post(`invoices/${current.invoice.id}/payments`, finalBody); assert.equal(replayFinal.status, 200); assert.equal(replayFinal.body.payment.id, final.body.payment.id);
  assert.equal(current.db.prepare('SELECT sum(amount) AS amount,count(*) AS count FROM payments WHERE invoice_id=?').get(current.invoice.id)?.amount, 308_880);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM payments').get()?.count, 2);
  assert.equal(current.db.prepare("SELECT count(*) AS count FROM invoice_history WHERE invoice_id=? AND kind='payment_recorded'").get(current.invoice.id)?.count, 2);
  assert.equal(current.db.prepare("SELECT count(*) AS count FROM invoice_history WHERE invoice_id=? AND kind='settled'").get(current.invoice.id)?.count, 1);
});

test('PAY-01: equal legitimate entries have different keys; changed fields or actor on an old key conflict', async t => {
  const current = await setup(t); const body = current.payment({ amount: 50_000, method: 'card', note: 'Same legitimate transfer details' });
  const first = await current.post(`invoices/${current.invoice.id}/payments`, body); assert.equal(first.status, 201);
  assert.equal((await current.post(`invoices/${current.invoice.id}/payments`, body)).status, 200);
  const second = await current.post(`invoices/${current.invoice.id}/payments`, { ...body, idempotencyKey: randomUUID() }); assert.equal(second.status, 201); assert.notEqual(second.body.payment.id, first.body.payment.id);
  assert.equal(second.body.invoice.amountPaid, 100_000); assert.equal(second.body.invoice.paymentCount, 2);
  for (const changes of [{ amount: 50_001 }, { note: 'Changed internal note' }, { method: 'cash' }, { paymentDate: '2026-10-31' }]) {
    const conflict = await current.post(`invoices/${current.invoice.id}/payments`, { ...body, ...changes }); assert.equal(conflict.status, 409); assert.equal(conflict.body.error.code, 'IDEMPOTENCY_CONFLICT');
  }
  assert.equal((await current.post(`invoices/${randomUUID()}/payments`, body)).status, 409);
  const staff = await signIn(current.app, 'staff@brightloop.test');
  assert.equal((await staff.agent.post(`/api/invoices/${current.invoice.id}/payments`).set('X-CSRF-Token', staff.csrfToken).send(body)).status, 409);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM payments').get()?.count, 2);
});

test('PAY-01: invalid amounts, currency, dates and browser-owned financial fields never allocate money', async t => {
  const current = await setup(t); const before = current.db.prepare('SELECT status,amount_paid,payment_count,version FROM invoices WHERE id=?').get(current.invoice.id);
  for (const changes of [
    { amount: 0 }, { amount: -1 }, { amount: 1.5 }, { amount: 1_000_000_000_001 }, { currency: 'USD' }, { method: 'unconfigured' },
    { paymentDate: '2026-02-30' }, { paymentDate: 'not-a-date' }, { paymentDate: '2026-11-02' }, { note: 'x'.repeat(2001) },
    { recordedAt: '2020-01-01T00:00:00Z' }, { status: 'Paid' }, { amountPaid: 1 }, { version: 1 },
  ]) {
    const invalid = await current.post(`invoices/${current.invoice.id}/payments`, { ...current.payment(), ...changes }); assert.equal(invalid.status, 400, JSON.stringify(changes));
  }
  const over = await current.post(`invoices/${current.invoice.id}/payments`, current.payment({ amount: current.invoice.total + 1 })); assert.equal(over.status, 409); assert.equal(over.body.error.code, 'OVERPAYMENT'); assert.ok(over.body.error.fields.amount);
  assert.deepEqual(current.db.prepare('SELECT status,amount_paid,payment_count,version FROM invoices WHERE id=?').get(current.invoice.id), before);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM payments').get()?.count, 0);
});

test('PAY-01/AUTH-04: internal recording and own history enforce roles; customer DTO, history, print and notices omit internal notes', async t => {
  const current = await setup(t); const maya = await signIn(current.app, 'maya@brightloop.test'); const arun = await signIn(current.app, 'arun@brightloop.test');
  assert.equal((await request(current.app).post(`/api/invoices/${current.invoice.id}/payments`).send(current.payment())).status, 401);
  for (const customer of [maya, arun]) assert.equal((await customer.agent.post(`/api/invoices/${current.invoice.id}/payments`).set('X-CSRF-Token', customer.csrfToken).send(current.payment())).status, 403);
  assert.equal((await request(current.app).get(`/api/invoices/${current.invoice.id}/payments`)).status, 401);
  assert.equal((await arun.agent.get(`/api/invoices/${current.invoice.id}/payments`)).status, 404);
  assert.equal((await maya.agent.get(`/api/invoices/${current.invoice.id}/payments`)).body.total, 0);
  const staff = await signIn(current.app, 'staff@brightloop.test'); const body = current.payment();
  const recorded = await staff.agent.post(`/api/invoices/${current.invoice.id}/payments`).set('X-CSRF-Token', staff.csrfToken).send(body); assert.equal(recorded.status, 201);
  const internal = await current.admin.agent.get(`/api/invoices/${current.invoice.id}/payments`); assert.equal(internal.body.items[0].note, body.note);
  const own = await maya.agent.get(`/api/invoices/${current.invoice.id}/payments`).query({ page: 999, pageSize: 1 }); assert.equal(own.status, 200); assert.equal(own.body.page, 1); assert.equal(own.body.total, 1); assert.equal(own.body.items[0].amount, body.amount); assert.equal('note' in own.body.items[0], false);
  const detail = await maya.agent.get(`/api/invoices/${current.invoice.id}`); const printed = await maya.agent.get(`/api/invoices/${current.invoice.id}/print`);
  const queued = await current.post(`invoices/${current.invoice.id}/send`, { idempotencyKey: randomUUID() }); assert.equal(queued.status, 201);
  const notice = current.db.prepare('SELECT body FROM outbox WHERE id=?').get(queued.body.id);
  for (const value of [JSON.stringify(own.body), JSON.stringify(detail.body), printed.text, String(notice?.body)]) assert.equal(value.includes(body.note), false);
  assert.equal(JSON.stringify(detail.body.history).includes('INTERNAL BANK MATCH NOTE'), false);
  assert.equal(JSON.stringify(current.db.prepare("SELECT details FROM audit_events WHERE kind='payment.recorded'").all()).includes(body.note), false);
});

test('PAY-01/PAY-02: Draft, Canceled and zero-total Paid invoices reject new payments; payment facts are immutable', async t => {
  await t.test('Draft and canceled', async sub => {
    const current = await setup(sub, { confirmed: false });
    assert.equal((await current.post(`invoices/${current.invoice.id}/payments`, current.payment())).status, 409);
    const canceled = await current.post(`invoices/${current.invoice.id}/cancel`, { version: current.invoice.version }); assert.equal(canceled.status, 200);
    assert.equal((await current.post(`invoices/${current.invoice.id}/payments`, current.payment())).status, 409);
    assert.equal(current.db.prepare('SELECT count(*) AS count FROM payments').get()?.count, 0);
  });
  await t.test('zero amount already settled', async sub => {
    const current = await setup(sub, { zero: true }); assert.equal(current.invoice.status, 'Paid');
    assert.equal((await current.post(`invoices/${current.invoice.id}/payments`, current.payment({ amount: 1 }))).status, 409);
    assert.equal(current.db.prepare('SELECT count(*) AS count FROM payments').get()?.count, 0);
  });
  await t.test('immutable allocation and cancellation defense', async sub => {
    const current = await setup(sub); const body = current.payment(); const recorded = await current.post(`invoices/${current.invoice.id}/payments`, body); assert.equal(recorded.status, 201);
    assert.throws(() => current.db.prepare('UPDATE payments SET amount=1 WHERE id=?').run(recorded.body.payment.id));
    assert.throws(() => current.db.prepare('UPDATE payments SET note=? WHERE id=?').run('Edited', recorded.body.payment.id));
    assert.throws(() => current.db.prepare('DELETE FROM payments WHERE id=?').run(recorded.body.payment.id));
    assert.throws(() => current.db.prepare('UPDATE invoices SET amount_paid=0,payment_count=0 WHERE id=?').run(current.invoice.id));
    assert.throws(() => current.db.prepare("UPDATE invoices SET status='Canceled',canceled_at=? WHERE id=?").run('2026-11-01T04:01:00.000Z', current.invoice.id));
    const raw = current.db.prepare('SELECT * FROM payments WHERE id=?').get(recorded.body.payment.id)!;
    const insert = current.db.prepare('INSERT INTO payments(id,invoice_id,amount,currency,method,payment_date,note,actor_id,recorded_by_name,idempotency_key,payload_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
    assert.throws(() => insert.run(randomUUID(), current.invoice.id, current.invoice.total, 'INR', 'cash', '2026-11-01', '', raw.actor_id, raw.recorded_by_name, randomUUID(), 'a'.repeat(64), '2026-11-01T04:01:00.000Z'));
    assert.equal(current.db.prepare('SELECT count(*) AS count FROM payments').get()?.count, 1);
  });
});

test('PAY-01: a later transactional failure rolls back the payment, balance, receipt and audit before exact retry', async t => {
  const current = await setup(t); const input = current.payment();
  const before = current.db.prepare('SELECT status,amount_paid,payment_count,version FROM invoices WHERE id=?').get(current.invoice.id);
  current.db.exec("CREATE TEMP TRIGGER fail_payment_history BEFORE INSERT ON invoice_history WHEN NEW.kind='payment_recorded' BEGIN SELECT RAISE(ABORT,'Synthetic payment history failure'); END;");
  const failed = await current.post(`invoices/${current.invoice.id}/payments`, input); assert.equal(failed.status, 500); assert.equal(JSON.stringify(failed.body).includes(input.note), false); assert.equal(JSON.stringify(failed.body).includes('Synthetic payment history failure'), false);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM payments').get()?.count, 0);
  assert.deepEqual(current.db.prepare('SELECT status,amount_paid,payment_count,version FROM invoices WHERE id=?').get(current.invoice.id), before);
  assert.equal(current.db.prepare("SELECT count(*) AS count FROM audit_events WHERE kind='payment.recorded'").get()?.count, 0);
  current.db.exec('DROP TRIGGER fail_payment_history');
  const retry = await current.post(`invoices/${current.invoice.id}/payments`, input); assert.equal(retry.status, 201); assert.equal(retry.body.invoice.paymentCount, 1);
});

test('PAY-01: payment event date uses Kolkata business date and remains distinct from UTC recording time', async t => {
  const current = await setup(t);
  await current.advance((14 * 60 + 30) * 60 * 1000);
  const recorded = await current.post(`invoices/${current.invoice.id}/payments`, current.payment({ paymentDate: '2026-11-02' }));
  assert.equal(recorded.status, 201); assert.equal(recorded.body.payment.paymentDate, '2026-11-02'); assert.equal(recorded.body.payment.recordedAt, '2026-11-01T18:30:00.000Z');
});

test('P6: the forward payment-facts guard preserves existing allocations and is repeatable', async t => {
  const current = await setup(t); const recorded = await current.post(`invoices/${current.invoice.id}/payments`, current.payment()); assert.equal(recorded.status, 201);
  const before = current.db.prepare('SELECT status,amount_paid,payment_count,version FROM invoices WHERE id=?').get(current.invoice.id);
  current.db.exec('DROP TRIGGER invoice_payment_facts_guard; DELETE FROM schema_migrations WHERE version=10;');
  migratePaymentFactsGuard(current.db); migratePaymentFactsGuard(current.db);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM schema_migrations WHERE version=10').get()?.count, 1);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM payments').get()?.count, 1);
  assert.deepEqual(current.db.prepare('SELECT status,amount_paid,payment_count,version FROM invoices WHERE id=?').get(current.invoice.id), before);
  assert.throws(() => current.db.prepare('UPDATE invoices SET amount_paid=0,payment_count=0 WHERE id=?').run(current.invoice.id));
});

async function racePayments(t: TestContext, current: Awaited<ReturnType<typeof setup>>, inputs: PaymentInput[]) {
  const login = await request(current.app).post('/api/auth/login').send({ email: 'admin@brightloop.test', password: demoPassword }); assert.equal(login.status, 200);
  const cookie = (login.headers['set-cookie'] as unknown as string[]).map(value => value.split(';')[0]).join('; ');
  const script = `import request from 'supertest';import{createApp}from'./server/app.ts';
    const app=createApp({databasePath:process.argv[2],mailMode:'outbox',clock:()=>new Date('2026-11-01T04:00:00.000Z'),billingWorkerOptions:{autoStart:false}});
    process.send({type:'ready'});process.once('message',async m=>{try{const r=await request(app).post('/api/invoices/'+m.invoiceId+'/payments').set('Cookie',m.cookie).set('X-CSRF-Token',m.csrf).send(m.input);process.send({type:'result',status:r.status,paymentId:r.body.payment?.id,invoiceStatus:r.body.invoice?.status,error:r.body.error?.code});}
    catch(e){process.send({type:'error',message:e.message});process.exitCode=1;}finally{await app.locals.billingWorker.stop();await app.locals.deliverPending.stop();app.locals.db.close();process.disconnect();}});`;
  type Message = { type: string; status: number; paymentId?: string; invoiceStatus?: string; error?: string; message?: string };
  function worker() {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-', current.databasePath], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
    t.after(() => { if (child.exitCode === null) child.kill(); }); let stderr = ''; child.stderr?.on('data', value => { stderr += String(value); });
    const ready = new Promise<void>((resolve, reject) => { child.on('message', raw => { if ((raw as Message).type === 'ready') resolve(); }); child.on('error', reject); child.on('exit', code => { if (code !== 0) reject(new Error(`Payment worker exited ${code}: ${stderr}`)); }); });
    const result = new Promise<Message>((resolve, reject) => { child.on('message', raw => { const message = raw as Message; if (message.type === 'result') resolve(message); if (message.type === 'error') reject(new Error(message.message)); }); child.on('error', reject); });
    const exited = new Promise<void>((resolve, reject) => { child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Payment worker exited ${code}: ${stderr}`))); });
    child.stdin!.end(script); return { child, ready, result, exited };
  }
  const workers = inputs.map(worker); await Promise.all(workers.map(value => value.ready));
  workers.forEach((value, index) => value.child.send({ invoiceId: current.invoice.id, input: inputs[index], cookie, csrf: login.body.csrfToken }));
  const results = await Promise.all(workers.map(value => value.result)); await Promise.all(workers.map(value => value.exited)); return results;
}

test('PAY-01: two independent processes cannot together overpay one invoice', { timeout: 30_000 }, async t => {
  const current = await setup(t); const results = await racePayments(t, current, [current.payment({ amount: 200_000 }), current.payment({ amount: 200_000 })]);
  assert.deepEqual(results.map(value => value.status).sort(), [201, 409]); assert.equal(results.find(value => value.status === 409)?.error, 'OVERPAYMENT');
  const invoice = current.db.prepare('SELECT status,amount_paid,payment_count FROM invoices WHERE id=?').get(current.invoice.id)!;
  assert.equal(invoice.status, 'Confirmed'); assert.equal(invoice.amount_paid, 200_000); assert.equal(invoice.payment_count, 1);
  assert.equal(current.db.prepare('SELECT sum(amount) AS amount,count(*) AS count FROM payments').get()?.count, 1);
});

test('PAY-01: two independent full-payment replays settle once and return the same allocation after Paid', { timeout: 30_000 }, async t => {
  const current = await setup(t); const input = current.payment({ amount: current.invoice.total }); const results = await racePayments(t, current, [input, input]);
  assert.deepEqual(results.map(value => value.status).sort(), [200, 201]); assert.equal(results[0].paymentId, results[1].paymentId); assert.deepEqual(results.map(value => value.invoiceStatus), ['Paid', 'Paid']);
  const invoice = current.db.prepare('SELECT status,amount_paid,payment_count FROM invoices WHERE id=?').get(current.invoice.id)!;
  assert.equal(invoice.status, 'Paid'); assert.equal(invoice.amount_paid, 308_880); assert.equal(invoice.payment_count, 1);
  assert.equal(current.db.prepare('SELECT sum(amount) AS amount FROM payments').get()?.amount, 308_880);
});
