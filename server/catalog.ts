import { Router, type Request } from 'express';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { z } from 'zod';
import {
  productInputSchema, productUpdateSchema, planInputSchema, planUpdateSchema,
  taxInputSchema, taxUpdateSchema, quotationTemplateInputSchema, quotationTemplateUpdateSchema, catalogPreviewSchema,
  type Product, type ProductInput, type ProductVariant, type Plan, type PlanInput,
  type TaxRule, type QuotationTemplate, type CatalogLineInput, type CatalogPreview,
} from '../shared/catalog.js';
import type { Role, User } from '../shared/contracts.js';
import { transaction } from './database.js';
import { DomainError } from './errors.js';
import { audit, requireRole } from './security.js';
import { businessDate, assertDate } from './calendar.js';
import { checkedMinor, multiplyMinor, sumMinor, taxMinor } from './money.js';

interface RecordRow { id: string; version: number; created_at: string; updated_at: string }
interface ProductRow extends RecordRow { name: string; type: ProductInput['type']; sales_price: number; cost_price: number; notes: string; active: number }
interface VariantRow { id: string; product_id: string; name: string; adjustment: number; active: number }
interface PlanRow extends RecordRow {
  name: string; primary_product_id: string; primary_product_name: string; price: number; interval: PlanInput['interval']; min_quantity: number;
  available_from: string | null; available_to: string | null; auto_close: number; allow_pause: number; allow_renew: number; allow_early_close: number; active: number;
}
interface TaxRow extends RecordRow { name: string; rate_bps: number; product_id: string | null; product_name: string | null; priority: number; active: number }
interface TemplateRow extends RecordRow { name: string; plan_id: string; plan_name: string; valid_days: number; active: number }
interface TemplateLineRow { template_id: string; product_id: string; variant_id: string | null; quantity: number }
const recordId = z.string().uuid('Select an existing record.');
const listSchema = z.object({
  q: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20), active: z.enum(['true', 'false']).optional(),
}).strict();
const placeholders = (values: unknown[]) => values.map(() => '?').join(',');
const base = (row: RecordRow) => ({ id: row.id, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at });
const actor = (res: { locals: Record<string, unknown> }) => res.locals.user as User;

