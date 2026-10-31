import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import request from 'supertest';
import type { ProductInput, PlanInput, Product, Plan } from '../shared/catalog.js';
import { fixture, signIn } from './fixtures.js';

const productInput = (changes: Partial<ProductInput> = {}): ProductInput => ({
  name: 'Business Software', type: 'software', salesPrice: 120_000, costPrice: 40_000,
  notes: 'Internal catalog note', active: true, variants: [{ name: 'Odoo', adjustment: 56_000, active: true }], ...changes,
});
const planInput = (productId: string, changes: Partial<PlanInput> = {}): PlanInput => ({
  name: 'Business Monthly', primaryProductId: productId, price: 100_000, interval: 'monthly', minQuantity: 1,
  availableFrom: null, availableTo: null, autoClose: true, allowPause: true, allowRenew: true, allowEarlyClose: true, active: true, ...changes,
});
async function setup(t: TestContext) {
  const current = await fixture(t);
  const admin = await signIn(current.app);
  const post = (path: string, body: object) => admin.agent.post(`/api/${path}`).set('X-CSRF-Token', admin.csrfToken).send(body);
  const put = (path: string, body: object) => admin.agent.put(`/api/${path}`).set('X-CSRF-Token', admin.csrfToken).send(body);
  async function product(input = productInput()): Promise<Product> {
    const response = await post('products', input); assert.equal(response.status, 201, JSON.stringify(response.body)); return response.body;
  }
  async function plan(productId: string, changes: Partial<PlanInput> = {}): Promise<Plan> {
    const response = await post('plans', planInput(productId, changes)); assert.equal(response.status, 201, JSON.stringify(response.body)); return response.body;
  }
  return { ...current, admin, post, put, product, plan };
}

test('CAT-01/CAT-02: complete product persists, protected fields stay off staff/customer payloads, writes are admin-only', async t => {
  const current = await setup(t);
  const input = productInput({ variants: [{ name: 'Odoo', adjustment: 56_000, active: true }, { name: 'Retired brand', adjustment: 0, active: false }] });
  const product = await current.product(input);
  assert.equal(product.version, 1);
  const reloaded = await current.admin.agent.get(`/api/products/${product.id}`);
  assert.equal(reloaded.status, 200);
  assert.equal(reloaded.body.salesPrice, 120_000);
  assert.equal(reloaded.body.costPrice, 40_000);
  assert.equal(reloaded.body.notes, input.notes);
  assert.equal(reloaded.body.variants.find((variant: { name: string }) => variant.name === 'Odoo').adjustment, 56_000);
  for (const email of ['staff@brightloop.test', 'maya@brightloop.test']) {
    const signed = await signIn(current.app, email);
    const read = await signed.agent.get(`/api/products/${product.id}`);
    assert.equal(read.status, 200);
    assert.equal('costPrice' in read.body, false);
    const list = await signed.agent.get('/api/products');
    assert.equal(JSON.stringify(list.body).includes('costPrice'), false);
    if (email.startsWith('maya')) {
      assert.equal('notes' in read.body, false);
      assert.equal(JSON.stringify(list.body).includes(input.notes), false);
      assert.equal(read.body.variants.length, 1);
    } else assert.equal(read.body.notes, input.notes);
    assert.equal((await signed.agent.post('/api/products').set('X-CSRF-Token', signed.csrfToken).send(input)).status, 403);
    assert.equal((await signed.agent.put(`/api/products/${product.id}`).set('X-CSRF-Token', signed.csrfToken).send({ ...input, version: 1 })).status, 403);
    for (const path of ['plans', 'taxes', 'quotation-templates']) {
      assert.equal((await signed.agent.post(`/api/${path}`).set('X-CSRF-Token', signed.csrfToken).send({})).status, 403);
    }
  }
  assert.equal((await request(current.app).get('/api/products')).status, 401);
});

