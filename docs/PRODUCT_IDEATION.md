# Product ideation: Brightloop's complete subscription operation

**Revised October 31, 2026 after reading the user's four-page Odoo problem-statement screenshot.** This replaces the earlier title-only, proration-led proposal. No implementation or passed tests are claimed.

Canonical requirement IDs and the source paraphrase are in [REQUIREMENTS.md](REQUIREMENTS.md). This document proposes the product approach; it does not replace that acceptance baseline.

## The actual assignment

Brightloop Software sells monthly or yearly business software, add-ons, and support products. Its customers range from small monthly subscribers to large yearly contracts. The requested product is one unified platform for plans, subscriptions, recurring invoices, payments, and reporting—not a consumer subscription tracker and not a standalone billing calculator.

The brief's business failures are missed renewals, duplicate invoices, manual payment matching, and unclear recurring revenue. The best strategy is to make the entire described month work. **Mandatory coverage is the differentiator's foundation.** Proration, a real payment gateway, AI predictions, refunds, and an elaborate simulator are not specified and must not displace required functionality.

Source of requirements: the user's four-page screenshot headed **Subscription Management System**, sections **The Challenge**, **Meet Brightloop Software**, and **A Month at Brightloop**. The official event's technology and submission rules remain separate from the problem statement; do not assume an Odoo-organized event requires the Odoo ERP framework.

## Product thesis

> Every subscription, invoice, discount, and payment belongs to one traceable business lifecycle. Billing runs create every eligible invoice once, and finance can explain every outstanding amount.

The product should feel like a coherent operations workspace, not a collection of CRUD pages. The memorable moment is a batch billing run: eligible subscriptions become correctly calculated invoices, an immediate repeat creates no duplicates, partial payment leaves the exact outstanding balance, and finance can drill into the result.

## Mandatory scope from the screenshot

### Identity and permissions

- Customer signup uses email and password; each email belongs to one account.
- Password length is **more than eight characters**: at least nine, with uppercase, lowercase, and a special character.
- A forgotten-password reset link reaches the registered email.
- The administrator controls the system. Internal staff have limited access. Customers access only their own subscriptions and invoices through a portal.
- Only the administrator can add internal staff.

The precise staff permission matrix is not supplied. Document a least-privilege proposal and enforce it on the server. Do not treat hidden buttons as authorization. A reset link must use a secure, expiring, single-use token; do not expose account credentials. If email is simulated in a development outbox, disclose that limitation rather than claim real delivery.

### Products and plans

Products include name, type, sales price, cost price, and variants. The brief's example brand variant **Odoo adds 560 to the price**. Preserve the distinction between base sales price, variant adjustment, and resulting line price; customers must not see internal cost price by accident.

Plans define price, billing frequency (**daily, weekly, monthly, yearly**), minimum quantity, and availability dates. The administrator chooses which plans close automatically at the end and which support early closure, pause, or renewal. These choices must affect the available operations and actual behavior.

Do not copy Odoo ERP's restrictions blindly: the problem statement explicitly allows daily plans, regardless of what a reference product supports.

### Quote to subscription

Quotation templates provide the right plan, product lines, and validity in days. A subscription has its own number, customer, plan, start date, expiry date, payment terms, and lines containing product, quantity, unit price, taxes, and amount.

The required lifecycle is **Draft → Quotation → Confirmed → Active**. Include the plan-controlled close, pause, and renew operations. The screenshot also describes plans that can be closed early; distinguish a cancellation request or action from an effective closed state in the chosen policy. Everyone with permission should be able to identify the current stage.

### Recurring billing

A billing run creates invoices from subscriptions with customer details, product lines, taxes, and totals prefilled. Taxes follow administrator-configured rules automatically. Invoices support confirm, cancel, send, and print and progress **Draft → Confirmed → Paid**.

The central invariant is explicit in the brief: **nothing is billed twice or skipped**. A successful batch run must account for every eligible subscription, not merely avoid duplicate rows. Present created, already billed, not due, ineligible, and failed outcomes with reasons so staff can repair failures without double-billing successful items.

### Discounts

Only the administrator creates discount rules. Rules support fixed amounts or percentages, minimum purchase or quantity, start/end dates, maximum uses, and scope to specific products or an entire subscription. Once eligible, the discount applies to the next invoice automatically and stops when it expires or its usage limit is reached.

Persist why a discount applied and which version or terms the invoice used. Usage limits must not be consumed repeatedly when a billing run is retried. Clarify whether usage is consumed at draft creation or confirmation and how cancellation affects it; the screenshot does not define these semantics.

### Payments and finance

Each invoice-linked payment records method, amount, date, and note. The user must be able to see paid and outstanding invoices. Partial-payment balances are a natural acceptance case for that requirement; document the policy rather than pretending the brief specifies a separate partial-payment status.

Finance needs active subscription count, revenue, payments, overdue invoices, filters, and a summary view. Pages should respond **in under two seconds with thousands of subscriptions**. Treat that as a measurable acceptance target, not a marketing claim.

## One coherent interface

