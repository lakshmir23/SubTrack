import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import request from 'supertest';
import { fixture, signIn } from './fixtures.js';
import type { AiQuoteOptions } from '../server/ai-quote.js';
import { createApp } from '../server/app.js';

async function setup(t: TestContext, changes: Partial<AiQuoteOptions> = {}) {
  let mode = 'success'; const outbound: Record<string, unknown>[] = [];
  const provider: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)); outbound.push(body);
    const context = JSON.parse(body.input[0].content).catalog;
    if (mode === 'timeout') return new Promise<Response>(() => {});
    if (mode === 'network') throw new Error('Synthetic private provider diagnostic never returned to clients.');
    if (mode === 'malformed') return new Response('{not-json');
    const usage = { input_tokens: 100, output_tokens: 50 };
    if (mode === 'refusal') return Response.json({ status: 'completed', usage, output: [{ content: [{ type: 'refusal' }] }] });
    if (mode === 'incomplete') return Response.json({ status: 'incomplete', usage, output: [] });
    const plan = context.plans[0]; const product = context.products.find((item: { id: string }) => item.id === plan.primaryProductId);
    const proposal = { schema_version: 'quote-proposal-v1', template_id: null, plan_id: plan.id, lines: [{ product_id: product.id, variant_id: product.variants[0].id, quantity: 2 }], requested_start_date: '2026-11-01', clarifications: [] };
    const changed = mode === 'unknown' ? { ...proposal, plan_id: randomUUID() } : mode === 'extra' ? { ...proposal, total: 1 } : mode === 'negative' ? { ...proposal, lines: [{ ...proposal.lines[0], quantity: -1 }] } : mode === 'fraction' ? { ...proposal, lines: [{ ...proposal.lines[0], quantity: 1.5 }] } : mode === 'unresolved' ? { ...proposal, plan_id: null, lines: [], requested_start_date: null, clarifications: ['Choose the cadence manually.'] } : proposal;
    return Response.json({ status: 'completed', usage, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(changed) }] }] });
  };
  const current = await fixture(t, { appOptions: { aiQuote: { enabled: true, apiKey: 'synthetic-key-not-a-real-credential', budgetUsd: 5, fetch: provider, timeoutMs: 25, ...changes } } });
  const admin = await signIn(current.app);
  const post = (path: string, body: object) => admin.agent.post(`/api/${path}`).set('X-CSRF-Token', admin.csrfToken).send(body);
  const productBody = { name: 'AI test software', type: 'software', salesPrice: 100000, costPrice: 40000, notes: 'PRIVATE INTERNAL PRODUCT NOTE', active: true, variants: [{ name: 'Odoo', adjustment: 56000, active: true }] };
  const product = await post('products', productBody); assert.equal(product.status, 201);
  const planBody = { name: 'AI test monthly', primaryProductId: product.body.id, price: 100000, interval: 'monthly', minQuantity: 1, availableFrom: null, availableTo: null, autoClose: true, allowPause: true, allowRenew: true, allowEarlyClose: true, active: true };
  const plan = await post('plans', planBody); assert.equal(plan.status, 201);
  const customerId = String(current.db.prepare("SELECT id FROM users WHERE email='maya@brightloop.test'").get()?.id);
  const otherId = String(current.db.prepare("SELECT id FROM users WHERE email='arun@brightloop.test'").get()?.id);
  const requestBody = { customerId, request: 'Two Odoo seats, monthly, starting 1 November 2026.' };
  const commercial = { customerId, planId: plan.body.id, templateId: null, startDate: '2026-11-01', termPeriods: 12, paymentTermDays: 7, validDays: 7, lines: [{ productId: product.body.id, variantId: product.body.variants[0].id, quantity: 2 }] };
  const propose = () => post('ai/quote-proposals', requestBody);
  return { ...current, admin, post, product: product.body, productBody, plan: plan.body, planBody, customerId, otherId, requestBody, commercial, propose, outbound, mode(value: string) { mode = value; } };
}

