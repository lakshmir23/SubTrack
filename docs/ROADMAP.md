# Coding-agent roadmap — configure → collect → prove

**Status: documentation-only implementation handoff. Every checkbox below is uncompleted; none is a claim that code, tests, delivery or benchmarks exist.** Start implementation only when the team gives the coding agent that task. This roadmap supplies execution order, not permission to change scope or spend on services.

## Read first; establish the real starting point

Read root `AGENTS.md`, [REQUIREMENTS.md](REQUIREMENTS.md), [HACKATHON_CONSTRAINTS.md](HACKATHON_CONSTRAINTS.md), [DECISIONS.md](DECISIONS.md), then [EXECUTION_BLUEPRINT.md](EXECUTION_BLUEPRINT.md). The supplied problem statement determines mandatory scope; D-01–D-10 are proposed defaults to agree as a team, not organizer rules. [DOMAIN_AND_EDGE_CASES.md](DOMAIN_AND_EDGE_CASES.md) supplies edge cases; [DEMO_AND_PROOF.md](DEMO_AND_PROOF.md) supplies reproducible witnesses. If these conflict, surface and resolve the discrepancy rather than choosing silently.

**Execution rule:** finish a thin, persisted, role-authorized workflow with UI and a test at each gate. Do not finish all backend work before connecting a frontend, or build a polished dashboard over static JSON. Keep the application runnable between slices.

**Time rule:** confirm the organizer's actual deadline/timezone and submission instructions; budget from time remaining, not a fresh eight hours. Reserve the final 60–90 minutes for regression, startup, evidence and submission. The event's nominal duration is not proof of your remaining build time. If behind, cut optional features and decoration—not requirements—and record any incomplete mandatory feature honestly.

## P0 — Baseline, contracts and ownership

**Depends on:** team authorization to implement and current repository access.

- [ ] Inspect current remote branch, local status, instructions and existing application before editing. Preserve teammate work; agree file ownership and an integration owner. Do not reset, force-push or migrate a working stack for preference.
- [ ] Confirm D-01–D-10 once: plan price meaning, roles, business clock, lifecycle boundaries, immutable billing snapshots, discount reservations and finance definitions. Record amendments in the canonical decision register.
- [ ] Keep the team's working stack. Only if none exists, the blueprint recommends React/TypeScript/Vite, Node/Express/TypeScript and PostgreSQL with familiar libraries; this is not a mandated stack.
- [ ] Agree minimal persisted entities and shared request/response contracts: users/customer ownership; products/variants/plans; templates/subscriptions/lines; invoices/lines; payments; tax/discount rules and reservations; period outcomes and action history. Give money, timestamps and business dates distinct types/representations.
- [ ] Agree migration/seed/start/test commands, server-only secrets and an approved email route. Establish a fresh local DB startup, health check, a real DB-backed page and synthetic demo identities. Do not provision paid services or credentials without authorization.
- [ ] Start an evidence ledger: `REQ ID | implementation path | test or demo witness | observed result | blocker`. Use planned, implemented-unverified, verified or blocked; retain failures.

**Gate:** another teammate starts the app against the DB using documented steps; contracts and ownership are agreed. **Fix before proceeding:** missing DB persistence, incompatible schema changes, secrets in source, or an email delivery route assumed to exist. Escalate email setup early while independent work continues.

## P1 — Identity, least privilege and first customer session

**Depends on:** P0. **Coverage:** AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05.

- [ ] Build signup/login/logout and persisted unique normalized-email accounts; validate on client and server. Require more than eight characters, uppercase, lowercase and special character—do not invent a digit requirement.
- [ ] Add admin-only staff creation, fixed server-side permissions and distinct staff/customer navigation. Public signup must never accept an elevated role.
- [ ] Build reset request → registered-address email → expiring single-use token → new password. Avoid leaking whether an unrelated email exists. Capture actual registered-inbox delivery evidence with approved accounts.
- [ ] Give each role an authenticated landing page; establish reusable ownership checks and safe serialization before adding business data. Customer/staff responses must not leak protected cost fields.