1. **Operations home:** due billing work, exceptions, approaching subscription expiry, and overdue balances. Counts link to actual records.
2. **Catalog and configuration:** products/variants, plans, taxes, discounts, quotation templates, and admin-only staff management.
3. **Subscription workspace:** agreement fields, lines, plan capabilities, lifecycle actions, and linked invoices.
4. **Billing workspace:** batch preview/results, invoice details, confirm/cancel/send/print actions, and payment entry.
5. **Finance:** filtered summaries with clear metric definitions and drill-downs.
6. **Customer portal:** the authenticated customer's subscriptions and invoices, with only actions the agreed policy allows.

Prefer a consistent detail layout and shared status vocabulary over excessive screens. Show effective dates, monetary breakdowns, useful validation errors, and pending actions. Keep internal cost fields and staff functions outside customer views.

## Differentiation only after coverage

### Explainable billing and exception queue

A compact history on each subscription links quotation, activation, billing period, invoice, applied discount, payments, and closure. A **Why this total?** panel shows base price, variant adjustment, quantity, eligible discount, tax, and balance.

The billing-run result is the hero screen: it explains both invoices created and records deliberately skipped. Failures remain actionable, not silently counted as success. This helps prove the problem statement's strongest requirement and makes the demo easy to follow.

This does not require a complex event-sourcing platform. Ordinary well-modeled records, transactional updates, and an audit history are enough.

### Optional sandbox time controls

Only add a visibly labeled demo clock if every required workflow and performance check is stable. It can demonstrate discount expiration, next billing, and automatic closure. It must exercise the same rules as ordinary processing. It is lower priority than reset-email delivery, print/send actions, daily/weekly intervals, and permissions.

## Modeling decisions that need an explicit policy

The brief leaves some semantics open. Choose simple, documented policies rather than secretly hard-code assumptions:

- Is a plan price a base charge, an alternative product price, or additional to product lines? Prevent accidental double counting. The demo uses product-line pricing with a plan's configured price aligned to the base software price; no additional plan fee.
- Does a variant adjustment apply per unit? The proposed demo says yes and shows it before confirmation.
- Are taxes calculated after discounts? The demo says yes, using a fictional configurable tax rule, not a legal claim.
- Can discounts stack? Start with one selected eligible rule per eligible line/subscription unless the organizer says otherwise; document deterministic selection.
- Does maximum usage mean global uses or uses per customer/subscription? The demo uses one global use for a rule assigned to a specific subscription. Make the policy explicit.
- How do plan availability dates differ from an existing subscription's start/expiry dates? Availability controls new selection; expiry controls the agreement unless specified otherwise.
- Does pausing also defer billing, and what happens on resume? Define the effective date and next bill. Avoid promising a pause that merely changes a badge.
- What happens at a month-end anchor such as January 31? Use a documented calendar rule, not a universal thirty-day month.
- Which invoice date and payment term determine overdue status? Use a due date and remaining balance; a fully paid invoice is not overdue.
- What does revenue mean in the finance view? Label invoiced totals and cash collected separately. Do not claim full revenue recognition or accounting compliance.

## Provisional eight-hour prioritization

Actual time remaining and team capabilities take precedence. This is a suggested allocation, not a promise:

| Time budget | Outcome |
|---|---|
| 45 minutes | Map every requirement; agree roles, pricing semantics, state transitions, batch identity, and demo fixtures. |
| 90 minutes | Authentication/authorization plus catalog, plans, templates, and subscription records. |
| 120 minutes | Required lifecycle, tax/discount calculation, batch invoice generation, and replay safety. |
| 75 minutes | Payment balances, customer portal, invoice send/print/cancel, and finance filters. |
| 60 minutes | Permission, calendar, discount-limit, billing-completeness, and performance tests. |
| 45 minutes | Explainable totals and actionable batch results, only after baseline gaps are closed. |
| 45 minutes | Rehearse, fix defects, prepare genuine evidence and submission. |

Do not trade away mandatory features to preserve this schedule. Work in parallel where safe, with shared data contracts and one integrated end-to-end slice early.

## Scope boundaries

Defer proration, refunds, real payment gateways, automatic card charging, AI churn prediction, multi-currency, advanced accounting, and an arbitrary workflow builder unless the organizer adds them. The required payment feature is recording invoice-linked payments; a real money movement is not implied. Never trigger real charges or real customer communications just to enhance a demo.

## Supporting references, not substitute requirements

Official Odoo documentation illustrates subscription management, upsells, payment exceptions, and reporting. It is useful domain context, but the supplied Brightloop statement is authoritative for this build. [Subscriptions](https://www.odoo.com/documentation/19.0/applications/sales/subscriptions.html), [Upselling](https://www.odoo.com/documentation/19.0/applications/sales/subscriptions/upselling.html), [Automatic payments](https://www.odoo.com/documentation/19.0/applications/sales/subscriptions/automatic_payments.html), [Reports](https://www.odoo.com/documentation/19.0/applications/sales/subscriptions/reports.html).

See [Demo and proof](DEMO_AND_PROOF.md) for the full requirement matrix and exact synthetic financial trace.
