import { z } from 'zod';
import { catalogDateSchema } from './catalog.js';
export const AI_QUOTE_MODEL = 'gpt-4.1-mini';
export const aiQuoteRequestSchema = z.object({ customerId: z.string().uuid(), request: z.string().trim().min(3).max(1000) }).strict();
export const aiQuoteProposalSchema = z.object({
  schema_version: z.literal('quote-proposal-v1'), template_id: z.string().uuid().nullable(), plan_id: z.string().uuid().nullable(),
  lines: z.array(z.object({ product_id: z.string().uuid(), variant_id: z.string().uuid().nullable(), quantity: z.number().int().min(1).max(10000) }).strict()).max(10),
  requested_start_date: catalogDateSchema.nullable(), clarifications: z.array(z.string().max(240)).max(5),
}).strict();
export type AiQuoteProposalFields = z.infer<typeof aiQuoteProposalSchema>;
export interface AiQuoteStatus { enabled: boolean; reason: string | null; model: typeof AI_QUOTE_MODEL; budget: { capUsd: string; committedUsd: string; remainingUsd: string }; disclosure: string }
export interface AiQuoteProposal {
  id: string; customerId: string; createdAt: string; expiresAt: string; proposal: AiQuoteProposalFields;
  labels: { plans: { id: string; name: string }[]; templates: { id: string; name: string }[]; products: { id: string; name: string; variants: { id: string; name: string }[] }[] };
}
export interface AiQuoteReview { proposalId: string; reviewHash: string }
// Internal only GET /api/ai/quote-assist -> AiQuoteStatus; POST /api/ai/quote-proposals
// with {customerId,request} -> AiQuoteProposal (201). One explicit request; no retry.
// The model sees only request text and allowlisted catalog IDs/names/eligibility,
// never customer identity, financial values, cost, notes or payment context.
// Apply proposed fields locally to the normal NEW Draft form. Nullable/unresolved
// fields require ordinary manual selection. No business record is created by AI.
// POST /subscriptions/preview accepts optional aiProposalId and returns aiReview.
// POST /subscriptions accepts aiProposalId + reviewHash together, in addition to
// ordinary fields/idempotencyKey. Each edited form needs a fresh preview/hash.
// Price/publication changes at save return409 AI_REVIEW_CHANGED; preserve form data,
// re-preview and explicitly review again. Existing create-key replay still wins.
// Actor/customer/15-minute expiry binding is enforced on preview and fresh save.
