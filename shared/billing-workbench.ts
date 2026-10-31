import { z } from 'zod';
import type { InvoicePreview } from './billing.js';

const id = z.string().uuid('Select an existing record.');
export const billingRunInputSchema = z.object({
  limit: z.number().int().min(1).max(500).default(250),
  subscriptionIds: z.array(id).min(1).max(500).optional(), idempotencyKey: id,
}).strict().refine(value => !value.subscriptionIds || new Set(value.subscriptionIds).size === value.subscriptionIds.length,
  { path: ['subscriptionIds'], message: 'Select each subscription once.' });
export const billingRetrySchema = z.object({ idempotencyKey: id }).strict();
export const invoiceReplacementPreviewSchema = z.object({ version: z.number().int().positive() }).strict();
export const invoiceReplacementSchema = z.object({
  version: z.number().int().positive(), idempotencyKey: id, previewHash: z.string().regex(/^[a-f0-9]{64}$/, 'Review a fresh replacement preview.'),
}).strict();
export type BillingRunInput = z.infer<typeof billingRunInputSchema>;
export interface BillingQueueItem {
  subscriptionId: string; subscriptionNumber: string; customerId: string; customerName: string;
  periodStart: string; periodEnd: string; outcome: 'due' | 'failed' | 'canceled'; reason: string | null;
  invoiceId: string | null; invoiceNumber: string | null; logicalChargeId: string | null; acceptedSubtotal: number; billable: boolean;
}
export interface BillingQueue {
  items: BillingQueueItem[]; total: number; page: number; pageSize: number; businessDate: string;
  summary: { dueSubscriptions: number; failedPeriods: number; canceledInvoices: number; notDueSubscriptions: number };
}
export type BillingRunStatus = 'queued' | 'running' | 'completed' | 'failed';
export interface BillingRun {
  id: string; number: string; status: BillingRunStatus; actorName: string; limit: number; subscriptionIds: string[] | null; retryOf: string | null;
  processed: number; created: number; alreadyExisting: number; nonbillable: number; failed: number; remainingDueSubscriptions: number;
  createdAt: string; startedAt: string | null; finishedAt: string | null; error: string | null;
}
export interface BillingRunItem {
  id: string; runId: string; position: number; subscriptionId: string; subscriptionNumber: string; customerName: string;
  periodStart: string; periodEnd: string; outcome: 'processing' | 'created' | 'alreadyExisting' | 'nonbillable' | 'failed';
  invoiceId: string | null; invoiceNumber: string | null; logicalChargeId: string | null; reason: string; retryable: boolean; createdAt: string; updatedAt: string;
}
export interface InvoiceReplacementPreview extends InvoicePreview {
  predecessorId: string; predecessorNumber: string; predecessorVersion: number; logicalChargeId: string; previewHash: string;
}

// POST /billing/runs returns 202 and a persisted queued/running run immediately. Poll GET
// /billing/runs/:id; paged GET /billing/runs/:id/items supplies actual row outcomes. Processing
// yields between short item transactions. Retry POST creates a new run for the original failed
// periods only. Remaining work is explicitly a subscription count, not an invented period count.