function missing(label: string): never { throw new DomainError(404, 'NOT_FOUND', `${label} was not found or is unavailable.`); }
function versionMatches(row: RecordRow, version: number): void {
  if (row.version !== version) throw new DomainError(409, 'VERSION_CONFLICT', 'This record changed after you opened it. Reload before saving. Your entered values have not been applied.');
}
function productRow(db: DatabaseSync, id: string): ProductRow | undefined {
  return db.prepare('SELECT * FROM products WHERE id=?').get(id) as unknown as ProductRow | undefined;
}
function planRow(db: DatabaseSync, id: string): PlanRow | undefined {
  return db.prepare('SELECT p.*,pr.name AS primary_product_name FROM plans p JOIN products pr ON pr.id=p.primary_product_id WHERE p.id=?').get(id) as unknown as PlanRow | undefined;
}
function referenceProduct(db: DatabaseSync, id: string): ProductRow {
  const row = productRow(db, id);
  if (!row) throw new DomainError(400, 'PRODUCT_NOT_FOUND', 'Select an existing product.', { primaryProductId: 'This product no longer exists.' });
  return row;
}
function loadProducts(db: DatabaseSync, ids: string[], role: Role): Product[] {
  if (!ids.length) return [];
  const rows = db.prepare(`SELECT * FROM products WHERE id IN (${placeholders(ids)})`).all(...ids) as unknown as ProductRow[];
  const variants = db.prepare(`SELECT * FROM product_variants WHERE product_id IN (${placeholders(ids)}) ORDER BY name COLLATE NOCASE,id`).all(...ids) as unknown as VariantRow[];
  const byId = new Map(rows.map(row => [row.id, row]));
  return ids.map(id => {
    const row = byId.get(id)!;
    return {
      ...base(row), name: row.name, type: row.type, salesPrice: row.sales_price, active: Boolean(row.active),
      ...(role === 'admin' ? { costPrice: row.cost_price } : {}), ...(role !== 'customer' ? { notes: row.notes } : {}),
      variants: variants.filter(variant => variant.product_id === id && (role !== 'customer' || Boolean(variant.active)))
        .map(variant => ({ id: variant.id, name: variant.name, adjustment: variant.adjustment, active: Boolean(variant.active) })),
    };
  });
}
function loadPlans(db: DatabaseSync, ids: string[]): Plan[] {
  if (!ids.length) return [];
  const rows = db.prepare(`SELECT p.*,pr.name AS primary_product_name FROM plans p JOIN products pr ON pr.id=p.primary_product_id WHERE p.id IN (${placeholders(ids)})`).all(...ids) as unknown as PlanRow[];
  const byId = new Map(rows.map(row => [row.id, row]));
  return ids.map(id => {
    const row = byId.get(id)!;
    return {
      ...base(row), name: row.name, primaryProductId: row.primary_product_id, primaryProductName: row.primary_product_name,
      price: row.price, interval: row.interval, minQuantity: row.min_quantity, availableFrom: row.available_from, availableTo: row.available_to,
      autoClose: Boolean(row.auto_close), allowPause: Boolean(row.allow_pause), allowRenew: Boolean(row.allow_renew),
      allowEarlyClose: Boolean(row.allow_early_close), active: Boolean(row.active),
    };
  });
}
function loadTaxes(db: DatabaseSync, ids: string[]): TaxRule[] {
  if (!ids.length) return [];
  const rows = db.prepare(`SELECT t.*,p.name AS product_name FROM tax_rules t LEFT JOIN products p ON p.id=t.product_id WHERE t.id IN (${placeholders(ids)})`).all(...ids) as unknown as TaxRow[];
  const byId = new Map(rows.map(row => [row.id, row]));
  return ids.map(id => {
    const row = byId.get(id)!;
    return { ...base(row), name: row.name, rateBps: row.rate_bps, productId: row.product_id, productName: row.product_name, priority: row.priority, active: Boolean(row.active) };
  });
}
function loadTemplates(db: DatabaseSync, ids: string[]): QuotationTemplate[] {
  if (!ids.length) return [];
  const rows = db.prepare(`SELECT t.*,p.name AS plan_name FROM quotation_templates t JOIN plans p ON p.id=t.plan_id WHERE t.id IN (${placeholders(ids)})`).all(...ids) as unknown as TemplateRow[];
  const lines = db.prepare(`SELECT template_id,product_id,variant_id,quantity FROM quotation_template_lines WHERE template_id IN (${placeholders(ids)}) ORDER BY template_id,position`).all(...ids) as unknown as TemplateLineRow[];
  const byId = new Map(rows.map(row => [row.id, row]));
  return ids.map(id => {
    const row = byId.get(id)!;
    return {
      ...base(row), name: row.name, planId: row.plan_id, planName: row.plan_name, validDays: row.valid_days, active: Boolean(row.active),
      lines: lines.filter(line => line.template_id === id).map(line => ({ productId: line.product_id, variantId: line.variant_id, quantity: line.quantity })),
    };
  });
}
function pageIds(db: DatabaseSync, req: Request, source: string, extraWhere: string[] = []) {
  const input = listSchema.parse(req.query);
  const where = [...extraWhere];
  const values: SQLInputValue[] = [];
  if (input.active !== undefined) { where.push('r.active=?'); values.push(input.active === 'true' ? 1 : 0); }
  if (input.q) { where.push("r.name LIKE ? ESCAPE '\\'"); values.push(`%${input.q.replace(/[\\%_]/g, '\\$&')}%`); }
  const condition = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = Number(db.prepare(`SELECT count(*) AS count FROM ${source} ${condition}`).get(...values)?.count);
  const page = Math.min(input.page, Math.max(1, Math.ceil(total / input.pageSize)));
  const rows = db.prepare(`SELECT r.id FROM ${source} ${condition} ORDER BY r.created_at DESC,r.id LIMIT ? OFFSET ?`).all(...values, input.pageSize, (page - 1) * input.pageSize) as { id: string }[];
  return { ids: rows.map(row => row.id), total, page, pageSize: input.pageSize };
}