test('P9: bounded Responses payload excludes identity/financial context; AI suggests only and ordinary human save creates one Draft', async t => {
  const current = await setup(t); const result = await current.propose(); assert.equal(result.status, 201, JSON.stringify(result.body));
  const body = current.outbound[0]; assert.equal(body.model, 'gpt-4.1-mini'); assert.equal(body.store, false); assert.equal(body.max_output_tokens, 800); assert.deepEqual(body.tools, []);
  const text = JSON.stringify(body); for (const forbidden of [current.customerId, 'maya@brightloop.test', 'Maya Shah', 'PRIVATE INTERNAL', 'costPrice', 'salesPrice', 'cost_price', 'paymentHistory', 'customerId']) assert.equal(text.includes(forbidden), false, forbidden);
  assert.ok(Buffer.byteLength(text, 'utf8') <= 24 * 1024); assert.equal(current.db.prepare('SELECT count(*) AS count FROM subscriptions').get()?.count, 0);
  const preview = await current.post('subscriptions/preview', { ...current.commercial, aiProposalId: result.body.id }); assert.equal(preview.status, 200); assert.equal(preview.body.terms.subtotal, 312000); assert.match(preview.body.aiReview.reviewHash, /^[a-f0-9]{64}$/);
  const key = randomUUID(); const input = { ...current.commercial, aiProposalId: result.body.id, reviewHash: preview.body.aiReview.reviewHash, idempotencyKey: key };
  const saved = await current.post('subscriptions', input); assert.equal(saved.status, 201); assert.equal(saved.body.stage, 'Draft'); assert.equal(saved.body.subtotal, 312000);
  const nextPreview = await current.post('subscriptions/preview', { ...current.commercial, aiProposalId: result.body.id }); assert.notEqual(nextPreview.body.aiReview.reviewHash, input.reviewHash);
  current.advanceTime(16 * 60000);
  const replay = await current.post('subscriptions', { ...input, reviewHash: nextPreview.body.aiReview.reviewHash }); assert.equal(replay.status, 200); assert.equal(replay.body.id, saved.body.id);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM subscriptions').get()?.count, 1); assert.equal(current.db.prepare('SELECT count(*) AS count FROM invoices').get()?.count, 0); assert.equal(current.db.prepare('SELECT count(*) AS count FROM payments').get()?.count, 0);
  assert.equal(JSON.stringify(current.db.prepare("SELECT details FROM audit_events WHERE kind='ai.quote_proposal'").all()).includes(current.requestBody.request), false);
});

test('P9: default-off, missing cap/key, unauthorized callers and personal data never dispatch', async t => {
  for (const changes of [{ enabled: false }, { apiKey: undefined }, { budgetUsd: undefined }, { budgetUsd: 5.01 }]) await t.test(JSON.stringify(changes), async sub => {
    const current = await setup(sub, changes); assert.equal((await current.propose()).status, 503); assert.equal(current.outbound.length, 0);
  });
  const current = await setup(t); const customer = await signIn(current.app, 'maya@brightloop.test');
  for (const path of ['ai/quote-assist', 'ai/quote-proposals']) {
    const anonymous = path.endsWith('assist') ? await request(current.app).get(`/api/${path}`) : await request(current.app).post(`/api/${path}`).send(current.requestBody); assert.equal(anonymous.status, 401);
    const denied = path.endsWith('assist') ? await customer.agent.get(`/api/${path}`) : await customer.agent.post(`/api/${path}`).set('X-CSRF-Token', customer.csrfToken).send(current.requestBody); assert.equal(denied.status, 403);
  }
  for (const changes of [{ request: 'For maya@brightloop.test' }, { request: 'For Maya Shah monthly software.' }, { request: 'x'.repeat(1001) }, { customerId: current.admin.user.id }]) assert.equal((await current.post('ai/quote-proposals', { ...current.requestBody, ...changes })).status, 400);
  assert.equal(current.outbound.length, 0); assert.equal(current.db.prepare('SELECT count(*) AS count FROM ai_quote_requests').get()?.count, 0);
});

test('P9: unknown IDs, invented money, fractional/negative quantities reject; unresolved fields remain manual', async t => {
  const current = await setup(t);
  for (const mode of ['unknown', 'extra', 'fraction', 'negative']) { current.mode(mode); const response = await current.propose(); assert.equal(response.status, 502, mode); }
  current.mode('unresolved'); const unresolved = await current.propose(); assert.equal(unresolved.status, 201); assert.equal(unresolved.body.proposal.plan_id, null); assert.equal(unresolved.body.proposal.clarifications.length, 1);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM subscriptions').get()?.count, 0);
  assert.equal((await current.propose()).status, 429); assert.equal(current.outbound.length, 5);
});

test('P9: timeout, network, refusal and truncation preserve manual entry and retain unknown reservation charges without retry', async t => {
  const current = await setup(t);
  for (const [mode, status] of [['timeout', 504], ['network', 502], ['refusal', 502], ['incomplete', 502], ['malformed', 502]] as const) { current.mode(mode); const response = await current.propose(); assert.equal(response.status, status); assert.equal(JSON.stringify(response.body).includes('private provider diagnostic'), false); }
  assert.equal(current.outbound.length, 5);
  const rows = current.db.prepare('SELECT status,charged_microusd FROM ai_quote_requests ORDER BY rowid').all();
  assert.equal(rows[0].status, 'unknown'); assert.equal(rows[0].charged_microusd, 20000); assert.equal(rows[1].charged_microusd, 20000); assert.equal(rows[4].charged_microusd, 20000);
  const manual = await current.post('subscriptions', { ...current.commercial, idempotencyKey: randomUUID() }); assert.equal(manual.status, 201); assert.equal(manual.body.stage, 'Draft');
});

