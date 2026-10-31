import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { config } from './config.js';
import { openDatabase } from './database.js';
import { emailSchema } from '../shared/validation.js';
import type { Product, Plan } from '../shared/catalog.js';
import type { Subscription } from '../shared/subscriptions.js';
import type { Invoice } from '../shared/billing.js';

// Explicit controlled-delivery proof. Never invoked by check, seed, startup or E2E.
if (!process.argv.includes('--send-invoice')) throw new Error('Use --send-invoice to send one real, clearly labeled synthetic test invoice.');
const settings = config();
if (settings.mailConfig.mode !== 'smtp') throw new Error('Set MAIL_MODE=smtp before this explicit delivery check.');
const appOrigin = new URL(settings.appUrl);
if (!['localhost', '127.0.0.1'].includes(appOrigin.hostname)) throw new Error('This controlled check requires the local loopback application.');
const recipient = emailSchema.parse(settings.mailConfig.allowedRecipients[0]);
const db = openDatabase(settings.databasePath);
let cookie = '';
let csrfToken = '';
async function call<T>(path: string, input?: object): Promise<T> {
  const response = await fetch(new URL(`/api/${path}`, appOrigin), {
    method: input ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) },
    ...(input ? { body: JSON.stringify(input) } : {}),
  });
  const sessionCookie = response.headers.getSetCookie().find(value => value.startsWith('subtrack_session='));
  if (sessionCookie) cookie = sessionCookie.split(';')[0];
  if (!response.ok) throw new Error(`Controlled invoice check failed at ${path} (HTTP ${response.status}). No delivery claim is made.`);
  return response.json() as Promise<T>;
}
try {
  const customer = db.prepare("SELECT id FROM users WHERE email=? AND role='customer'").get(recipient);
  if (!customer) throw new Error('The first approved recipient must already have a registered customer account. No invoice email was sent.');
  const session = await call<{ csrfToken: string }>('auth/login', { email: 'admin@brightloop.test', password: 'Brightloop!2026' });
  csrfToken = session.csrfToken;
  const { businessDate } = await call<{ businessDate: string }>('workspace');
  const label = `Delivery check ${randomUUID().slice(0, 8)}`;
  const product = await call<Product>('products', {
    name: `${label} — synthetic service`, type: 'service', salesPrice: 100, costPrice: 0,
    notes: 'Controlled invoice-delivery fixture. No real service or payment is requested.', active: true, variants: [],
  });
  const plan = await call<Plan>('plans', {
    name: `${label} — monthly`, primaryProductId: product.id, price: 100, interval: 'monthly', minQuantity: 1,
    availableFrom: null, availableTo: null, autoClose: true, allowPause: false, allowRenew: false, allowEarlyClose: false, active: true,
  });
  let subscription = await call<Subscription>('subscriptions', {
    customerId: customer.id, planId: plan.id, templateId: null, startDate: businessDate, termPeriods: 1,
    paymentTermDays: 7, validDays: 1, lines: [{ productId: product.id, variantId: null, quantity: 1 }], idempotencyKey: randomUUID(),
  });
  for (const action of ['issue', 'confirm', 'activate']) subscription = await call<Subscription>(`subscriptions/${subscription.id}/${action}`, { version: subscription.version });
  let invoice = await call<Invoice>(`subscriptions/${subscription.id}/invoices`, { expectedPeriodStart: businessDate, idempotencyKey: randomUUID() });
  invoice = await call<Invoice>(`invoices/${invoice.id}/confirm`, { version: invoice.version });
  const delivery = await call<{ id: string }>(`invoices/${invoice.id}/send`, { idempotencyKey: randomUUID() });
  let status = 'generated';
  let issue: string | null = null;
  for (let attempt = 0; attempt < 45; attempt++) {
    const row = db.prepare('SELECT status,error FROM outbox WHERE id=?').get(delivery.id);
    if (!row) throw new Error('The send operation did not persist its delivery record.');
    status = String(row.status);
    issue = row.error ? String(row.error) : null;
    if (status !== 'generated') break;
    await delay(1000);
  }
  console.log(JSON.stringify({ messageId: delivery.id, invoiceNumber: invoice.number, kind: 'synthetic_invoice', registeredApprovedRecipient: true, status, issue, inboxArrivalVerified: false }));
  if (status !== 'accepted') process.exitCode = 1;
} finally {
  if (cookie && csrfToken) {
    try { await call('auth/logout', {}); } catch { /* Preserve the original verification outcome. */ }
  }
  db.close();
}
