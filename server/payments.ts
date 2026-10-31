import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { User } from '../shared/contracts.js';
import { formatMoney } from '../shared/money.js';
import { paymentInputSchema, paymentListSchema, paymentMethodLabels, type PaymentInput, type Payment, type PaymentResult } from '../shared/payments.js';
import { transaction } from './database.js';
import { DomainError } from './errors.js';
import { audit, digest, requireRole } from './security.js';
import { serializeInvoice } from './billing.js';
import { businessDate } from './calendar.js';
import { checkedMinor } from './money.js';

const invoiceIdSchema = z.string().uuid('Select an existing invoice.');
interface PaymentRow {
  id: string; invoice_id: string; invoice_number: string; amount: number; currency: 'INR'; method: Payment['method'];
  payment_date: string; note: string; actor_id: string; recorded_by_name: string; idempotency_key: string; payload_hash: string; created_at: string;
}
interface InvoiceAllocation {
  id: string; customer_id: string; total: number; amount_paid: number; payment_count: number; status: string; currency: string; current_invoice_id: string;
}
const paymentSelect = 'SELECT p.*,i.number AS invoice_number FROM payments p JOIN invoices i ON i.id=p.invoice_id';
function paymentDto(row: PaymentRow, includeNote: boolean): Payment {
  return { id: row.id, invoiceId: row.invoice_id, invoiceNumber: row.invoice_number, amount: row.amount, currency: row.currency,
    method: row.method, paymentDate: row.payment_date, recordedAt: row.created_at, recordedBy: row.recorded_by_name,
    ...(includeNote ? { note: row.note } : {}) };
}
function internalUser(db: DatabaseSync, actorId: string): User {
  const row = db.prepare('SELECT id,name,email,role,created_at FROM users WHERE id=?').get(actorId) as { id: string; name: string; email: string; role: User['role']; created_at: string } | undefined;
  if (!row || !['admin', 'staff'].includes(row.role)) throw new DomainError(403, 'FORBIDDEN', 'Your account cannot record payments.');
  return { id: row.id, name: row.name, email: row.email, role: row.role, createdAt: row.created_at };
}