**Gate:** duplicate/concurrent signup rejected; eight-character rejection and valid nine-character acceptance tested; staff/customer direct staff-creation attempts denied; reset token expires and cannot replay. Verify ownership again against real records in P3/P7. **Fix failures:** hidden buttons are not authorization; a development outbox is not real inbox delivery. Track delivery blocked until genuinely verified or an organizer-approved fallback is explicitly recorded.

## P2 — Sellable configuration with live price preview

**Depends on:** P1 admin boundary. **Coverage:** CAT-01, CAT-02, PLAN-01, PLAN-02, PLAN-03; foundations for BILL-02 and QUOTE-01.

- [ ] Persist product name/type/sales price/cost price/notes and configurable variants. Selecting a variant updates a server-derived price explanation; the Odoo +560 example must be configuration, not a hardcoded brand branch.
- [ ] Persist plan primary product, price, daily/weekly/monthly/yearly interval, minimum quantity, availability and auto-close/early-close/pause/renew permissions.
- [ ] Add admin tax configuration and reusable quotation templates with plan/product lines and positive valid-days count. Set up one usable offering end to end, not dozens of unrelated forms.
- [ ] Supply field errors, loading/empty/error states, readable money/date formatting and a working edit-save-reload cycle. Operational staff can read allowed catalog fields, not configure them.

**Gate:** all four intervals persist; minimum/availability violations fail server-side; unequal catalog/plan price proves D-01 replacement semantics (1,200 catalog, 1,000 plan, +560 variant → 1,560 per primary unit). Cost data stays internal. **Fix failures:** ignored plan price, double-added base, fake saves or unauthorized configuration. Lifecycle flags are not complete merely because checkboxes save; P6 must exercise them.

## P3 — First reusable quote becomes an active agreement

**Depends on:** P2 and shared calculation/date contracts. **Coverage:** QUOTE-01, SUB-01, SUB-02, SUB-03, SUB-04; rechecks PLAN-02 and AUTH-04.

- [ ] Create two independent quotes from one template; include subscription number/customer/plan/start/expiry/payment terms and product/quantity/unit-price/tax/amount lines. Changes to an instance or later template edits must not mutate other instances.
- [ ] Implement Draft → Quotation → Confirmed → Active with server transition validation and visible history; define the final Closed state now and exercise plan-governed transition to Closed in P6. Validate quote expiry and plan availability at confirmation; snapshot accepted terms. Future-start confirmations remain Confirmed until a server-owned activation operation runs when due.
- [ ] Give staff a searchable list and detail view with shared persisted state. Give each customer a read-only view of their own agreement; reject cross-customer IDs in direct API/URL requests.
- [ ] Use original calendar anchors for month-end/leap-year periods and aligned exclusive expiry. Explain errors and permitted next actions; payment is not an invented prerequisite to activation.

**Gate:** two quotes, one complete state progression and a future-start case survive reload; invalid transitions/expired quotes fail; Jan 31 and leap-day anchors recover correctly. **Fix failures:** browser-only state, catalog edits rewriting accepted terms, or a customer able to submit price/ownership changes.

## P4 — Correct first invoice, tax and every discount dimension

**Depends on:** P3 active agreement and P2 rule configuration. **Coverage:** BILL-02, DISC-01, DISC-02, DISC-03, DISC-04; first BILL-01/BILL-04 witness.

- [ ] Generate one Draft invoice automatically from accepted subscription terms with customer, lines, taxes and totals. Use one server-authoritative fixed-decimal/minor-unit calculator, deterministic allocation and rounding; never trust posted totals. Implement its first Confirm transition here, including zero-total settlement; P5 expands this into the full billing workbench.
- [ ] Implement admin-only fixed/percentage discounts, minimum amount/quantity, inclusive dates, maximum uses, product/subscription scope and deterministic non-stacking selection. Auto-select on the next eligible generated invoice.
- [ ] Reserve usage atomically at generation; consume once at confirmation; release on Draft cancellation; retain consumed use on Confirmed cancellation. Preserve generated snapshots through later rule expiry or catalog edits.
- [ ] Display base/variant/discount/tax/total and an understandable ineligibility reason. Do not claim jurisdictional tax compliance from the fictional demo rule.

