import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { z } from 'zod';
import {
  discountInputSchema, discountUpdateSchema, invoiceGenerateSchema, invoicePreviewSchema, invoiceActionSchema, invoiceStatuses,
  type DiscountInput, type DiscountRule, type DiscountDecision, type Invoice, type InvoiceLine, type InvoicePreview,
  type InvoiceDiscountSnapshot, type InvoiceSummary, type InvoiceStatus, type InvoiceGenerateInput,
} from '../shared/billing.js';
import type { SubscriptionTerms, SubscriptionLine } from '../shared/subscriptions.js';
import type { User } from '../shared/contracts.js';
import { transaction } from './database.js';
import { DomainError } from './errors.js';
import { audit, digest, requireRole } from './security.js';
import { businessDate, periodBoundary, periodIndex, addDays } from './calendar.js';
import { checkedMinor, multiplyMinor, sumMinor, taxMinor, discountMinor, allocateMinor } from './money.js';
import { nextReference } from './subscriptions.js';
import { invoiceReplacementPreviewSchema, invoiceReplacementSchema, type InvoiceReplacementPreview } from '../shared/billing-workbench.js';

interface DiscountRow {
  id: string; name: string; kind: 'fixed' | 'percentage'; amount_minor: number | null; percent_bps: number | null;
  min_amount: number | null; min_quantity: number | null; start_date: string | null; end_date: string | null; max_uses: number | null;
  priority: number; active: number; scope: 'subscription' | 'products'; subscription_id: string | null; version: number;
  created_at: string; updated_at: string; reserved: number; consumed: number; subscription_number: string | null;
}
interface SourceRow {
  id: string; number: string; customer_id: string; customer_name: string; customer_email: string; start_date: string; expiry_date: string;
  accepted_terms_json: string | null; stage: string; service_state: string; next_period_index: number; payment_term_days: number;
}
interface ChargeRow { id: string; subscription_id: string; period_start: string; period_end: string; outcome: string; reason: string | null; current_invoice_id: string | null }
interface InvoiceRow {
  id: string; number: string; logical_charge_id: string; revision_number: number; predecessor_id: string | null; subscription_id: string; subscription_number: string;
  customer_id: string; customer_name: string; customer_email: string; period_start: string; period_end: string; issue_date: string; due_date: string;
  currency: 'INR'; status: InvoiceStatus; subtotal: number; discount: number; tax: number; total: number; amount_paid: number; payment_count: number;
  discount_snapshot_json: string | null; discount_reason: string; discount_decisions_json: string; discount_decisions_truncated: number;
  version: number; created_at: string; confirmed_at: string | null; canceled_at: string | null; settled_at: string | null; settlement_reason: string | null;
}
interface TaxRow { id: string; name: string; version: number; product_id: string | null; rate_bps: number; priority: number }
interface PriceLine { source: SubscriptionLine; base: number }
export interface DiscountSelection {
  rule: DiscountRow | null; snapshot: InvoiceDiscountSnapshot | null; allocations: Map<string, number>;
  decisions: DiscountDecision[]; truncated: boolean; reason: string;
}
export interface GenerationResult { invoiceId: string; logicalChargeId: string; created: boolean }
export interface GenerationOptions {
  failpoint?: (point: 'after-reservation' | 'before-commit') => void;
  onResult?: (result: GenerationResult) => void;
}
const idSchema = z.string().uuid('Select an existing record.');
const pageShape = { q: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).max(1_000_000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) };
const discountListSchema = z.object({ ...pageShape, active: z.enum(['true', 'false']).optional() }).strict();
const invoiceListSchema = z.object({ ...pageShape, status: z.enum(invoiceStatuses).optional(), customerId: idSchema.optional(), subscriptionId: idSchema.optional(), overdue: z.enum(['true', 'false']).optional() }).strict();
const placeholders = (ids: unknown[]) => ids.map(() => '?').join(',');
const usageJoin = `LEFT JOIN (SELECT rule_id,sum(CASE WHEN state='reserved' THEN 1 ELSE 0 END) AS reserved,sum(CASE WHEN state='consumed' THEN 1 ELSE 0 END) AS consumed FROM discount_applications GROUP BY rule_id) u ON u.rule_id=d.id`;
const discountSelect = `SELECT d.*,coalesce(u.reserved,0) AS reserved,coalesce(u.consumed,0) AS consumed,s.number AS subscription_number FROM discount_rules d ${usageJoin} LEFT JOIN subscriptions s ON s.id=d.subscription_id`;
function notFound(label: string): never { throw new DomainError(404, 'NOT_FOUND', `${label} was not found or is unavailable to your account.`); }
function internalActor(db: DatabaseSync, actorId: string) {
  const user = db.prepare('SELECT role FROM users WHERE id=?').get(actorId);
  if (!user || !['admin', 'staff'].includes(String(user.role))) throw new DomainError(403, 'FORBIDDEN', 'Your account cannot manage invoices.');
}
function rowInvoice(db: DatabaseSync, id: string, user?: User): InvoiceRow {
  const row = user?.role === 'customer'
    ? db.prepare('SELECT * FROM invoices WHERE id=? AND customer_id=?').get(id, user.id)
    : db.prepare('SELECT * FROM invoices WHERE id=?').get(id);
  return row as unknown as InvoiceRow || notFound('Invoice');
}
function versionMatches(row: { version: number }, version: number) {
  if (row.version !== version) throw new DomainError(409, 'VERSION_CONFLICT', 'This record changed after you opened it. Reload before trying again. Your entered values have not been applied.');
}
function discountTargets(db: DatabaseSync, ruleIds: string[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  if (!ruleIds.length) return result;
  const rows = db.prepare(`SELECT rule_id,product_id FROM discount_targets WHERE rule_id IN (${placeholders(ruleIds)}) ORDER BY product_id`).all(...ruleIds) as { rule_id: string; product_id: string }[];
  for (const row of rows) { const values = result.get(row.rule_id) || []; values.push(row.product_id); result.set(row.rule_id, values); }
  return result;
}
function loadDiscounts(db: DatabaseSync, ids: string[], holdingDrafts = false): DiscountRule[] {
  if (!ids.length) return [];
  const rows = db.prepare(`${discountSelect} WHERE d.id IN (${placeholders(ids)})`).all(...ids) as unknown as DiscountRow[];
  const byId = new Map(rows.map(row => [row.id, row])); const targets = discountTargets(db, ids);
  return ids.filter(id => byId.has(id)).map(id => {
    const row = byId.get(id)!;
    const draftRows = holdingDrafts ? db.prepare("SELECT i.id,i.number,i.created_at AS createdAt FROM discount_applications a JOIN invoices i ON i.id=a.invoice_id WHERE a.rule_id=? AND a.state='reserved' ORDER BY i.created_at,i.id LIMIT 100").all(id) as { id: string; number: string; createdAt: string }[] : undefined;
    return {
      id: row.id, name: row.name, kind: row.kind, amountMinor: row.amount_minor, percentBps: row.percent_bps,
      minAmount: row.min_amount, minQuantity: row.min_quantity, startDate: row.start_date, endDate: row.end_date, maxUses: row.max_uses,
      priority: row.priority, active: Boolean(row.active), scope: row.scope, subscriptionId: row.subscription_id, subscriptionNumber: row.subscription_number,
      productIds: targets.get(id) || [], version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
      reserved: row.reserved, consumed: row.consumed, remaining: row.max_uses === null ? null : row.max_uses - row.reserved - row.consumed,
      holdingDraftsTotal: row.reserved, ...(draftRows ? { holdingDrafts: draftRows, holdingDraftsTruncated: row.reserved > draftRows.length } : {}),
    };
  });
}
function validateDiscountReferences(db: DatabaseSync, input: DiscountInput) {
  if (input.subscriptionId && !db.prepare('SELECT id FROM subscriptions WHERE id=?').get(input.subscriptionId)) throw new DomainError(400, 'SUBSCRIPTION_NOT_FOUND', 'Select an existing subscription target.', { subscriptionId: 'This subscription no longer exists.' });
  if (input.productIds.length) {
    const count = Number(db.prepare(`SELECT count(*) AS count FROM products WHERE id IN (${placeholders(input.productIds)})`).get(...input.productIds)?.count);
    if (count !== input.productIds.length) throw new DomainError(400, 'PRODUCT_NOT_FOUND', 'Select existing product targets.', { productIds: 'One or more selected products no longer exist.' });
  }
}

/** Caller holds a read snapshot for advisory preview, or an immediate write transaction for reservation. */
export function selectDiscount(db: DatabaseSync, subscriptionId: string, lines: PriceLine[], date: string): DiscountSelection {
  const rows = db.prepare(`${discountSelect} ORDER BY d.priority,d.id`).all() as unknown as DiscountRow[];
  const targets = discountTargets(db, rows.map(row => row.id));
  const decisions: DiscountDecision[] = [];
  let selected: DiscountRow | null = null; let snapshot: InvoiceDiscountSnapshot | null = null; let allocations = new Map<string, number>();
  for (const row of rows) {
    const productIds = targets.get(row.id) || [];
    const eligibleLines = row.scope === 'subscription' ? lines : lines.filter(line => productIds.includes(line.source.productId));
    const eligibleBase = sumMinor(eligibleLines.map(line => line.base)); const eligibleQuantity = eligibleLines.reduce((sum, line) => sum + line.source.quantity, 0);
    let reason: string; let eligible = false;
    if (!row.active) reason = 'Rule is disabled.';
    else if (row.subscription_id && row.subscription_id !== subscriptionId) reason = 'Targets a different subscription.';
    else if (row.start_date && date < row.start_date) reason = `Not yet valid; starts ${row.start_date}.`;
    else if (row.end_date && date > row.end_date) reason = `Expired after ${row.end_date}.`;
    else if (!eligibleLines.length) reason = 'None of the targeted products appear on this invoice.';
    else if (row.min_amount !== null && eligibleBase < row.min_amount) reason = 'Eligible pre-tax amount is below the minimum purchase.';
    else if (row.min_quantity !== null && eligibleQuantity < row.min_quantity) reason = 'Eligible product quantity is below the minimum quantity.';
    else if (row.max_uses !== null && row.reserved + row.consumed >= row.max_uses) reason = 'Usage limit is exhausted by reserved or consumed applications.';
    else {
      eligible = true;
      if (selected) reason = 'Eligible, but a higher-priority rule was selected. Discounts do not stack.';
      else {
        selected = row; const amount = discountMinor(eligibleBase, row.kind, row.kind === 'fixed' ? row.amount_minor! : row.percent_bps!);
        allocations = allocateMinor(amount, eligibleLines.map(line => ({ id: line.source.id, base: line.base })));
        reason = 'Selected automatically by administrator priority and stable rule ID.';
        snapshot = { id: row.id, name: row.name, version: row.version, kind: row.kind, amountMinor: row.amount_minor, percentBps: row.percent_bps,
          scope: row.scope, productIds, eligibleBase, eligibleQuantity, amount, eligibilityDate: date,
          minAmount: row.min_amount, minQuantity: row.min_quantity, startDate: row.start_date, endDate: row.end_date,
          maxUses: row.max_uses, priority: row.priority, subscriptionId: row.subscription_id,
          explanation: 'Eligibility and the rule version were saved at invoice generation. One application belongs to this invoice; exclusive tax follows the allocated discount.' };
      }
    }
    if (decisions.length < 50) decisions.push({ ruleId: row.id, ruleName: row.name, eligible, reason });
  }
  return { rule: selected, snapshot, allocations, decisions, truncated: rows.length > 50,
    reason: snapshot ? `${snapshot.name} was selected automatically under its generation-date eligibility.` : 'No eligible discount was available when this invoice was generated.' };
}

function sourcePeriod(db: DatabaseSync, subscriptionId: string, expectedStart: string, now: Date) {
  const source = db.prepare('SELECT * FROM subscriptions WHERE id=?').get(subscriptionId) as unknown as SourceRow | undefined;
  if (!source) return notFound('Subscription');
  if (!source.accepted_terms_json) throw new DomainError(409, 'AGREEMENT_NOT_CONFIRMED', 'Confirm the quotation before generating invoices. Drafts and quotations are not billable.');
  const terms = JSON.parse(source.accepted_terms_json) as SubscriptionTerms;
  const index = periodIndex(source.start_date, terms.plan.interval, expectedStart);
  const end = periodBoundary(source.start_date, terms.plan.interval, index + 1);
  const charge = db.prepare("SELECT * FROM logical_charges WHERE subscription_id=? AND period_start=? AND period_end=? AND kind='recurring'").get(source.id, expectedStart, end) as unknown as ChargeRow | undefined;
  if (charge?.current_invoice_id) return { source, terms, index, start: expectedStart, end, charge, existing: rowInvoice(db, charge.current_invoice_id) };
  if (charge?.outcome === 'nonbillable') throw new DomainError(409, 'NON_BILLABLE_PERIOD', charge.reason || 'This period was explicitly recorded as non-billable.');
  if (index !== source.next_period_index) throw new DomainError(409, 'PERIOD_ORDER', 'Generate the oldest outstanding scheduled period first. Refresh the subscription to see its current next billing date.');
  if (expectedStart >= source.expiry_date || end > source.expiry_date) throw new DomainError(400, 'TERM_ENDED', 'No service period starts at or after the exclusive expiry boundary.');
  if (expectedStart > businessDate(now)) throw new DomainError(400, 'NOT_DUE', `This service period is not due until ${expectedStart}.`);
  return { source, terms, index, start: expectedStart, end, charge, existing: null };
}
function makePreview(db: DatabaseSync, period: ReturnType<typeof sourcePeriod>, now: Date): InvoicePreview {
  if (period.existing) {
    const row = period.existing;
    return { subscriptionId: row.subscription_id, subscriptionNumber: row.subscription_number, customerId: row.customer_id, customerName: row.customer_name, customerEmail: row.customer_email,
      periodStart: row.period_start, periodEnd: row.period_end, issueDate: row.issue_date, dueDate: row.due_date, currency: row.currency,
      lines: invoiceLines(db, row.id), subtotal: row.subtotal, discount: row.discount, tax: row.tax, total: row.total,
      discountSnapshot: row.discount_snapshot_json ? JSON.parse(row.discount_snapshot_json) as InvoiceDiscountSnapshot : null, discountReason: row.discount_reason,
      discountDecisions: JSON.parse(row.discount_decisions_json) as DiscountDecision[], discountDecisionsTruncated: Boolean(row.discount_decisions_truncated),
      existingInvoiceId: row.id, existingInvoiceNumber: row.number, previewOnly: true };
  }
  const date = businessDate(now);
  const pricing: PriceLine[] = period.terms.lines.map(source => {
    if (checkedMinor(BigInt(source.baseUnitPrice) + BigInt(source.variantAdjustment)) !== source.unitPrice) throw new DomainError(400, 'INVALID_ACCEPTED_TERMS', 'The accepted price snapshot is inconsistent. Review this agreement before billing.');
    return { source, base: multiplyMinor(source.unitPrice, source.quantity) };
  });
  const selected = selectDiscount(db, period.source.id, pricing, date);
  const taxes = db.prepare('SELECT id,name,version,product_id,rate_bps,priority FROM tax_rules WHERE active=1 ORDER BY priority,CASE WHEN product_id IS NULL THEN 1 ELSE 0 END,id').all() as unknown as TaxRow[];
  const lines: InvoiceLine[] = pricing.map(({ source, base }) => {
    const discount = selected.allocations.get(source.id) || 0; const taxableAmount = base - discount;
    const tax = taxes.find(rule => rule.product_id === source.productId || rule.product_id === null);
    const taxAmount = taxMinor(taxableAmount, tax?.rate_bps || 0);
    return { id: randomUUID(), subscriptionLineId: source.id, productId: source.productId, productName: source.productName, variantId: source.variantId, variantName: source.variantName,
      quantity: source.quantity, baseUnitPrice: source.baseUnitPrice, variantAdjustment: source.variantAdjustment, unitPrice: source.unitPrice, subtotal: base,
      discount, taxableAmount, taxRuleId: tax?.id || null, taxRuleName: tax?.name || null, taxRuleVersion: tax?.version || null, taxRateBps: tax?.rate_bps || 0,
      tax: taxAmount, total: sumMinor([taxableAmount, taxAmount]) };
  });
  return { subscriptionId: period.source.id, subscriptionNumber: period.source.number, customerId: period.source.customer_id, customerName: period.source.customer_name, customerEmail: period.source.customer_email,
    periodStart: period.start, periodEnd: period.end, issueDate: date, dueDate: addDays(date, period.source.payment_term_days), currency: 'INR', lines,
    subtotal: sumMinor(lines.map(line => line.subtotal)), discount: sumMinor(lines.map(line => line.discount)), tax: sumMinor(lines.map(line => line.tax)), total: sumMinor(lines.map(line => line.total)),
    discountSnapshot: selected.snapshot, discountReason: selected.reason, discountDecisions: selected.decisions, discountDecisionsTruncated: selected.truncated,
    existingInvoiceId: null, existingInvoiceNumber: null, previewOnly: true };
}
export function previewInvoice(db: DatabaseSync, subscriptionId: string, expectedPeriodStart: string, now: Date): InvoicePreview {
  return transaction(db, () => makePreview(db, sourcePeriod(db, subscriptionId, expectedPeriodStart, now), now), 'read');
}
function invoiceLines(db: DatabaseSync, invoiceId: string): InvoiceLine[] {
  return db.prepare(`SELECT id,subscription_line_id AS subscriptionLineId,product_id AS productId,product_name AS productName,variant_id AS variantId,variant_name AS variantName,
    quantity,base_unit_price AS baseUnitPrice,variant_adjustment AS variantAdjustment,unit_price AS unitPrice,subtotal,discount,taxable_amount AS taxableAmount,
    tax_rule_id AS taxRuleId,tax_rule_name AS taxRuleName,tax_rule_version AS taxRuleVersion,tax_rate_bps AS taxRateBps,tax,total FROM invoice_lines WHERE invoice_id=? ORDER BY position`).all(invoiceId) as unknown as InvoiceLine[];
}
function invoiceSummary(row: InvoiceRow, now: Date): InvoiceSummary {
  const outstanding = row.status === 'Canceled' ? 0 : row.total - row.amount_paid;
  return { id: row.id, number: row.number, logicalChargeId: row.logical_charge_id, revisionNumber: row.revision_number, predecessorId: row.predecessor_id,
    subscriptionId: row.subscription_id, subscriptionNumber: row.subscription_number, customerId: row.customer_id, customerName: row.customer_name, customerEmail: row.customer_email,
    periodStart: row.period_start, periodEnd: row.period_end, issueDate: row.issue_date, dueDate: row.due_date, currency: row.currency, status: row.status,
    subtotal: row.subtotal, discount: row.discount, tax: row.tax, total: row.total, amountPaid: row.amount_paid, outstanding, paymentCount: row.payment_count,
    overdue: row.status === 'Confirmed' && outstanding > 0 && row.due_date < businessDate(now), version: row.version, createdAt: row.created_at,
    confirmedAt: row.confirmed_at, canceledAt: row.canceled_at, settledAt: row.settled_at, settlementReason: row.settlement_reason };
}
export function serializeInvoice(db: DatabaseSync, id: string, user: User, now: Date): Invoice {
  const row = rowInvoice(db, id, user);
  const current = db.prepare('SELECT i.id,i.number FROM logical_charges c JOIN invoices i ON i.id=c.current_invoice_id WHERE c.id=?').get(row.logical_charge_id) as { id: string; number: string };
  const application = db.prepare('SELECT state FROM discount_applications WHERE invoice_id=?').get(id) as { state: 'reserved' | 'consumed' | 'released' } | undefined;
  const history = db.prepare(`SELECT h.id,h.kind,coalesce(u.name,'System') AS actorName,h.created_at AS at,h.from_status AS fromStatus,h.to_status AS toStatus,h.message
    FROM invoice_history h LEFT JOIN users u ON u.id=h.actor_id WHERE invoice_id=? ORDER BY h.rowid`).all(id) as unknown as Invoice['history'];
  const allowedActions: Invoice['allowedActions'] = [];
  if (user.role !== 'customer') {
    if (row.status === 'Draft') allowedActions.push('confirm', 'cancel');
    else if (row.status === 'Confirmed' && !row.payment_count && !row.amount_paid) allowedActions.push('cancel');
    else if (row.status === 'Canceled' && current.id === row.id && !row.payment_count && !row.amount_paid) allowedActions.push('replace');
  }
  return { ...invoiceSummary(row, now), currentInvoiceId: current.id, currentInvoiceNumber: current.number, lines: invoiceLines(db, id), discountSnapshot: row.discount_snapshot_json ? JSON.parse(row.discount_snapshot_json) as InvoiceDiscountSnapshot : null,
    discountReason: row.discount_reason, discountApplicationState: application?.state || null,
    ...(user.role !== 'customer' ? { discountDecisions: JSON.parse(row.discount_decisions_json) as DiscountDecision[], discountDecisionsTruncated: Boolean(row.discount_decisions_truncated) } : {}),
    history, businessDate: businessDate(now), allowedActions };
}
function invoiceHistory(db: DatabaseSync, invoiceId: string, actorId: string, kind: string, from: InvoiceStatus | null, to: InvoiceStatus, now: Date, message: string, version: number | null = null) {
  db.prepare('INSERT INTO invoice_history(id,invoice_id,actor_id,kind,created_at,from_status,to_status,message,request_version) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(), invoiceId, actorId, kind, now.toISOString(), from, to, message, version);
  audit(db, actorId, `invoice.${kind}`, invoiceId, now, { fromStatus: from, toStatus: to });
}

function persistDraft(db: DatabaseSync, source: SourceRow, chargeId: string, preview: InvoicePreview, actorId: string, now: Date, revision = 1, predecessorId: string | null = null): string {
  const invoiceId = randomUUID(); const number = nextReference(db, 'invoice', 'INV');
  db.prepare(`INSERT INTO invoices(id,number,logical_charge_id,revision_number,predecessor_id,subscription_id,subscription_number,customer_id,customer_name,customer_email,
    period_start,period_end,issue_date,due_date,currency,status,subtotal,discount,tax,total,amount_paid,payment_count,discount_snapshot_json,discount_reason,discount_decisions_json,discount_decisions_truncated,version,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'INR','Draft',?,?,?,?,0,0,?,?,?,?,1,?)`)
    .run(invoiceId, number, chargeId, revision, predecessorId, source.id, source.number, source.customer_id, source.customer_name, source.customer_email,
      preview.periodStart, preview.periodEnd, preview.issueDate, preview.dueDate, preview.subtotal, preview.discount, preview.tax, preview.total,
      preview.discountSnapshot ? JSON.stringify(preview.discountSnapshot) : null, preview.discountReason, JSON.stringify(preview.discountDecisions || []), Number(preview.discountDecisionsTruncated), now.toISOString());
  const insertLine = db.prepare(`INSERT INTO invoice_lines(id,invoice_id,position,subscription_line_id,product_id,product_name,variant_id,variant_name,quantity,base_unit_price,variant_adjustment,unit_price,subtotal,discount,taxable_amount,tax_rule_id,tax_rule_name,tax_rule_version,tax_rate_bps,tax,total)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  preview.lines.forEach((line, position) => insertLine.run(line.id, invoiceId, position, line.subscriptionLineId, line.productId, line.productName, line.variantId, line.variantName, line.quantity,
    line.baseUnitPrice, line.variantAdjustment, line.unitPrice, line.subtotal, line.discount, line.taxableAmount, line.taxRuleId, line.taxRuleName, line.taxRuleVersion, line.taxRateBps, line.tax, line.total));
  if (preview.discountSnapshot) db.prepare("INSERT INTO discount_applications(id,rule_id,invoice_id,rule_version,state,amount,created_at) VALUES(?,?,?,?,'reserved',?,?)")
    .run(randomUUID(), preview.discountSnapshot.id, invoiceId, preview.discountSnapshot.version, preview.discount, now.toISOString());
  invoiceHistory(db, invoiceId, actorId, 'generated', null, 'Draft', now, predecessorId ? 'Replacement Draft generated under current tax and discount eligibility; prior canceled revision remains immutable.' : 'Draft generated from accepted agreement prices. Taxes, discount eligibility and all amounts are frozen.');
  return invoiceId;
}

export function generateInvoice(db: DatabaseSync, subscriptionId: string, input: InvoiceGenerateInput, actorId: string, now: Date, options: GenerationOptions = {}): GenerationResult {
  const validated = invoiceGenerateSchema.parse(input); internalActor(db, actorId);
  const payloadHash = digest(JSON.stringify([subscriptionId, validated.expectedPeriodStart]));
  return transaction(db, () => {
    const finish = (result: GenerationResult) => { options.onResult?.(result); return result; };
    const receipt = db.prepare('SELECT actor_id,payload_hash,logical_charge_id FROM invoice_generation_requests WHERE idempotency_key=?').get(validated.idempotencyKey) as { actor_id: string; payload_hash: string; logical_charge_id: string } | undefined;
    if (receipt) {
      if (receipt.actor_id !== actorId || receipt.payload_hash !== payloadHash) throw new DomainError(409, 'IDEMPOTENCY_CONFLICT', 'This submission key was already used for a different invoice request. Review the current period before starting a new request.');
      const charge = db.prepare('SELECT current_invoice_id FROM logical_charges WHERE id=?').get(receipt.logical_charge_id);
      if (!charge?.current_invoice_id) throw new DomainError(409, 'CHARGE_EXCEPTION', 'This charge has no current invoice. Review its billing outcome before retrying.');
      return finish({ invoiceId: String(charge.current_invoice_id), logicalChargeId: receipt.logical_charge_id, created: false });
    }
    const period = sourcePeriod(db, subscriptionId, validated.expectedPeriodStart, now);
    if (period.existing) {
      db.prepare('INSERT INTO invoice_generation_requests(idempotency_key,actor_id,payload_hash,logical_charge_id,created_at) VALUES(?,?,?,?,?)').run(validated.idempotencyKey, actorId, payloadHash, period.existing.logical_charge_id, now.toISOString());
      return finish({ invoiceId: period.existing.id, logicalChargeId: period.existing.logical_charge_id, created: false });
    }
    const preview = makePreview(db, period, now); const chargeId = period.charge?.id || randomUUID();
    if (!period.charge) db.prepare("INSERT INTO logical_charges(id,subscription_id,period_start,period_end,kind,outcome,reason,current_invoice_id,created_at,updated_at) VALUES(?,?,?,?,'recurring','failed',?,NULL,?,?)")
      .run(chargeId, subscriptionId, period.start, period.end, 'Generation has not committed.', now.toISOString(), now.toISOString());
    const invoiceId = persistDraft(db, period.source, chargeId, preview, actorId, now);
    options.failpoint?.('after-reservation');
    db.prepare("UPDATE logical_charges SET outcome='invoiced',reason=NULL,current_invoice_id=?,updated_at=? WHERE id=?").run(invoiceId, now.toISOString(), chargeId);
    const nextDate = period.end < period.source.expiry_date ? period.end : null;
    db.prepare('UPDATE subscriptions SET next_period_index=next_period_index+1,next_billing_date=?,version=version+1,updated_at=? WHERE id=?').run(nextDate, now.toISOString(), subscriptionId);
    db.prepare('INSERT INTO invoice_generation_requests(idempotency_key,actor_id,payload_hash,logical_charge_id,created_at) VALUES(?,?,?,?,?)').run(validated.idempotencyKey, actorId, payloadHash, chargeId, now.toISOString());
    options.failpoint?.('before-commit');
    return finish({ invoiceId, logicalChargeId: chargeId, created: true });
  });
}

export function confirmInvoice(db: DatabaseSync, invoiceId: string, version: number, actorId: string, now: Date): void {
  internalActor(db, actorId);
  transaction(db, () => {
    const row = rowInvoice(db, invoiceId);
    const replay = db.prepare("SELECT 1 FROM invoice_history WHERE invoice_id=? AND kind='confirmed' AND request_version=?").get(invoiceId, version);
    if (replay || row.status === 'Confirmed' || row.status === 'Paid') return;
    versionMatches(row, version);
    if (row.status !== 'Draft') throw new DomainError(409, 'INVALID_TRANSITION', 'Only a Draft invoice can be confirmed. A canceled invoice requires an explicit replacement.');
    const application = db.prepare('SELECT id,state FROM discount_applications WHERE invoice_id=?').get(invoiceId) as { id: string; state: string } | undefined;
    if (application && application.state !== 'reserved') throw new DomainError(409, 'DISCOUNT_RESERVATION', 'This invoice’s discount reservation is not available. Review its billing history.');
    if (application) db.prepare("UPDATE discount_applications SET state='consumed',consumed_at=? WHERE id=?").run(now.toISOString(), application.id);
    const status = row.total === 0 ? 'Paid' : 'Confirmed';
    db.prepare('UPDATE invoices SET status=?,confirmed_at=?,settled_at=?,settlement_reason=?,version=version+1 WHERE id=?')
      .run(status, now.toISOString(), status === 'Paid' ? now.toISOString() : null, status === 'Paid' ? 'zero amount due' : null, invoiceId);
    invoiceHistory(db, invoiceId, actorId, 'confirmed', 'Draft', status, now, 'Invoice confirmed at its saved financial snapshot. Any reserved discount application was consumed once.', version);
    if (status === 'Paid') invoiceHistory(db, invoiceId, actorId, 'settled', 'Paid', 'Paid', now, 'Settled because zero amount is due. No payment was created.');
  });
}
export function cancelInvoice(db: DatabaseSync, invoiceId: string, version: number, actorId: string, now: Date): void {
  internalActor(db, actorId);
  transaction(db, () => {
    const row = rowInvoice(db, invoiceId);
    if (row.status === 'Canceled') return;
    versionMatches(row, version);
    if (!['Draft', 'Confirmed'].includes(row.status) || row.payment_count > 0 || row.amount_paid > 0) throw new DomainError(409, 'CANNOT_CANCEL', 'Cancel only a Draft or Confirmed invoice with no payment ever recorded. Paid invoices cannot be canceled.');
    if (row.status === 'Draft') db.prepare("UPDATE discount_applications SET state='released',released_at=? WHERE invoice_id=? AND state='reserved'").run(now.toISOString(), invoiceId);
    db.prepare("UPDATE invoices SET status='Canceled',canceled_at=?,version=version+1 WHERE id=?").run(now.toISOString(), invoiceId);
    invoiceHistory(db, invoiceId, actorId, 'canceled', row.status, 'Canceled', now, row.status === 'Draft' ? 'Draft canceled. Any reserved discount use was released; the logical period remains occupied.' : 'Unpaid Confirmed invoice canceled. Any consumed discount use is retained; the logical period remains occupied.', version);
  });
}

function replacementPeriod(db: DatabaseSync, invoiceId: string, version: number, now: Date) {
  const predecessor = rowInvoice(db, invoiceId); versionMatches(predecessor, version);
  const charge = db.prepare('SELECT * FROM logical_charges WHERE id=?').get(predecessor.logical_charge_id) as unknown as ChargeRow;
  if (charge.current_invoice_id !== predecessor.id) throw new DomainError(409, 'NOT_CURRENT_REVISION', 'This revision was already replaced. Open the current linked invoice.');
  if (predecessor.status !== 'Canceled' || predecessor.amount_paid || predecessor.payment_count) throw new DomainError(409, 'CANNOT_REPLACE', 'Replace only the current Canceled invoice with no payment ever recorded.');
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='payments'").get() && Number(db.prepare('SELECT count(*) AS count FROM payments WHERE invoice_id=?').get(invoiceId)?.count)) throw new DomainError(409, 'CANNOT_REPLACE', 'A payment was recorded against this invoice. It cannot be replaced.');
  const source = db.prepare('SELECT * FROM subscriptions WHERE id=?').get(predecessor.subscription_id) as unknown as SourceRow;
  if (!source.accepted_terms_json) throw new DomainError(409, 'AGREEMENT_NOT_CONFIRMED', 'This invoice has no accepted agreement snapshot.');
  const terms = JSON.parse(source.accepted_terms_json) as SubscriptionTerms;
  const index = periodIndex(source.start_date, terms.plan.interval, predecessor.period_start);
  if (periodBoundary(source.start_date, terms.plan.interval, index + 1) !== predecessor.period_end) throw new DomainError(409, 'INVALID_PERIOD', 'The saved invoice period does not match its accepted calendar schedule.');
  if (predecessor.period_start > businessDate(now)) throw new DomainError(400, 'NOT_DUE', 'This invoice period has not started.');
  return { predecessor, source, terms, index, start: predecessor.period_start, end: predecessor.period_end, charge, existing: null };
}
function replacementHash(predecessor: InvoiceRow, preview: InvoicePreview): string {
  return digest(JSON.stringify({ predecessorId: predecessor.id, version: predecessor.version, periodStart: preview.periodStart, periodEnd: preview.periodEnd,
    issueDate: preview.issueDate, dueDate: preview.dueDate, subtotal: preview.subtotal, discount: preview.discount, tax: preview.tax, total: preview.total,
    discountSnapshot: preview.discountSnapshot, lines: preview.lines.map(line => Object.fromEntries(Object.entries(line).filter(([key]) => key !== 'id'))) }));
}
export function previewInvoiceReplacement(db: DatabaseSync, invoiceId: string, version: number, now: Date): InvoiceReplacementPreview {
  return transaction(db, () => {
    const period = replacementPeriod(db, invoiceId, version, now); const preview = makePreview(db, period, now);
    return { ...preview, predecessorId: period.predecessor.id, predecessorNumber: period.predecessor.number, predecessorVersion: period.predecessor.version,
      logicalChargeId: period.charge.id, previewHash: replacementHash(period.predecessor, preview) };
  }, 'read');
}
export function replaceInvoice(db: DatabaseSync, invoiceId: string, input: z.infer<typeof invoiceReplacementSchema>, actorId: string, now: Date): GenerationResult {
  const validated = invoiceReplacementSchema.parse(input); internalActor(db, actorId);
  const payloadHash = digest(JSON.stringify([invoiceId, validated.version, validated.previewHash]));
  return transaction(db, () => {
    const receipt = db.prepare('SELECT actor_id,payload_hash,logical_charge_id FROM invoice_replacement_requests WHERE idempotency_key=?').get(validated.idempotencyKey) as { actor_id: string; payload_hash: string; logical_charge_id: string } | undefined;
    if (receipt) {
      if (receipt.actor_id !== actorId || receipt.payload_hash !== payloadHash) throw new DomainError(409, 'IDEMPOTENCY_CONFLICT', 'This replacement submission key was already used for different inputs.');
      const charge = db.prepare('SELECT current_invoice_id FROM logical_charges WHERE id=?').get(receipt.logical_charge_id);
      if (!charge?.current_invoice_id) throw new DomainError(409, 'CHARGE_EXCEPTION', 'This logical charge has no current revision. Review its billing history.');
      return { invoiceId: String(charge.current_invoice_id), logicalChargeId: receipt.logical_charge_id, created: false };
    }
    const period = replacementPeriod(db, invoiceId, validated.version, now); const preview = makePreview(db, period, now);
    if (replacementHash(period.predecessor, preview) !== validated.previewHash) throw new DomainError(409, 'PREVIEW_CHANGED', 'Tax or discount eligibility changed after the preview. Review a fresh replacement before continuing.', { previewHash: 'Review the updated financial preview.' });
    const successorId = persistDraft(db, period.source, period.charge.id, preview, actorId, now, period.predecessor.revision_number + 1, period.predecessor.id);
    db.prepare("UPDATE logical_charges SET current_invoice_id=?,outcome='invoiced',reason=NULL,updated_at=? WHERE id=?").run(successorId, now.toISOString(), period.charge.id);
    db.prepare('INSERT INTO invoice_replacement_requests(idempotency_key,actor_id,payload_hash,logical_charge_id,predecessor_id,created_at) VALUES(?,?,?,?,?,?)')
      .run(validated.idempotencyKey, actorId, payloadHash, period.charge.id, period.predecessor.id, now.toISOString());
    invoiceHistory(db, period.predecessor.id, actorId, 'replacement_created', 'Canceled', 'Canceled', now, 'An explicit linked successor Draft was created. This canceled revision remains immutable.');
    return { invoiceId: successorId, logicalChargeId: period.charge.id, created: true };
  });
}

export function billingRoutes(db: DatabaseSync, clock: () => Date): Router {
  const router = Router();
  router.post('/invoices/:id/replacement/preview', requireRole('admin', 'staff'), (req, res) => {
    const id = idSchema.parse(req.params.id); const input = invoiceReplacementPreviewSchema.parse(req.body); res.json(previewInvoiceReplacement(db, id, input.version, clock()));
  });
  router.post('/invoices/:id/replace', requireRole('admin', 'staff'), (req, res) => {
    const id = idSchema.parse(req.params.id); const input = invoiceReplacementSchema.parse(req.body); const user = res.locals.user as User;
    const result = replaceInvoice(db, id, input, user.id, clock()); res.status(result.created ? 201 : 200).json(transaction(db, () => serializeInvoice(db, result.invoiceId, user, clock()), 'read'));
  });
  router.get('/discounts', requireRole('admin', 'staff'), (req, res) => {
    const input = discountListSchema.parse(req.query);
    res.json(transaction(db, () => {
      const where: string[] = []; const values: SQLInputValue[] = [];
      if (input.q) { where.push("name LIKE ? ESCAPE '\\'"); values.push(`%${input.q.replace(/[\\%_]/g, '\\$&')}%`); }
      if (input.active !== undefined) { where.push('active=?'); values.push(input.active === 'true' ? 1 : 0); }
      const condition = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = Number(db.prepare(`SELECT count(*) AS count FROM discount_rules ${condition}`).get(...values)?.count); const page = Math.min(input.page, Math.max(1, Math.ceil(total / input.pageSize)));
      const ids = db.prepare(`SELECT id FROM discount_rules ${condition} ORDER BY priority,id LIMIT ? OFFSET ?`).all(...values, input.pageSize, (page - 1) * input.pageSize) as { id: string }[];
      return { items: loadDiscounts(db, ids.map(row => row.id)), total, page, pageSize: input.pageSize };
    }, 'read'));
  });
  router.get('/discounts/:id', requireRole('admin', 'staff'), (req, res) => {
    const id = idSchema.parse(req.params.id);
    res.json(transaction(db, () => { const result = loadDiscounts(db, [id], true); if (!result[0]) return notFound('Discount rule'); return result[0]; }, 'read'));
  });
  router.post('/discounts', requireRole('admin'), (req, res) => {
    const input = discountInputSchema.parse(req.body); const id = randomUUID(); const now = clock();
    transaction(db, () => {
      validateDiscountReferences(db, input);
      db.prepare(`INSERT INTO discount_rules(id,name,kind,amount_minor,percent_bps,min_amount,min_quantity,start_date,end_date,max_uses,priority,active,scope,subscription_id,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`)
        .run(id, input.name, input.kind, input.amountMinor, input.percentBps, input.minAmount, input.minQuantity, input.startDate, input.endDate, input.maxUses, input.priority, Number(input.active), input.scope, input.subscriptionId, now.toISOString(), now.toISOString());
      const insert = db.prepare('INSERT INTO discount_targets(rule_id,product_id) VALUES(?,?)'); for (const productId of input.productIds) insert.run(id, productId);
      audit(db, (res.locals.user as User).id, 'discount.created', id, now, { version: 1 });
    });
    res.status(201).json(transaction(db, () => loadDiscounts(db, [id], true)[0], 'read'));
  });
  router.put('/discounts/:id', requireRole('admin'), (req, res) => {
    const id = idSchema.parse(req.params.id); const input = discountUpdateSchema.parse(req.body); const now = clock();
    transaction(db, () => {
      const row = db.prepare(`${discountSelect} WHERE d.id=?`).get(id) as unknown as DiscountRow | undefined;
      if (!row) return notFound('Discount rule'); versionMatches(row, input.version); validateDiscountReferences(db, input);
      if (input.maxUses !== null && input.maxUses < row.reserved + row.consumed) throw new DomainError(400, 'DISCOUNT_LIMIT', 'The maximum uses cannot be below existing reserved and consumed applications.', { maxUses: 'Keep the limit at or above the current reserved and consumed count.' });
      db.prepare(`UPDATE discount_rules SET name=?,kind=?,amount_minor=?,percent_bps=?,min_amount=?,min_quantity=?,start_date=?,end_date=?,max_uses=?,priority=?,active=?,scope=?,subscription_id=?,version=version+1,updated_at=? WHERE id=?`)
        .run(input.name, input.kind, input.amountMinor, input.percentBps, input.minAmount, input.minQuantity, input.startDate, input.endDate, input.maxUses, input.priority, Number(input.active), input.scope, input.subscriptionId, now.toISOString(), id);
      db.prepare('DELETE FROM discount_targets WHERE rule_id=?').run(id); const insert = db.prepare('INSERT INTO discount_targets(rule_id,product_id) VALUES(?,?)'); for (const productId of input.productIds) insert.run(id, productId);
      audit(db, (res.locals.user as User).id, 'discount.updated', id, now, { version: input.version + 1 });
    });
    res.json(transaction(db, () => loadDiscounts(db, [id], true)[0], 'read'));
  });
  router.post('/subscriptions/:id/invoices/preview', requireRole('admin', 'staff'), (req, res) => {
    const id = idSchema.parse(req.params.id); const input = invoicePreviewSchema.parse(req.body);
    res.json(previewInvoice(db, id, input.expectedPeriodStart, clock()));
  });
  router.post('/subscriptions/:id/invoices', requireRole('admin', 'staff'), (req, res) => {
    const id = idSchema.parse(req.params.id); const input = invoiceGenerateSchema.parse(req.body); const user = res.locals.user as User;
    const result = generateInvoice(db, id, input, user.id, clock());
    res.status(result.created ? 201 : 200).json(transaction(db, () => serializeInvoice(db, result.invoiceId, user, clock()), 'read'));
  });
  router.get('/invoices', requireRole(), (req, res) => {
    const input = invoiceListSchema.parse(req.query); const user = res.locals.user as User;
    res.json(transaction(db, () => {
      const where: string[] = []; const values: SQLInputValue[] = [];
      if (user.role === 'customer') { where.push('customer_id=?'); values.push(user.id); }
      if (input.customerId) { where.push('customer_id=?'); values.push(input.customerId); }
      if (input.subscriptionId) { where.push('subscription_id=?'); values.push(input.subscriptionId); }
      if (input.status) { where.push('status=?'); values.push(input.status); }
      if (input.q) { const query = `%${input.q.replace(/[\\%_]/g, '\\$&')}%`; where.push("(number LIKE ? ESCAPE '\\' OR subscription_number LIKE ? ESCAPE '\\' OR customer_name LIKE ? ESCAPE '\\')"); values.push(query, query, query); }
      const now = clock();
      if (input.overdue !== undefined) { where.push(`${input.overdue === 'false' ? 'NOT ' : ''}(status='Confirmed' AND total>amount_paid AND due_date<?)`); values.push(businessDate(now)); }
      const condition = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = Number(db.prepare(`SELECT count(*) AS count FROM invoices ${condition}`).get(...values)?.count); const page = Math.min(input.page, Math.max(1, Math.ceil(total / input.pageSize)));
      const rows = db.prepare(`SELECT * FROM invoices ${condition} ORDER BY created_at DESC,id LIMIT ? OFFSET ?`).all(...values, input.pageSize, (page - 1) * input.pageSize) as unknown as InvoiceRow[];
      return { items: rows.map(row => invoiceSummary(row, now)), total, page, pageSize: input.pageSize };
    }, 'read'));
  });
  router.get('/invoices/:id', requireRole(), (req, res) => {
    const id = idSchema.parse(req.params.id); res.json(transaction(db, () => serializeInvoice(db, id, res.locals.user as User, clock()), 'read'));
  });
  for (const action of ['confirm', 'cancel'] as const) {
    router.post(`/invoices/:id/${action}`, requireRole('admin', 'staff'), (req, res) => {
      const id = idSchema.parse(req.params.id); const input = invoiceActionSchema.parse(req.body); const user = res.locals.user as User;
      if (action === 'confirm') confirmInvoice(db, id, input.version, user.id, clock()); else cancelInvoice(db, id, input.version, user.id, clock());
      res.json(transaction(db, () => serializeInvoice(db, id, user, clock()), 'read'));
    });
  }
  return router;
}