test('P9: actor/customer/expiry review binding and changed financial terms require fresh explicit review', async t => {
  const current = await setup(t); const proposal = await current.propose(); assert.equal(proposal.status, 201); const id = proposal.body.id;
  const staff = await signIn(current.app, 'staff@brightloop.test');
  assert.equal((await staff.agent.post('/api/subscriptions/preview').set('X-CSRF-Token', staff.csrfToken).send({ ...current.commercial, aiProposalId: id })).status, 403);
  assert.equal((await current.post('subscriptions/preview', { ...current.commercial, customerId: current.otherId, aiProposalId: id })).status, 403);
  const preview = await current.post('subscriptions/preview', { ...current.commercial, aiProposalId: id }); const input = { ...current.commercial, aiProposalId: id, reviewHash: preview.body.aiReview.reviewHash, idempotencyKey: randomUUID() };
  assert.equal((await current.post('subscriptions', { ...input, reviewHash: '0'.repeat(64) })).status, 409);
  const edit = await current.admin.agent.put(`/api/plans/${current.plan.id}`).set('X-CSRF-Token', current.admin.csrfToken).send({ ...current.planBody, price: 120000, version: 1 }); assert.equal(edit.status, 200);
  const changed = await current.post('subscriptions', input); assert.equal(changed.status, 409); assert.equal(changed.body.error.code, 'AI_REVIEW_CHANGED'); assert.equal(current.db.prepare('SELECT count(*) AS count FROM subscriptions').get()?.count, 0);
  const renewed = await current.post('subscriptions/preview', { ...current.commercial, aiProposalId: id }); assert.equal(renewed.body.terms.subtotal, 352000);
  assert.equal((await current.post('subscriptions', { ...input, reviewHash: renewed.body.aiReview.reviewHash })).status, 201);
  current.advanceTime(16 * 60000); assert.equal((await current.post('subscriptions/preview', { ...current.commercial, aiProposalId: id })).status, 409);
});

test('P9: independent app connections cannot oversubscribe budget; ledger persists across connections', async t => {
  let release: (value: Response) => void = () => {}; let announce: () => void = () => {}; const started = new Promise<void>(resolve => { announce = resolve; });
  const pending: typeof fetch = async (_url, init) => { announce(); const body = JSON.parse(String(init?.body)); const context = JSON.parse(body.input[0].content).catalog; const plan = context.plans[0]; const product = context.products[0]; return new Promise<Response>(resolve => { release = () => resolve(Response.json({ status: 'completed', usage: { input_tokens: 100, output_tokens: 50 }, output: [{ content: [{ type: 'output_text', text: JSON.stringify({ schema_version: 'quote-proposal-v1', template_id: null, plan_id: plan.id, lines: [{ product_id: product.id, variant_id: product.variants[0].id, quantity: 2 }], requested_start_date: '2026-11-01', clarifications: [] }) }] }] })); }); };
  const current = await setup(t, { budgetUsd: .02, fetch: pending, timeoutMs: 8000 });
  const first = current.propose().then(response => response); await started;
  const other = createApp({ databasePath: current.databasePath, clock: () => new Date('2026-11-01T04:00:00.000Z'), aiQuote: { enabled: true, apiKey: 'stub', budgetUsd: .02, fetch: pending } });
  try {
    const staff = await signIn(other, 'staff@brightloop.test');
    const denied = await staff.agent.post('/api/ai/quote-proposals').set('X-CSRF-Token', staff.csrfToken).send(current.requestBody); assert.equal(denied.status, 503);
    assert.equal((await current.admin.agent.get('/api/ai/quote-assist')).body.budget.committedUsd, '0.020000');
    release(new Response()); assert.equal((await first).status, 201);
    const row = current.db.prepare('SELECT charged_microusd FROM ai_quote_requests').get(); assert.equal(row?.charged_microusd, 120);
    assert.equal((await staff.agent.get('/api/ai/quote-assist')).body.budget.committedUsd, '0.000120');
    assert.equal((await staff.agent.get('/api/ai/quote-assist')).body.enabled, false); // remaining below the next conservative reserve
  } finally { release(new Response()); await other.locals.billingWorker.stop(); await other.locals.deliverPending.stop(); other.locals.db.close(); }
});

test('P9: one user cannot dispatch a second in-flight request even when the global allowance has room', async t => {
  let release: (value: Response) => void = () => {}; let announce: () => void = () => {};
  const started = new Promise<void>(resolve => { announce = resolve; });
  const current = await setup(t, { timeoutMs: 8000, fetch: async () => { announce(); return new Promise<Response>(resolve => { release = resolve; }); } });
  const first = current.propose().then(response => response); await started;
  const denied = await current.propose(); assert.equal(denied.status, 429); assert.equal(denied.body.error.code, 'AI_INFLIGHT');
  release(Response.json({ status: 'completed', usage: { input_tokens: 100, output_tokens: 50 }, output: [{ content: [{ type: 'output_text', text: JSON.stringify({ schema_version: 'quote-proposal-v1', template_id: null, plan_id: null, lines: [], requested_start_date: null, clarifications: ['Choose the plan manually.'] }) }] }] }));
  assert.equal((await first).status, 201); assert.equal(current.db.prepare('SELECT count(*) AS count FROM ai_quote_requests').get()?.count, 1);
});