**Gate:** demo A computes **3,088.80**, B **1,100**; independently test fixed and percentage, both scopes, amount/quantity boundaries, expiry and exhaustion separately, last-use race, fixed allocation rounding and 100% discount. Confirming a zero-total invoice yields Paid without a fake payment. **Fix failures:** client money authority, duplicate use, tax-before-discount mismatch or a correct happy path hiding missing rule dimensions.

## P5 — Reliable billing workbench and real invoice actions

**Depends on:** P4; D-05–D-07 transactional policies. **Coverage:** BILL-01, BILL-03, BILL-04, BILL-05.

- [ ] Process hundreds of due subscriptions, oldest owed periods first under a visible batch limit. Produce created/already-existing/explicitly-nonbillable/failed-retryable outcomes and remaining backlog. Historical owed periods must remain recoverable after pause, close or expiry.
- [ ] Enforce DB-level period uniqueness and atomic invoice/reservation/outcome/cursor persistence. Concurrent runs and retry after commit must not duplicate a charge; rollback must not move the cursor past failure.
- [ ] Add review/Confirm, eligible Cancel, explicit linked replacement, Send and Print. Canceled period identities remain occupied; ordinary batch replay must not silently rebill them. Never allow cancel after a payment was recorded.
- [ ] Send through the approved mechanism with truthful delivery status; render usable print/download output with number/customer/lines/tax/total/status. Label Draft output. Print/send must not alter settlement state.

**Gate:** hundreds-record results reconcile; replay creates zero duplicates; one injected failure remains retryable while other records succeed; two workers cannot double bill; print is inspected and actual invoice delivery verified. **Fix failures:** generic success toast over failed rows, untraceable skips, lost backlog, fake send button or a canceled invoice regenerated on replay.

## P6 — Partial collection and complete service lifecycle

Include the brief’s switchable add-ons using existing optional product lines and the proposed future-boundary policy in DECISIONS. Prove enabling/disabling affects the appropriate future bill without rewriting prior invoices; do not create a separate add-on engine or mid-cycle proration scope.

**Depends on:** P5; lifecycle uses P2/P3 accepted policies. **Coverage:** PAY-01, PAY-02, PLAN-03; completes BILL-04 and exercises BILL-05.

- [ ] Record method/amount/date/note against a Confirmed invoice; show history, paid/outstanding/due/overdue. Lock allocation and use an idempotency key; reject overpayment, invalid/future dates and zero/negative amounts. Identical legitimate payments may have different keys.
- [ ] Implement permitted pause/resume/early-close/renew and expiry processing using D-02–D-04. Show requested and effective dates. Paused full periods have explicit nonbillable outcomes; earlier owed periods remain billable; renewal does not repeat old periods.
- [ ] Exercise denied plan capabilities and direct API ownership. Preserve immutable payments and disclose the baseline's lack of payment reversal/correction UI.

**Gate:** A pays 1,000 then 2,088.80: first remains Confirmed with 2,088.80 outstanding, second Paid; replay adds nothing; concurrent allocations cannot overpay. Separately exercise pause/resume, early close, auto-close on/off, renewal replay, late-renewal rejection and recovery of older debt after closure. **Fix failures:** partial marked Paid, pause wiping debt, renewable forever after expiry, or permissions checked only in UI.

## P7 — Reconciled finance, complete portal and cohesive polish

**Depends on:** P6 persisted records. **Coverage:** FIN-01; complete AUTH-04 and PAY-02 witnesses.

