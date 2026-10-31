import { Router } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { User } from '../shared/contracts.js';
import type { Invoice } from '../shared/billing.js';
import { formatMoney } from '../shared/money.js';
import { invoiceDeliveryListSchema, invoiceSendSchema, type InvoiceDelivery } from '../shared/invoice-output.js';
import { serializeInvoice } from './billing.js';
import { transaction } from './database.js';
import { DomainError } from './errors.js';
import { audit, digest, requireRole } from './security.js';

const invoiceIdSchema = z.string().uuid('Select an existing invoice.');
interface DeliveryRow {
  id: string; invoice_id: string; recipient: string; subject: string; created_at: string;
  status: 'generated' | 'accepted' | 'failed' | 'unknown'; claimed_at: string | null; error: string | null;
}
const deliverySelect = 'SELECT o.id,r.invoice_id,o.recipient,o.subject,o.created_at,o.status,o.claimed_at,o.error FROM invoice_send_requests r JOIN outbox o ON o.id=r.outbox_id';
function deliveryDto(row: DeliveryRow): InvoiceDelivery {
  return { id: row.id, invoiceId: row.invoice_id, recipient: row.recipient, subject: row.subject, createdAt: row.created_at,
    status: row.status === 'generated' && row.claimed_at ? 'sending' : row.status, error: row.error };
}
function internalUser(db: DatabaseSync, actorId: string): User {
  const row = db.prepare('SELECT id,name,email,role,created_at FROM users WHERE id=?').get(actorId) as { id: string; name: string; email: string; role: User['role']; created_at: string } | undefined;
  if (!row || !['admin', 'staff'].includes(row.role)) throw new DomainError(403, 'FORBIDDEN', 'Your account cannot send invoice notices.');
  return { id: row.id, name: row.name, email: row.email, role: row.role, createdAt: row.created_at };
}
const oneLine = (value: string) => value.replace(/[\r\n]+/g, ' ');
function invoiceEmail(invoice: Invoice): { subject: string; body: string } {
  const subject = `TEST · SubTrack invoice ${oneLine(invoice.number)} · ${invoice.status}`;
  const lines = invoice.lines.map(line => `${oneLine(line.productName)}${line.variantName ? ` / ${oneLine(line.variantName)}` : ''}\n  ${line.quantity} × ${formatMoney(line.unitPrice)}; discount ${formatMoney(line.discount)}; tax ${formatMoney(line.tax)}; line total ${formatMoney(line.total)}`).join('\n\n');
  return { subject, body: [
    'CONTROLLED TEST MESSAGE — NOT A PAYMENT REQUEST',
    'This synthetic invoice notice verifies the SubTrack delivery workflow. Do not transfer money or make a payment in response to this message.',
    '', `Brightloop Software · ${invoice.number}`, `Status: ${invoice.status}${invoice.status === 'Draft' ? ' — review copy; not collectible' : ''}`,
    `Customer: ${oneLine(invoice.customerName)} <${invoice.customerEmail}>`, `Subscription: ${invoice.subscriptionNumber}`,
    `Service period: [${invoice.periodStart}, ${invoice.periodEnd})`, `Issue date: ${invoice.issueDate}`, `Due date: ${invoice.dueDate}`,
    '', lines, '', `Subtotal: ${formatMoney(invoice.subtotal)}`, `Discount: ${formatMoney(invoice.discount)}`,
    `Tax: ${formatMoney(invoice.tax)}`, `Saved invoice total: ${formatMoney(invoice.total)}`, `Recorded payments: ${formatMoney(invoice.amountPaid)}`,
    `Remaining balance: ${formatMoney(invoice.outstanding)}${invoice.status === 'Draft' ? ' (not collectible before confirmation)' : ''}`, '',
    'Amounts come from this invoice’s saved financial snapshot. Sending this notice does not confirm, cancel or settle the invoice.',
    'SMTP acceptance is recorded separately from actual inbox receipt.',
  ].join('\n') };
}

