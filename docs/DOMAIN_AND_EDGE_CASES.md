# Brightloop: domain, billing invariants and edge cases

> **Documentation only, revised 31 October 2026 after inspecting all four pages of the supplied Subscription Management System problem statement.** This replaces the earlier title-only hypotheses. Required behavior below comes from that statement; implementation choices and unresolved semantics are explicitly marked. No tests or performance results are claimed as completed.
>
> The user-confirmed [hackathon constraints](HACKATHON_CONSTRAINTS.md) apply throughout: dynamic database-backed data, clean responsive UI, robust validation, intuitive navigation and genuine Git participation by every teammate. Prefer understandable code and a reliable local database/API over fashionable infrastructure.

## 1. What the actual brief makes non-negotiable

Brightloop sells subscription software, services and products with variants. Admin configures products, plans, taxes and discounts; internal staff handles daily work with limited access; customers see only their own subscriptions and invoices through a portal.

The [verified requirements matrix](REQUIREMENTS.md) is the authoritative cross-reference. The baseline is now **the entire ordinary billing month**, not just an attractive recurring-payment demo:

- Unique-email signup, password rules, reset links and role-scoped access; only admin adds staff.
- Product name/type/sales price/cost price, variant pricing, recurring plans and availability policies.
- Reusable quotation templates with validity; subscription commercial lines and exact progression **Draft → Quotation → Confirmed → Active**.
- Batch invoice generation from subscriptions, automatic taxes, confirm/cancel/send/print actions and **Draft → Confirmed → Paid** progression, without duplicate or skipped bills.
- Admin-only fixed/percentage discounts with purchase/quantity thresholds, dates, usage limits, product/subscription targeting and automatic next-invoice application/expiry.
- Payments against invoices with method, amount, date and note; accurate paid/outstanding balances, including partial payments.
- Filtered finance views for active subscriptions, revenue, payments and overdue invoices, with summary and **under-two-second page responses at thousands of subscriptions**.

**Not stated as requirements:** a live payment gateway, stored cards, automated charging, AI agents, multi-tenancy, proration, a time-travel UI or a full accounting ledger. Do not let these displace required workflows.

## 2. Relational model: the smallest credible complete system

This is a proposed schema, not a claim that the brief prescribes table names. Every list below needs database constraints and server validation; client validation is additional UX.