function finalVariants(db: DatabaseSync, input: ProductInput, productId?: string): ProductVariant[] {
  const existing = productId ? db.prepare('SELECT * FROM product_variants WHERE product_id=?').all(productId) as unknown as VariantRow[] : [];
  const existingIds = new Set(existing.map(row => row.id));
  const seen = new Set<string>();
  const incoming = input.variants.map(variant => {
    if (variant.id && (!productId || !existingIds.has(variant.id))) throw new DomainError(400, 'VARIANT_OWNER', 'A variant must belong to the product being edited.', { variants: 'Reload and select this product’s own variant.' });
    if (variant.id && seen.has(variant.id)) throw new DomainError(400, 'DUPLICATE_VARIANT', 'A variant was included more than once.', { variants: 'Use each variant once.' });
    const id = variant.id || randomUUID(); seen.add(id);
    return { id, name: variant.name, adjustment: variant.adjustment, active: variant.active };
  });
  const all = [...incoming, ...existing.filter(row => !seen.has(row.id)).map(row => ({ id: row.id, name: row.name, adjustment: row.adjustment, active: false }))];
  if (all.length > 50) throw new DomainError(400, 'VARIANT_LIMIT', 'A product supports at most 50 retained variants. Reuse an existing variant or create a new product.', { variants: 'The retained variant limit is 50.' });
  const names = new Set<string>();
  for (const variant of all) {
    const key = variant.name.toLocaleLowerCase('en-US');
    if (names.has(key)) throw new DomainError(400, 'DUPLICATE_VARIANT', 'Variant names must be different within one product.', { variants: 'Rename the duplicate or reuse its existing ID.' });
    names.add(key);
    if (variant.active) checkedMinor(BigInt(input.salesPrice) + BigInt(variant.adjustment));
  }
  return all;
}
function saveVariants(db: DatabaseSync, productId: string, variants: ProductVariant[]) {
  const existing = db.prepare('SELECT id,name FROM product_variants WHERE product_id=?').all(productId) as { id: string; name: string }[];
  // Temporary names permit an atomic swap of variant names without deleting referenced IDs.
  const occupied = new Set([...existing.map(row => row.name.toLowerCase()), ...variants.map(row => row.name.toLowerCase())]);
  for (const row of existing) {
    let temporary: string;
    do { temporary = `Editing ${randomUUID()}`; } while (occupied.has(temporary.toLowerCase()));
    occupied.add(temporary.toLowerCase());
    db.prepare('UPDATE product_variants SET name=? WHERE id=? AND product_id=?').run(temporary, row.id, productId);
  }
  const upsert = db.prepare('INSERT INTO product_variants(id,product_id,name,adjustment,active) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,adjustment=excluded.adjustment,active=excluded.active');
  for (const variant of variants) upsert.run(variant.id, productId, variant.name, variant.adjustment, Number(variant.active));
}
function validatePlanProduct(db: DatabaseSync, input: PlanInput) {
  const product = referenceProduct(db, input.primaryProductId);
  if (input.active && !product.active) throw new DomainError(400, 'PRODUCT_INACTIVE', 'Activate the primary product before publishing this plan.', { primaryProductId: 'The selected product is archived.' });
  if (input.availableFrom) assertDate(input.availableFrom);
  if (input.availableTo) assertDate(input.availableTo);
}
function validateLines(db: DatabaseSync, plan: PlanRow, lines: CatalogLineInput[], requireActive: boolean) {
  const primary = lines.filter(line => line.productId === plan.primary_product_id);
  if (primary.length !== 1) throw new DomainError(400, 'PRIMARY_LINE', 'Include exactly one line for the plan’s primary product.', { lines: 'The primary product must appear once.' });
  if (primary[0].quantity < plan.min_quantity) throw new DomainError(400, 'MIN_QUANTITY', `The primary product requires at least ${plan.min_quantity} units.`, { lines: `Use at least ${plan.min_quantity} primary-product units.` });
  if (requireActive && !plan.active) throw new DomainError(400, 'PLAN_INACTIVE', 'This plan is archived. Choose an active plan.', { planId: 'Select an active plan.' });
  const ids = [...new Set(lines.map(line => line.productId))];
  const products = db.prepare(`SELECT * FROM products WHERE id IN (${placeholders(ids)})`).all(...ids) as unknown as ProductRow[];
  const variants = db.prepare(`SELECT * FROM product_variants WHERE product_id IN (${placeholders(ids)})`).all(...ids) as unknown as VariantRow[];
  const byId = new Map(products.map(row => [row.id, row]));
  const byVariant = new Map(variants.map(row => [row.id, row]));
  return lines.map((line, index) => {
    const product = byId.get(line.productId);
    if (!product || (requireActive && !product.active)) throw new DomainError(400, 'PRODUCT_UNAVAILABLE', 'A selected product is unavailable. Choose an active product.', { [`lines.${index}.productId`]: 'This product is unavailable.' });
    const variant = line.variantId ? byVariant.get(line.variantId) : undefined;
    if (line.variantId && (!variant || variant.product_id !== product.id || (requireActive && !variant.active))) throw new DomainError(400, 'VARIANT_UNAVAILABLE', 'A variant must be active and belong to its selected product.', { [`lines.${index}.variantId`]: 'Select an available variant for this product.' });
    return { line, product, variant };
  });
}

