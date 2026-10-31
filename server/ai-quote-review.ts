import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { SubscriptionPreview } from '../shared/subscriptions.js';
import type { AiQuoteReview } from '../shared/ai-quote.js';
import { DomainError } from './errors.js';
import { digest } from './security.js';

export function aiPreviewHash(preview: SubscriptionPreview): string {
  const stable = { ...preview, terms: { ...preview.terms, lines: preview.terms.lines.map(({ id: _id, ...line }) => line) } };
  return digest(JSON.stringify(stable));
}
/** Caller owns the preview/create transaction; ordinary create replay runs first. */
export function guardAiQuoteReview(db: DatabaseSync, actorId: string, input: { customerId: string; aiProposalId?: string; reviewHash?: string }, preview: SubscriptionPreview, now: Date, saving: boolean): AiQuoteReview | undefined {
  if (!input.aiProposalId) {
    if (input.reviewHash) throw new DomainError(400, 'AI_PROPOSAL_REQUIRED', 'Choose the original proposal or continue manually without AI review fields.');
    return undefined;
  }
  const proposal = db.prepare('SELECT actor_id,customer_id,expires_at FROM ai_quote_proposals WHERE id=?').get(input.aiProposalId) as { actor_id: string; customer_id: string; expires_at: string } | undefined;
  if (!proposal || proposal.actor_id !== actorId || proposal.customer_id !== input.customerId) throw new DomainError(403, 'AI_PROPOSAL_BINDING', 'This proposal belongs to a different user or customer. Continue manually or request a fresh suggestion.');
  if (proposal.expires_at <= now.toISOString()) throw new DomainError(409, 'AI_PROPOSAL_EXPIRED', 'This suggestion expired. Continue manually or request a fresh suggestion.');
  const previewHash = aiPreviewHash(preview);
  if (saving) {
    const review = input.reviewHash && db.prepare('SELECT * FROM ai_quote_reviews WHERE review_hash=?').get(input.reviewHash) as { proposal_id: string; actor_id: string; customer_id: string; preview_hash: string; expires_at: string } | undefined;
    if (!review || review.proposal_id !== input.aiProposalId || review.actor_id !== actorId || review.customer_id !== input.customerId || review.expires_at <= now.toISOString() || review.preview_hash !== previewHash) throw new DomainError(409, 'AI_REVIEW_CHANGED', 'The quotation changed since review. Preview again and explicitly review the current terms before saving.');
    return { proposalId: input.aiProposalId, reviewHash: input.reviewHash! };
  }
  const reviewHash = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO ai_quote_reviews VALUES(?,?,?,?,?,?,?)').run(reviewHash, input.aiProposalId, actorId, input.customerId, previewHash, now.toISOString(), proposal.expires_at);
  return { proposalId: input.aiProposalId, reviewHash };
}
