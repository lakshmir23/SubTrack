# Brightloop demo and proof plan

**Revised October 31, 2026 against the user's four-page problem-statement screenshot.** This replaces the earlier speculative proration demo. The required story is Brightloop's complete subscription month: configure, quote, activate, batch bill, apply discounts and taxes, record payments, and report the balance.

**Evidence status:** This document defines the reproducible fixture and proof obligations. Execution is now authorized; [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) records observed results gate by gate. A procedure below is not itself a passing result, and unexecuted witnesses remain **Not verified**.

## The demo promise

> Brightloop can bill every due subscription once, explain every total, record each payment against the correct invoice, and identify exactly what is still owed.

Use synthetic customer records and clearly labeled demo financial data. Do not initiate real money movement. Recording a payment is the required workflow; integrating a live gateway is not required by the supplied statement.

## Exact synthetic fixture and calculation

### Declared choices

These are explicit demo policies, not additional requirements or tax advice:

- Currency is INR for presentation; single currency throughout.
- Billing date is November 1, 2026, using a clearly labeled synthetic fixture. A and B use seven-day payment terms: invoices issued November 1 are due November 8, with overdue status starting November 9 under this demo policy. The finance snapshot is November 9, before C becomes due on November 15; all three contracts remain unexpired.
- **Fixture clarification:** C starts October 15 and has a valid October 15–November 15 period with a paid October invoice/payment, so its November 15 next boundary is backed by an actual outcome. Never seed a skipped cursor. The main finance witness explicitly selects November invoice-issue and payment-event dates; C's paid October invoice is outside those ranges. “Two invoices” below means the two November invoices/current billing-run results, not the entire database's lifetime count.
- Product **Business Software** has base sales price ₹1,000 and cost price ₹400 and notes “Demo recurring software product.” Cost price is internal only.
- Variant **Odoo** adds ₹560 **per unit**, following the statement's variant example.
- The monthly plan identifies Business Software as its primary product; plan price ₹1,000 replaces that product’s catalog base unit price. Add the chosen variant per unit; never add a separate plan fee. See [DECISIONS.md](DECISIONS.md). A separate unequal-plan/catalog-price test proves this mapping.
- Demonstration tax is a fictional configurable **10% demo tax**, calculated after discount. It is not described as an applicable statutory rate.
- Discount **LAUNCH10** is administrator-created: 10%, minimum quantity two, valid November 1–30 inclusive, maximum one use, assigned to subscription A. No stacking.
- Discount eligibility is frozen at generation business date and its limited use is reserved atomically then. Confirmation consumes the reservation once; replay changes no counters. Canceling a Draft releases it; canceling a zero-payment Confirmed invoice does not restore consumed usage. Generated amounts are read-only snapshots. See [DECISIONS.md](DECISIONS.md).
- Partial payments reduce the remaining balance; the invoice stays Confirmed until its balance reaches zero, then becomes Paid.

### Three active subscriptions

| Subscription | Customer | Quantity / variant | Billing eligibility |
|---|---|---|---|
| A | Sample Studio | Two Business Software units, Odoo variant | Due November 1; eligible for LAUNCH10. |
| B | Sample Shop | One Business Software unit, base variant | Due November 1; no discount. |
| C | Sample Services | One Business Software unit, base variant | Active but next billing date November 15; not due in this run. |

All agreements have explicit numbers, customers, plans, start/expiry dates, payment terms, and product lines. Use a quotation template to create A and show **Draft → Quotation → Confirmed → Active → Closed** for the full required lifecycle. In the main billing fixture, stop A at Active until collection/reporting is shown; use a separate ending fixture to prove Closed, so closing A does not contradict the active-count arithmetic.

### Subscription A: explain the invoice

| Component | Calculation | Amount |
|---|---|---|
| Variant-adjusted unit price | ₹1,000 + ₹560 | ₹1,560.00 |
| Subtotal | 2 × ₹1,560 | ₹3,120.00 |
| Discount | 10% × ₹3,120 | −₹312.00 |
| Taxable amount under demo policy | ₹3,120 − ₹312 | ₹2,808.00 |
| Demo tax | 10% × ₹2,808 | ₹280.80 |
| Invoice total | ₹2,808 + ₹280.80 | **₹3,088.80** |

