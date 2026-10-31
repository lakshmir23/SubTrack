import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SubscriptionTerms } from '../shared/subscriptions.js';
import { BENCHMARK_BUSINESS_DATE, BENCHMARK_INSTANT, type BenchmarkManifest } from './benchmark-data.js';
import { periodBoundary, periodIndex, addDays, type Cadence } from './calendar.js';

type Result = BenchmarkManifest['validation'];
interface Agreement { id: string; customer_id: string; start_date: string; expiry_date: string; term_periods: number; next_period_index: number; next_billing_date: string | null; stage: string; service_state: string; early_close_effective: string | null; closure_cause: string | null; terms_json: string; accepted_terms_json: string | null; payment_term_days: number; accepted_at: string | null }
interface Invoice { id: string; subscription_id: string; customer_id: string; logical_charge_id: string; period_start: string; period_end: string; issue_date: string; due_date: string; status: string; subtotal: number; discount: number; tax: number; total: number; amount_paid: number; payment_count: number; discount_snapshot_json: string | null }
interface Line { id: string; invoice_id: string; subscription_line_id: string; product_id: string; variant_id: string | null; quantity: number; base_unit_price: number; variant_adjustment: number; unit_price: number; subtotal: number; discount: number; taxable_amount: number; tax_rate_bps: number; tax: number; total: number }
interface Charge { id: string; subscription_id: string; period_start: string; period_end: string; outcome: string; current_invoice_id: string | null }
interface Payment { id: string; invoice_id: string; amount: number; payment_date: string; created_at: string }

