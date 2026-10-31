# Brightloop execution blueprint

> **Planning, not implementation.** The user explicitly reaffirmed “No code” on 31 October 2026. This document is a handoff for the team's later implementation. No feature, test, benchmark or delivery below is claimed complete. The supplied problem statement—not a guessed judging rubric—is the acceptance contract. See [requirements](REQUIREMENTS.md), [domain policies](DOMAIN_AND_EDGE_CASES.md) and [proof script](DEMO_AND_PROOF.md).

## 1. The winning proposition to make demonstrable

**One customer's agreement becomes a correct bill, a traceable partial payment and an accurate finance view—without retyping or losing a billing period.**

Treat every required feature as part of that connected workflow, not 28 unrelated checkboxes. The visual story is **Configure → Quote → Activate → Bill → Collect → Understand**. A judge should follow the same subscription number through every stage, open the amount breakdown, and see the finance totals change from persisted records.

Three quality multipliers, not three new products:

1. **Explain the amount:** line base + variant adjustment − eligible discount + configured tax; show the accepted price snapshot.
2. **Explain the state:** progression, outstanding balance and allowed next action; disabled actions explain the rule instead of silently failing.
3. **Explain the exception:** failed billing row → affected subscription → actionable cause → retry → refreshed result. Never replace errors with a success toast.

## 2. Freeze decisions before parallel implementation

These are **proposed defaults**, not additional brief requirements. [DECISIONS.md](DECISIONS.md) is the canonical decision register; the table below is a compact implementation reminder, not a second policy source. Do not let frontend and backend invent different policies.

| Decision | Bounded proposed default / decision gate |
|---|---|
| Stack | If no existing choice: React + TypeScript/Vite, Node/Express + TypeScript, PostgreSQL, the ORM/session library the team already understands. This is a recommendation, not user-selected architecture. Keep a teammate's working stack rather than spend the round migrating. SQLite is a local fallback only if its concurrency behavior is deliberately tested. |
| Plan versus line price | Proposed DECISIONS policy: plan identifies a primary product; plan.price replaces that product's base unit price, then variant adjustment applies per unit. Other lines use accepted catalog prices; no additive plan fee. The demo's 1,000 base plus 560 variant remains reproducible. |
| Time and currency | Proposed DECISIONS policy: Asia/Kolkata business dates, UTC timestamps and half-open service periods; original-anchor calendar advancement with month/year clamping and anchor recovery. Availability/discount end dates inclusive. Synthetic demo INR is not specified by the Odoo +560 example; do not approximate a month as 30 days. |
| Partial periods | Require term boundaries aligned to complete billing periods for baseline. Explain validation. No unrequested proration engine. |
| Pause | Apply the boundary and explicit waived-interval policy in DECISIONS.md. Preserve historical billable periods, including on expired/closed accounts; distinguish intentionally paused intervals from missed unpaid billing. No silent cursor jump or automatic refund/expiry extension. |
| Renewal | Explicit new term on the same subscription, recorded dates and accepted terms; preserve prior invoices and avoid overlapping periods. Plan permissions govern renewal. |
| Pricing | Server-authoritative integer-minor-unit/fixed-decimal calculator; exclusive configured demo tax after discount, line-level half-up rounding. No claim of statutory tax compliance. |
| Discounts | No stacking; deterministic priority; threshold on eligible pre-tax/pre-discount base. One finalized invoice application = one use. Generated Draft is read-only and freezes eligibility; generation reserves, confirmation consumes once, Draft cancellation releases. Canceling an unpaid Confirmed invoice does not restore consumed usage. Usage limit and consumption must be transactional. |
| Staff | Admin configures catalog, plans, taxes, discounts and staff. Staff manages permitted subscriptions, invoices and payments. Customer sees only own records and plan-allowed service actions. Never rely on hidden navigation for authorization. |
| Invoice cancellation | Block cancellation with recorded money; preserve canceled charge identity/history. Replacement requires an explicit decision, not an automatic batch rebill. |
| Email | Identify an authorized sender/provider early. Registered-address reset delivery and invoice send require real delivery evidence. A local outbox is a development fallback, **not proof of inbox delivery**. Do not invent credentials or send to unrelated addresses. |

**Consistency gate:** subscription lifecycle and settlement are separate. Confirmed agreements may activate according to service dates without payment, because the brief does not impose prepayment. Partial payment keeps the invoice Confirmed, with a partial-payment label. Paid is derived from valid allocations; a valid zero-total invoice confirms directly to Paid without inventing a zero-value payment.

## 3. Vertical slices: every requirement produces observable evidence