test('CAT-01/CAT-02: edits use optimistic versions and omitted variants retain identity as inactive', async t => {
  const current = await setup(t);
  const input = productInput(); const product = await current.product(input);
  const variantId = product.variants[0].id;
  const plan = await current.plan(product.id);
  const template = await current.post('quotation-templates', { name: 'Referenced variant', planId: plan.id, validDays: 7, active: true, lines: [{ productId: product.id, variantId, quantity: 1 }] });
  assert.equal(template.status, 201);
  const changed = await current.put(`products/${product.id}`, { ...input, name: 'Edited software', notes: 'Saved change', variants: [], version: product.version });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.version, 2);
  assert.equal(changed.body.variants[0].id, variantId);
  assert.equal(changed.body.variants[0].active, false);
  const stale = await current.put(`products/${product.id}`, { ...input, name: 'Stale overwrite', version: 1 });
  assert.equal(stale.status, 409);
  assert.equal((await current.admin.agent.get(`/api/products/${product.id}`)).body.name, 'Edited software');
  assert.equal((await current.admin.agent.get(`/api/quotation-templates/${template.body.id}`)).body.lines[0].variantId, variantId);
  const foreign = await current.product(productInput({ name: 'Other product' }));
  const crossed = await current.put(`products/${product.id}`, { ...input, version: 2, variants: [{ ...foreign.variants[0] }] });
  assert.equal(crossed.status, 400);
  assert.equal((await current.admin.agent.get(`/api/products/${product.id}`)).body.version, 2);
});

test('CAT-02: variant names can swap atomically, duplicates and negative active catalog prices fail without partial writes', async t => {
  const current = await setup(t);
  const input = productInput({ variants: [{ name: 'Alpha', adjustment: 0, active: true }, { name: 'Beta', adjustment: 100, active: true }] });
  const product = await current.product(input);
  const swaps = product.variants.map(variant => ({ ...variant, name: variant.name === 'Alpha' ? 'Beta' : 'Alpha' }));
  const changed = await current.put(`products/${product.id}`, { ...input, variants: swaps, version: 1 });
  assert.equal(changed.status, 200);
  for (const variant of swaps) assert.equal(changed.body.variants.find((row: { id: string }) => row.id === variant.id).name, variant.name);
  const duplicates = await current.post('products', productInput({ variants: [{ name: 'Same', adjustment: 0, active: true }, { name: 'same', adjustment: 10, active: true }] }));
  assert.equal(duplicates.status, 400);
  const negative = await current.post('products', productInput({ salesPrice: 1, variants: [{ name: 'Negative', adjustment: -2, active: true }] }));
  assert.equal(negative.status, 400);
  assert.equal(current.db.prepare('SELECT count(*) AS count FROM products').get()?.count, 1);
});

test('PLAN-01/PLAN-03: all four cadences and lifecycle policies persist and edit with a version check', async t => {
  const current = await setup(t); const product = await current.product();
  for (const interval of ['daily', 'weekly', 'monthly', 'yearly'] as const) {
    const plan = await current.plan(product.id, { name: `Business ${interval}`, interval, autoClose: false, allowPause: false, allowRenew: true, allowEarlyClose: false });
    const read = await current.admin.agent.get(`/api/plans/${plan.id}`);
    assert.equal(read.status, 200); assert.equal(read.body.interval, interval);
    assert.equal(read.body.primaryProductName, product.name);
    assert.equal(read.body.autoClose, false); assert.equal(read.body.allowPause, false); assert.equal(read.body.allowRenew, true); assert.equal(read.body.allowEarlyClose, false);
    const changed = await current.put(`plans/${plan.id}`, { ...planInput(product.id, { interval, price: 90_000 }), version: 1 });
    assert.equal(changed.status, 200); assert.equal(changed.body.version, 2); assert.equal(changed.body.price, 90_000);
    assert.equal((await current.put(`plans/${plan.id}`, { ...planInput(product.id), version: 1 })).status, 409);
  }
  assert.equal((await current.admin.agent.get('/api/plans')).body.total, 4);
});