| Entity | Minimum information | Design reason / invariant |
|---|---|---|
| **User** | ID, normalized unique email, password hash, role, enabled flag | One account per email. Signup creates customer role only; admin creates staff. Never trust a submitted role. |
| **Customer** | ID, linked user where applicable, name/contact/billing details | Commercial identity separate from authentication; staff may prepare quotes for a customer. |
| **PasswordResetToken** | User, token hash, expiry, consumed timestamp | Single-use reset links; never store plaintext passwords or reset tokens. |
| **Product** | ID, name, type, base sales price, cost price, currency, active flag | Cost is internal, never exposed in the portal. Referenced products are archived, not deleted. |
| **VariantAttribute / VariantValue** | Attribute name and value, e.g. Brand → Odoo | Distinguish named attributes from individual saleable variants. |
| **ProductVariant** | Product, unique combination/SKU, attribute values, sales-price adjustment or explicit price | Brief example: choosing brand **Odoo adds 560**. Store a numeric adjustment, not a name-specific UI calculation. Currency is not specified by that example. |
| **Plan** | Name, price and currency, interval enum daily/weekly/monthly/yearly, positive interval count if supported, minimum quantity, available-from/to, auto-close-at-end, allow-early-close/pause/renew | Policies belong to the plan and must be enforced by actions, not only displayed. |
| **PriceVersion / CommercialTermsVersion** | Product/variant, plan or pricing context, currency, accepted unit price and policy snapshot/version | Proposed lightweight versioning: catalog edits must not silently reprice accepted agreements. Immutable snapshots can replace a separate version table if simpler. |
| **QuotationTemplate / TemplateLine** | Name, plan/default terms, validity days, product/variant lines and default quantities/prices | Copy to a new subscription quote; later template edits do not mutate existing quotations. |
| **Subscription** | Unique human-facing number, customer, plan, start date, expiry date, payment terms, quotation-valid-until, stage, operational state, next billing boundary, version | Preserves required commercial fields and separates sales progression from pause/close behavior. |
| **SubscriptionLine** | Subscription, product/variant, quantity, accepted unit price, tax references/snapshots, computed amount | Snapshot accepted price and terms on confirmation; retain history for later changes. |
| **TaxRule** | Name, rate, applicable products/type if needed, enabled/effective dates, inclusive/exclusive policy | Admin-managed automatic calculation. Snapshot applied tax on finalized invoice lines. |
| **Invoice / InvoiceLine** | Number, subscription/customer, charge period, issue/due date, currency, state; copied lines, quantities, prices, tax/discount amounts and totals | Reproducible financial document; historical display must survive catalog edits. |
| **DiscountRule / DiscountTarget** | Fixed/percentage value, min purchase/quantity, start/end, usage limit, enabled flag, target products or subscriptions | Admin-only authoring. Eligibility checked at billing time, not by a stale browser preview. |
| **DiscountApplication** | Rule, invoice and optional line, calculated amount, usage reservation/consumption state | Evidence of why a bill changed, plus a transactional record for enforcing a global limit. |
| **Payment** | Invoice, method, positive amount, currency, payment date, note, recorder, unique submission key, optional external reference | Core requirement: manual recording supports partial payment. Payment is a money fact, not just a `paid` checkbox. |
| **LifecycleEvent** | Entity references, type, actor, timestamp, correlation key, safe structured details | Append-only application audit trail for actual persisted transitions. |
| **InvoiceDelivery** (small optional table) | Invoice, destination, delivery status/time, message reference | Useful evidence for Send. If email delivery is unavailable, expose a truthful pending/failed status rather than fake success. |

### Cardinalities and shortcuts that remain defensible

A customer has many subscriptions; a subscription has many lines and invoices; an invoice has many lines and payments. A plan has many subscriptions. A rule has many target records and applications.

One invoice per recurring period is the proposed baseline. All lines on a subscription share its plan cadence. Multiple cadences require separate subscriptions unless clarified otherwise. One configured currency simplifies the build; do not silently combine different currencies in finance totals.

Use integer or UUID internal keys consistently; neither is inherently a judging advantage. Customer-facing subscription/invoice numbers must be unique. Opaque IDs do not replace ownership checks.

## 3. Authentication and permissions are part of correctness

**Explicit password requirement:** more than eight characters (**at least nine**), at least one uppercase, one lowercase and one special character. Digits may be allowed but are not specified as mandatory. Apply checks server-side; choose a clear special-character policy and display it. Use established password hashing and session libraries, never homemade cryptography.

Normalize email consistently for uniqueness (proposed: trim and lowercase); enforce a database unique index, including concurrent signups. Reset links go only to the registered address, expire, are single-use and contain high-entropy tokens. Return the same public response for known/unknown addresses to reduce account enumeration. Rate-limit login/reset attempts. Never expose secrets in logs or repository files.

| Action | Admin | Internal staff | Customer |
|---|---|---|---|
| Add staff / manage roles | Yes | No | No |
| Product/plan/tax configuration | Yes | Read unless explicitly granted | Published information only |
| Create/edit discount rules | Yes | No | No |
| Prepare quotes/manage subscriptions | Yes | Within day-to-day permission | Own records/actions permitted by plan |
| Generate/confirm invoices, record payments | Yes | Proposed day-to-day permission | Read own bills; no ability to mark paid |
| Send/print invoice | Yes | Authorized scope | Own invoice print/download |
| Finance-wide filters and summary | Yes | Grant only relevant finance permission | No cross-customer data |

Staff scope above is a **proposed least-privilege interpretation**, since the brief says limited access without enumerating permissions. Enforce it server-side. Explicitly prevent changing a URL/customer ID to retrieve somebody else's invoice, receipt, subscription or PDF. Protect cost price and internal payment notes from portal serialization.