### Subscription B

₹1,000 subtotal + ₹100 demo tax = **₹1,100.00**.

The batch therefore creates **two invoices totaling ₹4,188.80**. Subscription C is shown as **not due**, not as an unexplained omission or failure.

## End-to-end demonstration

1. **Administrator setup:** Show product/variant, monthly plan capabilities, tax rule, discount eligibility, and quotation template. Use a prepared synthetic configuration where necessary, but show that these are real editable records.
2. **Customer and access:** Sign in as a customer, show only their own records. Briefly show that staff creation and discount configuration are administrator-only.
3. **Quote to activation:** Create A from the quotation template. Confirm validity days, customer, subscription number, dates, terms, and lines. Walk through the required stages.
4. **Batch preview:** Show A and B due, C not due. The preview exposes prices, discount, tax, and expected totals.
5. **Generate and confirm invoices:** Generate invoices from subscriptions, preserving the prefilled fields. Explain A's ₹3,088.80. Confirm both invoices under the chosen workflow.
6. **Replay the same billing run:** It creates **zero new invoices**. A and B are already billed for that period; C remains not due. Total remains ₹4,188.80. Show record-level evidence, not only a success toast.
7. **Record partial payment:** Add ₹1,000 to A with method, date, and note. A remains Confirmed with **₹2,088.80 outstanding**. Overall outstanding is **₹3,188.80**, including B.
8. **Complete A's payment:** Record another ₹2,088.80 against A. It becomes Paid; collected total is **₹3,088.80**. B remains outstanding at **₹1,100**.
9. **Finance drill-down:** At the isolated November 9 date, explicitly select November invoice-issue and payment-event ranges. Show three currently active subscriptions, two November invoices, ₹4,188.80 invoiced, ₹3,088.80 collected, and ₹1,100 outstanding/overdue. C's paid October period remains inspectable outside the month filter. A must not appear overdue merely because its original due date has passed.
10. **Invoice communication:** Demonstrate print output and the approved send path to a controlled test recipient or disclosed development outbox. Do not claim an outbox preview is delivered email.
11. **Lifecycle policy:** On separate small fixtures, show plan-permitted pause/renew/early close and an automatic-end case. A disallowed action must be rejected, not merely hidden.

Use a clean reset between demonstrations so previous invoices and discount usage do not contaminate the expected totals. Keep the fixtures distinct from performance-test records.

### Discount expiration and limit proof

Use a separate test, not a claim bolted onto the main demo:

- Retry A's existing batch: no second invoice and no second discount consumption.
- Isolate the usage-limit test from expiry: on a separate daily-plan fixture still inside the rule validity dates, generate another otherwise eligible invoice after its one-use limit has been consumed. No discount should apply. Do not use a December invoice with the November-only rule as sole proof of the usage limit; it also fails the date condition.
- Run with a date outside the validity range: no discount.
- Test quantity one against the minimum of two: no discount.
- Exercise fixed-amount and product-scoped rules separately; the main percentage/subscription example does not prove those modes.

## Complete requirement-to-proof matrix

Canonical requirement IDs come from [REQUIREMENTS.md](REQUIREMENTS.md). Repeated IDs below identify separate checks for the same requirement, not additional organizer requirements.

All entries are **Not verified** until the implemented system supplies evidence. This matrix records obligations, not completed work.