test('PLAN-02: primary minimum and availability use inclusive server dates; malformed configuration is rejected', async t => {
  const current = await setup(t); const product = await current.product();
  const plan = await current.plan(product.id, { minQuantity: 2, availableFrom: '2026-11-01', availableTo: '2026-11-01' });
  const lines = [{ productId: product.id, variantId: null, quantity: 1 }];
  assert.equal((await current.post('catalog/preview', { planId: plan.id, lines })).body.error.code, 'MIN_QUANTITY');
  lines[0].quantity = 2;
  assert.equal((await current.post('catalog/preview', { planId: plan.id, lines })).status, 200);
  current.advanceTime(24 * 60 * 60_000);
  const refreshed = await signIn(current.app);
  const expired = await refreshed.agent.post('/api/catalog/preview').set('X-CSRF-Token', refreshed.csrfToken).send({ planId: plan.id, lines });
  assert.equal(expired.status, 400); assert.equal(expired.body.error.code, 'PLAN_UNAVAILABLE');
  for (const changes of [{ minQuantity: 0 }, { availableFrom: '2026-02-30' }, { availableFrom: '1899-12-31' }, { availableFrom: '2026-12-01', availableTo: '2026-11-01' }, { primaryProductId: randomUUID() }]) {
    const response = await refreshed.agent.post('/api/plans').set('X-CSRF-Token', refreshed.csrfToken).send(planInput(product.id, changes));
    assert.equal(response.status, 400);
  }
});

test('CAT-02/BILL-02: server preview replaces catalog base with plan price and picks deterministic configured taxes', async t => {
  const current = await setup(t); const product = await current.product(); const plan = await current.plan(product.id);
  const addon = await current.product(productInput({ name: 'Support add-on', type: 'addon', salesPrice: 30_000, variants: [] }));
  const global = await current.post('taxes', { name: 'Demo global tax', rateBps: 1_000, productId: null, priority: 10, active: true });
  assert.equal(global.status, 201);
  const scoped = await current.post('taxes', { name: 'Software demo tax', rateBps: 500, productId: product.id, priority: 10, active: true });
  assert.equal(scoped.status, 201);
  const lines = [{ productId: product.id, variantId: product.variants[0].id, quantity: 2 }, { productId: addon.id, variantId: null, quantity: 1 }];
  const preview = await current.post('catalog/preview', { planId: plan.id, lines });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.lines[0].baseUnitPrice, 100_000);
  assert.equal(preview.body.lines[0].variantAdjustment, 56_000);
  assert.equal(preview.body.lines[0].unitPrice, 156_000);
  assert.equal(preview.body.lines[0].subtotal, 312_000);
  assert.equal(preview.body.lines[0].taxId, scoped.body.id);
  assert.equal(preview.body.lines[1].taxId, global.body.id);
  assert.equal(preview.body.subtotal, 342_000); assert.equal(preview.body.tax, 18_600); assert.equal(preview.body.total, 360_600);
  assert.ok(preview.body.priceExplanation.includes('replaces'));
  const altered = await current.put(`taxes/${global.body.id}`, { name: 'Priority global', rateBps: 1_000, productId: null, priority: 1, active: true, version: 1 });
  assert.equal(altered.status, 200);
  assert.equal((await current.post('catalog/preview', { planId: plan.id, lines })).body.lines[0].taxId, global.body.id);
  assert.equal((await current.put(`taxes/${global.body.id}`, { name: 'Stale', rateBps: 1, productId: null, priority: 1, active: true, version: 1 })).status, 409);
});

