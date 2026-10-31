import { z } from 'zod';
import { catalogDateSchema } from './catalog.js';
import type { SubscriptionServiceState } from './subscriptions.js';
import type { InvoiceStatus } from './billing.js';
import type { PaymentMethod } from './payments.js';

const filters = {
  customerId: z.string().uuid('Select an existing customer.').optional(),
  invoiceFrom: catalogDateSchema.optional(), invoiceTo: catalogDateSchema.optional(),
  paymentFrom: catalogDateSchema.optional(), paymentTo: catalogDateSchema.optional(),
};
function orderedDates(value: FinanceFilters, context: z.RefinementCtx) {
  if (value.invoiceFrom && value.invoiceTo && value.invoiceFrom > value.invoiceTo) context.addIssue({ code: 'custom', path: ['invoiceTo'], message: 'Use an invoice end date on or after its start date.' });
  if (value.paymentFrom && value.paymentTo && value.paymentFrom > value.paymentTo) context.addIssue({ code: 'custom', path: ['paymentTo'], message: 'Use a payment end date on or after its start date.' });
}
const filterObject = z.object(filters).strict();
export type FinanceFilters = z.infer<typeof filterObject>;
export const financeFilterSchema = filterObject.superRefine(orderedDates);
const paging = { page: z.coerce.number().int().min(1).max(1_000_000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) };
export const financePageSchema = filterObject.extend(paging).superRefine(orderedDates);
export const financeInvoicePageSchema = filterObject.extend({ ...paging, view: z.enum(['invoiced', 'outstanding', 'overdue']).default('invoiced') }).superRefine(orderedDates);

/** Decimal integer INR minor units; aggregates deliberately exceed per-record number limits. */
export type FinanceMinor = string;
export interface FinanceSummary {
  businessDate: string; currency: 'INR'; filters: FinanceFilters;
  activeAgreements: number; pausedAgreements: number;
  invoicedRevenue: FinanceMinor; invoiceCount: number;
  paymentsReceived: FinanceMinor; paymentCount: number;
  outstanding: FinanceMinor; outstandingInvoiceCount: number;
  overdue: FinanceMinor; overdueInvoiceCount: number;
  definitions: { active: string; invoiced: string; payments: string; outstanding: string; overdue: string };
}
export interface FinanceAgreement {
  id: string; number: string; customerId: string; customerName: string; customerEmail: string;
  planName: string; startDate: string; expiryDate: string; serviceState: SubscriptionServiceState;
}
export interface FinanceInvoice {
  id: string; number: string; subscriptionId: string; subscriptionNumber: string;
  customerId: string; customerName: string; customerEmail: string; issueDate: string; dueDate: string;
  status: InvoiceStatus; total: number; amountPaid: number; outstanding: number; overdue: boolean; currency: 'INR';
}
export interface FinancePayment {
  id: string; invoiceId: string; invoiceNumber: string; subscriptionId: string; subscriptionNumber: string;
  customerId: string; customerName: string; customerEmail: string;
  paymentDate: string; recordedAt: string; method: PaymentMethod; amount: number; currency: 'INR';
}

// Internal (admin/staff) GET /api/finance/summary returns FinanceSummary.
// GET /api/finance/agreements -> Page<FinanceAgreement>, /invoices -> Page<FinanceInvoice>,
// /payments -> Page<FinancePayment>. All accept the same filters; lists add page/pageSize;
// invoices add view=invoiced|outstanding|overdue. Page counts and summary use the whole
// matching dataset, never only visible rows. Responses are coherent read transactions.
// Invoice ranges (inclusive) affect revenue/balance invoice cohorts ONLY. Payment ranges
// (inclusive) affect cash event dates ONLY, regardless of the invoice's issue date.
// Customer applies to every metric. Date ranges do not change today's active agreements.
// Outstanding/overdue are CURRENT balances for the invoice-issue cohort, not historical
// balances as at the selected date. Draft/Canceled are excluded. Overdue: dueDate < today.
// Active: stage Active, within [start,expiry), no effective early close; paused included.
// All endpoints deny customers; customer own invoice/payment views remain separate.
