import { z } from 'zod';
import type { SubscriptionPlanTerms, SubscriptionStage, SubscriptionServiceState } from './subscriptions.js';

const action = z.object({ version: z.number().int().positive(), idempotencyKey: z.string().uuid() }).strict();
export const lifecycleActionSchema = action;
export const lifecycleRenewSchema = action.extend({ periods: z.number().int().min(1).max(1_200) });
export const lifecycleAddonSchema = action.extend({ enabled: z.boolean() });
export const lifecycleProcessSchema = z.object({ limit: z.number().int().min(1).max(500).default(100) }).strict();
export type LifecycleAction = 'pause' | 'resume' | 'renew' | 'closeEarly' | 'closeTerm';
export interface LifecycleEvent {
  id: string; kind: 'pause' | 'resume' | 'closeEarly' | 'closeTerm' | 'renew' | 'expiry' | 'termEnded' | 'addonEnabled' | 'addonDisabled';
  actorName: string; requestedDate: string; effectiveDate: string; status: 'scheduled' | 'applied'; createdAt: string; appliedAt: string | null;
  lineId: string | null; enabled: boolean | null; previousExpiry: string | null; newExpiry: string | null; message: string;
}
export interface LifecycleAddon {
  lineId: string; productId: string; productName: string; quantity: number; unitPrice: number; primary: boolean; enabled: boolean;
  nextChange: { enabled: boolean; requestedDate: string; effectiveDate: string } | null;
  intervals: { from: string; to: string | null; enabled: boolean }[];
  canToggle: boolean; deniedReason: string | null;
}
export interface LifecycleState {
  subscriptionId: string; number: string; version: number; stage: SubscriptionStage; serviceState: SubscriptionServiceState;
  businessDate: string; startDate: string; expiryDate: string; closureCause: 'early' | 'expiry' | null; policies: SubscriptionPlanTerms;
  allowedActions: LifecycleAction[]; deniedReasons: Record<LifecycleAction, string | null>;
  actionEffectiveDates: { pause: string | null; resume: string | null; closeEarly: string | null; closeTerm: string | null };
  scheduled: LifecycleEvent[]; history: LifecycleEvent[]; addons: LifecycleAddon[];
  nextPeriod: { start: string; end: string; billable: boolean; reason: string | null; subtotal: number;
    lines: { lineId: string; productName: string; quantity: number; unitPrice: number; subtotal: number }[] } | null;
  estimateExplanation: string;
}
export interface LifecycleProcessResult {
  processed: number; paused: number; resumed: number; closed: number; termEnded: number; failed: number; remaining: number;
  items: { subscriptionId: string; number: string; outcome: string; message: string }[];
}
export interface NonbillablePeriod {
  outcome: 'nonbillable'; subscriptionId: string; logicalChargeId: string | null; periodStart: string; periodEnd: string; reason: string; previewOnly?: boolean;
}

// GET /subscriptions/:id/lifecycle is own-record safe. POST /:id/pause|resume|close-early|
// close-term uses {version,idempotencyKey}; /renew adds whole periods, /addons/:lineId adds
// enabled. Actions return LifecycleState. Customers may use only their own plan-permitted
// actions; close-term and POST /subscriptions/process-lifecycle are internal operations.
// nextPeriod reports accepted active line bases only, with no promise of future tax/discount.
