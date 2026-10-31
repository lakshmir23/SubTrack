import { Router } from 'express';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { financeFilterSchema, financePageSchema, financeInvoicePageSchema,
  type FinanceFilters, type FinanceSummary, type FinanceAgreement, type FinanceInvoice, type FinancePayment } from '../shared/finance.js';
import type { Page } from '../shared/contracts.js';
import { transaction } from './database.js';
import { businessDate } from './calendar.js';
import { requireRole } from './security.js';

interface Clause { sql: string; values: SQLInputValue[] }
type FinancePageInput = FinanceFilters & { page: number; pageSize: number };
type InvoiceView = 'invoiced' | 'outstanding' | 'overdue';

function invoiceCohort(filters: FinanceFilters, date: string, view: InvoiceView = 'invoiced'): Clause {
  const where = ["i.status IN ('Confirmed','Paid')"]; const values: SQLInputValue[] = [];
  if (filters.customerId) { where.push('i.customer_id=?'); values.push(filters.customerId); }
  if (filters.invoiceFrom) { where.push('i.issue_date>=?'); values.push(filters.invoiceFrom); }
  if (filters.invoiceTo) { where.push('i.issue_date<=?'); values.push(filters.invoiceTo); }
  if (view !== 'invoiced') where.push('i.total>i.amount_paid');
  if (view === 'overdue') { where.push('i.due_date<?'); values.push(date); }
  return { sql: where.join(' AND '), values };
}
function paymentCohort(filters: FinanceFilters): Clause {
  const where = ["i.status IN ('Confirmed','Paid')"]; const values: SQLInputValue[] = [];
  if (filters.customerId) { where.push('i.customer_id=?'); values.push(filters.customerId); }
  if (filters.paymentFrom) { where.push('p.payment_date>=?'); values.push(filters.paymentFrom); }
  if (filters.paymentTo) { where.push('p.payment_date<=?'); values.push(filters.paymentTo); }
  return { sql: where.join(' AND '), values };
}
function activeCohort(filters: FinanceFilters, date: string): Clause {
  const where = ["s.stage='Active'", "s.service_state IN ('Running','Paused')", 's.start_date<=?', 's.expiry_date>?', '(s.early_close_effective IS NULL OR s.early_close_effective>?)'];
  const values: SQLInputValue[] = [date, date, date];
  if (filters.customerId) { where.push('s.customer_id=?'); values.push(filters.customerId); }
  return { sql: where.join(' AND '), values };
}
// Effective history handles a due pause/resume even before the normal lifecycle worker
// has projected its badge. Reading finance never changes agreement state or history.
const effectiveState = `coalesce((SELECT CASE e.kind WHEN 'pause' THEN 'Paused' ELSE 'Running' END
  FROM lifecycle_events e WHERE e.subscription_id=s.id AND e.kind IN ('pause','resume') AND e.effective_date<=?
  ORDER BY e.effective_date DESC,e.rowid DESC LIMIT 1),s.service_state)`;

/** Caller may compose this inside a read transaction; routes always provide one. */
export function summarizeFinance(db: DatabaseSync, filters: FinanceFilters, now: Date): FinanceSummary {
  const date = businessDate(now); const invoice = invoiceCohort(filters, date); const payment = paymentCohort(filters); const active = activeCohort(filters, date);
  // Each fact table is aggregated once. CAST before crossing the SQLite/JS boundary
  // preserves totals above Number.MAX_SAFE_INTEGER; no invoice-line or payment join
  // appears in invoice totals. A payment row joins exactly one invoice for ownership.
  const billed = db.prepare(`SELECT CAST(coalesce(sum(i.total),0) AS TEXT) AS revenue,count(*) AS count,
    CAST(coalesce(sum(i.total-i.amount_paid),0) AS TEXT) AS outstanding,
    sum(CASE WHEN i.total>i.amount_paid THEN 1 ELSE 0 END) AS outstanding_count,
    CAST(coalesce(sum(CASE WHEN i.due_date<? THEN i.total-i.amount_paid ELSE 0 END),0) AS TEXT) AS overdue,
    sum(CASE WHEN i.due_date<? AND i.total>i.amount_paid THEN 1 ELSE 0 END) AS overdue_count
    FROM invoices i WHERE ${invoice.sql}`).get(date, date, ...invoice.values) as {
      revenue: string; count: number; outstanding: string; outstanding_count: number | null; overdue: string; overdue_count: number | null;
    };
  const cash = db.prepare(`SELECT CAST(coalesce(sum(p.amount),0) AS TEXT) AS received,count(*) AS count
    FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE ${payment.sql}`).get(...payment.values) as { received: string; count: number };
  const agreements = db.prepare(`SELECT count(*) AS count,sum(CASE WHEN ${effectiveState}='Paused' THEN 1 ELSE 0 END) AS paused
    FROM subscriptions s WHERE ${active.sql}`).get(date, ...active.values) as { count: number; paused: number | null };
  const customer = filters.customerId ? db.prepare("SELECT name FROM users WHERE id=? AND role='customer'").get(filters.customerId) as { name: string } | undefined : undefined;
  return { businessDate: date, currency: 'INR', filters, customerName: customer?.name || null, activeAgreements: agreements.count, pausedAgreements: agreements.paused || 0,
    invoicedRevenue: billed.revenue, invoiceCount: billed.count, paymentsReceived: cash.received, paymentCount: cash.count,
    outstanding: billed.outstanding, outstandingInvoiceCount: billed.outstanding_count || 0, overdue: billed.overdue, overdueInvoiceCount: billed.overdue_count || 0,
    definitions: {
      active: 'Active agreements today within their service term, including paused agreements. Invoice and payment date ranges do not change this count.',
      invoiced: 'Confirmed and Paid invoice totals, including tax and after discounts, selected by invoice issue date. Draft and Canceled invoices are excluded.',
      payments: 'Money received on the selected payment dates, regardless of when its invoice was issued. Zero-amount settlements do not count as money received.',
      outstanding: 'What remains unpaid today on invoices issued within the selected dates. This is not a historical balance.',
      overdue: 'Of those invoices, unpaid balances with a due date before today. An invoice due today is not overdue.',
    } };
}

