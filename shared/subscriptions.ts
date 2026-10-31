import { z } from 'zod';
import { catalogDateSchema, catalogLineInputSchema, type PlanInput, type ProductInput } from './catalog.js';
import type { AiQuoteReview } from './ai-quote.js';

export const subscriptionStages = ['Draft', 'Quotation', 'Confirmed', 'Active', 'Closed'] as const;
export const subscriptionServiceStates = ['Running', 'Paused', 'TermEnded', 'Closed'] as const;
export type SubscriptionStage = typeof subscriptionStages[number];
export type SubscriptionServiceState = typeof subscriptionServiceStates[number];
export type SubscriptionAction = 'edit' | 'issue' | 'confirm' | 'activate';
const id = z.string().uuid('Select an existing record.');
const commercialShape = {
  customerId: id, planId: id, templateId: id.nullable(), startDate: catalogDateSchema,
  termPeriods: z.number().int().min(1).max(1_200).optional(), expiryDate: catalogDateSchema.optional(),
  paymentTermDays: z.number().int().min(0).max(365), validDays: z.number().int().min(1).max(3_650).optional(),
  lines: z.array(catalogLineInputSchema).min(1).max(50).optional(),
};
function commercialRules(value: z.infer<typeof commercialObject>, context: z.RefinementCtx) {
  if ((value.termPeriods === undefined) === (value.expiryDate === undefined)) context.addIssue({ code: 'custom', path: ['termPeriods'], message: 'Choose a whole number of periods or an aligned expiry date, not both.' });
  if (!value.templateId && !value.lines) context.addIssue({ code: 'custom', path: ['lines'], message: 'Add the subscription’s product lines.' });
  if (!value.templateId && value.validDays === undefined) context.addIssue({ code: 'custom', path: ['validDays'], message: 'Set the quotation’s validity in days.' });
}
const commercialObject = z.object(commercialShape).strict();
const aiFields = { aiProposalId: id.optional(), reviewHash: z.string().regex(/^[a-f0-9]{64}$/).optional() };
export const subscriptionPreviewSchema = commercialObject.extend(aiFields).superRefine(commercialRules);
export const subscriptionCreateSchema = commercialObject.extend({ ...aiFields, idempotencyKey: id }).superRefine(commercialRules);
export const subscriptionUpdateSchema = commercialObject.extend({ version: z.number().int().positive() }).superRefine(commercialRules);
export const subscriptionActionSchema = z.object({ version: z.number().int().positive() }).strict();
export const subscriptionProcessDueSchema = z.object({ limit: z.number().int().min(1).max(500).default(100) }).strict();
export type SubscriptionCommercialInput = z.infer<typeof subscriptionPreviewSchema>;
export type SubscriptionCreateInput = z.infer<typeof subscriptionCreateSchema>;

export interface SubscriptionPlanTerms {
  id: string; name: string; version: number; primaryProductId: string; price: number; interval: PlanInput['interval']; minQuantity: number;
  autoClose: boolean; allowPause: boolean; allowRenew: boolean; allowEarlyClose: boolean;
}
export interface SubscriptionLine {
  id: string; productId: string; productName: string; productType: ProductInput['type']; variantId: string | null; variantName: string | null;
  quantity: number; isPrimary: boolean; baseUnitPrice: number; variantAdjustment: number; unitPrice: number; subtotal: number;
  estimatedTaxRateBps: number; estimatedTax: number; estimatedTotal: number;
}
export interface SubscriptionTerms {
  currency: 'INR'; plan: SubscriptionPlanTerms; lines: SubscriptionLine[];
  subtotal: number; estimatedTax: number; estimatedTotal: number; taxesAreEstimates: true; priceExplanation: string;
}
export interface SubscriptionPreview {
  aiReview?: AiQuoteReview;
  customerId: string; customerName: string; customerEmail: string; planId: string; templateId: string | null; templateName: string | null;
  startDate: string; expiryDate: string; termPeriods: number; paymentTermDays: number; validDays: number;
  businessDate: string; terms: SubscriptionTerms;
}
export interface SubscriptionSummary {
  id: string; number: string; customerId: string; customerName: string; customerEmail: string; planId: string; planName: string;
  startDate: string; expiryDate: string; termPeriods: number; paymentTermDays: number; stage: SubscriptionStage; serviceState: SubscriptionServiceState;
  version: number; currency: 'INR'; subtotal: number; estimatedTax: number; estimatedTotal: number;
  issuedDate: string | null; validUntil: string | null; acceptedAt: string | null; nextBillingDate: string | null; createdAt: string; updatedAt: string;
}
export interface SubscriptionHistory {
  id: string; kind: string; actorName: string; at: string; fromStage: SubscriptionStage | null; toStage: SubscriptionStage; message: string;
}
export interface Subscription extends SubscriptionSummary {
  templateId: string | null; templateName: string | null; validDays: number; businessDate: string;
  terms: SubscriptionTerms; offeredTerms: SubscriptionTerms | null; acceptedTerms: SubscriptionTerms | null;
  history: SubscriptionHistory[]; allowedActions: SubscriptionAction[]; activationBlockedReason: string | null;
}
export interface SubscriptionProcessDueResult {
  activated: number; alreadyActive: number; failed: number; remaining: number; blocked: number;
  items: { id: string; number: string; outcome: 'activated' | 'alreadyActive' | 'failed' | 'blocked'; message: string }[];
}

// UI uses termPeriods; an explicit expiryDate is accepted only as an alternative and must align
// to the original calendar anchor. Dates, prices, stages, ownership and policies stay server-owned.
// Template lines/validity may be omitted to copy the stored template, or explicitly overridden
// for the instance. The stored template is never edited by subscription operations.