test('BILL-02 foundation: tax is half-up per line, totals are bounded, and submitted totals/dates have no authority', async t => {
  const current = await setup(t);
  const product = await current.product(productInput({ salesPrice: 1, variants: [] }));
  const addon = await current.product(productInput({ name: 'One minor-unit add-on', salesPrice: 1, variants: [] }));
  const plan = await current.plan(product.id, { price: 1 });
  assert.equal((await current.post('taxes', { name: 'Half demo tax', rateBps: 5_000, productId: null, priority: 0, active: true })).status, 201);
  const lines = [{ productId: product.id, variantId: null, quantity: 1 }, { productId: addon.id, variantId: null, quantity: 1 }];
  const preview = await current.post('catalog/preview', { planId: plan.id, lines });
  assert.equal(preview.status, 200); assert.equal(preview.body.tax, 2); assert.equal(preview.body.total, 4);
  assert.equal((await current.post('catalog/preview', { planId: plan.id, lines, total: 0 })).status, 400);
  assert.equal((await current.post('catalog/preview', { planId: plan.id, lines, businessDate: '2099-01-01' })).status, 400);
  const big = await current.plan(product.id, { price: 1_000_000_000_000 });
  const overflow = await current.post('catalog/preview', { planId: big.id, lines: [{ productId: product.id, variantId: null, quantity: 2 }] });
  assert.equal(overflow.status, 400); assert.equal(overflow.body.error.code, 'AMOUNT_RANGE');
  for (const invalid of [1.1, -1, 1_000_000_000_001]) assert.equal((await current.post('products', productInput({ salesPrice: invalid }))).status, 400);
});

test('QUOTE-01 foundation: reusable templates copy independent lines, enforce primary/variant/minimum rules and versioned edits', async t => {
  const current = await setup(t); const product = await current.product(); const plan = await current.plan(product.id, { minQuantity: 2 });
  const other = await current.product(productInput({ name: 'Other software' }));
  const input = { name: 'Reusable business template', planId: plan.id, validDays: 7, active: true, lines: [{ productId: product.id, variantId: product.variants[0].id, quantity: 2 }] };
  const first = await current.post('quotation-templates', input); const second = await current.post('quotation-templates', input);
  assert.equal(first.status, 201); assert.equal(second.status, 201); assert.notEqual(first.body.id, second.body.id);
  const edited = await current.put(`quotation-templates/${first.body.id}`, { ...input, name: 'Edited template', validDays: 30, lines: [{ ...input.lines[0], quantity: 3 }], version: 1 });
  assert.equal(edited.status, 200); assert.equal(edited.body.version, 2);
  const unchanged = await current.admin.agent.get(`/api/quotation-templates/${second.body.id}`);
  assert.equal(unchanged.body.validDays, 7); assert.equal(unchanged.body.lines[0].quantity, 2);
  assert.equal((await current.put(`quotation-templates/${first.body.id}`, { ...input, version: 1 })).status, 409);
  for (const changes of [
    { validDays: 0 }, { lines: [{ ...input.lines[0], quantity: 1 }] },
    { lines: [{ ...input.lines[0], variantId: other.variants[0].id }] }, { lines: [input.lines[0], input.lines[0]] },
    { lines: [{ productId: other.id, variantId: null, quantity: 2 }] },
  ]) assert.equal((await current.post('quotation-templates', { ...input, ...changes })).status, 400);
});

test('P2: active templates reject impossible prices/overflow while future availability remains configurable', async t => {
  const current = await setup(t);
  const product = await current.product(productInput({ salesPrice: 100, variants: [{ name: 'Reduced variant', adjustment: -100, active: true }] }));
  const plan = await current.plan(product.id, { price: 50, availableFrom: '2026-12-01' });
  const input = { name: 'Future template', planId: plan.id, validDays: 7, active: true, lines: [{ productId: product.id, variantId: product.variants[0].id, quantity: 1 }] };
  const negative = await current.post('quotation-templates', input);
  assert.equal(negative.status, 400); assert.equal(current.db.prepare('SELECT count(*) AS count FROM quotation_templates').get()?.count, 0);
  const future = await current.post('quotation-templates', { ...input, lines: [{ ...input.lines[0], variantId: null }] });
  assert.equal(future.status, 201, 'A future plan can have a valid reusable template prepared before availability.');
  const huge = await current.plan(product.id, { price: 1_000_000_000_000 });
  const overflow = await current.post('quotation-templates', { ...input, planId: huge.id, lines: [{ ...input.lines[0], variantId: null, quantity: 2 }] });
  assert.equal(overflow.status, 400);
});