function pageRecords<T>(db: DatabaseSync, from: string, clause: Clause, input: FinancePageInput, select: string, order: string, prefixValues: SQLInputValue[] = []): Page<T> {
  const total = Number(db.prepare(`SELECT count(*) AS count FROM ${from} WHERE ${clause.sql}`).get(...clause.values)?.count);
  const page = Math.min(input.page, Math.max(1, Math.ceil(total / input.pageSize)));
  const items = db.prepare(`SELECT ${select} FROM ${from} WHERE ${clause.sql} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...prefixValues, ...clause.values, input.pageSize, (page - 1) * input.pageSize) as unknown as T[];
  return { items, total, page, pageSize: input.pageSize };
}

export function financeRoutes(db: DatabaseSync, clock: () => Date): Router {
  const router = Router();
  router.use('/finance', requireRole('admin', 'staff'));
  router.get('/finance/summary', (req, res) => {
    const input = financeFilterSchema.parse(req.query); const now = clock();
    res.json(transaction(db, () => summarizeFinance(db, input, now), 'read'));
  });
  router.get('/finance/agreements', (req, res) => {
    const input = financePageSchema.parse(req.query); const date = businessDate(clock());
    res.json(transaction(db, () => pageRecords<FinanceAgreement>(db, 'subscriptions s JOIN users u ON u.id=s.customer_id', activeCohort(input, date), input,
      `s.id,s.number,s.customer_id AS customerId,u.name AS customerName,u.email AS customerEmail,
       json_extract(s.accepted_terms_json,'$.plan.name') AS planName,s.start_date AS startDate,s.expiry_date AS expiryDate,${effectiveState} AS serviceState`,
      's.start_date DESC,s.number DESC,s.id', [date]), 'read'));
  });
  router.get('/finance/invoices', (req, res) => {
    const input = financeInvoicePageSchema.parse(req.query); const date = businessDate(clock());
    res.json(transaction(db, () => {
      const result = pageRecords<FinanceInvoice>(db, 'invoices i', invoiceCohort(input, date, input.view), input,
        `i.id,i.number,i.subscription_id AS subscriptionId,i.subscription_number AS subscriptionNumber,
         i.customer_id AS customerId,i.customer_name AS customerName,i.customer_email AS customerEmail,i.issue_date AS issueDate,i.due_date AS dueDate,
         i.status,i.total,i.amount_paid AS amountPaid,i.total-i.amount_paid AS outstanding,
         CASE WHEN i.due_date<? AND i.total>i.amount_paid THEN 1 ELSE 0 END AS overdue,i.currency`, 'i.issue_date DESC,i.number DESC,i.id', [date]);
      return { ...result, items: result.items.map(row => ({ ...row, overdue: Boolean(row.overdue) })) };
    }, 'read'));
  });
  router.get('/finance/payments', (req, res) => {
    const input = financePageSchema.parse(req.query);
    res.json(transaction(db, () => pageRecords<FinancePayment>(db, 'payments p JOIN invoices i ON i.id=p.invoice_id', paymentCohort(input), input,
      `p.id,p.invoice_id AS invoiceId,i.number AS invoiceNumber,i.subscription_id AS subscriptionId,i.subscription_number AS subscriptionNumber,
       i.customer_id AS customerId,i.customer_name AS customerName,i.customer_email AS customerEmail,
       p.payment_date AS paymentDate,p.created_at AS recordedAt,p.method,p.amount,p.currency`, 'p.payment_date DESC,p.created_at DESC,p.id'), 'read'));
  });
  return router;
}