## 4. State transitions and policy boundaries

### Required subscription progression

**Draft → Quotation → Confirmed → Active** must remain visible. Do not replace it with a generic active/inactive toggle.

- **Draft:** editable preparation; apply/copy a quotation template.
- **Quotation:** offer issued with validity date and price/product lines. Expired offers cannot be confirmed without explicit renewal/reissue.
- **Confirmed:** customer agreement recorded; freeze accepted commercial snapshots and validate dates, quantity, plan availability and payment terms.
- **Active:** service has started according to start date/activation policy and is eligible for recurring billing. The brief does not require a successful-payment gate for activation; do not invent one.

Pause/close is a separate operational status or explicit extension to that progression. Proposed representation: stage plus `running/paused/closed`, with paused/closed relevant only after activation. Plan permissions control whether staff/customer may pause, renew or close early.

**Unresolved business semantics to decide openly:** Does pause stop billing, extend expiry, or only suspend service? Is renewal a new term on the same contract or a linked new contract? Does plan availability limit new sales only or existing renewals too? Proposed baseline: availability controls new acceptance; existing accepted terms remain honored; pause blocks future invoice generation without silently shifting dates; renewal is an explicit new term with recorded dates. Document any alternative before implementing it.

Auto-close at expiry must stop billing beyond the agreed term. Early close preserves historical invoices and recorded payments. Closing service does not erase unpaid debt or imply a refund.

### Required invoice progression

**Draft → Confirmed → Paid**, with **Canceled** as an explicit cancellation outcome.

- Draft can be reviewed/edited and is not collectible.
- Confirm validates calculated totals and freezes the financial snapshot.
- Partial payment leaves invoice **Confirmed**, with a partial-payment label and outstanding balance.
- Paid is derived from full valid payment allocation, not manually toggled.
- Cancel is permitted only according to a clear policy. Proposed baseline: no cancellation of an invoice with recorded money; require reversal/credit workflow if later implemented. Never delete payments to make cancellation possible.
- Print/download and send do not change settlement status. A failed email send must not pretend delivery succeeded.

Overdue is a derived flag: Confirmed, positive balance, and due date earlier than business date. Specify whether due dates end at local midnight; don't label today's due invoice overdue prematurely.

## 5. Batch billing without duplicate or skipped invoices

This is an explicit requirement, not an optional showcase.

1. Query active, unpaused subscriptions whose next billing boundary is due.
2. Lock/version-check each subscription independently in a short transaction.
3. Recheck expiry, operational status and existing charge identity.
4. Build the invoice with customer, accepted product/variant lines, applicable discounts, taxes, totals and due date already populated.
5. Persist invoice, discount applications, audit event and billing-cursor advancement together.
6. Commit each subscription independently; report created/already-existing/failed counts with retryable errors. One bad subscription must not silently lose the rest of the batch.

Use a unique key such as `(subscription_id, period_start, period_end, charge_kind)` for recurring charges. Repeated clicks, scheduler retries and two workers must return the same invoice for the same period. A failure before commit cannot advance the cursor. A failure after commit cannot create another invoice on retry.

**Never skip backlog:** if more than one period is due, process due boundaries in order up to a documented batch limit and expose remaining work. Do not set `next_bill = today + interval`, which silently discards missed periods.

**Cancellation nuance:** a canceled invoice still occupies its original charge identity. Do not let a routine rerun recreate it. If replacement is needed, require an explicit linked revision/replacement action. If the intended bill was canceled accidentally, show an exception for staff; “no duplicates” must not hide unbilled debt.

**Expiry nuance:** define whether a final partial period is disallowed, billed in full, or prorated. Proration is not specified. For the baseline, choose dates aligned to full plan periods and validate them, or explicitly support a documented final-period policy.

## 6. Tax, variant price and discount calculations

### Commercial amounts

The plan has its own configured price as required. Clarify whether that price is a base fee, a recurring rate for its products, or a total offer price before combining it with product/variant lines; do not double-count a plan fee and its included products. Snapshot the chosen mapping in accepted terms.