export function calculateCatalogPreview(db: DatabaseSync, planId: string, inputLines: CatalogLineInput[], now: Date, options: { enforceAvailability?: boolean } = {}): CatalogPreview {
  const plan = planRow(db, planId);
  if (!plan) throw new DomainError(400, 'PLAN_NOT_FOUND', 'Select an existing plan.', { planId: 'This plan no longer exists.' });
  const date = businessDate(now);
  if (options.enforceAvailability !== false && ((plan.available_from && date < plan.available_from) || (plan.available_to && date > plan.available_to))) throw new DomainError(400, 'PLAN_UNAVAILABLE', 'This plan is outside its availability dates.', { planId: 'Choose a plan available on the current business date.' });
  const selected = validateLines(db, plan, inputLines, true);
  const taxes = db.prepare('SELECT * FROM tax_rules WHERE active=1 ORDER BY priority,CASE WHEN product_id IS NULL THEN 1 ELSE 0 END,id').all() as unknown as TaxRow[];
  const lines = selected.map(({ line, product, variant }) => {
    const isPrimary = product.id === plan.primary_product_id;
    const baseUnitPrice = isPrimary ? plan.price : product.sales_price;
    const variantAdjustment = variant?.adjustment || 0;
    const unitPrice = checkedMinor(BigInt(baseUnitPrice) + BigInt(variantAdjustment));
    const subtotal = multiplyMinor(unitPrice, line.quantity);
    const rule = taxes.find(tax => tax.product_id === product.id || tax.product_id === null);
    const tax = taxMinor(subtotal, rule?.rate_bps || 0);
    return {
      ...line, productName: product.name, variantName: variant?.name || null, isPrimary, baseUnitPrice, variantAdjustment, unitPrice, subtotal,
      taxId: rule?.id || null, taxName: rule?.name || null, taxRateBps: rule?.rate_bps || 0, tax, total: sumMinor([subtotal, tax]),
    };
  });
  return {
    planId: plan.id, planName: plan.name, currency: 'INR', businessDate: date, lines,
    subtotal: sumMinor(lines.map(line => line.subtotal)), tax: sumMinor(lines.map(line => line.tax)), total: sumMinor(lines.map(line => line.total)),
    priceExplanation: 'The plan price replaces the primary product’s catalog base price. Variant adjustments apply per unit. Additional products use their catalog prices. One configured exclusive tax is rounded half-up on each line. This preview does not reserve prices or discounts.',
  };
}

