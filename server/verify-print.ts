import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { chromium } from '@playwright/test';
import { createApp } from './app.js';
import { openDatabase } from './database.js';
import { seedDemo } from './seed.js';
import type { Product, Plan, TaxRule } from '../shared/catalog.js';
import type { Subscription } from '../shared/subscriptions.js';
import type { Invoice } from '../shared/billing.js';
import { MAX_MINOR } from '../shared/money.js';

// Isolated real-HTTP/Chromium proof: no .env, SMTP or private customer records.
const directory = mkdtempSync(join(tmpdir(), 'subtrack-print-'));
const databasePath = join(directory, 'print.sqlite');
const seed = openDatabase(databasePath);
await seedDemo(seed);
seed.close();
const app = createApp({ databasePath, mailMode: 'outbox', billingWorkerOptions: { autoStart: false } });
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
assert(address && typeof address !== 'string');
const origin = `http://127.0.0.1:${address.port}`;
const output = resolve('output/pdf');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const pageErrors: string[] = [];
page.on('pageerror', error => pageErrors.push(error.message));
let csrfToken = '';
async function post<T>(path: string, body: object): Promise<T> {
  const response = await context.request.post(`${origin}/api/${path}`, { headers: { 'X-CSRF-Token': csrfToken }, data: body });
  assert(response.ok(), `Print fixture request failed at ${path}: HTTP ${response.status()}`);
  return response.json() as Promise<T>;
}
async function product(name: string, price: number, variant = false): Promise<Product> {
  return post('products', { name, type: 'software', salesPrice: price, costPrice: 0, notes: 'Synthetic print proof only.', active: true,
    variants: variant ? [{ name: 'Odoo', adjustment: 56000, active: true }] : [] });
}
async function agreement(primary: Product, lines: { productId: string; variantId: string | null; quantity: number }[], price: number): Promise<Subscription> {
  const plan = await post<Plan>('plans', { name: 'Synthetic print monthly', primaryProductId: primary.id, price, interval: 'monthly', minQuantity: 1,
    availableFrom: null, availableTo: null, autoClose: true, allowPause: false, allowRenew: false, allowEarlyClose: false, active: true });
  const people = await (await context.request.get(`${origin}/api/customers?q=maya`)).json() as { items: { id: string }[] };
  const workspace = await (await context.request.get(`${origin}/api/workspace`)).json() as { businessDate: string };
  let subscription = await post<Subscription>('subscriptions', { customerId: people.items[0].id, planId: plan.id, templateId: null,
    startDate: workspace.businessDate, termPeriods: 1, paymentTermDays: 7, validDays: 1, lines, idempotencyKey: randomUUID() });
  for (const action of ['issue', 'confirm', 'activate']) subscription = await post(`subscriptions/${subscription.id}/${action}`, { version: subscription.version });
  return subscription;
}
async function generate(subscription: Subscription): Promise<Invoice> {
  return post(`subscriptions/${subscription.id}/invoices`, { expectedPeriodStart: subscription.startDate, idempotencyKey: randomUUID() });
}
const observed: { file: string; status: string; lines: number; total: number; pdfBytes: number }[] = [];
async function capture(invoice: Invoice, file: string): Promise<void> {
  const response = await page.goto(`${origin}/api/invoices/${invoice.id}/print`);
  assert.equal(response?.status(), 200);
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator('script').count(), 1, 'Only the nonce-authorized print handler may be present.');
  assert.equal(await page.locator('img').count(), 0, 'Product text must not create image markup.');
  assert.equal(await page.locator('tbody tr').count(), invoice.lines.length);
  await page.evaluate(() => { window.print = () => { document.documentElement.dataset.printInvoked = 'yes'; }; });
  await page.getByRole('button', { name: 'Print invoice', exact: true }).click();
  assert.equal(await page.locator('html').getAttribute('data-print-invoked'), 'yes', 'The actual print button must invoke the browser print action.');
  const pdf = await page.pdf({ path: join(output, file), format: 'A4', printBackground: true, preferCSSPageSize: true });
  observed.push({ file, status: invoice.status, lines: invoice.lines.length, total: invoice.total, pdfBytes: pdf.length });
}
try {
  csrfToken = (await post<{ csrfToken: string }>('auth/login', { email: 'admin@brightloop.test', password: 'Brightloop!2026' })).csrfToken;
  const primary = await product('Business Software', 120000, true);
  await post<TaxRule>('taxes', { name: 'Fictional 10% print tax', rateBps: 1000, productId: primary.id, priority: 10, active: true });
  const subscription = await agreement(primary, [{ productId: primary.id, variantId: primary.variants[0].id, quantity: 2 }], 100000);
  await post('discounts', { name: 'Synthetic LAUNCH10', kind: 'percentage', amountMinor: null, percentBps: 1000,
    minAmount: null, minQuantity: 2, startDate: null, endDate: null, maxUses: 1, priority: 10, active: true,
    scope: 'subscription', subscriptionId: subscription.id, productIds: [] });
  const draft = await generate(subscription);
  assert.equal(draft.total, 308880);
  await capture(draft, 'p5-draft.pdf');
  const confirmed = await post<Invoice>(`invoices/${draft.id}/confirm`, { version: draft.version });
  await capture(confirmed, 'p5-confirmed.pdf');

  const edgePrimary = await product('Maximum valid amount <img src=x onerror="alert(1)">', MAX_MINOR);
  const lines = [{ productId: edgePrimary.id, variantId: null, quantity: 1 }];
  for (let index = 1; index < 50; index++) {
    const addon = await product(`Line ${index} — long synthetic product & variant text for page-break verification `.padEnd(100, 'x'), 0);
    lines.push({ productId: addon.id, variantId: null, quantity: 1 });
  }
  const edge = await generate(await agreement(edgePrimary, lines, MAX_MINOR));
  assert.equal(edge.total, MAX_MINOR);
  await capture(edge, 'p5-edge-50-lines.pdf');
  assert.deepEqual(pageErrors, []);
  const report = { clock: new Date().toISOString(), engine: 'actual Chromium print renderer', synthetic: true, realEmailSent: false,
    checks: ['server ownership route', 'saved amounts', 'Draft label', 'nonce print button', 'escaped markup', '50-line page breaks', 'maximum valid amount'], documents: observed,
    visualInspection: 'Pending Poppler rendering and human/agent image inspection.' };
  writeFileSync(join(output, 'print-proof.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
  await app.locals.billingWorker.stop();
  await app.locals.deliverPending.stop();
  await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  app.locals.db.close();
  const resolvedDirectory = realpathSync(directory);
  const resolvedTemporaryRoot = realpathSync(tmpdir());
  assert(resolvedDirectory.startsWith(`${resolvedTemporaryRoot}${sep}`) && basename(resolvedDirectory).startsWith('subtrack-print-'));
  rmSync(resolvedDirectory, { recursive: true, force: true });
}
