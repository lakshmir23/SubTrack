# Brightloop Software — authoritative requirements

Source: the supplied higher-quality four-page **Subscription Management System** problem statement, inspected on 31 October 2026. It describes Brightloop Software and an ordinary billing month. This document paraphrases the visible brief; requirement IDs are our tracking labels, not organizer numbering. Rechecked against the four higher-quality images on 31 October: product notes and final Closed status are explicit, and the performance target covers every page. These requirements supersede title-only assumptions in the first research pass. The source was received as an image of the four pages, not as a machine-readable PDF.

## Product and users

Brightloop sells business software monthly or yearly, add-ons customers switch on and off, and products with variants. Customers range from small monthly subscribers to large annual-contract clients. Replace spreadsheet subscription tracking, manually remembered renewals, hand-typed invoices, manual bank matching and manually assembled revenue reports with one connected system.

| ID | Explicit requirement | Evidence expected from the final application |
|---|---|---|
| AUTH-01 | Customer signup with email and password; one account per email. | Duplicate signup rejected on server and database; account persists. |
| AUTH-02 | Password is more than eight characters and includes uppercase, lowercase and a special character. | Nine-character boundary and each missing character class tested on server and client. A digit requirement is not stated. |
| AUTH-03 | Forgotten-password reset link reaches the registered email. | Token-based reset flow and delivery evidence using an approved mechanism; a development inbox must be labelled, not presented as real delivery. |
| AUTH-04 | Administrator controls the system; internal staff have limited operational access; customers access only their own subscriptions/invoices through a portal. | Server-side role and ownership tests; another customer's URL cannot disclose their record. Exact staff action boundaries must be documented as policy. |
| AUTH-05 | Only an administrator may add internal staff. | Customer/staff attempts fail even through direct API access. |

## Catalog and recurring plans

| ID | Explicit requirement | Evidence expected |
|---|---|---|
| CAT-01 | Admin adds a product with name, type, sales price, cost price and notes. | Persisted validated product; distinguish selling price from internal cost. |
| CAT-02 | Products support variants, including brand-dependent price changes; the supplied example adds 560 for Odoo brand. | Select a variant and show the correct persisted price computation. The example is not a universal hardcoded surcharge for all products. Currency is not specified in that sentence. |
| PLAN-01 | Admin creates recurring plans with price and interval: daily, weekly, monthly or yearly. | All four intervals can be configured and date arithmetic is tested. |
| PLAN-02 | Plans include minimum quantity and availability dates. | Quantity and date eligibility are enforced when choosing/confirming a plan. |
| PLAN-03 | Plans may close automatically when they end, or permit closing early, pausing or renewing; admin decides which play by which rules. | Persist the chosen policies and enforce permitted actions on the server. Do not assume every plan permits every action. |

**Scenario context to preserve:** Brightloop’s add-ons can be switched on and off. Represent them through ordinary product/subscription lines rather than inventing a separate product. The effective date, permission and pricing behavior are proposed team policy in DECISIONS; the brief does not prescribe immediate proration.

## Quote to subscription

| ID | Explicit requirement | Evidence expected |
|---|---|---|
| QUOTE-01 | Reusable quotation templates contain the appropriate plan/product lines and a number of valid days. | Create a quotation from a template, edit the instance without silently changing the template, show validity. |
| SUB-01 | Each subscription has its own number, customer, plan, start date, expiry date and payment terms. | Unique reference and complete persisted detail. Distinguish contract dates, invoice due dates and plan availability. |
| SUB-02 | Lines show product, quantity, unit price, taxes and amount. | Server-calculated line/total values; original pricing inputs remain explainable. |
| SUB-03 | Progression is Draft → Quotation → Confirmed → Active → Closed. | Visible status history and valid transition enforcement. The brief does not explicitly say payment must gate activation; declare any such policy rather than inventing it as a requirement. |
| SUB-04 | Everyone on the internal team can see where a subscription stands. | Shared persisted state and appropriately authorized list/detail views. |

