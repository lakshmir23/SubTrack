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

**Policy reference:** [DECISIONS.md](DECISIONS.md) supplies coherent, team-adoptable proposed defaults for ambiguities below. They are not official requirements and remain pending team agreement. Use its numbered policies consistently rather than independently inventing behavior.

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
| **Plan** | Name, primary product, price and currency, interval enum daily/weekly/monthly/yearly, positive interval count if supported, minimum quantity, available-from/to, auto-close-at-end, allow-early-close/pause/renew | Policies belong to the plan and must be enforced by actions, not only displayed. |
| **PriceVersion / CommercialTermsVersion** | Product/variant, plan or pricing context, currency, accepted unit price and policy snapshot/version | Proposed lightweight versioning: catalog edits must not silently reprice accepted agreements. Immutable snapshots can replace a separate version table if simpler. |
| **QuotationTemplate / TemplateLine** | Name, plan/default terms, validity days, product/variant lines and default quantities/prices | Copy to a new subscription quote; later template edits do not mutate existing quotations. |
| **Subscription** | Unique human-facing number, customer, plan, start date, expiry date, payment terms, quotation-valid-until, stage, operational state, next billing boundary, version | Preserves required commercial fields and separates sales progression from pause/close behavior. |
| **SubscriptionLine** | Subscription, product/variant, quantity, accepted unit price, tax references/snapshots, computed amount | Snapshot accepted price and terms on confirmation; retain history for later changes. |
| **TaxRule** | Name, rate, applicable products/type if needed, enabled/effective dates, inclusive/exclusive policy | Admin-managed automatic calculation. Snapshot applied tax on finalized invoice lines. |
| **Invoice / InvoiceLine** | Number, subscription/customer, logical charge, revision number, predecessor if replaced, charge period, issue/due date, currency, state; copied lines, quantities, prices, tax/discount amounts and totals | Reproducible financial document; historical display must survive catalog edits. |
| **DiscountRule / DiscountTarget** | Fixed/percentage value, min purchase/quantity, start/end, usage limit, enabled flag, target products or subscriptions | Admin-only authoring. Eligibility checked at billing time, not by a stale browser preview. |
| **DiscountApplication** | Rule, invoice and optional line, calculated amount, usage reservation/consumption state | Evidence of why a bill changed, plus a transactional record for enforcing a global limit. |
| **Payment** | Invoice, method, positive amount, currency, payment date, note, recorder, unique submission key, optional external reference | Core requirement: manual recording supports partial payment. Payment is a money fact, not just a `paid` checkbox. |
| **BillingPeriodOutcome / LogicalCharge** | Subscription, original period boundaries, charge kind, outcome, current-invoice reference or non-billable reason | Unique logical period identity; current-invoice pointer selects the sole current revision. Distinguishes waived paused periods from failed/owed backlog (D-03/D-05). |
| **LifecycleEvent** | Entity references, type, actor, timestamp, correlation key, safe structured details | Append-only application audit trail for actual persisted transitions. |
| **InvoiceDelivery** (small optional table) | Invoice, destination, delivery status/time, message reference | Useful evidence for Send. If email delivery is unavailable, expose a truthful pending/failed status rather than fake success. |

### Cardinalities and shortcuts that remain defensible

A customer has many subscriptions; a subscription has many lines and invoices; an invoice has many lines and payments. A plan has many subscriptions. A rule has many target records and applications.

One logical charge per recurring period, with at most one current collectible invoice revision, is the proposed baseline. All lines on a subscription share its plan cadence. Multiple cadences require separate subscriptions unless clarified otherwise. One configured currency simplifies the build; do not silently combine different currencies in finance totals.

Use integer or UUID internal keys consistently; neither is inherently a judging advantage. Customer-facing subscription/invoice numbers must be unique. Opaque IDs do not replace ownership checks.

## 3. Authentication and permissions are part of correctness

**Explicit password requirement:** more than eight characters (**at least nine**), at least one uppercase, one lowercase and one special character. Digits may be allowed but are not specified as mandatory. Apply checks server-side; choose a clear special-character policy and display it. Use established password hashing and session libraries, never homemade cryptography.

Normalize email consistently for uniqueness (proposed: trim and lowercase); enforce a database unique index, including concurrent signups. Reset links go only to the registered address, expire, are single-use and contain high-entropy tokens. Return the same public response for known/unknown addresses to reduce account enumeration. Rate-limit login/reset attempts. Never expose secrets in logs or repository files.