| ID | Requirement from the statement | Proof to collect |
|---|---|---|
| AUTH-01 | Unique email signup | Register once; duplicate email cannot create a second account. Define normalization. |
| AUTH-02 | Password longer than eight characters with uppercase, lowercase, special character | Eight-character value rejected; valid nine-or-more accepted; each missing character class rejected. |
| AUTH-03 | Reset link reaches registered email | Controlled delivery to the registered test address; expiring single-use token; existing password not revealed. A disclosed outbox proves generation only, not this delivery requirement, unless the organizer accepts that fallback. |
| AUTH-04 | Administrator, limited internal staff, customer portal | Separate identities; test actual allowed and denied requests. |
| AUTH-05 | Only administrator adds internal staff | Staff/customer direct requests rejected. |
| AUTH-04 | Customers see only their own subscriptions/invoices | Cross-customer URL/API attempts rejected; own records accessible. |
| CAT-01 | Product name, type, sales price, cost price and notes | Create/edit valid record including notes; values persist; cost visibility restricted appropriately. |
| CAT-02 | Variants and price adjustment | Odoo variant adds 560; line unit price and total update consistently. |
| PLAN-01 | Plan price and daily/weekly/monthly/yearly frequency | Configure each interval; verify actual next billing dates. |
| PLAN-02 | Minimum quantity and availability dates | Reject below-minimum or unavailable selection; boundary cases recorded. |
| PLAN-03 | Automatic end and administrator-selected early close/pause/renew choices | Allowed actions operate; forbidden actions fail; automatic-end behavior verified. |
| QUOTE-01 | Templates with plan, lines, validity days | Create quote from template; correct copied values and validity date. |
| SUB-01 | Number, customer, plan, start, expiry, payment terms | Persist and display all agreement fields; subscription numbers remain unique. |
| SUB-02 | Product, quantity, unit price, taxes, amount on lines | Correct populated lines and calculated totals. |
| SUB-03 | Draft → Quotation → Confirmed → Active → Closed | Legal transitions, including final closure on a separate fixture, work; invalid/repeated transitions do not duplicate effects. |
| SUB-04 | Internal team can see where each subscription stands | Separate authorized staff views reflect the same persisted state. |
| BILL-01 | Batch invoices created from subscriptions | Customer, lines, taxes, totals populated without manual re-entry. |
| BILL-02 | Automatic administrator-configured tax rules | Eligible tax applied; noneligible tax not applied; rounding policy documented. |
| BILL-03 | Invoice confirm, cancel, send, print | Each action produces its genuine outcome; delivery status described honestly. |
| BILL-04 | Invoice Draft → Confirmed → Paid | Payment completion drives Paid; partial balance does not falsely mark Paid. |
| BILL-05 | Nothing billed twice or skipped | Same-period replay produces no duplicates; every eligible item has an outcome; recoverable failed item can be retried. |
| DISC-01 | Administrator-only discount creation | Staff/customer attempts rejected by server. |
| DISC-02 | Fixed or percentage amount | Separate fixtures prove both calculations. |
| DISC-02 | Minimum purchase or quantity, start/end dates, maximum uses | Boundary tests for amount/quantity, dates, and consumption limits. |
| DISC-03 | Specific products or whole subscriptions | Product-only and subscription-scoped fixtures prove scope. |
| DISC-04 | Automatically applies next invoice, stops at expiry/limit | No manual re-entry; future eligibility and replay behavior verified. |
| PAY-01 | Method, amount, date, note against correct invoice | Payment persists with correct invoice link and complete fields. |
| PAY-02 | Paid versus outstanding visibility | Partial and final payment update balances and status consistently. |
| FIN-01 | Active count, revenue, payments, overdue invoices | Each summary reconciles to underlying filtered records; definitions visible. |
| FIN-01 | Filters and summary view | Filters affect both rows and corresponding totals consistently. |
| FIN-02 | Thousands of subscriptions; every page under two seconds | Reproducible dataset, page/action inventory, measured elapsed times, and failures disclosed. |

## Integrity and security acceptance gates

These are design-quality checks supporting the required workflows, not additions to an alleged organizer rubric:

- One billing identity per subscription and billable period; replay is safe.
- Batch outcomes reconcile: every candidate is created, already billed, not due/ineligible with reason, or failed with an actionable reason. Never silently skip a due record.
- Retrying failures does not regenerate invoices for successful records.
- Discount limits cannot be overspent by simultaneous eligible invoices or consumed twice by a retry.
- Monetary arithmetic uses exact minor units or appropriate decimal operations and a declared rounding policy.
- Historical invoice prices/taxes/discounts do not mutate when current catalog rules change.
- Payment amount cannot be negative or silently overpay without a defined policy. Reject overpayment for the bounded scope unless credit handling is explicitly implemented.
- Canceling an invoice does not silently delete payment history. Define and restrict cancellation of paid/part-paid invoices.
- A paused or closed agreement follows the chosen billing policy; it is not just visually relabeled.
- Authorization is server-enforced for every record and action.
- Email/reset handling does not leak credentials or expose reusable reset tokens.
- No live payment or uncontrolled customer-email action is used for the demo.