## Billing day

| ID | Explicit requirement | Evidence expected |
|---|---|---|
| BILL-01 | Hundreds of due subscriptions generate invoices from their subscription, with customer details, product lines, taxes and totals filled in. | Batch process due records; no hand-entry of invoice lines. Show eligible, created, skipped and failed records with reasons. |
| BILL-02 | Tax calculations use admin-configured rules automatically. | Configured-rule examples and deterministic rounding; the brief does not prescribe a minimum rule count or establish jurisdictional compliance. |
| BILL-03 | Team can confirm, cancel, send and print an invoice. | Each action works with sensible permissions/state constraints; sending and printing are not decorative buttons. |
| BILL-04 | Invoice progression is Draft → Confirmed → Paid. | Partial payments leave balance outstanding; mark Paid only when fully settled. Document cancellation as an additional operational outcome without deleting history. |
| BILL-05 | Nothing is billed twice or skipped. | Per-subscription billing-period uniqueness, safe retries and a reconciled batch outcome listing; failures remain visible and retryable rather than silently discarded. |

## Discounts

| ID | Explicit requirement | Evidence expected |
|---|---|---|
| DISC-01 | Only admin creates discount rules. | Permission test and operational UI. |
| DISC-02 | Fixed-amount or percentage discount, minimum purchase or quantity, start/end dates and maximum number of uses. | Every eligibility boundary tested, including exhausted count and concurrent use. |
| DISC-03 | A discount can target specific products or a whole subscription. | Scope is explicit and amounts cannot accidentally apply twice. Stacking and allocation are policy decisions unless clarified later. |
| DISC-04 | An eligible discount appears on the next invoice without manual intervention; stops at expiry or exhausted uses. | Generate successive invoices across eligibility boundaries and inspect stored adjustments/usage. |

## Payments and finance

| ID | Explicit requirement | Evidence expected |
|---|---|---|
| PAY-01 | Record payments arriving through different methods/days, with method, amount, date and note, against the correct invoice. | Multiple partial payments and correct invoice allocation; no real gateway is specified as mandatory. |
| PAY-02 | Show paid versus outstanding invoices so overdue amounts can be followed up. | Outstanding equals invoice total minus valid recorded payments; partial payment does not imply Paid. |
| FIN-01 | One place shows active subscriptions, revenue, payments and overdue invoices with filters and summary view. | Each metric drills into persisted records and respects selected filters. Define billed revenue, collected payments, outstanding and overdue separately. |
| FIN-02 | Every page should respond in under two seconds with thousands of subscriptions. | Documented dataset, hardware, query scope and measured end-to-end/page timings, including search/filter/pagination; do not claim success before measuring. |

## Decisions the brief leaves open

- Exact field enums, staff permission matrix, tax inclusivity/order, discount stacking and when uses are consumed.
- Whether activation is gated on payment, invoice due-date calculation from payment terms and handling of overpayments.
- Meaning of pause for billing/expiry; whether renewal extends the same contract or creates a linked contract.
- Calendar anchors for month-end/leap-year plans, business timezone and availability boundary inclusion.
- Whether sending requires an external mail provider or an approved local demo inbox is acceptable.
- Definition of revenue for the summary and the precise performance measurement environment.

Make these explicit product decisions and keep them easy to change. Do not wait to satisfy unambiguous requirements while debating optional sophistication.

## Not required by this supplied brief

Real payment gateway, live bank integration, automatic card charging, AI assistant, churn prediction, multi-currency, tenant-isolated SaaS, formal accounting ledger, mid-cycle proration, or a time-travel engine. They may be useful later, but must not displace the required workflow.

The standing [hackathon constraints](HACKATHON_CONSTRAINTS.md) still apply: dynamic data, responsive consistent UI, robust validation, intuitive navigation and genuine team Git participation, with local resilience and explainable code encouraged.
