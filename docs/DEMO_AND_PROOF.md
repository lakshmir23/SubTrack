# Demo and proof plan

**Status:** Proposed demonstration and acceptance checks, October 31, 2026. Nothing below is a claim that code exists, tests have passed, or payments have been processed. The full problem statement and event rules take precedence.

## The demo promise

> We can show not only that a subscription works, but why its bill and access state remain correct when something goes wrong.

Demonstrate one coherent customer's journey. Avoid jumping between unrelated seeded dashboards while implying an end-to-end process occurred. Label all seeded records, simulated dates, and gateway outcomes clearly.

## Primary demonstration: prove recurring billing before plan changes

This is the first presentation path, subject to the full statement. Use one synthetic customer, one ₹1,000 monthly plan, INR, no tax/discount unless required, full settlement only, and activation/access after confirmed sandbox payment. Label simulated dates and payments. Do not require a general-purpose time simulator: a protected “process due renewals” action may exercise the same persisted domain checks as the scheduler.

| Step | Action | Expected persisted evidence |
|---|---|---|
| 1 | Accept the November 1 quotation and settle its ₹1,000 initial invoice in sandbox. | One subscription, one paid invoice, access for November 1–December 1. |
| 2 | At simulated December 1, process the due renewal. | Exactly one new ₹1,000 invoice covering December 1–January 1; previous invoice unchanged. The invoicing cursor advances, but an open invoice is not collected cash or proof of paid access. |
| 3 | Repeat processing for the same boundary, then refresh. | Still two invoices total; no additional receivable, settlement, or shifted period. Show actual IDs/counts, not a toast alone. |
| 4 | Settle the renewal invoice in sandbox. | Two paid invoices, ₹2,000 collected, access through December 31; next boundary January 1. Replay that successful event without changing totals. |
| 5 | Schedule cancellation for January 1 and process that boundary. | Service ends, no third invoice, previous invoices remain readable. Replace the next-renewal message with the cancellation date. |

For this bounded scenario, unpaid renewal does not automatically extend paid access; no grace period is claimed. If the brief requires grace or credit terms, replace this policy explicitly. Show invoice state and service/access state separately during step 2 rather than inventing a universal renewal-failure rule.

This path proves **positive renewal and replay safety**, not merely that cancellation suppresses a charge. Optional upgrade math must not displace this evidence.

## Optional separate synthetic example: immediate upgrade

Reset to a visibly labeled separate November scenario before this example. Do not imply that a canceled January subscription was silently rewound or upgraded in place.

### Declared assumptions

- This is a sandbox using synthetic November 2026 dates, not the current real date.
- Currency: INR. Plan A is ₹1,000 per month; Plan B is ₹1,600 per month.
- Period: November 1 inclusive to December 1 exclusive, exactly 30 days.
- Upgrade effective date: November 16, leaving 15 unused days. Decline and successful recovery occur at that same simulated effective instant; this does not demonstrate delayed-payment handling.
- Proration uses the actual number of days in this period.
- No tax or discounts in this example. Add them if mandatory, with a separately verified calculation policy.
- The upgrade takes effect only after its adjustment payment succeeds.
- Cancellation is effective at period end, not immediately.

These are proposed product rules, not a claim that every subscription provider uses them.

### Visible journey

| Step | Action | Expected persisted result | What the reviewer sees |
|---|---|---|---|
| 1 | Customer accepts quotation for A on November 1. | One subscription; initial invoice ₹1,000. | Quote linked to subscription and invoice. |
| 2 | Simulate successful payment of that invoice. | Invoice paid; A active for the period. | ₹1,000 collected; next boundary December 1. |
| 3 | Advance sandbox date to November 16 and request B. | Pending plan change with preview; no settled charge yet. | Explicit calculation and next invoice date. |
| 4 | Simulate a declined adjustment payment. | Adjustment remains unpaid; change pending; A retained. | Recoverable error, not a false success state. |
| 5 | Successfully pay the same outstanding adjustment. | ₹300 settled; B active; change applied once. | Timeline links payment and entitlement change. |
| 6 | Redeliver the same successful event. | No additional settlement or upgrade. | Totals and record counts remain unchanged. |
| 7 | Schedule period-end cancellation. | Cancellation scheduled for December 1. | Access remains through November 30; no next renewal. |
| 8 | Advance to December 1. | Subscription ended; no renewal invoice. | Final state and complete history. |