/** Queues one controlled notice. The existing SMTP worker owns actual delivery and its allowlist. */
export function enqueueInvoiceEmail(db: DatabaseSync, invoiceId: string, idempotencyKey: string, actorId: string, now: Date): { delivery: InvoiceDelivery; created: boolean } {
  invoiceIdSchema.parse(invoiceId);
  invoiceSendSchema.parse({ idempotencyKey });
  const user = internalUser(db, actorId);
  const payloadHash = digest(JSON.stringify([invoiceId]));
  return transaction(db, () => {
    const prior = db.prepare('SELECT actor_id,invoice_id,payload_hash,outbox_id FROM invoice_send_requests WHERE idempotency_key=?').get(idempotencyKey) as { actor_id: string; invoice_id: string; payload_hash: string; outbox_id: string } | undefined;
    if (prior) {
      if (prior.actor_id !== actorId || prior.invoice_id !== invoiceId || prior.payload_hash !== payloadHash) throw new DomainError(409, 'IDEMPOTENCY_CONFLICT', 'This send key belongs to a different request. Review the invoice before starting a new notice.');
      const saved = db.prepare(`${deliverySelect} WHERE r.idempotency_key=?`).get(idempotencyKey) as unknown as DeliveryRow | undefined;
      if (!saved) throw new DomainError(409, 'DELIVERY_EXCEPTION', 'This saved delivery could not be found. Review its delivery history before sending another notice.');
      return { delivery: deliveryDto(saved), created: false };
    }
    const invoice = serializeInvoice(db, invoiceId, user, now);
    const current = db.prepare('SELECT current_invoice_id FROM logical_charges WHERE id=?').get(invoice.logicalChargeId);
    if (current?.current_invoice_id !== invoice.id) throw new DomainError(409, 'INVOICE_SUPERSEDED', 'This invoice has a newer replacement. Open the current revision before sending a notice.');
    if (invoice.status === 'Canceled') throw new DomainError(409, 'INVOICE_CANCELED', 'A canceled invoice cannot be sent. Review the charge and create an explicit replacement if appropriate.');
    const message = invoiceEmail(invoice); const id = randomUUID();
    db.prepare("INSERT INTO outbox(id,recipient,subject,body,created_at,status) VALUES(?,?,?,?,?,'generated')")
      .run(id, invoice.customerEmail, message.subject, message.body, now.toISOString());
    db.prepare('INSERT INTO invoice_send_requests(idempotency_key,actor_id,invoice_id,payload_hash,outbox_id,created_at) VALUES(?,?,?,?,?,?)')
      .run(idempotencyKey, actorId, invoice.id, payloadHash, id, now.toISOString());
    db.prepare('INSERT INTO invoice_history(id,invoice_id,actor_id,kind,created_at,from_status,to_status,message,request_version) VALUES(?,?,?,?,?,?,?,?,NULL)')
      .run(randomUUID(), invoice.id, actorId, 'email_queued', now.toISOString(), invoice.status, invoice.status, 'A controlled test notice was queued for the saved customer email. Invoice settlement is unchanged.');
    audit(db, actorId, 'invoice.email_queued', invoice.id, now, { deliveryId: id });
    return { delivery: { id, invoiceId: invoice.id, recipient: invoice.customerEmail, subject: message.subject, createdAt: now.toISOString(), status: 'generated', error: null }, created: true };
  });
}

export const escapeInvoiceHtml = (value: string | number) => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
function dateLabel(date: string): string {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}