export function catalogRoutes(db: DatabaseSync, clock: () => Date): Router {
  const router = Router();
  router.get('/products', requireRole(), (req, res) => {
    const user = actor(res); const { ids, ...page } = pageIds(db, req, 'products r', user.role === 'customer' ? ['r.active=1'] : []);
    res.json({ items: loadProducts(db, ids, user.role), ...page });
  });
  router.get('/products/:id', requireRole(), (req, res) => {
    const id = recordId.parse(req.params.id); const user = actor(res); const row = productRow(db, id);
    if (!row || (user.role === 'customer' && !row.active)) return missing('Product');
    res.json(loadProducts(db, [id], user.role)[0]);
  });
  router.post('/products', requireRole('admin'), (req, res) => {
    const input = productInputSchema.parse(req.body); const id = randomUUID(); const now = clock();
    transaction(db, () => {
      const variants = finalVariants(db, input);
      db.prepare('INSERT INTO products(id,name,type,sales_price,cost_price,notes,active,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?)')
        .run(id, input.name, input.type, input.salesPrice, input.costPrice, input.notes, Number(input.active), now.toISOString(), now.toISOString());
      saveVariants(db, id, variants); audit(db, actor(res).id, 'product.created', id, now, { version: 1 });
    });
    res.status(201).json(loadProducts(db, [id], 'admin')[0]);
  });
  router.put('/products/:id', requireRole('admin'), (req, res) => {
    const id = recordId.parse(req.params.id); const input = productUpdateSchema.parse(req.body); const now = clock();
    transaction(db, () => {
      const row = productRow(db, id); if (!row) return missing('Product'); versionMatches(row, input.version);
      const variants = finalVariants(db, input, id);
      db.prepare('UPDATE products SET name=?,type=?,sales_price=?,cost_price=?,notes=?,active=?,version=version+1,updated_at=? WHERE id=? AND version=?')
        .run(input.name, input.type, input.salesPrice, input.costPrice, input.notes, Number(input.active), now.toISOString(), id, input.version);
      saveVariants(db, id, variants); audit(db, actor(res).id, 'product.updated', id, now, { version: input.version + 1 });
    });
    res.json(loadProducts(db, [id], 'admin')[0]);
  });
  router.get('/plans', requireRole(), (req, res) => {
    const { ids, ...page } = pageIds(db, req, 'plans r JOIN products p ON p.id=r.primary_product_id', actor(res).role === 'customer' ? ['r.active=1', 'p.active=1'] : []);
    res.json({ items: loadPlans(db, ids), ...page });
  });
  router.get('/plans/:id', requireRole(), (req, res) => {
    const id = recordId.parse(req.params.id); const row = planRow(db, id);
    if (!row || (actor(res).role === 'customer' && (!row.active || !productRow(db, row.primary_product_id)?.active))) return missing('Plan');
    res.json(loadPlans(db, [id])[0]);
  });
  router.post('/plans', requireRole('admin'), (req, res) => {
    const input = planInputSchema.parse(req.body); const id = randomUUID(); const now = clock();
    transaction(db, () => {
      validatePlanProduct(db, input);
      db.prepare('INSERT INTO plans(id,name,primary_product_id,price,interval,min_quantity,available_from,available_to,auto_close,allow_pause,allow_renew,allow_early_close,active,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)')
        .run(id, input.name, input.primaryProductId, input.price, input.interval, input.minQuantity, input.availableFrom, input.availableTo, Number(input.autoClose), Number(input.allowPause), Number(input.allowRenew), Number(input.allowEarlyClose), Number(input.active), now.toISOString(), now.toISOString());
      audit(db, actor(res).id, 'plan.created', id, now, { version: 1 });
    });
    res.status(201).json(loadPlans(db, [id])[0]);
  });
  router.put('/plans/:id', requireRole('admin'), (req, res) => {
    const id = recordId.parse(req.params.id); const input = planUpdateSchema.parse(req.body); const now = clock();
    transaction(db, () => {
      const row = planRow(db, id); if (!row) return missing('Plan'); versionMatches(row, input.version); validatePlanProduct(db, input);
      db.prepare('UPDATE plans SET name=?,primary_product_id=?,price=?,interval=?,min_quantity=?,available_from=?,available_to=?,auto_close=?,allow_pause=?,allow_renew=?,allow_early_close=?,active=?,version=version+1,updated_at=? WHERE id=? AND version=?')
        .run(input.name, input.primaryProductId, input.price, input.interval, input.minQuantity, input.availableFrom, input.availableTo, Number(input.autoClose), Number(input.allowPause), Number(input.allowRenew), Number(input.allowEarlyClose), Number(input.active), now.toISOString(), id, input.version);
      audit(db, actor(res).id, 'plan.updated', id, now, { version: input.version + 1 });
    });
    res.json(loadPlans(db, [id])[0]);
  });
  router.get('/taxes', requireRole('admin', 'staff'), (req, res) => {
    const { ids, ...page } = pageIds(db, req, 'tax_rules r'); res.json({ items: loadTaxes(db, ids), ...page });
  });
  router.get('/taxes/:id', requireRole('admin', 'staff'), (req, res) => {
    const id = recordId.parse(req.params.id); if (!db.prepare('SELECT id FROM tax_rules WHERE id=?').get(id)) return missing('Tax rule');
    res.json(loadTaxes(db, [id])[0]);
  });
  router.post('/taxes', requireRole('admin'), (req, res) => {
    const input = taxInputSchema.parse(req.body); const id = randomUUID(); const now = clock();
    transaction(db, () => {
      if (input.productId) referenceProduct(db, input.productId);
      db.prepare('INSERT INTO tax_rules(id,name,rate_bps,product_id,priority,active,version,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)')
        .run(id, input.name, input.rateBps, input.productId, input.priority, Number(input.active), now.toISOString(), now.toISOString());
      audit(db, actor(res).id, 'tax.created', id, now, { version: 1 });
    });
    res.status(201).json(loadTaxes(db, [id])[0]);
  });
  router.put('/taxes/:id', requireRole('admin'), (req, res) => {
    const id = recordId.parse(req.params.id); const input = taxUpdateSchema.parse(req.body); const now = clock();
    transaction(db, () => {
      const row = db.prepare('SELECT * FROM tax_rules WHERE id=?').get(id) as unknown as TaxRow | undefined;
      if (!row) return missing('Tax rule'); versionMatches(row, input.version); if (input.productId) referenceProduct(db, input.productId);
      db.prepare('UPDATE tax_rules SET name=?,rate_bps=?,product_id=?,priority=?,active=?,version=version+1,updated_at=? WHERE id=? AND version=?')
        .run(input.name, input.rateBps, input.productId, input.priority, Number(input.active), now.toISOString(), id, input.version);
      audit(db, actor(res).id, 'tax.updated', id, now, { version: input.version + 1 });
    });
    res.json(loadTaxes(db, [id])[0]);
  });
  router.get('/quotation-templates', requireRole('admin', 'staff'), (req, res) => {
    const { ids, ...page } = pageIds(db, req, 'quotation_templates r'); res.json({ items: loadTemplates(db, ids), ...page });
  });
  router.get('/quotation-templates/:id', requireRole('admin', 'staff'), (req, res) => {
    const id = recordId.parse(req.params.id); if (!db.prepare('SELECT id FROM quotation_templates WHERE id=?').get(id)) return missing('Quotation template');
    res.json(loadTemplates(db, [id])[0]);
  });
  router.post('/quotation-templates', requireRole('admin'), (req, res) => {
    const input = quotationTemplateInputSchema.parse(req.body); const id = randomUUID(); const now = clock();
    transaction(db, () => {
      const plan = planRow(db, input.planId); if (!plan) throw new DomainError(400, 'PLAN_NOT_FOUND', 'Select an existing plan.', { planId: 'This plan no longer exists.' });
      if (input.active) calculateCatalogPreview(db, input.planId, input.lines, now, { enforceAvailability: false });
      else validateLines(db, plan, input.lines, false);
      db.prepare('INSERT INTO quotation_templates(id,name,plan_id,valid_days,active,version,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)')
        .run(id, input.name, input.planId, input.validDays, Number(input.active), now.toISOString(), now.toISOString());
      const insert = db.prepare('INSERT INTO quotation_template_lines(id,template_id,position,product_id,variant_id,quantity) VALUES(?,?,?,?,?,?)');
      input.lines.forEach((line, index) => insert.run(randomUUID(), id, index, line.productId, line.variantId, line.quantity));
      audit(db, actor(res).id, 'template.created', id, now, { version: 1 });
    });
    res.status(201).json(loadTemplates(db, [id])[0]);
  });
  router.put('/quotation-templates/:id', requireRole('admin'), (req, res) => {
    const id = recordId.parse(req.params.id); const input = quotationTemplateUpdateSchema.parse(req.body); const now = clock();
    transaction(db, () => {
      const row = db.prepare('SELECT * FROM quotation_templates WHERE id=?').get(id) as unknown as TemplateRow | undefined;
      if (!row) return missing('Quotation template'); versionMatches(row, input.version);
      const plan = planRow(db, input.planId); if (!plan) throw new DomainError(400, 'PLAN_NOT_FOUND', 'Select an existing plan.', { planId: 'This plan no longer exists.' });
      if (input.active) calculateCatalogPreview(db, input.planId, input.lines, now, { enforceAvailability: false });
      else validateLines(db, plan, input.lines, false);
      db.prepare('UPDATE quotation_templates SET name=?,plan_id=?,valid_days=?,active=?,version=version+1,updated_at=? WHERE id=? AND version=?')
        .run(input.name, input.planId, input.validDays, Number(input.active), now.toISOString(), id, input.version);
      db.prepare('DELETE FROM quotation_template_lines WHERE template_id=?').run(id);
      const insert = db.prepare('INSERT INTO quotation_template_lines(id,template_id,position,product_id,variant_id,quantity) VALUES(?,?,?,?,?,?)');
      input.lines.forEach((line, index) => insert.run(randomUUID(), id, index, line.productId, line.variantId, line.quantity));
      audit(db, actor(res).id, 'template.updated', id, now, { version: input.version + 1 });
    });
    res.json(loadTemplates(db, [id])[0]);
  });
  router.post('/catalog/preview', requireRole('admin', 'staff'), (req, res) => {
    const input = catalogPreviewSchema.parse(req.body);
    res.json(transaction(db, () => calculateCatalogPreview(db, input.planId, input.lines, clock())));
  });
  return router;
}