test('P2: customer catalog exposes only published active products/plans and never internal rule/template data', async t => {
  const current = await setup(t); const product = await current.product(); const plan = await current.plan(product.id);
  const archived = await current.product(productInput({ name: 'Archived product', active: false }));
  const inactivePlan = await current.plan(product.id, { name: 'Archived plan', active: false });
  const customer = await signIn(current.app, 'maya@brightloop.test');
  assert.equal((await customer.agent.get('/api/products')).body.total, 1);
  assert.equal((await customer.agent.get(`/api/products/${archived.id}`)).status, 404);
  assert.equal((await customer.agent.get('/api/products').query({ active: 'false' })).body.total, 0);
  assert.equal((await customer.agent.get('/api/plans')).body.total, 1);
  assert.equal((await customer.agent.get(`/api/plans/${inactivePlan.id}`)).status, 404);
  for (const path of ['taxes', 'quotation-templates']) assert.equal((await customer.agent.get(`/api/${path}`)).status, 403);
  assert.equal((await customer.agent.post('/api/catalog/preview').set('X-CSRF-Token', customer.csrfToken).send({ planId: plan.id, lines: [{ productId: product.id, variantId: null, quantity: 1 }] })).status, 403);
  await current.put(`products/${product.id}`, { ...productInput(), active: false, version: 1, variants: product.variants });
  assert.equal((await customer.agent.get('/api/plans')).body.total, 0);
  assert.equal((await customer.agent.get(`/api/plans/${plan.id}`)).status, 404);
});

test('P2: lists paginate/filter/search safely and relational constraints survive reopening', async t => {
  const current = await setup(t);
  const percent = await current.product(productInput({ name: 'Literal % Product' }));
  await current.product(productInput({ name: 'Other Product' }));
  const searched = await current.admin.agent.get('/api/products').query({ q: '%' });
  assert.equal(searched.status, 200); assert.equal(searched.body.total, 1); assert.equal(searched.body.items[0].id, percent.id);
  const page = await current.admin.agent.get('/api/products').query({ pageSize: 1, page: 20 });
  assert.equal(page.body.total, 2); assert.equal(page.body.page, 2); assert.equal(page.body.items.length, 1);
  assert.equal((await current.admin.agent.get('/api/products').query({ q: "' OR 1=1 --" })).body.total, 0);
  assert.equal((await current.admin.agent.get('/api/products').query({ pageSize: 101 })).status, 400);
  const anotherConnection = new DatabaseSync(current.databasePath);
  try {
    assert.equal(anotherConnection.prepare('SELECT sales_price FROM products WHERE id=?').get(percent.id)?.sales_price, 120_000);
    assert.equal(anotherConnection.prepare('SELECT max(version) AS version FROM schema_migrations').get()?.version, 4);
  } finally { anotherConnection.close(); }
  assert.throws(() => current.db.prepare("UPDATE products SET sales_price=-1 WHERE id=?").run(percent.id));
  assert.throws(() => current.db.prepare("UPDATE products SET active=3 WHERE id=?").run(percent.id));
  assert.throws(() => current.db.prepare("INSERT INTO plans(id,name,primary_product_id,price,interval,min_quantity,auto_close,allow_pause,allow_renew,allow_early_close,active,version,created_at,updated_at) VALUES(?,?,?,1,'monthly',1,1,1,1,1,1,1,'now','now')").run(randomUUID(), 'Invalid reference', randomUUID()));
});

// These P2 foundations do not claim quote-instance snapshots, invoicing or actual lifecycle actions.
// Those must be verified at P3–P6 using accepted subscription and financial records.