Store money in integer minor units of the configured currency (or appropriate fixed-precision decimals); never binary floating-point money. Currency scale is configured, not universally assumed to be two decimals. Snapshot both base price and variant adjustment, or their accepted total, so the Brand=Odoo **+560** example is explainable.

Quantity × accepted unit price gives the pre-adjustment line base. The server calculates totals; client-submitted totals are untrusted. Cost price is not part of the customer invoice calculation.

### Proposed explicit calculation policy

The brief requires taxes and discounts but does not define precedence. Proposed baseline:

1. Compute accepted line bases.
2. Evaluate discount thresholds against eligible **pre-discount, pre-tax** bases/quantities.
3. Apply selected discount and allocate invoice-wide fixed discounts deterministically across eligible lines.
4. Calculate exclusive percentage tax on discounted line base.
5. Round per line using documented half-up minor-unit rounding; sum rounded values.

This is a product policy, not legal tax advice or a claim of GST compliance. Inclusive taxes, compound taxes, stacked discounts and tax exemptions are not specified. If supported, define them explicitly rather than producing arbitrary totals.

### Discount edge cases that matter

- Percentage must be in a valid range, proposed 0–100%; fixed amount nonnegative and capped at eligible base so it cannot create a negative bill.
- Store whether minimum purchase, minimum quantity or both are required. If both are set, proposed policy is both must pass. For product rules, count eligible product lines only.
- Dates and usage limits are checked when the next invoice is created, not merely when the rule was attached to a contract. End-date boundary and business timezone must be explicit.
- **One use = one finalized invoice application**, not one unit or line, is a proposed definition; document it in admin UI.
- If draft generation applies a usage-limited rule, reserve its usage transactionally. Confirmation consumes the reservation; cancellation of an unpaid draft releases it under an explicit policy. Otherwise several drafts can all promise the last remaining discount.
- Lock/update the rule counter and insert its application in the same transaction. Concurrent invoices must not exceed the usage limit.
- Global limit and per-customer limit are different concepts. The brief only specifies a usage limit; do not invent per-customer semantics silently.
- Choose one deterministic non-stacking policy initially, such as admin priority then rule ID. Show the applied rule and amount. If multiple rules match, do not apply them in unpredictable database-return order.
- Existing confirmed invoices never change when a discount expires or is edited. Expiry affects future invoices automatically.

## 7. Recording payments and maintaining balances

Payment recording is core; a gateway is not required. Record method, amount, date and note against the correct confirmed invoice. The payment date is the financial event date; also preserve recorded-at timestamp and actor for audit.

**Balance = finalized invoice total − sum of valid allocated payments.** Recompute or transactionally maintain it from persisted facts. Use invoice locking/version checks when concurrent payments are entered.

Example: invoice total 1,000; record 400 → balance 600, Confirmed/partially paid. Record 600 → balance 0, Paid. Finance summary, invoice detail and portal must agree immediately after commit.

Reject zero/negative amounts and wrong currency. Proposed baseline rejects amounts greater than outstanding balance rather than inventing customer credit handling. Duplicate-submit keys prevent a double-click from recording the same payment twice. Two legitimate equal payments on the same date are still possible, so amount/date alone must not be treated as a unique identity.

Corrections need an explicit reversal record linked to the original payment, not deletion or silent editing after finalization. If reversal is not in scope, restrict corrections and show a clear limitation. Do not permit arbitrary payment dates outside validated formats or blindly accept a note as trusted HTML.

**Optional future gateway:** add PaymentAttempt separate from Payment. A timeout is unknown, not declined; reconcile before retry. Confirmed provider events need unique IDs and cannot regress a paid invoice. This remains stretch work and must not delay manual payment requirements.

## 8. Finance summary and the under-two-second requirement

Use database-backed filters and pagination; do not load thousands of records into the browser and hide most rows. Suggested indexes: subscription stage/operational state and next-bill date; customer foreign keys; invoice status/due date; payment date/invoice; unique billing identity. Validate actual query plans rather than adding every possible index.