/** One immutable allocation; the database trigger updates balance and settlement in the same transaction. */
export function recordPayment(db: DatabaseSync, invoiceId: string, input: PaymentInput, actorId: string, now: Date): PaymentResult {
  invoiceIdSchema.parse(invoiceId);
  const parsed = paymentInputSchema.parse(input);
  const payloadHash = digest(JSON.stringify([invoiceId, parsed.amount, parsed.currency, parsed.method, parsed.paymentDate, parsed.note]));
  return transaction(db, () => {
    const user = internalUser(db, actorId);
    const prior = db.prepare(`${paymentSelect} WHERE p.idempotency_key=?`).get(parsed.idempotencyKey) as unknown as PaymentRow | undefined;
    if (prior) {
      if (prior.actor_id !== actorId || prior.invoice_id !== invoiceId || prior.payload_hash !== payloadHash) throw new DomainError(409, 'IDEMPOTENCY_CONFLICT', 'This payment key was used for a different request. Review the recorded payment before starting a new entry.');
      return { payment: paymentDto(prior, true), invoice: serializeInvoice(db, invoiceId, user, now), replayed: true };
    }
    const row = db.prepare('SELECT i.id,i.customer_id,i.total,i.amount_paid,i.payment_count,i.status,i.currency,c.current_invoice_id FROM invoices i JOIN logical_charges c ON c.id=i.logical_charge_id WHERE i.id=?').get(invoiceId) as unknown as InvoiceAllocation | undefined;
    if (!row) throw new DomainError(404, 'NOT_FOUND', 'This invoice was not found.');
    if (row.current_invoice_id !== row.id) throw new DomainError(409, 'INVOICE_SUPERSEDED', 'A newer invoice revision exists. Record payments against the current invoice.');
    if (row.status !== 'Confirmed') throw new DomainError(409, 'INVOICE_NOT_CONFIRMED', 'Only a Confirmed invoice with a remaining balance accepts payments.');
    if (parsed.currency !== row.currency) throw new DomainError(400, 'CURRENCY_MISMATCH', 'Record the payment in the invoice’s currency.', { currency: 'This invoice uses INR.' });
    if (parsed.paymentDate > businessDate(now)) throw new DomainError(400, 'FUTURE_PAYMENT_DATE', 'The payment date cannot be later than the current business date.', { paymentDate: 'Use today’s business date or an earlier date.' });
    const facts = db.prepare('SELECT coalesce(sum(amount),0) AS amount,count(*) AS count FROM payments WHERE invoice_id=?').get(invoiceId)!;
    if (facts.amount !== row.amount_paid || facts.count !== row.payment_count) throw new DomainError(409, 'BALANCE_INCONSISTENT', 'The invoice balance does not reconcile with its payment history. Review this record before recording another payment.');
    const paidAfter = BigInt(row.amount_paid) + BigInt(parsed.amount);
    const outstanding = row.total - row.amount_paid;
    if (paidAfter > BigInt(row.total)) throw new DomainError(409, 'OVERPAYMENT', `The remaining balance is ${formatMoney(outstanding)}. Record that amount or less.`, { amount: `Use an amount no greater than ${formatMoney(outstanding)}.` });
    checkedMinor(paidAfter);
    const id = randomUUID();
    db.prepare('INSERT INTO payments(id,invoice_id,amount,currency,method,payment_date,note,actor_id,recorded_by_name,idempotency_key,payload_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, invoiceId, parsed.amount, parsed.currency, parsed.method, parsed.paymentDate, parsed.note, actorId, user.name, parsed.idempotencyKey, payloadHash, now.toISOString());
    const invoice = serializeInvoice(db, invoiceId, user, now);
    const message = `Payment of ${formatMoney(parsed.amount)} recorded by ${paymentMethodLabels[parsed.method]} for ${parsed.paymentDate}. ${invoice.status === 'Paid' ? 'The invoice is fully paid.' : `Remaining balance: ${formatMoney(invoice.outstanding)}.`}`;
    db.prepare('INSERT INTO invoice_history(id,invoice_id,actor_id,kind,created_at,from_status,to_status,message,request_version) VALUES(?,?,?,?,?,?,?,?,NULL)')
      .run(randomUUID(), invoiceId, actorId, 'payment_recorded', now.toISOString(), 'Confirmed', invoice.status, message);
    if (invoice.status === 'Paid') db.prepare('INSERT INTO invoice_history(id,invoice_id,actor_id,kind,created_at,from_status,to_status,message,request_version) VALUES(?,?,?,?,?,?,?,?,NULL)')
      .run(randomUUID(), invoiceId, actorId, 'settled', now.toISOString(), 'Confirmed', 'Paid', 'The invoice settled after its final committed payment allocation.');
    audit(db, actorId, 'payment.recorded', id, now, { invoiceId, amount: parsed.amount, method: parsed.method, paymentDate: parsed.paymentDate });
    const saved = db.prepare(`${paymentSelect} WHERE p.id=?`).get(id) as unknown as PaymentRow;
    return { payment: paymentDto(saved, true), invoice: serializeInvoice(db, invoiceId, user, now), replayed: false };
  });
}

export function paymentRoutes(db: DatabaseSync, clock: () => Date): Router {
  const router = Router();
  router.post('/invoices/:id/payments', requireRole('admin', 'staff'), (req, res) => {
    const id = invoiceIdSchema.parse(req.params.id); const input = paymentInputSchema.parse(req.body);
    const result = recordPayment(db, id, input, (res.locals.user as User).id, clock());
    res.status(result.replayed ? 200 : 201).json(result);
  });
  router.get('/invoices/:id/payments', requireRole(), (req, res) => {
    const id = invoiceIdSchema.parse(req.params.id); const input = paymentListSchema.parse(req.query); const user = res.locals.user as User;
    res.json(transaction(db, () => {
      const invoice = db.prepare('SELECT customer_id FROM invoices WHERE id=?').get(id);
      if (!invoice || (user.role === 'customer' && invoice.customer_id !== user.id)) throw new DomainError(404, 'NOT_FOUND', 'This invoice was not found or is unavailable to your account.');
      const total = Number(db.prepare('SELECT count(*) AS count FROM payments WHERE invoice_id=?').get(id)?.count);
      const page = Math.min(input.page, Math.max(1, Math.ceil(total / input.pageSize)));
      const rows = db.prepare(`${paymentSelect} WHERE p.invoice_id=? ORDER BY p.payment_date DESC,p.created_at DESC,p.id LIMIT ? OFFSET ?`).all(id, input.pageSize, (page - 1) * input.pageSize) as unknown as PaymentRow[];
      return { items: rows.map(row => paymentDto(row, user.role !== 'customer')), total, page, pageSize: input.pageSize };
    }, 'read'));
  });
  return router;
}