## Performance evidence: the under-two-second requirement

Do not substitute a tiny local seed and a verbal scalability claim for measurement. Suggested verification plan:

1. Use the canonical proposed dataset in [EXECUTION_BLUEPRINT.md](EXECUTION_BLUEPRINT.md#6-honest-performance-and-reliability-proof): 10,000 synthetic subscriptions with representative customers, lines, invoices and payments. Record exact counts. If the team scales that fixture down, it must still contain thousands of subscriptions as the brief requires, and disclose the actual dataset and limitations. These are test plans, not achieved results.
2. List every relevant page and operation: operations home, filtered subscription list, subscription detail, invoice list/detail, finance summary, catalog, and customer portal. Include both paginated lists and summary queries.
3. Measure user-visible page readiness as well as relevant server response times. State the machine, deployment, browser, network conditions, dataset, and cache conditions.
4. Run repeated measurements. Report median, p95, maximum observed time, and sample size if enough observations exist. A p95 below two seconds alone does not prove the statement's stronger “every page” wording.
5. Test cold and warm cases and filter changes. Report any page exceeding two seconds and fix or disclose it.
6. Measure batch billing throughput separately. A fast page response or queued-job acknowledgement does not prove all invoices were generated correctly or quickly.

Potential engineering choices such as pagination, indexed access, bounded queries, and precomputed summaries belong in the later implementation plan. Never claim they exist or are effective before verification.

## Honest category-targeted presentation

Use the organizer's actual rubric when available. Until then, these are proof themes, not official weights:

- **Functionality:** complete every Brightloop scene, including unglamorous reset, send, print, and rule boundaries.
- **Data modeling:** stable agreements and invoice snapshots; separate payment records; explicit eligibility and periods.
- **Technical quality:** duplicate prevention plus completeness, authorization, reliable balances, and measured page speed.
- **UX:** clear next action, effective dates, explanations, and recoverable billing exceptions.
- **Originality:** make operational trust tangible with explainable totals and the batch exception view, rather than adding unrelated AI.
- **Presentation:** show the required workflow, deliberately repeat billing, and reconcile finance totals from records.

Never invent customers served, revenue saved, delivery success, test coverage, or latency numbers. Synthetic collection is not real revenue. Invoiced totals, cash collected, recurring contract value, and recognized revenue are different metrics.

## Before submission

**Ready:** Required flows run end to end; the demo resets predictably; each required action is genuine; totals reconcile; permissions and performance have evidence; the team can explain policies and known gaps.

**Reduce optional scope:** Any mandatory gap remains. Cut the clock, fancy timeline effects, and extra analytics before cutting required tax/discount modes, lifecycle capabilities, or security.

**Do not claim complete:** The frontend hides missing persistence, send/print are inert, the billing replay creates duplicates, a due subscription silently disappears, or performance remains unmeasured.

## Additional adversarial gates from policy review

- A due period earned before closure is still found by backlog processing; a complete paused interval is explicitly non-billable rather than silently skipped or later charged.
- Two workers racing for the final discount capacity cannot both reserve it.
- A confirmed zero-total invoice becomes Paid with no fabricated payment.
- Two concurrent partial payments cannot together exceed outstanding balance.
- Reusing one payment idempotency key with a different payload fails as a conflict.
- Editing catalog or plan prices leaves accepted contract and invoice snapshots unchanged.
- Joining two invoice lines with two payments cannot multiply finance aggregates.
- Portal responses omit internal cost and payment-note fields, not merely hide them visually.

Every check remains unrun until implementation evidence exists.

## Higher-quality source reconciliation

Product notes persist and remain editable under normal catalog permissions. The exact subscription sequence is Draft → Quotation → Confirmed → Active → Closed; prove Closed on a separate fixture so the main three-active-subscription snapshot remains internally consistent. Cover switchable add-ons through ordinary optional lines and the chosen effective-boundary policy; historical invoices remain unchanged. FIN-02 measures every required page with the populated dataset, not finance alone.
