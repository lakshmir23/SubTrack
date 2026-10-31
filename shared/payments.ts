import { z } from 'zod';
import { catalogDateSchema } from './catalog.js';
import { MAX_MINOR } from './money.js';
import type { Invoice } from './billing.js';

export const paymentMethods = ['bank_transfer', 'cash', 'card', 'cheque', 'other'] as const;
export type PaymentMethod = typeof paymentMethods[number];
export const paymentMethodLabels: Record<PaymentMethod, string> = {
  bank_transfer: 'Bank transfer', cash: 'Cash', card: 'Card', cheque: 'Cheque', other: 'Other',
};
export const paymentInputSchema = z.object({
  amount: z.number().int('Use an exact amount in minor units.').min(1, 'Record a positive payment.').max(MAX_MINOR),
  currency: z.literal('INR', 'This invoice uses INR.'), method: z.enum(paymentMethods),
  paymentDate: catalogDateSchema, note: z.string().trim().max(2_000).default(''),
  idempotencyKey: z.string().uuid('Use a valid submission key.'),
}).strict();
export const paymentListSchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export type PaymentInput = z.infer<typeof paymentInputSchema>;
export interface Payment {
  id: string; invoiceId: string; invoiceNumber: string; amount: number; currency: 'INR';
  method: PaymentMethod; paymentDate: string; recordedAt: string; recordedBy: string;
  note?: string;
}
export interface PaymentResult { payment: Payment; invoice: Invoice; replayed: boolean }

// POST /api/invoices/:id/payments, internal only, returns PaymentResult:
// 201 newly recorded; 200 exact replay, including after final settlement.
// The UUID key binds actor, invoice and every normalized payment field. A changed
// payload conflicts. No invoice version is required: the transaction rechecks the
// current outstanding balance. Different keys may record equal legitimate payments.
// GET /api/invoices/:id/payments returns Page<Payment>, internal or owning customer.
// Customer DTOs OMIT note; internal notes never enter invoice history or print output.
// Payments are immutable; correction/reversal is intentionally outside the baseline.
