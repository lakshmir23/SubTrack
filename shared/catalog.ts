import { z } from 'zod';
import { MAX_MINOR } from './money.js';

export const catalogMoneyLimit = MAX_MINOR;
export const productTypes = ['software', 'service', 'addon'] as const;
export const planIntervals = ['daily', 'weekly', 'monthly', 'yearly'] as const;
const id = z.string().uuid('Select an existing record.');
const name = z.string().trim().min(2, 'Enter at least 2 characters.').max(100);
const money = z.number().int('Use an exact amount in minor units.').min(0).max(catalogMoneyLimit);
const quantity = z.number().int('Use a whole quantity.').min(1, 'Use at least one unit.').max(10_000);
export const catalogDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.').refine(value => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return value >= '1900-01-01' && value <= '9999-12-31' && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Enter a real calendar date.');
export const productVariantInputSchema = z.object({
  id: id.optional(), name, adjustment: z.number().int().min(-catalogMoneyLimit).max(catalogMoneyLimit), active: z.boolean(),
}).strict();
export const productInputSchema = z.object({
  name, type: z.enum(productTypes), salesPrice: money, costPrice: money,
  notes: z.string().trim().max(2_000), active: z.boolean(), variants: z.array(productVariantInputSchema).max(50),
}).strict();
export const productUpdateSchema = productInputSchema.extend({ version: z.number().int().positive() });
export const planInputSchema = z.object({
  name, primaryProductId: id, price: money, interval: z.enum(planIntervals), minQuantity: quantity,
  availableFrom: catalogDateSchema.nullable(), availableTo: catalogDateSchema.nullable(),
  autoClose: z.boolean(), allowPause: z.boolean(), allowRenew: z.boolean(), allowEarlyClose: z.boolean(), active: z.boolean(),
}).strict().refine(value => !value.availableFrom || !value.availableTo || value.availableFrom <= value.availableTo,
  { path: ['availableTo'], message: 'Availability end must be on or after its start.' });
export const planUpdateSchema = planInputSchema.safeExtend({ version: z.number().int().positive() });
export const taxInputSchema = z.object({
  name, rateBps: z.number().int().min(0).max(10_000), productId: id.nullable(),
  priority: z.number().int().min(0).max(10_000), active: z.boolean(),
}).strict();
export const taxUpdateSchema = taxInputSchema.extend({ version: z.number().int().positive() });
export const catalogLineInputSchema = z.object({ productId: id, variantId: id.nullable(), quantity }).strict();
export const quotationTemplateInputSchema = z.object({
  name, planId: id, validDays: z.number().int().min(1).max(3_650),
  lines: z.array(catalogLineInputSchema).min(1, 'Add the plan’s primary product.').max(50), active: z.boolean(),
}).strict();
export const quotationTemplateUpdateSchema = quotationTemplateInputSchema.extend({ version: z.number().int().positive() });
export const catalogPreviewSchema = z.object({ planId: id, lines: z.array(catalogLineInputSchema).min(1).max(50) }).strict();

export type ProductInput = z.infer<typeof productInputSchema>;
export type ProductVariantInput = z.infer<typeof productVariantInputSchema>;
export type PlanInput = z.infer<typeof planInputSchema>;
export type TaxRuleInput = z.infer<typeof taxInputSchema>;
export type CatalogLineInput = z.infer<typeof catalogLineInputSchema>;
export type QuotationTemplateInput = z.infer<typeof quotationTemplateInputSchema>;
export interface CatalogRecord { id: string; version: number; createdAt: string; updatedAt: string }
export interface ProductVariant { id: string; name: string; adjustment: number; active: boolean }
export interface Product extends CatalogRecord {
  name: string; type: ProductInput['type']; salesPrice: number; costPrice?: number; notes?: string;
  active: boolean; variants: ProductVariant[];
}
export interface Plan extends PlanInput, CatalogRecord { primaryProductName: string }
export interface TaxRule extends TaxRuleInput, CatalogRecord { productName: string | null }
export interface QuotationTemplate extends QuotationTemplateInput, CatalogRecord { planName: string }
export interface CatalogPreviewLine extends CatalogLineInput {
  productName: string; variantName: string | null; isPrimary: boolean;
  baseUnitPrice: number; variantAdjustment: number; unitPrice: number; subtotal: number;
  taxId: string | null; taxName: string | null; taxRateBps: number; tax: number; total: number;
}
export interface CatalogPreview {
  planId: string; planName: string; currency: 'INR'; businessDate: string;
  lines: CatalogPreviewLine[]; subtotal: number; tax: number; total: number; priceExplanation: string;
}

// Prices are integer INR minor units. PUT is the complete input plus its last-read version.
// Staff product DTOs omit costPrice; customer DTOs also omit notes and inactive variants.
// Tax selection: one active rule by ascending priority, product scope before global at a tie,
// then stable rule ID. Tax is exclusive, rounded half-up per line using exact integer arithmetic.