Use the exact fixed-role matrix in [D-09](DECISIONS.md#d-09--fixed-least-privilege-roles): admin owns configuration; staff handles operational quotes/subscriptions/invoices/payments and read-only finance; customers read/download only their own records and invoke only permitted lifecycle actions. Staff creation and discount changes are admin-only. No dynamic permission builder is proposed.

Enforce roles and ownership server-side, including PDFs and indirect references. Protect cost price and internal payment notes from portal serialization. Capabilities do not grant permission to edit prices, ownership or arbitrary dates.

## 4. State transitions and policy boundaries

### Required subscription progression

**Draft → Quotation → Confirmed → Active** must remain visible. Do not replace it with a generic active/inactive toggle.

- **Draft:** editable preparation; apply/copy a quotation template.
- **Quotation:** offer issued with validity date and price/product lines. Expired offers cannot be confirmed without explicit renewal/reissue.
- **Confirmed:** customer agreement recorded; freeze accepted commercial snapshots and validate dates, quantity, plan availability and payment terms.
- **Active:** service has started according to start date/activation policy and is eligible for recurring billing. The brief does not require a successful-payment gate for activation; do not invent one.

Pause/close is a separate operational status or explicit extension to that progression. Proposed representation: stage plus `running/paused/closed`, with paused/closed relevant only after activation. Plan permissions control whether staff/customer may pause, renew or close early.

Use [D-02–D-04](DECISIONS.md#d-02--time-boundaries-and-activation) for exact proposed date/lifecycle defaults: full-period boundaries, original-anchor calendar arithmetic, next-boundary pause/early close, explicit paused-period waivers, and explicit whole-term renewal. No retroactive waiver of owed periods. Pausing does not shift the anchor or extend expiry. Resume cannot invoice waived paused periods. Term expiry blocks future periods whether auto-close is enabled or not; older debt remains recoverable. Late renewal requires a new quote rather than automatically charging an expired gap.

### Required invoice progression

**Draft → Confirmed → Paid**, with **Canceled** as an explicit cancellation outcome.

- Generated Draft amounts are read-only snapshots and are not collectible. Correct using explicit cancel/replacement, not arbitrary line edits (D-06).
- Confirm validates and preserves the generated financial snapshot and consumes its reserved discount use exactly once.
- Partial payment leaves invoice **Confirmed**, with a partial-payment label and outstanding balance.
- Paid is derived from zero outstanding, not manually toggled. Confirming a zero-total invoice settles it immediately without creating a fake payment (D-06).
- Cancel only Draft/Confirmed invoices with no payment ever recorded; Paid invoices are not cancelable. Draft cancellation releases reserved discount use; Confirmed cancellation does not restore consumed use. Credits/reversals are deferred (D-06–D-08).
- Print/download and send do not change settlement status. A failed email send must not pretend delivery succeeded.

Overdue is a derived flag: Confirmed, positive balance, and due date earlier than Asia/Kolkata business date. Today's due invoice is not overdue. Issue date plus payment-term days gives due date (D-02).

## 5. Batch billing without duplicate or skipped invoices

This is an explicit requirement, not an optional showcase.

1. Enumerate due periods using effective historical eligibility, including owed backlog on currently paused/closed/expired subscriptions; current status alone is insufficient (D-05).
2. Lock/version-check each subscription independently in a short transaction.
3. Recheck period-specific start/pause/close/expiry policy and existing charge identity; record explicit non-billable paused-period outcomes rather than silently skipping.
4. Build the invoice with customer, accepted product/variant lines, applicable discounts, taxes, totals and due date already populated.
5. Persist invoice or explicit non-billable period outcome, discount reservation where applicable, audit event and billing-cursor advancement together.
6. Commit each subscription independently; report created/already-existing/failed counts with retryable errors. One bad subscription must not silently lose the rest of the batch.

Use a unique key such as `(subscription_id, period_start, period_end, charge_kind)` on the logical charge/period-outcome record. Invoice revisions are unique by `(logical_charge_id, revision_number)`; the charge points to the current revision. Repeated clicks, scheduler retries and two workers must return that current invoice/outcome for the same period, not create another revision. A failure before commit cannot advance the cursor. A failure after commit cannot create another invoice on retry.

**Never skip backlog:** if more than one period is due, process due boundaries in order up to a documented batch limit and expose remaining work. Do not set `next_bill = today + interval`, which silently discards missed periods.

**Cancellation nuance:** a canceled revision retains its logical charge link; a routine rerun cannot recreate it. Explicit staff/admin replacement locks the charge and verifies the current revision is Canceled with no payment ever recorded, then atomically links a successor and changes the current-invoice pointer. Preserve old revisions; only the current revision can become collectible. Recalculate under D-07 and show a replacement preview before normal confirmation: an exhausted discount retained as consumed on the predecessor can make the new total different. If the intended bill was canceled accidentally, show an exception for staff; “no duplicates” must not hide unbilled debt.

**Expiry default (D-02):** require full-period aligned expiry; reject partial final periods. Historical owed periods remain billable after expiry, but no new period begins at/after expiry. Proration is deferred.

## 6. Tax, variant price and discount calculations

### Commercial amounts

Use D-01: plan price supplies the recurring base unit price of its designated primary product; variant adjustment is per unit. Additional product lines use accepted catalog prices. No additive plan fee. Snapshot accepted mapping and terms; minimum quantity applies to the primary-product line. This is a proposed policy, not an organizer-prescribed pricing formula.

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
- Dates and usage limits are checked at invoice generation business date, then frozen on the generated Draft (D-07). End dates are inclusive in Asia/Kolkata; backlog eligibility uses generation date, not historical period start.
- **One use = one finalized invoice application**, not one unit or line, is a proposed definition; document it in admin UI.
- Draft generation reserves limited use atomically. Confirmation consumes that frozen reservation even after rule expiry; Draft cancellation releases it. Confirmed cancellation does not restore consumed use. Show reserved/consumed/available usage and drafts holding reservations (D-07).
- Lock/update the rule counter and insert its application in the same transaction. Concurrent invoices must not exceed the usage limit.
- Global limit and per-customer limit are different concepts. The brief only specifies a usage limit; do not invent per-customer semantics silently.
- Apply one eligible rule per invoice, selected by admin priority then stable rule ID (D-07). Product scope limits eligible lines. Fixed allocation uses proportional minor units plus deterministic largest-remainder allocation; show the rule and amount.
- Existing confirmed invoices never change when a discount expires or is edited. Expiry affects future invoices automatically.

## 7. Recording payments and maintaining balances

Payment recording is core; a gateway is not required. Record method, amount, date and note against the correct confirmed invoice. The payment date is the financial event date; also preserve recorded-at timestamp and actor for audit.

**Balance = finalized invoice total − sum of valid allocated payments.** Recompute or transactionally maintain it from persisted facts. Use invoice locking/version checks when concurrent payments are entered.

Example: invoice total 1,000; record 400 → balance 600, Confirmed/partially paid. Record 600 → balance 0, Paid. Finance summary, invoice detail and portal must agree immediately after commit.

Reject zero/negative amounts and wrong currency. Proposed baseline rejects amounts greater than outstanding balance rather than inventing customer credit handling. Duplicate-submit keys prevent a double-click from recording the same payment twice. Two legitimate equal payments on the same date are still possible, so amount/date alone must not be treated as a unique identity.

D-08 defers correction/reversal UI: payments are immutable and reviewed before recording. Reject future/invalid dates; notes are untrusted text. Same submission key with a different payload is a conflict. A future reversal feature must use a linked unique reversal record and recompute settlement transactionally, never delete/edit history.

**Optional future gateway:** add PaymentAttempt separate from Payment. A timeout is unknown, not declined; reconcile before retry. Confirmed provider events need unique IDs and cannot regress a paid invoice. This remains stretch work and must not delay manual payment requirements.

## 8. Finance summary and the under-two-second requirement

Use database-backed filters and pagination; do not load thousands of records into the browser and hide most rows. Suggested indexes: subscription stage/operational state and next-bill date; customer foreign keys; invoice status/due date; payment date/invoice; unique billing identity. Validate actual query plans rather than adding every possible index.

Define dashboard labels precisely:

- **Active subscriptions:** current active-stage, running contracts at server business date, excluding closed/expired. Historical as-of reconstruction is not implemented by this proposed baseline (D-10).
- **Revenue received:** valid payments in selected payment-date range. Label this cash received, not accounting revenue recognition.
- **Outstanding:** invoice totals less valid payments for included non-canceled confirmed invoices.
- **Overdue:** positive outstanding with due date before server business date.
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
| Invoice actions | Generation freezes amounts; confirmation preserves the snapshot and consumes its reserved discount use; cancel follows rules; send reports true delivery state; print matches persisted totals. |
| Partial payments | 400 + 600 against 1,000 yields 600 then 0 balance; one final Paid status; duplicate click adds no payment; concurrent allocations cannot overpay. |
| Zero total | Confirm fully discounted invoice: Paid, zero outstanding, no fabricated payment. |
| Pause / closed backlog | Future paused full periods are explicitly waived; prior owed periods still invoice after closure; resume preserves anchor without back-billing waived periods. |
| Renewal | Extend accepted term before expiry; next new-period invoice exists exactly once; idempotent request replay does not extend twice. |
| History integrity | Price/tax/discount edits do not change confirmed invoice or recorded payment. |
| Month/year edges | January 31 anchoring and leap-year policy produce valid non-overlapping periods without drift. |
| Finance consistency / speed | Filtered full-dataset summaries equal underlying records; thousands-row test produces recorded page timings under two seconds. |

These are planned tests, not completed passes. Audit events must correspond to actual database changes, exclude passwords/tokens/payment secrets, and record business facts in the same transaction. Do not claim cryptographic tamper-proofing merely because the UI has no edit button.

## 10. Implementation decision gate

Before coding, the team should accept or amend the proposed defaults in [DECISIONS.md](DECISIONS.md), especially pricing, date/period arithmetic, pause/expiry/renewal, draft freeze/cancellation, discount reservations, payment limitations and role matrix. Confirm email delivery setup and single-currency assumption. These are documented proposals, not evidence of implemented behavior.

Build the required vertical path first: **role-safe signup → product/variant and plan → quote/template → accepted subscription → batch invoice with tax/discount → partial/full payment → filtered finance proof**. Then cover alternate branches. Proration, automatic collection and a demo clock are stretch additions, not substitutes.

### Source boundary

Primary source for this revision: user-supplied four-page **Subscription Management System / Meet Brightloop Software** statement, image `1000082739.jpg`, inspected directly on 31 October 2026. The filename is a provenance reference, not a requirement to publish the user's upload. See [RESEARCH.md](RESEARCH.md) for historical context; historical Odoo features and judging weights do not override this actual statement.
