import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import request from 'supertest';
import { createApp } from './app.js';
import { seedDemo } from './seed.js';
import { processBillingRun } from './billing-workbench.js';
import type { User } from '../shared/contracts.js';
import type { Product, Plan, QuotationTemplate } from '../shared/catalog.js';
import type { Subscription } from '../shared/subscriptions.js';
import type { Invoice } from '../shared/billing.js';
import type { BillingRun } from '../shared/billing-workbench.js';

export type DemoSettlement = 'unpaid' | 'partial' | 'settled';
/** A fresh, real-domain fixture. Never reads .env, sends mail or overwrites a database. */
export async function buildNovemberDemo(databasePath: string, options: { settlement?: DemoSettlement; appUrl?: string } = {}) {
  if (databasePath === ':memory:') throw new Error('The November demo requires a fresh file-backed database.');
  if (existsSync(databasePath)) throw new Error('The November fixture requires a new database path; existing records were preserved.');
  let current = new Date('2026-10-15T04:00:00.000Z');
  const clock = () => new Date(current);
  const appUrl = options.appUrl || 'http://localhost:3003';
  const app = createApp({ databasePath, clock, appUrl, production: true, mailMode: 'outbox', billingWorkerOptions: { autoStart: false }, demoLabel: 'Synthetic November demo' });
  const agent = request.agent(app);
  let csrfToken = '';
  let seedClosed = false;
  const post = async <T>(path: string, body: object): Promise<T> => {
    const response = await agent.post(`/api/${path}`).set('X-CSRF-Token', csrfToken).send(body);
    assert(response.status >= 200 && response.status < 300, `Synthetic fixture ${path} failed with HTTP ${response.status}.`);
    return response.body as T;
  };
  const login = async () => { csrfToken = (await post<{ csrfToken: string }>('auth/login', { email: 'admin@brightloop.test', password: 'Brightloop!2026' })).csrfToken; };
  const day = async (date: string) => { current = new Date(`${date}T04:00:00.000Z`); await login(); };
  try {
    await seedDemo(app.locals.db);
    const people = {} as Record<'A' | 'B' | 'C', User>;
    for (const [key, name, email] of [['A', 'Sample Studio', 'studio@brightloop.test'], ['B', 'Sample Shop', 'shop@brightloop.test'], ['C', 'Sample Services', 'services@brightloop.test']] as const) {
      const response = await request(app).post('/api/auth/signup').send({ name, email, password: 'Brightloop!2026' });
      assert.equal(response.status, 201);
      people[key] = response.body.user;
    }
    await login();
    const product = await post<Product>('products', { name: 'Business Software', type: 'software', salesPrice: 100000, costPrice: 40000,
      notes: 'Demo recurring software product.', active: true, variants: [{ name: 'Odoo', adjustment: 56000, active: true }] });
    const plan = await post<Plan>('plans', { name: 'Business monthly', primaryProductId: product.id, price: 100000, interval: 'monthly', minQuantity: 1,
      availableFrom: null, availableTo: null, autoClose: true, allowPause: true, allowRenew: true, allowEarlyClose: true, active: true });
    await post('taxes', { name: 'Fictional 10% demo tax', rateBps: 1000, productId: null, priority: 10, active: true });
    const template = await post<QuotationTemplate>('quotation-templates', { name: 'Brightloop monthly offering', planId: plan.id, validDays: 7,
      lines: [{ productId: product.id, variantId: null, quantity: 1 }], active: true });
    const accepted = async (key: 'A' | 'B' | 'C', startDate: string): Promise<Subscription> => {
      let subscription = await post<Subscription>('subscriptions', { customerId: people[key].id, planId: plan.id, templateId: template.id,
        startDate, termPeriods: 12, paymentTermDays: 7, validDays: 7,
        lines: [{ productId: product.id, variantId: key === 'A' ? product.variants[0].id : null, quantity: key === 'A' ? 2 : 1 }], idempotencyKey: randomUUID() });
      for (const action of ['issue', 'confirm', 'activate']) subscription = await post(`subscriptions/${subscription.id}/${action}`, { version: subscription.version });
      return subscription;
    };
    const pay = (invoice: Invoice, amount: number, paymentDate: string, note: string) => post(`invoices/${invoice.id}/payments`, {
      amount, currency: 'INR', method: 'bank_transfer', paymentDate, note, idempotencyKey: randomUUID(),
    });
    const c = await accepted('C', '2026-10-15');
    let cInvoice = await post<Invoice>(`subscriptions/${c.id}/invoices`, { expectedPeriodStart: '2026-10-15', idempotencyKey: randomUUID() });
    cInvoice = await post(`invoices/${cInvoice.id}/confirm`, { version: cInvoice.version });
    await pay(cInvoice, cInvoice.total, '2026-10-15', 'Synthetic prior paid October period.');

    await day('2026-11-01');
    const a = await accepted('A', '2026-11-01');
    const b = await accepted('B', '2026-11-01');
    await post('discounts', { name: 'LAUNCH10', kind: 'percentage', amountMinor: null, percentBps: 1000,
      minAmount: null, minQuantity: 2, startDate: '2026-11-01', endDate: '2026-11-30', maxUses: 1,
      priority: 10, active: true, scope: 'subscription', subscriptionId: a.id, productIds: [] });
    const run = await post<BillingRun>('billing/runs', { limit: 250, subscriptionIds: [a.id, b.id, c.id], idempotencyKey: randomUUID() });
    await processBillingRun(app.locals.db, run.id, clock);
    const invoiceFor = async (subscription: Subscription): Promise<Invoice> => {
      const response = await agent.get(`/api/invoices?subscriptionId=${subscription.id}`);
      assert.equal(response.status, 200); assert.equal(response.body.total, 1);
      const invoice = response.body.items[0] as Invoice;
      return post(`invoices/${invoice.id}/confirm`, { version: invoice.version });
    };
    const aInvoice = await invoiceFor(a), bInvoice = await invoiceFor(b);
    assert.equal(aInvoice.total, 308880); assert.equal(bInvoice.total, 110000);
    const settlement = options.settlement || 'settled';
    if (settlement !== 'unpaid') await pay(aInvoice, 100000, '2026-11-01', 'Synthetic first bank transfer.');
    if (settlement === 'settled') { await day('2026-11-02'); await pay(aInvoice, 208880, '2026-11-02', 'Synthetic final bank transfer.'); }
    await day('2026-11-09');
    await post('auth/logout', {});
    const records = { subscriptions: { A: a.id, B: b.id, C: c.id }, invoices: { A: aInvoice.id, B: bInvoice.id, C: cInvoice.id }, billingRunId: run.id };
    await app.locals.billingWorker.stop();
    await app.locals.deliverPending.stop();
    app.locals.db.close();
    seedClosed = true;
    const runtimeApp = createApp({ databasePath, clock, appUrl, production: true, mailMode: 'outbox', demoLabel: 'Synthetic November demo' });
    return { app: runtimeApp, clock, records };
  } catch (error) {
    if (!seedClosed) {
      await app.locals.billingWorker.stop();
      await app.locals.deliverPending.stop();
      app.locals.db.close();
    }
    throw error;
  }
}