- [ ] Build finance summary and filtered/paginated detail for active subscriptions, billed revenue, payments, outstanding and overdue. Separate invoice-issue-date and payment-event-date filters; current balances are not historical as-of accounting.
- [ ] Aggregate across the entire filtered dataset, not the visible page; avoid invoice-line/payment join multiplication. Drill-through preserves the filter and reconciles to summary values.
- [ ] Finish customer own-subscription/invoice/payment-status views, permitted lifecycle actions and own print/download. Test cross-customer list/detail/action/download routes; remove cost prices and internal payment notes from payloads, not just screens.
- [ ] Audit every destination for consistent spacing/navigation/statuses, keyboard focus, labels, disabled-action explanations, mobile layouts, loading/empty/error/retry states and duplicate-submit feedback. Refresh persisted totals after writes.

**Gate:** two demo invoices total **4,188.80**; after A settles, collections **3,088.80** and B outstanding **1,100**. On the isolated Nov 9 fixture B is overdue; C is not due. Filters and drill-through agree. **Fix failures:** fabricated charts, mislabeled revenue, portal data leaks or stale balances requiring manual page repair.

## P8 — Thousands-row performance and release proof

**Depends on:** P1–P7; all mandatory features implemented before optional work. **Coverage:** FIN-02 plus regression of every requirement.

- [ ] Run the blueprint's valid synthetic thousands-record dataset/protocol; record dataset counts, commit/environment, cold/warm API and first-usable-page timings for lists/search/filter/detail/due queue/finance. Report median/p95/max and every observed >2-second breach. A p95 target does not replace the brief's under-two-second requirement.
- [ ] Fix measured N+1, unbounded payload, missing-index and aggregate bottlenecks; rerun affected paths. Measure batch completion separately from page response. Do not invent performance results.
- [ ] Run authorization, financial arithmetic, date boundaries, failure/retry and concurrency regression; repeat fresh startup/migration/seed from the README. Check for secrets and broken links; preserve genuine teammate Git history.
- [ ] Rehearse [JUDGE_WALKTHROUGH.md](JUDGE_WALKTHROUGH.md), capture real evidence, verify organizer-required submission assets and actual upload/entry status. Submission permission/terms still apply. Record remaining failures and limitations plainly.

**Gate:** the ledger has actual evidence for all 28 IDs, startup is reproducible, every remaining breach is disclosed and submission status is verified rather than inferred from a deployed page. **Fix failures before new features:** no benchmark, untested security boundaries, fake email evidence, missing mandatory actions or a nonworking judge path.

## Optional P9 — One constrained AI assist, only if time remains

- [ ] Only after mandatory gates, team approval and authorized API access, consider [OPTIONAL_AI.md](OPTIONAL_AI.md): staff request → structured quotation proposal → server validation/recalculation → human review → ordinary saved quote.
- [ ] Never let model output write money, roles, ownership or lifecycle state; never expose keys in browser/repo. Keep manual form usable on timeout, refusal or rate limit; show no fabricated success. No guaranteed judging bonus is known.

**Cut this whole slice first** if any required feature or evidence is incomplete. Also defer gateways, proration, bank feeds, churn models and decorative animation.

## Mandatory coverage index

| Requirement IDs | Primary gates |
|---|---|
| AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05 | P1; ownership/portal completion P3/P7 |
| CAT-01, CAT-02 | P2 |
| PLAN-01, PLAN-02, PLAN-03 | P2/P3; actual lifecycle P6 |
| QUOTE-01 | P2/P3 |
| SUB-01, SUB-02, SUB-03, SUB-04 | P3 |
| BILL-01, BILL-02, BILL-03, BILL-04, BILL-05 | P4/P5/P6 |
| DISC-01, DISC-02, DISC-03, DISC-04 | P4/P5 |
| PAY-01, PAY-02 | P6/P7 |
| FIN-01, FIN-02 | P7/P8 |

**Finish definition:** complete, demonstrated mandatory workflow + truthful evidence + usable responsive UI + reproducible startup + verified submission. More feature names are not a substitute for this.