Define dashboard labels precisely:

- **Active subscriptions:** active-stage, running contracts as of the selected date, excluding closed/expired according to policy.
- **Revenue received:** valid payments in selected payment-date range. Label this cash received, not accounting revenue recognition.
- **Outstanding:** invoice totals less valid payments for included non-canceled confirmed invoices.
- **Overdue:** positive outstanding with due date before the chosen business date.
- **Billed amount:** separate from cash received; never add both and call the sum revenue.

Filters must use consistent date boundaries, customer/status semantics and currency. Summary totals cover the full filtered dataset, not only the current page. Avoid joining invoice lines and payments in a way that multiplies rows and inflates sums; aggregate each separately before combining.

**Performance proof plan, not a result:** seed thousands of valid subscriptions with coherent invoices/payments; measure end-to-end dashboard/list response in the documented environment for representative filters, cold and warm loads. Record dataset counts, page size, timings and failure cases. Target every measured page response below two seconds; do not claim compliance from a fast empty dataset or a screenshot. Optimize bounded queries, pagination and aggregation before adding cache complexity; caches must invalidate after billing/payment changes.

## 9. Acceptance matrix to execute

| Test | Required observable evidence |
|---|---|
| Concurrent same-email signup | Exactly one account; second gets clean validation error. |
| Password/reset | Eight-character password rejected; nine with required classes accepted; reset link expires and cannot be reused. |
| Staff creation / portal isolation | Non-admin cannot add staff; customer cannot access another customer's invoice, PDF or subscription by ID. |
| Product variant | Brand Odoo adds exactly 560 to the defined base, and accepted quote preserves it after catalog edit. |
| Plan controls | Each of daily/weekly/monthly/yearly schedules works; min quantity and availability enforced; disabled pause/renew/early-close denied. |
| Quote template / expiry | Template copies lines; original survives template edits; expired offer cannot silently confirm. |
| Subscription progression | Draft → Quotation → Confirmed → Active visible with required fields and line totals. |
| Repeat/concurrent billing | Same due period creates one invoice; customer/products/taxes/totals prefilled. |
| Failed batch item / backlog | No cursor advance on failure; other items succeed; retry fills failed/missed periods without duplicates. |
| Discount last use race | Only permitted number of invoices reserve/use rule; next invoice stops applying expired/exhausted rule. |
| Invoice actions | Confirm freezes amounts; cancel follows rules; send reports true delivery state; print matches persisted totals. |
| Partial payments | 400 + 600 against 1,000 yields 600 then 0 balance; one final Paid status; duplicate click adds no payment. |
| History integrity | Price/tax/discount edits do not change confirmed invoice or recorded payment. |
| Month/year edges | January 31 anchoring and leap-year policy produce valid non-overlapping periods without drift. |
| Finance consistency / speed | Filtered full-dataset summaries equal underlying records; thousands-row test produces recorded page timings under two seconds. |

These are planned tests, not completed passes. Audit events must correspond to actual database changes, exclude passwords/tokens/payment secrets, and record business facts in the same transaction. Do not claim cryptographic tamper-proofing merely because the UI has no edit button.

## 10. Implementation decision gate

Before coding, agree on: billing in advance vs arrears; activation date behavior; calendar anchoring; pause semantics; expiry/final-period billing; invoice cancellation/replacement; discount stacking/threshold/time boundaries and usage counting; payment correction; staff finance permissions; email delivery setup; single-currency assumption.

Build the required vertical path first: **role-safe signup → product/variant and plan → quote/template → accepted subscription → batch invoice with tax/discount → partial/full payment → filtered finance proof**. Then cover alternate branches. Proration, automatic collection and a demo clock are stretch additions, not substitutes.

### Source boundary

Primary source for this revision: user-supplied four-page **Subscription Management System / Meet Brightloop Software** statement, image `1000082739.jpg`, inspected directly on 31 October 2026. The filename is a provenance reference, not a requirement to publish the user's upload. See [RESEARCH.md](RESEARCH.md) for historical context; historical Odoo features and judging weights do not override this actual statement.