/** Saved values only. No remote assets, provider calls, financial recalculation or state changes. */
export function renderInvoicePrint(invoice: Invoice, nonce: string): string {
  const html = escapeInvoiceHtml;
  const amount = (value: number) => html(formatMoney(value));
  const tableAmount = (value: number) => {
    const formatted = formatMoney(value);
    return `<span class="money${formatted.length > 16 ? ' compact' : ''}">${html(formatted)}</span>`;
  };
  const statusNote = invoice.status === 'Draft' ? 'Draft · review copy. This invoice is not collectible until confirmed.'
    : invoice.status === 'Canceled' ? 'Canceled · not collectible. Original amounts are retained for history.'
    : invoice.status === 'Paid' ? 'Paid · the remaining balance is zero.' : 'Confirmed · recorded payments and the remaining balance are shown below.';
  const rows = invoice.lines.map(line => `<tr><td><strong>${html(line.productName)}</strong>${line.variantName ? `<span class="detail">${html(line.variantName)}</span>` : ''}</td><td class="number">${html(line.quantity)}</td><td class="number">${tableAmount(line.unitPrice)}</td><td class="number">${tableAmount(line.discount)}</td><td class="number">${tableAmount(line.tax)}<span class="detail">${html(line.taxRateBps / 100)}%${line.taxRuleName ? ` · ${html(line.taxRuleName)}` : ''}</span></td><td class="number">${tableAmount(line.total)}</td></tr>`).join('');
  return `<!doctype html><html lang="en-IN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(invoice.number)} · Brightloop invoice</title><style nonce="${html(nonce)}">
    @page{size:A4;margin:16mm 14mm}*{box-sizing:border-box}html{color:#192b3d;background:#edf1f5;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5}body{margin:0;padding:24px}.toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px;max-width:960px;margin:0 auto 20px}.toolbar p{margin:0;color:#435366}.print-button{border:0;border-radius:6px;padding:12px 18px;min-height:44px;background:#234a73;color:#fff;font:inherit;font-weight:600;cursor:pointer}.print-button:hover{background:#173b60}.print-button:focus-visible{outline:3px solid #386da3;outline-offset:3px}.paper{max-width:960px;margin:auto;padding:42px;background:white}.heading{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;border-bottom:1px solid #b4c1cf;padding-bottom:22px}.brand{font-weight:700;font-size:18px;margin:0 0 6px}.muted,.detail{color:#435366}.detail{display:block;font-size:12px;font-weight:400;white-space:normal;overflow-wrap:anywhere}h1{font-size:30px;line-height:1.2;margin:0 0 7px}h2{font-size:14px;margin:0 0 6px}.document-number{text-align:right;font-variant-numeric:tabular-nums}.status{display:inline-block;border:1px solid #8a9bad;padding:3px 9px;border-radius:4px;font-size:13px}.status-note{padding:12px 0;margin:0;border-bottom:1px solid #b4c1cf;font-weight:600}.metadata{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin:24px 0}.metadata p{margin:0;overflow-wrap:anywhere}.metadata dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:5px 18px}.metadata dt{color:#435366}.metadata dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}table{border-collapse:collapse;width:100%;table-layout:fixed;margin:20px 0 0}th,td{padding:11px 7px;border-bottom:1px solid #d3dbe4;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{font-size:12px;background:#eef3f8;font-weight:700}th:first-child,td:first-child{padding-left:0;width:29%}th:nth-child(2){width:7%}th:last-child,td:last-child{padding-right:0}.number{text-align:right;font-variant-numeric:tabular-nums;white-space:normal;overflow-wrap:anywhere}.totals{width:330px;max-width:100%;margin:24px 0 0 auto;break-inside:avoid}.totals dl{display:grid;grid-template-columns:1fr auto;gap:9px 20px;margin:0}.totals dt,.totals dd{margin:0}.totals dd{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.total{font-size:18px;font-weight:700;border-top:1px solid #8a9bad;padding-top:10px}.balance{font-weight:700}.footnote{border-top:1px solid #d3dbe4;padding-top:18px;margin:28px 0 0;color:#435366;font-size:12px;break-inside:avoid}.footnote p{margin:6px 0}thead{display:table-header-group}tr{break-inside:avoid}a{color:inherit}@media(max-width:640px){body{padding:14px}.paper{padding:20px}.heading{gap:15px}.metadata{grid-template-columns:1fr}h1{font-size:25px}table{font-size:11px}th,td{padding:8px 3px}.detail{font-size:10px}.number{white-space:normal}.toolbar{align-items:flex-start}.toolbar p{font-size:12px}}@media print{html{background:white;font-size:10pt}body{padding:0}.toolbar{display:none}.paper{max-width:none;padding:0}.heading{padding-bottom:16px}.metadata{margin:18px 0}th{background:#eef3f8!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.number{white-space:normal;font-size:9pt}}@media(max-width:640px){.heading{flex-direction:column}.document-number{text-align:left}}
    .money{display:inline-block;white-space:nowrap}.money.compact{font-size:.84em}.closing-block{break-inside:avoid;page-break-inside:avoid}@media print{.money.compact{font-size:7.5pt}}
  </style></head><body><div class="toolbar"><p>Print this saved invoice or choose “Save as PDF” in your browser.</p><button class="print-button" id="print-invoice" type="button">Print invoice</button></div><main class="paper"><header class="heading"><div><p class="brand">Brightloop Software</p><p class="muted">SubTrack · subscription invoice</p></div><div class="document-number"><h1>${html(invoice.number)}</h1><span class="status">${html(invoice.status)}</span><span class="detail">Revision ${html(invoice.revisionNumber)} · ${html(invoice.currency)}</span></div></header><p class="status-note">${html(statusNote)}</p><section class="metadata" aria-label="Invoice details"><div><h2>Bill to</h2><p><strong>${html(invoice.customerName)}</strong><br>${html(invoice.customerEmail)}</p><p class="detail">Subscription ${html(invoice.subscriptionNumber)}</p></div><dl><dt>Issued</dt><dd>${html(dateLabel(invoice.issueDate))}</dd><dt>Due</dt><dd>${html(dateLabel(invoice.dueDate))}</dd><dt>Service period</dt><dd>${html(dateLabel(invoice.periodStart))} – ${html(dateLabel(invoice.periodEnd))}<span class="detail">End date excluded</span></dd></dl></section><table><thead><tr><th scope="col">Product / variant</th><th scope="col" class="number">Qty</th><th scope="col" class="number">Unit price</th><th scope="col" class="number">Discount</th><th scope="col" class="number">Tax</th><th scope="col" class="number">Amount</th></tr></thead><tbody>${rows}</tbody></table><div class="closing-block"><section class="totals" aria-label="Invoice totals"><dl><dt>Subtotal</dt><dd>${amount(invoice.subtotal)}</dd><dt>Discount</dt><dd>−${amount(invoice.discount)}</dd><dt>Tax</dt><dd>${amount(invoice.tax)}</dd><dt class="total">${invoice.status === 'Draft' ? 'Draft total' : 'Invoice total'}</dt><dd class="total">${amount(invoice.total)}</dd><dt>Recorded payments</dt><dd>${amount(invoice.amountPaid)}</dd><dt class="balance">${invoice.status === 'Canceled' ? 'Collectible balance' : invoice.status === 'Draft' ? 'Balance after confirmation' : 'Remaining balance'}</dt><dd class="balance">${amount(invoice.outstanding)}</dd></dl></section><footer class="footnote">${invoice.discountSnapshot ? `<p>Discount: ${html(invoice.discountSnapshot.name)} · ${amount(invoice.discount)}. Its eligibility was saved on ${html(dateLabel(invoice.discountSnapshot.eligibilityDate))}.</p>` : ''}<p>All line prices, discount allocations and taxes shown above come from this invoice’s saved financial snapshot. Printing does not change its status or recorded payments.</p><p>No payment request is issued by this view. Configured demonstration taxes are not a claim of statutory compliance.</p></footer></div></main><script nonce="${html(nonce)}">document.getElementById('print-invoice').addEventListener('click',function(){window.print();});</script></body></html>`;
}