### The calculation shown before confirmation

Unused A credit: **₹1,000 × 15 ÷ 30 = ₹500**.

Remaining B charge: **₹1,600 × 15 ÷ 30 = ₹800**.

Additional amount: **₹800 − ₹500 = ₹300**.

Customer-facing summary:

> Pay ₹300 now to upgrade. Your next full-cycle invoice would be ₹1,600 on December 1 unless you cancel before renewal.

After both successful payments, the synthetic record contains **two paid invoices and ₹1,300 collected**. The failed attempt is not a successful payment. Replaying a successful event must not add a third invoice or additional collection. This is a simple invoice/payment view, not a claim of full accounting-ledger compliance.

After cancellation is scheduled, replace the next-invoice promise with the correct cancellation message. Do not leave contradictory UI saying both “renews December 1” and “ends December 1.”

## Optional safety branch: unknown is not declined

Use a separate resettable scenario if time permits:

1. Submit a sandbox payment attempt.
2. Return an unknown/timeout outcome instead of a definite decline.
3. Show: **Payment outcome unconfirmed. Reconciliation required; automatic retry is blocked.**
4. Resolve the existing attempt from a verified sandbox status result.
5. Apply its result once.

Never assume an unknown outcome means no money moved. Odoo's official automatic-payment documentation describes exception handling intended to avoid duplicate charging. [Odoo automatic payments](https://www.odoo.com/documentation/19.0/applications/sales/subscriptions/automatic_payments.html).