Routes below are **suggested contracts**, not existing endpoints. Prefix `/api`; validate all writes and serialize only role-allowed fields. Freeze request/response shapes with teammates before splitting work.

| Slice / requirements | Storage and domain ownership | API and UI surface | Observable acceptance—not a checkbox claim |
|---|---|---|---|
| **A. Identity and boundaries** AUTH-01–05 | Unique normalized email; password hash; role; expiring single-use reset token | Signup/login/reset; admin staff creation; shared session and role navigation | Concurrent duplicate email rejected; 8-character password rejected and compliant 9-character password accepted; no invented digit requirement; reset reaches registered inbox and token cannot replay; staff cannot create staff; customer A cannot read customer B's record/PDF through direct URL/API. |
| **B. Sellable configuration** CAT-01–02, PLAN-01–03 | Product sales/cost/type; variant adjustment; plan price/cadence/minimum/availability/permissions | Product and plan forms; `/products`, `/plans`; compact setup workspace | Create named product with both prices; selecting Odoo adds configured 560, not a hardcoded brand branch; save all four cadences; reject below-minimum and unavailable acceptance; exercise allowed and disallowed pause/early-close/renew and expiry auto-close. Cost price absent from customer responses. |
| **C. Agreement** QUOTE-01, SUB-01–04 | Template copied, not shared mutable lines; unique subscription number; stage and accepted snapshot | `/quotation-templates`; subscription create/detail and transition actions; quote editor + progress strip | Reuse one template for two customers; changing it later does not rewrite their quotes; expired validity cannot confirm; show customer, plan, start, expiry, payment terms and product/quantity/unit-price/tax/amount lines; visibly traverse all four stages, visible to staff. |
| **D. Price and discount** BILL-02, DISC-01–04 | One calculator; tax rule; fixed/percentage rule/targets; reservation/application | Admin tax/discount setup; preview calculation and line breakdown | Staff discount creation denied; fixed and percentage examples separately pass; product-only and whole-subscription targeting work; test minimum purchase/quantity boundaries, start/end, next-invoice auto-apply and exhausted limit. Two concurrent claims on final use cannot both succeed. Confirmed amount survives catalog changes. |
| **E. Billing workspace** BILL-01, BILL-03–05 | Invoice snapshots; unique recurring charge identity; transactional cursor; per-item batch result | `/billing-runs`; invoice confirm/cancel/send; print route; due preview + result table | Hundreds of due records prefill invoices; replay/concurrent run creates no duplicate; failed item does not advance cursor and remains retryable; missed billable periods are processed in order even after service expiry/closure, while explicitly waived paused periods are not charged; confirm, unpaid cancellation, verified send and printable invoice work; Draft → Confirmed → Paid displayed correctly. |
| **F. Collection** PAY-01–02 | Append payment record with unique submission key; invoice lock/version and derived balance | `POST /invoices/:id/payments`; invoice payment drawer/history | Record method, positive amount, date and note; reject wrong scope and proposed overpayment; first payment leaves correct outstanding; second settles; browser replay adds no second payment; overdue follows due date and remaining balance. |
| **G. Finance and quality** FIN-01–02 | Aggregate persisted subscriptions/invoices/payments; indexed filtered lists; no fabricated chart data | `/finance/summary`, paginated lists; finance overview with drill-through | Active count, defined revenue, collections and overdue reconcile to the same fixture; filters affect rows and matching summaries; drill-through preserves filter; thousands-row benchmark below documents measured response times. |

Together the slice mapping covers **all 28 canonical requirement IDs**. Frontend-only screenshots do not prove server authorization, idempotency or calculation integrity; pair those screens with focused automated/integration evidence when implementation begins.

## 4. Critical path and parallel ownership

Plan against the **remaining** event time, not eight fresh hours after every restart. For an eight-hour round, reserve the last 60–90 minutes for integration, evidence and submission. Rebase checkpoints to the organizer-confirmed deadline.

1. **Opening 30–45 minutes:** agree policies, schema, roles, route shapes, synthetic fixture and permitted stack; verify local DB startup and actual email route. Establish real teammate branches/ownership.
2. **By ~2 hours:** identity/role boundary and one database-backed configuration-to-Draft path. Calculator tests can run before the polished UI. No mass CRUD generation before a working relationship path.
3. **By ~4 hours:** template → Quotation → Confirmed → Active → one correct invoice. UI and backend integrate now, not at the end. First exact money fixture reconciles.
4. **By ~5.5 hours:** batch/replay, discounts/taxes, partial payments, lifecycle policies and finance. Send/print/reset must already have a known working route or an explicitly documented unresolved blocker.
5. **By ~6.5 hours:** all requirement witnesses run; customer-scope and concurrency failures fixed; responsive layout and database performance tested. Stop adding optional features.
6. **Final 60–90 minutes:** regression, representative seeded dataset, fresh startup check, Git integration, demo rehearsal, organizer submission requirements and evidence. No invented pass status for an unexecuted check.

