import { z } from 'zod';
import { catalogDateSchema } from './catalog.js';
import { MAX_MINOR } from './money.js';

const id = z.string().uuid('Select an existing record.');
const money = z.number().int().min(0).max(MAX_MINOR);
const discountObject = z.object({
  name: z.string().trim().min(2).max(100), kind: z.enum(['fixed', 'percentage']),
  amountMinor: money.nullable(), percentBps: z.number().int().min(0).max(10_000).nullable(),
  minAmount: money.nullable(), minQuantity: z.number().int().min(1).max(500_000).nullable(),
  startDate: catalogDateSchema.nullable(), endDate: catalogDateSchema.nullable(), maxUses: z.number().int().min(1).max(1_000_000_000).nullable(),
  priority: z.number().int().min(0).max(10_000), active: z.boolean(), scope: z.enum(['subscription', 'products']),
  subscriptionId: id.nullable(), productIds: z.array(id).max(50),
}).strict();
function discountRules(value: z.infer<typeof discountObject>, context: z.RefinementCtx) {
  if (value.kind === 'fixed' && (value.amountMinor === null || value.percentBps !== null)) context.addIssue({ code: 'custom', path: ['amountMinor'], message: 'A fixed discount needs an amount and no percentage.' });
  if (value.kind === 'percentage' && (value.percentBps === null || value.amountMinor !== null)) context.addIssue({ code: 'custom', path: ['percentBps'], message: 'A percentage discount needs a rate and no fixed amount.' });
  if (value.startDate && value.endDate && value.startDate > value.endDate) context.addIssue({ code: 'custom', path: ['endDate'], message: 'End date must be on or after the start date.' });
  if (value.scope === 'products' && !value.productIds.length) context.addIssue({ code: 'custom', path: ['productIds'], message: 'Select at least one eligible product.' });
  if (value.scope === 'subscription' && value.productIds.length) context.addIssue({ code: 'custom', path: ['productIds'], message: 'Whole-subscription discounts apply to every line; clear product targets.' });
  if (new Set(value.productIds).size !== value.productIds.length) context.addIssue({ code: 'custom', path: ['productIds'], message: 'Select each product once.' });
}
export const discountInputSchema = discountObject.superRefine(discountRules);
export const discountUpdateSchema = discountObject.extend({ version: z.number().int().positive() }).superRefine(discountRules);
export const invoiceGenerateSchema = z.object({ expectedPeriodStart: catalogDateSchema, idempotencyKey: id }).strict();
export const invoicePreviewSchema = z.object({ expectedPeriodStart: catalogDateSchema }).strict();
export const invoiceActionSchema = z.object({ version: z.number().int().positive() }).strict();
export const invoiceStatuses = ['Draft', 'Confirmed', 'Paid', 'Canceled'] as const;
export type InvoiceStatus = typeof invoiceStatuses[number];
export type DiscountInput = z.infer<typeof discountInputSchema>;
export type InvoiceGenerateInput = z.infer<typeof invoiceGenerateSchema>;
export interface DiscountRule extends DiscountInput {
  id: string; version: number; createdAt: string; updatedAt: string; subscriptionNumber: string | null;
  reserved: number; consumed: number; remaining: number | null; holdingDraftsTotal: number;
  holdingDrafts?: { id: string; number: string; createdAt: string }[]; holdingDraftsTruncated?: boolean;
}
export interface InvoiceLine {
  id: string; subscriptionLineId: string; productId: string; productName: string; variantId: string | null; variantName: string | null;
  quantity: number; baseUnitPrice: number; variantAdjustment: number; unitPrice: number; subtotal: number;
  discount: number; taxableAmount: number; taxRuleId: string | null; taxRuleName: string | null; taxRuleVersion: number | null;
  taxRateBps: number; tax: number; total: number;
}
export interface InvoiceDiscountSnapshot {
  id: string; name: string; version: number; kind: 'fixed' | 'percentage'; amountMinor: number | null; percentBps: number | null;
  scope: 'subscription' | 'products'; productIds: string[]; eligibleBase: number; eligibleQuantity: number;
  minAmount?: number | null; minQuantity?: number | null; startDate?: string | null; endDate?: string | null;
  maxUses?: number | null; priority?: number; subscriptionId?: string | null;
  amount: number; eligibilityDate: string; explanation: string;
}
export interface DiscountDecision { ruleId: string; ruleName: string; eligible: boolean; reason: string }
export interface InvoicePreview {
  subscriptionId: string; subscriptionNumber: string; customerId: string; customerName: string; customerEmail: string;
  periodStart: string; periodEnd: string; issueDate: string; dueDate: string; currency: 'INR';
  lines: InvoiceLine[]; subtotal: number; discount: number; tax: number; total: number;
  discountSnapshot: InvoiceDiscountSnapshot | null; discountReason: string;
  discountDecisions?: DiscountDecision[]; discountDecisionsTruncated?: boolean;
  existingInvoiceId: string | null; existingInvoiceNumber: string | null; previewOnly: true;
}
export interface InvoiceSummary {
  id: string; number: string; logicalChargeId: string; revisionNumber: number; predecessorId: string | null;
  subscriptionId: string; subscriptionNumber: string; customerId: string; customerName: string; customerEmail: string;
  periodStart: string; periodEnd: string; issueDate: string; dueDate: string; currency: 'INR'; status: InvoiceStatus;
  subtotal: number; discount: number; tax: number; total: number; amountPaid: number; outstanding: number; paymentCount: number; overdue: boolean;
  version: number; createdAt: string; confirmedAt: string | null; canceledAt: string | null; settledAt: string | null; settlementReason: string | null;
}
export interface Invoice extends InvoiceSummary {
  currentInvoiceId: string; currentInvoiceNumber: string;
  lines: InvoiceLine[]; discountSnapshot: InvoiceDiscountSnapshot | null; discountReason: string;
  discountApplicationState: 'reserved' | 'consumed' | 'released' | null;
  discountDecisions?: DiscountDecision[]; discountDecisionsTruncated?: boolean;
  history: { id: string; kind: string; actorName: string; at: string; fromStatus: InvoiceStatus | null; toStatus: InvoiceStatus; message: string }[];
  businessDate: string; allowedActions: ('confirm' | 'cancel' | 'replace')[];
}

// All amounts are exact INR minor units. One eligible rule is selected by priority then ID.
// Percentage is rounded once on the eligible scope, then allocated by largest remainder and
// stable accepted-line ID. Exclusive tax is rounded per discounted line. Preview reserves nothing.
// Invoice DTOs for customers omit global rule decisions/usage and all internal cost/note fields.