A small, explicitly marked simulation clock is an established testing technique, not a world-first claim. [Stripe test clocks](https://stripe.com/blog/test-clocks-how-we-made-it-easier-to-test-stripe-billing-integrations).

## A concise presentation sequence

Adapt to the actual allotted presentation time. For approximately four minutes:

1. **20 seconds:** State the business problem and the mandatory flows covered.
2. **45 seconds:** Show quotation acceptance, paid activation, and customer-visible persisted records.
3. **60 seconds:** Process a normal renewal, repeat it, and refresh to prove exactly one invoice for that period.
4. **35 seconds:** Settle it, show collected cash separately from invoiced amounts, and replay the event safely.
5. **35 seconds:** Schedule cancellation, process its boundary, and prove there is no next-period invoice.
6. **45 seconds:** Show requirement coverage, validation/authorization evidence and deliberate scope boundaries.

Only with extra presentation time and a stable mandatory baseline, show the separately reset ₹300 upgrade example. If there is less time, omit the optional example rather than positive renewal.

The presenter should be able to explain the state transitions without relying on an AI assistant or reading raw logs. Keep a small offline capture of the genuine workflow if event rules permit, but do not present a recording as a live interaction.

## Requirement-to-proof matrix

Populate this from the exact statement before implementation. The rows below are proposed examples, not a confirmed event rubric.

| Requirement or quality | Reviewer action | Evidence | Status |
|---|---|---|---|
| Quotation workflow | Accept a quote. | Linked subscription and invoice; repeat action has no duplicate. | Not implemented / not verified |
| Plan management | Create or edit a permitted plan. | Validation; future price change does not alter old invoice. | Not implemented / not verified |
| Customer self-service | Open own subscription. | Correct records, permitted actions, clear effective dates. | Not implemented / not verified |
| Normal renewal | Process a due boundary, repeat, then refresh. | Exactly one invoice for the correct period; no duplicate totals. | Not implemented / not verified |
| Billing adjustment (optional unless required) | Preview the November example. | ₹500 credit, ₹800 charge, ₹300 net. | Not implemented / not verified |
| Recovery behavior | Decline then pay same invoice. | Pending change becomes active once; coherent access. | Not implemented / not verified |
| Replay safety | Repeat one successful event. | One settlement for that event; unchanged totals. | Not implemented / not verified |
| Authorization | Request another customer's invoice. | Server rejects access. | Not implemented / not verified |
| Cancellation | Cancel at period end and cross boundary. | Access preserved then ended; no renewal invoice. | Not implemented / not verified |

Do not change these status labels to passed merely because a screen exists. Link each passed claim to a repeatable check or captured evidence from the actual system.

## High-value acceptance checks

### Release-blocking for the implemented scope

- [ ] Normal renewal creates one invoice for the correct period; repeated processing creates none extra.
- [ ] Double-clicking quotation acceptance creates only one subscription.
- [ ] The demonstrated proration calculation is exact and its assumptions are visible.
- [ ] Duplicate successful payment delivery cannot create duplicate settlement or entitlement.
- [ ] A declined upgrade payment does not grant the paid upgrade prematurely.
- [ ] Unknown payment outcome is not treated as a safe automatic retry.
- [ ] A customer cannot access another customer's invoice through a direct URL or request.
- [ ] Customer requests cannot invoke administrator-only price changes.
- [ ] Period-end cancellation preserves access before its boundary and ends it afterward.
- [ ] Plan-price edits do not silently change historical invoices.
- [ ] The demonstration does not trigger real payments or real customer communications.

If a proposed optional feature is not implemented, mark its test **not applicable to current scope**, not passed. If the statement mandates it, mark it an outstanding gap instead.

### Calendar and consistency checks

- [ ] A monthly subscription starting January 31 follows a documented calendar policy rather than blindly adding 30 days.
- [ ] Leap-year February and differing month lengths are considered if monthly arithmetic is implemented.
- [ ] Billing timestamps have a defined timezone and are displayed consistently.
- [ ] An unpaid initial invoice cannot accidentally yield an unsupported unused-time credit.
- [ ] Concurrent plan changes produce a clear result or conflict rather than silently losing one update.
- [ ] Subscription, invoice, payment-attempt, and access states remain coherent after refresh.
- [ ] Data persists across sessions; dashboard values are derived from records, not hard-coded.

For an eight-hour build, prioritize the checks that cover actual mandatory features and the exact live demo. Do not claim all edge cases are solved merely because this checklist mentions them.

## Honest benchmarks

A benchmark must name the workload, environment, measurement, and result. Suggested checks, only reported after execution:

- **Replay correctness:** Deliver the same event 20 times; count actual resulting settlements and plan changes. Target: one of each where appropriate.
- **Isolation:** Attempt cross-customer record access with separate authenticated identities. Target: denied access, not merely hidden navigation.
- **Lifecycle correctness:** Run the complete synthetic journey from a clean seed and inspect invoice totals and effective dates.
- **Workflow usability:** Have a teammate perform a plan change without verbal guidance; record observed confusion and fix it.
- **Response time, if measured:** State dataset size, machine/environment, request type, and actual measurement. Do not extrapolate a small local test into production-scale claims.

Do not invent success percentages, revenue recovered, customers served, latency numbers, or test counts. Synthetic ₹300 recovered in the demo is **simulated collection**, not real business impact. MRR, invoice totals, and cash collected are different quantities and must not be labeled interchangeably.

## Go / no-go before presentation

**Go:** Required flows work end to end; the demo can be reset; visible totals match records; permissions work; the team knows which integrations are simulated; submission requirements are met.

**Reduce scope:** Mandatory flow is incomplete, hero feature bypasses normal rules, data changes unpredictably, or the presenter cannot explain a calculation. Remove optional complexity and rehearse the smaller genuine system.

**Do not claim ready:** A polished frontend has no working persistence or authorization, the demonstration is scripted around broken workflows, or a live payment integration has not been safely approved.