/** Independent recomputation from persisted facts; never repairs or changes a row. */
export function validateBenchmarkDatabase(db: DatabaseSync): Result {
  const errors: string[] = []; const checks: string[] = [];
  const check = (value: boolean, message: string) => { if (!value && errors.length < 100) errors.push(message); };
  check(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys === 1, 'Foreign-key enforcement is disabled.');
  check(db.prepare('PRAGMA foreign_key_check').all().length === 0, 'Foreign-key check failed.');
  check(db.prepare('PRAGMA integrity_check').get()?.integrity_check === 'ok', 'SQLite integrity check failed.');
  checks.push('Foreign keys enabled; FK and SQLite integrity checks.');
  const triggers = ['invoice_financial_snapshot_immutable', 'invoice_line_no_update', 'invoice_no_delete', 'payment_allocation_guard', 'payment_apply_allocation', 'payment_no_update', 'payment_no_delete', 'invoice_payment_facts_guard', 'discount_capacity_insert', 'subscription_accepted_immutable'];
  for (const name of triggers) check(Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(name)), `Missing invariant trigger ${name}.`);
  checks.push('All financial, payment, discount and accepted-term guards remain installed.');
  const subscriptions = db.prepare('SELECT * FROM subscriptions').all() as unknown as Agreement[];
  const invoices = db.prepare('SELECT * FROM invoices').all() as unknown as Invoice[];
  const lines = db.prepare('SELECT * FROM invoice_lines ORDER BY invoice_id,position').all() as unknown as Line[];
  const charges = db.prepare('SELECT * FROM logical_charges').all() as unknown as Charge[];
  const payments = db.prepare('SELECT id,invoice_id,amount,payment_date,created_at FROM payments').all() as unknown as Payment[];
  check(subscriptions.length === 10000, `Expected 10000 subscriptions, found ${subscriptions.length}.`);
  check(invoices.length === 30000, `Expected 30000 invoices, found ${invoices.length}.`);
  check(lines.length === 60000, `Expected 60000 financial lines, found ${lines.length}.`);
  const bySub = new Map(subscriptions.map(row => [row.id, row])); const byInvoice = new Map(invoices.map(row => [row.id, row])); const byCharge = new Map(charges.map(row => [row.id, row]));
  const terms = new Map(subscriptions.map(row => [row.id, JSON.parse(row.accepted_terms_json || row.terms_json) as SubscriptionTerms]));
  const groupedLines = new Map<string, Line[]>(); for (const row of lines) { const group = groupedLines.get(row.invoice_id) || []; group.push(row); groupedLines.set(row.invoice_id, group); }
  const groupedCharges = new Map<string, Charge[]>(); for (const row of charges) { const group = groupedCharges.get(row.subscription_id) || []; group.push(row); groupedCharges.set(row.subscription_id, group); }
  const paymentFacts = new Map<string, { amount: bigint; count: number }>();
  for (const payment of payments) {
    const invoice = byInvoice.get(payment.invoice_id); check(Boolean(invoice), `Payment ${payment.id} has no invoice.`);
    const facts = paymentFacts.get(payment.invoice_id) || { amount: 0n, count: 0 }; facts.amount += BigInt(payment.amount); facts.count++; paymentFacts.set(payment.invoice_id, facts);
    check(payment.amount > 0 && payment.payment_date <= BENCHMARK_BUSINESS_DATE && payment.created_at <= BENCHMARK_INSTANT, `Payment ${payment.id} has an invalid date/amount.`);
    if (invoice) check(payment.payment_date >= invoice.issue_date, `Payment ${payment.id} predates its synthetic invoice issue.`);
  }
  for (const invoice of invoices) {
    const subscription = bySub.get(invoice.subscription_id); const accepted = terms.get(invoice.subscription_id)!; const children = groupedLines.get(invoice.id) || [];
    check(Boolean(subscription?.accepted_terms_json), `Invoice ${invoice.id} is not backed by accepted terms.`);
    check(invoice.customer_id === subscription?.customer_id, `Invoice ${invoice.id} ownership differs from its agreement.`);
    check(children.length === 2, `Invoice ${invoice.id} does not have two real lines.`);
    let subtotal = 0n, discount = 0n, tax = 0n, total = 0n;
    for (const line of children) {
      const agreed = accepted.lines.find(candidate => candidate.id === line.subscription_line_id);
      check(Boolean(agreed) && agreed!.productId === line.product_id && agreed!.variantId === line.variant_id && agreed!.quantity === line.quantity && agreed!.baseUnitPrice === line.base_unit_price && agreed!.variantAdjustment === line.variant_adjustment && agreed!.unitPrice === line.unit_price, `Line ${line.id} differs from immutable accepted pricing.`);
      check(BigInt(line.unit_price) === BigInt(line.base_unit_price) + BigInt(line.variant_adjustment) && BigInt(line.subtotal) === BigInt(line.unit_price) * BigInt(line.quantity), `Line ${line.id} base arithmetic is invalid.`);
      check(line.taxable_amount === line.subtotal - line.discount && BigInt(line.tax) === (BigInt(line.taxable_amount) * BigInt(line.tax_rate_bps) + 5000n) / 10000n && line.total === line.taxable_amount + line.tax, `Line ${line.id} discount/tax arithmetic is invalid.`);
      subtotal += BigInt(line.subtotal); discount += BigInt(line.discount); tax += BigInt(line.tax); total += BigInt(line.total);
    }
    check(subtotal === BigInt(invoice.subtotal) && discount === BigInt(invoice.discount) && tax === BigInt(invoice.tax) && total === BigInt(invoice.total), `Invoice ${invoice.id} does not reconcile with its lines.`);
    check(invoice.due_date === addDays(invoice.issue_date, subscription!.payment_term_days) && invoice.issue_date <= BENCHMARK_BUSINESS_DATE, `Invoice ${invoice.id} issue/due date is invalid.`);
    const snapshot = JSON.parse(invoice.discount_snapshot_json || '{}') as { kind: string; scope: string; productIds: string[]; percentBps: number | null; amountMinor: number | null; eligibleBase: number; eligibleQuantity: number; amount: number; eligibilityDate: string; startDate: string | null; endDate: string | null; minAmount: number | null; minQuantity: number | null };
    const eligible = children.filter(line => snapshot.scope === 'subscription' || snapshot.productIds?.includes(line.product_id)); const base = eligible.reduce((sum, line) => sum + BigInt(line.subtotal), 0n);
    const expectedDiscount = snapshot.kind === 'fixed' ? (BigInt(snapshot.amountMinor!) < base ? BigInt(snapshot.amountMinor!) : base) : (base * BigInt(snapshot.percentBps!) + 5000n) / 10000n;
    check(base === BigInt(snapshot.eligibleBase) && eligible.reduce((sum, line) => sum + line.quantity, 0) === snapshot.eligibleQuantity && expectedDiscount === BigInt(invoice.discount) && snapshot.amount === invoice.discount && snapshot.eligibilityDate === invoice.issue_date, `Invoice ${invoice.id} frozen discount eligibility does not reconcile.`);
    check((!snapshot.startDate || snapshot.startDate <= invoice.issue_date) && (!snapshot.endDate || snapshot.endDate >= invoice.issue_date) && (!snapshot.minAmount || snapshot.minAmount <= snapshot.eligibleBase) && (!snapshot.minQuantity || snapshot.minQuantity <= snapshot.eligibleQuantity), `Invoice ${invoice.id} discount was outside its saved conditions.`);
    const facts = paymentFacts.get(invoice.id) || { amount: 0n, count: 0 };
    check(facts.amount === BigInt(invoice.amount_paid) && facts.count === invoice.payment_count, `Invoice ${invoice.id} payment cache differs from real immutable facts.`);
    check((invoice.status !== 'Paid' || invoice.amount_paid === invoice.total) && (invoice.status !== 'Confirmed' || invoice.amount_paid < invoice.total), `Invoice ${invoice.id} settlement status is invalid.`);
    check((invoice.status !== 'Draft' && invoice.status !== 'Canceled') || facts.count === 0, `Draft/Canceled ${invoice.id} has a payment.`);
    check(invoice.total !== 0 || (invoice.status === 'Paid' && facts.count === 0), `Zero invoice ${invoice.id} has fake money or is unsettled.`);
    const charge = byCharge.get(invoice.logical_charge_id); check(charge?.current_invoice_id === invoice.id && charge.outcome === 'invoiced' && charge.subscription_id === invoice.subscription_id && charge.period_start === invoice.period_start && charge.period_end === invoice.period_end, `Invoice ${invoice.id} is not the unique current logical period revision.`);
  }
  checks.push('Every invoice/line reconciles with accepted prices, exact discounts, exclusive half-up tax, dates and current logical charge.');
  checks.push('Every payment cache/count/settlement reconciles with immutable real positive payment inserts; zero Paid has no payment.');
  const eventRows = db.prepare("SELECT subscription_id,kind,effective_date FROM lifecycle_events WHERE kind IN ('pause','resume') ORDER BY effective_date,rowid").all() as { subscription_id: string; kind: string; effective_date: string }[];
  const events = new Map<string, typeof eventRows>(); for (const row of eventRows) { const group = events.get(row.subscription_id) || []; group.push(row); events.set(row.subscription_id, group); }
  const cadenceCounts: Record<string, number> = {};
  for (const subscription of subscriptions) {
    const accepted = terms.get(subscription.id)!; const cadence = accepted.plan.interval as Cadence; cadenceCounts[cadence] = (cadenceCounts[cadence] || 0) + 1;
    check(subscription.expiry_date === periodBoundary(subscription.start_date, cadence, subscription.term_periods), `Agreement ${subscription.id} expiry lost its original calendar anchor.`);
    const outcomes = groupedCharges.get(subscription.id) || []; const decided = new Map<number, Charge>();
    for (const charge of outcomes) {
      try {
        const index = periodIndex(subscription.start_date, cadence, charge.period_start);
        check(charge.period_end === periodBoundary(subscription.start_date, cadence, index + 1) && charge.period_end <= subscription.expiry_date, `Charge ${charge.id} is outside its original whole period.`);
        if (charge.outcome !== 'failed') decided.set(index, charge);
        else check(index === subscription.next_period_index && charge.current_invoice_id === null, `Failed charge ${charge.id} moved past its cursor.`);
        if (charge.outcome === 'nonbillable') {
          const history = (events.get(subscription.id) || []).filter(event => event.effective_date <= charge.period_start);
          check(history.at(-1)?.kind === 'pause' && charge.current_invoice_id === null, `Waived charge ${charge.id} lacks effective pause history.`);
        }
      } catch { check(false, `Charge ${charge.id} has an invalid original calendar boundary.`); }
    }
    for (let index = 0; index < subscription.next_period_index; index++) check(decided.has(index), `Agreement ${subscription.id} silently skipped period ${index}.`);
    check(decided.size === subscription.next_period_index, `Agreement ${subscription.id} cursor does not match its decided prefix.`);
    const next = periodBoundary(subscription.start_date, cadence, subscription.next_period_index); const expected = !subscription.accepted_terms_json || next >= subscription.expiry_date || (subscription.early_close_effective && next >= subscription.early_close_effective) ? null : next;
    check(subscription.next_billing_date === expected, `Agreement ${subscription.id} has an invalid indexed billing projection.`);
    if (subscription.accepted_at) check(subscription.accepted_at <= BENCHMARK_INSTANT, `Agreement ${subscription.id} was accepted in the future.`);
    if (subscription.service_state === 'TermEnded') check(!accepted.plan.autoClose && subscription.expiry_date <= BENCHMARK_BUSINESS_DATE, `Agreement ${subscription.id} TermEnded disagrees with accepted auto-close.`);
    if (subscription.closure_cause === 'expiry') check(accepted.plan.autoClose && subscription.expiry_date <= BENCHMARK_BUSINESS_DATE, `Agreement ${subscription.id} expiry close disagrees with accepted policy.`);
  }
  for (const cadence of ['daily', 'weekly', 'monthly', 'yearly']) check(cadenceCounts[cadence] === 2500, `Expected 2500 ${cadence} agreements, found ${cadenceCounts[cadence]}.`);
  checks.push('All 10k original daily/weekly/monthly/yearly anchors, whole expiry dates, decided prefixes, failed cursors, waivers and indexed projections checked.');
  const badApplications = Number(db.prepare(`SELECT count(*) AS count FROM discount_applications a JOIN invoices i ON i.id=a.invoice_id
    WHERE (i.status='Draft' AND a.state<>'reserved') OR (i.status IN ('Confirmed','Paid') AND a.state<>'consumed') OR (i.status='Canceled' AND a.state<>'released') OR a.amount<>i.discount`).get()?.count);
  check(badApplications === 0, 'Discount reservation/consumption/release facts disagree with invoices.');
  check(Number(db.prepare('SELECT count(*) AS count FROM invoices i LEFT JOIN discount_applications a ON a.invoice_id=i.id WHERE a.id IS NULL').get()?.count) === 0, 'An applied frozen discount has no reservation fact.');
  check(Number(db.prepare('SELECT count(*) AS count FROM billing_runs r WHERE r.processed<>(SELECT count(*) FROM billing_run_items i WHERE i.run_id=r.id)').get()?.count) === 0, 'Run result count differs from real item rows.');
  checks.push('Discount usage and real persisted billing run item counts reconcile.');
  return { passed: errors.length === 0, checks, errors, checkedSubscriptions: subscriptions.length, checkedInvoices: invoices.length, checkedPayments: payments.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Usage: npx tsx server/benchmark-validation.ts <database path>');
  const db = new DatabaseSync(resolve(process.argv[2]), { readOnly: true });
  try { db.exec('PRAGMA foreign_keys=ON'); const result = validateBenchmarkDatabase(db); console.log(JSON.stringify(result, null, 2)); if (!result.passed) process.exitCode = 1; }
  finally { db.close(); }
}