export function invoiceOutputRoutes(db: DatabaseSync, clock: () => Date): Router {
  const router = Router();
  router.post('/invoices/:id/send', requireRole('admin', 'staff'), (req, res) => {
    const id = invoiceIdSchema.parse(req.params.id); const input = invoiceSendSchema.parse(req.body);
    const result = enqueueInvoiceEmail(db, id, input.idempotencyKey, (res.locals.user as User).id, clock());
    res.status(result.created ? 201 : 200).json(result.delivery);
  });
  router.get('/invoices/:id/deliveries', requireRole('admin', 'staff'), (req, res) => {
    const id = invoiceIdSchema.parse(req.params.id); const input = invoiceDeliveryListSchema.parse(req.query);
    res.json(transaction(db, () => {
      if (!db.prepare('SELECT id FROM invoices WHERE id=?').get(id)) throw new DomainError(404, 'NOT_FOUND', 'This invoice was not found.');
      const total = Number(db.prepare('SELECT count(*) AS count FROM invoice_send_requests WHERE invoice_id=?').get(id)?.count);
      const page = Math.min(input.page, Math.max(1, Math.ceil(total / input.pageSize)));
      const rows = db.prepare(`${deliverySelect} WHERE r.invoice_id=? ORDER BY o.created_at DESC,o.id LIMIT ? OFFSET ?`).all(id, input.pageSize, (page - 1) * input.pageSize) as unknown as DeliveryRow[];
      return { items: rows.map(deliveryDto), total, page, pageSize: input.pageSize };
    }, 'read'));
  });
  router.get('/invoices/:id/print', requireRole(), (req, res) => {
    const id = invoiceIdSchema.parse(req.params.id); const user = res.locals.user as User;
    const invoice = transaction(db, () => serializeInvoice(db, id, user, clock()), 'read');
    const nonce = randomBytes(18).toString('base64');
    res.setHeader('Content-Security-Policy', `default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'`);
    res.setHeader('Content-Disposition', `inline; filename="${invoice.number.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 100)}.html"`);
    res.type('html').send(renderInvoicePrint(invoice, nonce));
  });
  return router;
}
