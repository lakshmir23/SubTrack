import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { z } from 'zod';
import {
  subscriptionPreviewSchema, subscriptionCreateSchema, subscriptionUpdateSchema, subscriptionActionSchema, subscriptionProcessDueSchema,
  subscriptionStages, type SubscriptionCommercialInput, type SubscriptionPreview, type SubscriptionTerms,
  type Subscription, type SubscriptionSummary, type SubscriptionStage, type SubscriptionServiceState, type SubscriptionHistory,
  type SubscriptionProcessDueResult, type SubscriptionAction,
} from '../shared/subscriptions.js';
import type { CatalogLineInput, PlanInput, ProductInput } from '../shared/catalog.js';
import type { User } from '../shared/contracts.js';
import { calculateCatalogPreview } from './catalog.js';
import { transaction } from './database.js';
import { DomainError } from './errors.js';
import { audit, digest, requireRole } from './security.js';
import { businessDate, addDays, periodBoundary, periodIndex } from './calendar.js';
import { applyLifecycleDueForSubscription } from './lifecycle.js';

interface SubscriptionRow {
  id: string; number: string; customer_id: string; customer_name: string; customer_email: string; plan_id: string;
  template_id: string | null; template_name: string | null; start_date: string; expiry_date: string; term_periods: number;
  payment_term_days: number; valid_days: number; stage: SubscriptionStage; service_state: SubscriptionServiceState; version: number;
  terms_json: string; offered_terms_json: string | null; accepted_terms_json: string | null;
  issued_date: string | null; valid_until: string | null; accepted_at: string | null; next_period_index: number; next_billing_date: string | null; created_at: string; updated_at: string;
}
interface CurrentPlan {
  id: string; name: string; version: number; primary_product_id: string; price: number; interval: PlanInput['interval']; min_quantity: number;
  auto_close: number; allow_pause: number; allow_renew: number; allow_early_close: number; active: number;
  available_from: string | null; available_to: string | null;
}
const recordId = z.string().uuid('Select an existing record.');
const listSchema = z.object({
  q: z.string().trim().max(100).optional(), stage: z.enum(subscriptionStages).optional(), customerId: recordId.optional(),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
const placeholders = (items: unknown[]) => items.map(() => '?').join(',');
const termsOf = (row: SubscriptionRow): SubscriptionTerms => JSON.parse(row.accepted_terms_json || row.offered_terms_json || row.terms_json) as SubscriptionTerms;
function notFound(): never { throw new DomainError(404, 'NOT_FOUND', 'This subscription was not found or is unavailable to your account.'); }
function versionMatches(row: SubscriptionRow, version: number) {
  if (row.version !== version) throw new DomainError(409, 'VERSION_CONFLICT', 'This subscription changed after you opened it. Reload before trying again. Your entered values have not been applied.');
}
function getRow(db: DatabaseSync, id: string, user?: User): SubscriptionRow {
  const row = user?.role === 'customer'
    ? db.prepare('SELECT * FROM subscriptions WHERE id=? AND customer_id=?').get(id, user.id)
    : db.prepare('SELECT * FROM subscriptions WHERE id=?').get(id);
  return row as unknown as SubscriptionRow || notFound();
}
function currentPlan(db: DatabaseSync, id: string): CurrentPlan {
  const plan = db.prepare('SELECT * FROM plans WHERE id=?').get(id) as unknown as CurrentPlan | undefined;
  if (!plan) throw new DomainError(400, 'PLAN_NOT_FOUND', 'Select an existing plan.', { planId: 'This plan no longer exists.' });
  return plan;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** One atomic SQLite statement; call within the domain transaction to roll back unused references. */
export function nextReference(db: DatabaseSync, kind: string, prefix: string): string {
  if (!/^[a-z_]{1,40}$/.test(kind) || !/^[A-Z]{1,10}$/.test(prefix)) throw new DomainError(400, 'INVALID_REFERENCE', 'Use a supported document reference kind.');
  const row = db.prepare('INSERT INTO reference_counters(kind,value) VALUES(?,1) ON CONFLICT(kind) DO UPDATE SET value=value+1 RETURNING value').get(kind) as { value: number };
  return `${prefix}-${String(row.value).padStart(6, '0')}`;
}

export function buildSubscriptionPreview(db: DatabaseSync, input: SubscriptionCommercialInput, now: Date): SubscriptionPreview {
  const customer = db.prepare("SELECT id,name,email FROM users WHERE id=? AND role='customer'").get(input.customerId) as { id: string; name: string; email: string } | undefined;
  if (!customer) throw new DomainError(400, 'CUSTOMER_NOT_FOUND', 'Select a customer account.', { customerId: 'The selected account is not a customer.' });
  const plan = currentPlan(db, input.planId);
  let lines = input.lines;
  let validDays = input.validDays;
  let templateName: string | null = null;
  if (input.templateId) {
    const template = db.prepare('SELECT id,name,plan_id,valid_days,active FROM quotation_templates WHERE id=?').get(input.templateId) as { id: string; name: string; plan_id: string; valid_days: number; active: number } | undefined;
    if (!template?.active) throw new DomainError(400, 'TEMPLATE_UNAVAILABLE', 'Choose an active quotation template or continue without one.', { templateId: 'This template is unavailable.' });
    if (template.plan_id !== input.planId) throw new DomainError(400, 'TEMPLATE_PLAN', 'The template and quotation must use the same plan.', { templateId: 'Select a template for this plan.' });
    templateName = template.name;
    if (validDays === undefined) validDays = template.valid_days;
    if (!lines) lines = db.prepare('SELECT product_id AS productId,variant_id AS variantId,quantity FROM quotation_template_lines WHERE template_id=? ORDER BY position').all(template.id) as unknown as CatalogLineInput[];
  }
  if (!lines?.length || validDays === undefined) throw new DomainError(400, 'INCOMPLETE_QUOTATION', 'Add product lines and quotation validity before continuing.');
  const termPeriods = input.termPeriods ?? periodIndex(input.startDate, plan.interval, input.expiryDate!);
  if (termPeriods < 1 || termPeriods > 1_200) throw new DomainError(400, 'INVALID_TERM', 'Use between one and 1,200 whole billing periods.', { termPeriods: 'Choose a positive supported number of full periods.' });
  const expiryDate = periodBoundary(input.startDate, plan.interval, termPeriods);
  const price = calculateCatalogPreview(db, input.planId, lines, now, { enforceAvailability: false });
  const productIds = [...new Set(lines.map(line => line.productId))];
  const products = db.prepare(`SELECT id,type FROM products WHERE id IN (${placeholders(productIds)})`).all(...productIds) as { id: string; type: ProductInput['type'] }[];
  const productTypes = new Map(products.map(product => [product.id, product.type]));
  const terms: SubscriptionTerms = {
    currency: 'INR',
    plan: {
      id: plan.id, name: plan.name, version: plan.version, primaryProductId: plan.primary_product_id, price: plan.price, interval: plan.interval,
      minQuantity: plan.min_quantity, autoClose: Boolean(plan.auto_close), allowPause: Boolean(plan.allow_pause), allowRenew: Boolean(plan.allow_renew), allowEarlyClose: Boolean(plan.allow_early_close),
    },
    lines: price.lines.map(line => ({
      id: randomUUID(), productId: line.productId, productName: line.productName, productType: productTypes.get(line.productId)!,
      variantId: line.variantId, variantName: line.variantName, quantity: line.quantity, isPrimary: line.isPrimary,
      baseUnitPrice: line.baseUnitPrice, variantAdjustment: line.variantAdjustment, unitPrice: line.unitPrice, subtotal: line.subtotal,
      estimatedTaxRateBps: line.taxRateBps, estimatedTax: line.tax, estimatedTotal: line.total,
    })),
    subtotal: price.subtotal, estimatedTax: price.tax, estimatedTotal: price.total, taxesAreEstimates: true,
    priceExplanation: 'The offered primary unit price is the plan price plus the accepted variant adjustment. Additional lines use their saved catalog prices. Issuing freezes this offer; confirmation accepts it unchanged. Quotation taxes are estimates; invoices apply their own generation-date tax and discount rules.',
  };
  return {
    customerId: customer.id, customerName: customer.name, customerEmail: customer.email, planId: plan.id,
    templateId: input.templateId, templateName, startDate: input.startDate, expiryDate, termPeriods, paymentTermDays: input.paymentTermDays,
    validDays, businessDate: businessDate(now), terms,
  };
}

function validateCurrentEligibility(db: DatabaseSync, row: SubscriptionRow, date: string, checkAvailability: boolean) {
  const plan = currentPlan(db, row.plan_id);
  if (!plan.active) throw new DomainError(400, 'PLAN_INACTIVE', 'This plan is archived. Prepare a fresh quotation on an active plan.');
  if (checkAvailability && ((plan.available_from && date < plan.available_from) || (plan.available_to && date > plan.available_to))) throw new DomainError(400, 'PLAN_UNAVAILABLE', 'The plan is outside its current availability dates. The offered prices have not been changed.');
  const terms = termsOf(row);
  const primary = terms.lines.filter(line => line.productId === terms.plan.primaryProductId);
  if (primary.length !== 1 || primary[0].quantity < terms.plan.minQuantity) throw new DomainError(400, 'INVALID_OFFER', 'The offered primary-product quantity does not satisfy its saved plan terms.');
  const ids = [...new Set(terms.lines.map(line => line.productId))];
  const products = db.prepare(`SELECT id,active FROM products WHERE id IN (${placeholders(ids)})`).all(...ids) as { id: string; active: number }[];
  const variants = db.prepare(`SELECT id,product_id,active FROM product_variants WHERE product_id IN (${placeholders(ids)})`).all(...ids) as { id: string; product_id: string; active: number }[];
  const productsById = new Map(products.map(product => [product.id, product]));
  const variantsById = new Map(variants.map(variant => [variant.id, variant]));
  for (const line of terms.lines) {
    if (!productsById.get(line.productId)?.active) throw new DomainError(400, 'PRODUCT_UNAVAILABLE', 'An offered product is archived. Prepare a fresh quotation with available products.');
    if (line.variantId) {
      const variant = variantsById.get(line.variantId);
      if (!variant?.active || variant.product_id !== line.productId) throw new DomainError(400, 'VARIANT_UNAVAILABLE', 'An offered variant is unavailable. Prepare a fresh quotation with an active variant.');
    }
  }
}
function history(db: DatabaseSync, row: SubscriptionRow, actorId: string | null, kind: string, from: SubscriptionStage | null, to: SubscriptionStage, now: Date, message: string, requestVersion: number | null = null) {
  db.prepare('INSERT INTO subscription_history(id,subscription_id,actor_id,kind,created_at,from_stage,to_stage,message,request_version) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(), row.id, actorId, kind, now.toISOString(), from, to, message, requestVersion);
  audit(db, actorId, `subscription.${kind}`, row.id, now, { number: row.number, fromStage: from, toStage: to });
}
function summary(row: SubscriptionRow): SubscriptionSummary {
  const terms = termsOf(row);
  const nextBillingDate = row.accepted_terms_json ? row.next_billing_date : null;
  return {
    id: row.id, number: row.number, customerId: row.customer_id, customerName: row.customer_name, customerEmail: row.customer_email,
    planId: row.plan_id, planName: terms.plan.name, startDate: row.start_date, expiryDate: row.expiry_date, termPeriods: row.term_periods,
    paymentTermDays: row.payment_term_days, stage: row.stage, serviceState: row.service_state, version: row.version, currency: 'INR',
    subtotal: terms.subtotal, estimatedTax: terms.estimatedTax, estimatedTotal: terms.estimatedTotal,
    issuedDate: row.issued_date, validUntil: row.valid_until, acceptedAt: row.accepted_at, nextBillingDate, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
function detail(db: DatabaseSync, row: SubscriptionRow, user: User, now: Date): Subscription {
  const date = businessDate(now);
  const allowedActions: SubscriptionAction[] = [];
  let activationBlockedReason: string | null = null;
  if (row.stage === 'Confirmed' && date < row.start_date) activationBlockedReason = `Service starts on ${row.start_date}. It can be activated on or after that business date.`;
  else if (row.stage === 'Confirmed' && date >= row.expiry_date) activationBlockedReason = 'This service term has ended and cannot be activated.';
  if (user.role !== 'customer') {
    if (row.stage === 'Draft') allowedActions.push('edit', 'issue');
    if (row.stage === 'Quotation' && row.valid_until! >= date && row.expiry_date > date) allowedActions.push('confirm');
    if (row.stage === 'Confirmed' && !activationBlockedReason) allowedActions.push('activate');
  }
  const events = db.prepare(`SELECT h.*,u.name AS actor_name FROM subscription_history h LEFT JOIN users u ON u.id=h.actor_id WHERE subscription_id=? ORDER BY h.rowid`).all(row.id) as unknown as { id: string; kind: string; actor_name: string | null; created_at: string; from_stage: SubscriptionStage | null; to_stage: SubscriptionStage; message: string }[];
  const safeHistory: SubscriptionHistory[] = events.map(event => ({ id: event.id, kind: event.kind, actorName: event.actor_name || 'System', at: event.created_at, fromStage: event.from_stage, toStage: event.to_stage, message: event.message }));
  return {
    ...summary(row), templateId: row.template_id, templateName: row.template_name, validDays: row.valid_days, businessDate: date,
    terms: termsOf(row), offeredTerms: row.offered_terms_json ? JSON.parse(row.offered_terms_json) as SubscriptionTerms : null,
    acceptedTerms: row.accepted_terms_json ? JSON.parse(row.accepted_terms_json) as SubscriptionTerms : null,
    history: safeHistory, allowedActions, activationBlockedReason,
  };
}
function activate(db: DatabaseSync, row: SubscriptionRow, now: Date, actorId: string | null, requestVersion: number | null) {
  const date = businessDate(now);
  if (row.stage !== 'Confirmed') throw new DomainError(409, 'INVALID_TRANSITION', 'Only a confirmed agreement can be activated.');
  if (date < row.start_date) throw new DomainError(400, 'NOT_STARTED', `Service starts on ${row.start_date}. Activate on or after that business date.`);
  if (date >= row.expiry_date) throw new DomainError(400, 'TERM_ENDED', 'This agreement’s service term has ended and cannot be activated.');
  db.prepare("UPDATE subscriptions SET stage='Active',service_state='Running',version=version+1,updated_at=? WHERE id=?").run(now.toISOString(), row.id);
  history(db, row, actorId, 'activated', 'Confirmed', 'Active', now, `Service activated on ${date}. Payment is tracked separately.`, requestVersion);
}

export function processDueSubscriptions(db: DatabaseSync, now: Date, limit = 100): SubscriptionProcessDueResult {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new DomainError(400, 'INVALID_LIMIT', 'Process between one and 500 due agreements at a time.');
  const date = businessDate(now);
  const candidates = db.prepare("SELECT id,number FROM subscriptions WHERE stage='Confirmed' AND start_date<=? AND expiry_date>? ORDER BY start_date,id LIMIT ?").all(date, date, limit) as { id: string; number: string }[];
  const blocked = Number(db.prepare("SELECT count(*) AS count FROM subscriptions WHERE stage='Confirmed' AND expiry_date<=?").get(date)?.count);
  const blockedRows = db.prepare("SELECT id,number FROM subscriptions WHERE stage='Confirmed' AND expiry_date<=? ORDER BY expiry_date,id LIMIT ?").all(date, limit) as { id: string; number: string }[];
  const result: SubscriptionProcessDueResult = { activated: 0, alreadyActive: 0, failed: 0, remaining: 0, blocked, items: blockedRows.map(row => ({ ...row, outcome: 'blocked', message: 'The service term ended before activation. It cannot be activated; review this agreement.' })) };
  for (const candidate of candidates) {
    try {
      const outcome = transaction(db, () => {
        const row = getRow(db, candidate.id);
        if (row.stage === 'Active') return 'alreadyActive' as const;
        activate(db, row, now, null, null);
        return 'activated' as const;
      });
      result[outcome]++;
      result.items.push({ ...candidate, outcome, message: outcome === 'activated' ? 'Service activated.' : 'Service was already activated by another worker.' });
    } catch (error) {
      result.failed++;
      result.items.push({ ...candidate, outcome: 'failed', message: error instanceof DomainError ? error.message : 'Activation could not be completed. The agreement remains available to retry.' });
    }
  }
  result.remaining = Number(db.prepare("SELECT count(*) AS count FROM subscriptions WHERE stage='Confirmed' AND start_date<=? AND expiry_date>?").get(date, date)?.count);
  return result;
}

export function subscriptionRoutes(db: DatabaseSync, clock: () => Date): Router {
  const router = Router();
  router.post('/subscriptions/preview', requireRole('admin', 'staff'), (req, res) => {
    const input = subscriptionPreviewSchema.parse(req.body);
    res.json(transaction(db, () => buildSubscriptionPreview(db, input, clock()), 'read'));
  });
  router.post('/subscriptions/process-due', requireRole('admin', 'staff'), (req, res) => {
    const input = subscriptionProcessDueSchema.parse(req.body);
    res.json(processDueSubscriptions(db, clock(), input.limit));
  });
  router.get('/subscriptions', requireRole(), (req, res) => {
    const input = listSchema.parse(req.query); const user = res.locals.user as User;
    res.json(transaction(db, () => {
      const where: string[] = []; const values: SQLInputValue[] = [];
      if (user.role === 'customer') { where.push('customer_id=?'); values.push(user.id); }
      if (input.customerId) { where.push('customer_id=?'); values.push(input.customerId); }
      if (input.stage) { where.push('stage=?'); values.push(input.stage); }
      if (input.q) {
        const query = `%${input.q.replace(/[\\%_]/g, '\\$&')}%`;
        where.push("(number LIKE ? ESCAPE '\\' OR customer_name LIKE ? ESCAPE '\\' OR json_extract(terms_json,'$.plan.name') LIKE ? ESCAPE '\\')"); values.push(query, query, query);
      }
      const condition = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = Number(db.prepare(`SELECT count(*) AS count FROM subscriptions ${condition}`).get(...values)?.count);
      const page = Math.min(input.page, Math.max(1, Math.ceil(total / input.pageSize)));
      const rows = db.prepare(`SELECT * FROM subscriptions ${condition} ORDER BY created_at DESC,id LIMIT ? OFFSET ?`).all(...values, input.pageSize, (page - 1) * input.pageSize) as unknown as SubscriptionRow[];
      return { items: rows.map(summary), total, page, pageSize: input.pageSize };
    }, 'read'));
  });
  router.get('/subscriptions/:id', requireRole(), (req, res) => {
    const id = recordId.parse(req.params.id); const user = res.locals.user as User;
    const current = getRow(db, id, user); const date = businessDate(clock());
    if (current.accepted_terms_json && ((date >= current.expiry_date && current.stage !== 'Closed' && current.service_state !== 'TermEnded')
      || db.prepare("SELECT 1 FROM lifecycle_events WHERE subscription_id=? AND status='scheduled' AND effective_date<=? LIMIT 1").get(id, date))) {
      transaction(db, () => applyLifecycleDueForSubscription(db, id, clock()));
    }
    res.json(transaction(db, () => detail(db, getRow(db, id, user), user, clock()), 'read'));
  });
  router.post('/subscriptions', requireRole('admin', 'staff'), (req, res) => {
    const input = subscriptionCreateSchema.parse(req.body); const user = res.locals.user as User;
    const { idempotencyKey, ...commercial } = input;
    const payloadHash = digest(canonical(commercial));
    const result = transaction(db, () => {
      const prior = db.prepare('SELECT actor_id,payload_hash,subscription_id FROM subscription_requests WHERE idempotency_key=?').get(idempotencyKey) as { actor_id: string; payload_hash: string; subscription_id: string } | undefined;
      if (prior) {
        if (prior.actor_id !== user.id || prior.payload_hash !== payloadHash) throw new DomainError(409, 'IDEMPOTENCY_CONFLICT', 'This submission key was already used for a different request. Start a new quotation to use different inputs.');
        return { id: prior.subscription_id, created: false };
      }
      const now = clock(); const preview = buildSubscriptionPreview(db, commercial, now); const id = randomUUID(); const number = nextReference(db, 'subscription', 'SUB');
      db.prepare(`INSERT INTO subscriptions(id,number,customer_id,customer_name,customer_email,plan_id,template_id,template_name,start_date,expiry_date,term_periods,payment_term_days,valid_days,
        stage,service_state,version,terms_json,offered_terms_json,accepted_terms_json,issued_date,valid_until,accepted_at,next_period_index,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'Draft','Running',1,?,NULL,NULL,NULL,NULL,NULL,0,?,?)`)
        .run(id, number, preview.customerId, preview.customerName, preview.customerEmail, preview.planId, preview.templateId, preview.templateName, preview.startDate, preview.expiryDate, preview.termPeriods, preview.paymentTermDays, preview.validDays, JSON.stringify(preview.terms), now.toISOString(), now.toISOString());
      db.prepare('INSERT INTO subscription_requests(idempotency_key,actor_id,payload_hash,subscription_id,created_at) VALUES(?,?,?,?,?)').run(idempotencyKey, user.id, payloadHash, id, now.toISOString());
      history(db, getRow(db, id), user.id, 'created', null, 'Draft', now, `Draft quotation created${preview.templateName ? ` from ${preview.templateName}` : ''}.`);
      return { id, created: true };
    });
    res.status(result.created ? 201 : 200).json(transaction(db, () => detail(db, getRow(db, result.id), user, clock()), 'read'));
  });
  router.put('/subscriptions/:id', requireRole('admin', 'staff'), (req, res) => {
    const id = recordId.parse(req.params.id); const input = subscriptionUpdateSchema.parse(req.body); const user = res.locals.user as User;
    transaction(db, () => {
      const row = getRow(db, id); versionMatches(row, input.version);
      if (row.stage !== 'Draft') throw new DomainError(409, 'OFFER_FROZEN', 'Issued quotations and accepted agreements are read-only. Create a fresh quotation for new commercial terms.');
      const now = clock(); const preview = buildSubscriptionPreview(db, input, now);
      db.prepare(`UPDATE subscriptions SET customer_id=?,customer_name=?,customer_email=?,plan_id=?,template_id=?,template_name=?,start_date=?,expiry_date=?,term_periods=?,payment_term_days=?,valid_days=?,terms_json=?,version=version+1,updated_at=? WHERE id=?`)
        .run(preview.customerId, preview.customerName, preview.customerEmail, preview.planId, preview.templateId, preview.templateName, preview.startDate, preview.expiryDate, preview.termPeriods, preview.paymentTermDays, preview.validDays, JSON.stringify(preview.terms), now.toISOString(), id);
      history(db, row, user.id, 'edited', 'Draft', 'Draft', now, 'Draft explicitly updated and priced from the current catalog.', input.version);
    });
    res.json(transaction(db, () => detail(db, getRow(db, id), user, clock()), 'read'));
  });
  for (const action of ['issue', 'confirm', 'activate'] as const) {
    router.post(`/subscriptions/:id/${action}`, requireRole('admin', 'staff'), (req, res) => {
      const id = recordId.parse(req.params.id); const input = subscriptionActionSchema.parse(req.body); const user = res.locals.user as User;
      transaction(db, () => {
        const row = getRow(db, id); const now = clock(); const date = businessDate(now);
        const target = action === 'issue' ? 'Quotation' : action === 'confirm' ? 'Confirmed' : 'Active';
        const replay = db.prepare('SELECT 1 FROM subscription_history WHERE subscription_id=? AND kind=? AND request_version=?').get(id, action === 'issue' ? 'issued' : action === 'confirm' ? 'confirmed' : 'activated', input.version);
        if (replay || row.stage === target) return;
        versionMatches(row, input.version);
        if (action === 'issue') {
          if (row.stage !== 'Draft') throw new DomainError(409, 'INVALID_TRANSITION', 'Only a Draft can be issued as a Quotation.');
          validateCurrentEligibility(db, row, date, false);
          const validUntil = addDays(date, row.valid_days - 1);
          db.prepare("UPDATE subscriptions SET stage='Quotation',offered_terms_json=terms_json,issued_date=?,valid_until=?,version=version+1,updated_at=? WHERE id=?").run(date, validUntil, now.toISOString(), id);
          history(db, row, user.id, 'issued', 'Draft', 'Quotation', now, `Quotation issued; valid through ${validUntil}, inclusive.`, input.version);
        } else if (action === 'confirm') {
          if (row.stage !== 'Quotation') throw new DomainError(409, 'INVALID_TRANSITION', 'Issue the Draft quotation before confirming an agreement.');
          if (row.valid_until! < date) throw new DomainError(400, 'QUOTATION_EXPIRED', 'This quotation has expired. Create a fresh quotation before confirming.');
          if (row.expiry_date <= date) throw new DomainError(400, 'TERM_ENDED', 'The service term has already ended. Create a fresh quotation with new service dates.');
          validateCurrentEligibility(db, row, date, true);
          db.prepare("UPDATE subscriptions SET stage='Confirmed',accepted_terms_json=offered_terms_json,accepted_at=?,next_billing_date=start_date,version=version+1,updated_at=? WHERE id=?").run(now.toISOString(), now.toISOString(), id);
          history(db, row, user.id, 'confirmed', 'Quotation', 'Confirmed', now, 'Agreement confirmed at its exact offered prices, quantities and plan capabilities.', input.version);
        } else activate(db, row, now, user.id, input.version);
      });
      res.json(transaction(db, () => detail(db, getRow(db, id), user, clock()), 'read'));
    });
  }
  return router;
}
