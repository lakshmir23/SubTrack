import { z } from 'zod';
import type { Delivery } from './contracts.js';

export const invoiceSendSchema = z.object({ idempotencyKey: z.string().uuid('Use a valid submission key.') }).strict();
export const invoiceDeliveryListSchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export interface InvoiceDelivery extends Delivery { invoiceId: string }

// POST /api/invoices/:id/send {idempotencyKey} returns InvoiceDelivery: 201 first,
// 200 exact replay. Keys bind the internal actor and invoice. The recipient is the
// saved invoice customer email; the browser cannot supply or override it.
// GET /api/invoices/:id/deliveries returns Page<InvoiceDelivery>, internal only.
// generated means queued/outbox generation; accepted means SMTP acceptance only.
// GET /api/invoices/:id/print returns escaped printable HTML, own customer or internal.