**Suggested ownership (adapt to actual team size):** one teammate owns identity/configuration; one owns subscription and lifecycle; one owns calculator/batch/payment integrity; one owns shared UI/finance and integration. Smaller teams combine slices, not integrity guarantees. Share UI primitives and one calculator rather than duplicate implementations. Every teammate makes genuine, attributable contributions and reviews an adjacent seam; never manufacture commits to satisfy participation.

**Merge contract:** small integrated changes, schema migration compatibility, explicit route response shape, documented seed/reset command, and one person accountable for resolving integration—not one person doing all work. Never overwrite teammates' active changes for a tidier history.

## 5. Cohesive UI without building a design system project

Use five staff destinations: **Overview, Subscriptions, Billing, Customers, Configuration**. Customer portal is a separate own-record view, not a filtered admin dashboard exposing internal data.

- Subscription detail: number/customer header; stage strip; service status; commercial terms; lines; invoice/payment history. One primary permitted next action.
- Billing: due queue, selectable batch scope, totals preview, result counts, failed-row explanations, invoice drill-through. Don't force the judge to find failures in a server log.
- Invoice: frozen amount explanation, confirmed/due/overdue context, payments and remaining amount; send/print/record-payment where permitted.
- Overview: definitions next to numbers. Distinguish **invoiced revenue** from **cash collected**; Draft/Canceled invoices cannot inflate realized revenue. Do not call a sum “MRR” without cadence normalization and a defined policy.
- All pages: visible loading/empty/error/success states, inline field errors, keyboard-accessible controls, readable numeric alignment, mobile cards instead of horizontally unusable tables. Preserve filters after returning from a detail page.

Prefer one intentional accent color, consistent spacing and clear status labels to decorative charts. Dynamic means real database state; it does not require WebSockets.

## 6. Honest performance and reliability proof

The brief says pages respond **under two seconds with thousands of subscriptions**. It does not name hardware, percentile or concurrency. Record these; do not weaken the requirement into a fast empty API response.

**Proposed internal test protocol:**

- Seed 10,000 subscriptions across customers, all lifecycle states and all four intervals; include 30,000 invoices and representative payments, overdue dates and variants. These are synthetic test records, never claimed as production users.
- Record commit, database engine/version, indexes, machine/browser, network/local mode and dataset counts. Use reproducible seed and reset steps.
- Measure first usable rendered content **and** API duration separately for subscription list, search/filter, detail, due billing queue and filtered finance. Include narrow and broad filters, populated data and empty results.
- Record cold navigation separately; run 50 warm measurements per path. Report count, median, p95 and max, plus errors; proposed internal target p95 under 2 seconds is **additional discipline, not proof that every page meets the literal brief**. Investigate every observed >2-second result and disclose remaining breaches.
- Test a realistic small simultaneous-user sample separately; don't mix it into single-user results. Bulk billing completion is measured separately from page response; UI should promptly acknowledge and expose progress/results if a batch takes longer.
- Optimize measured bottlenecks: indexed `(state, next_billing_date)`, customer ownership lookups, invoice status/due dates and payment invoice links; server pagination; bounded payloads; database aggregation; no per-row N+1 calls. Validate with actual query plans before adding speculative caching.

**Reliability witnesses:** two concurrent bill runs; replay after commit; one failed row amid successful rows; duplicate payment submission; discount final-use race; customer cross-record request; expired/reset-token replay. Preserve actual output and failure details. A seed script completing is not a benchmark pass.

## 7. Cut line and handoff truth

**Cut first:** proration, live gateway, automatic cards, bank feeds, AI/churn features, multi-currency, multi-tenancy, animated timeline and time-travel UI. Do not cut password reset, partial payments, plan permissions, invoice send/print, discount boundaries or customer isolation: those are in the brief.

**Highest integration risks:** ambiguous plan price; disagreeing pause/billing-cursor semantics; discount reservation lifecycle; nonexistent email sender; frontend permission-only protection; aggregate totals inconsistent with filters. Resolve these before visual extras.

Maintain a small evidence ledger: `requirement ID | implementation location | test/demo witness | actual result | unresolved issue`. Until verified, mark **planned / implemented-unverified / blocked**, never “done.” The existing demo fixture and requirements remain the source of truth; this blueprint adds execution order, not a competing specification.
