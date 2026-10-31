# Brightloop — coding-agent instructions

## Mission and scope

Build the **Subscription Management System** described in the supplied Odoo Brightloop brief, not a generic SaaS dashboard or consumer subscription tracker. Deliver one connected, database-backed product with complete required workflows, defensible business rules, responsive UI and measured performance.

This handoff was prepared as documentation only. A coding agent should implement when assigned implementation by the team. Do not mistake unchecked plans for completed work. Preserve teammates' code and changes; do not restart the project simply because a preferred stack differs.

## The two mandatory baseline sources

The supplied four-page Brightloop problem statement and the supplied Odoo Must have / Nice to have screenshot are the baseline for this entire project. REQUIREMENTS.md maps the first; HACKATHON_CONSTRAINTS.md maps the second. Never trade either baseline away for an enhancement. DECISIONS.md supplies proposed team policies only where the sources are silent. Use docs/BASELINE_AND_ENHANCEMENTS.md to prioritize optional improvements after mandatory coverage; it does not introduce new organizer requirements.

## Read first; do not skip the specification

1. `docs/REQUIREMENTS.md`: 28 canonical tracking IDs covering the actual four-page brief.
2. `docs/HACKATHON_CONSTRAINTS.md`: standing event expectations.
3. `docs/DECISIONS.md`: proposed defaults for unspecified semantics. Record which defaults the team adopts; apply each consistently across code, UI, tests and demo. These are not organizer requirements.
4. `docs/ROADMAP.md`: the top-down implementation sequence and acceptance gates.
5. `docs/DOMAIN_AND_EDGE_CASES.md` and `docs/EXECUTION_BLUEPRINT.md`: domain boundaries and verification details.
6. `docs/DEMO_AND_PROOF.md` and `docs/JUDGE_WALKTHROUGH.md`: reproducible demonstration and reviewer evidence.
7. `docs/OPTIONAL_AI.md`: optional only after the mandatory product is complete.

Authority order: newest explicit team/organizer clarification → actual problem-statement requirements → standing event constraints → recorded team decisions → roadmap/design suggestions → historical research. Flag a conflict and reconcile the affected documents; never silently reinterpret a required feature.

## Start from the actual repository

- Read the existing root README, package manifests, environment examples, migrations, tests and relevant local agent instructions before editing.
- Inspect the current branch and worktree. Preserve uncommitted changes and teammates' files. Fetch current remote state before integration; do not force-push or overwrite unknown changes.
- If implementation already exists, map it to the requirements and continue it. If not, use the team's selected stack; the blueprint's stack is a recommendation, not an imposed requirement.
- Establish working local run, test, lint, typecheck and production-build commands. Record exact commands in the README once implemented; do not document commands that do not exist.
- Create a short implementation-status record mapping requirement IDs to owner, implementation location, test and current result. Use Not started / In progress / Verified / Blocked, never optimistic percentages.
- Follow ROADMAP in order, preserving its vertical-slice integration gates. Do not build every backend table and every frontend screen separately before testing a complete journey.

## Required product boundaries

### Identity and authorization

Unique email; password longer than eight characters with uppercase, lowercase and a special character; reset link to registered email. Admin alone adds staff. Admin, limited internal staff and customer portal are distinct roles. Enforce access and ownership on every server operation, not only the navigation. Do not leak internal costs or notes in portal payloads.

### Configuration and quoting

Products include name, type, sales/cost prices, notes and variant adjustments. Plans include price, daily/weekly/monthly/yearly cadence, minimum quantity, availability and permitted lifecycle actions. Reusable quotation templates carry plan, lines and validity days. Subscription instances have their own number, customer, dates, payment terms and line snapshots, moving through Draft → Quotation → Confirmed → Active → Closed.

### Billing and collection

Generate prefilled invoices for all eligible periods. Enforce one logical charge per subscription period and expose failed/retryable items. Automatic taxes and bounded fixed/percentage discounts must obey configured scope, thresholds, validity and usage. Invoice actions include confirm, cancel, send and print. Record partial payments with method, amount, date and note against the correct invoice. Do not mark partly paid debt as Paid.

### Lifecycle and finance

Implement plan-permitted pause, resume, renewal, early closure and expiry behavior using one documented policy. Finance shows active subscriptions, invoiced revenue, payments, outstanding and overdue amounts with filters and summary. Every application page must remain responsive with thousands of subscriptions; the brief requires under two seconds, which must be measured rather than asserted.

## Non-negotiable engineering invariants

- Real persisted records and server calculations drive all lists, totals and state changes. Static JSON is only an initial prototype, not the final application.
- Validate input on both client and server. Database constraints remain the last line of defense.
- Use exact monetary arithmetic, explicit rounding and immutable accepted pricing/invoice snapshots. Do not compute authoritative totals from browser-submitted values.
- Adopt one documented interpretation of plan price; never double-charge a plan fee and the same product base price.
- Billing retries and concurrent workers cannot duplicate a logical period charge. A due item cannot disappear because its current contract badge changed; evaluate the effective period history and report non-billable reasons explicitly.
- Discount reservations and consumption must be atomic. Replay cannot consume another use. Expired/exhausted discounts must not quietly apply to newly generated bills.
- A confirmed zero-total invoice settles without a fake payment. Partial-payment allocation is atomic; duplicate keys cannot double-record money and conflicting payloads are rejected.
- A generated financial snapshot is not silently edited after the fact. Apply the cancellation/replacement rules in DECISIONS and preserve audit history.
- All four calendar cadences use explicit timezone and boundary rules. Do not approximate monthly billing as thirty days.
- Backend mutations return useful domain errors; the interface preserves entered data and offers safe recovery.
- Avoid aggregate join multiplication: invoice lines and multiple payments must not inflate finance totals.

## Polish gate on every screen

A feature is not done when its happy path first works. Verify:

1. Loading, empty, populated, error, invalid input and success states.
2. Refresh/direct navigation and persisted state after mutation.
3. Allowed versus denied roles, including direct API calls.
4. Repeated click/submission, retry and relevant concurrent change.
5. Keyboard focus, form labels, readable contrast, useful validation text and narrow-screen layout.
6. Search/filter/pagination and totals with nontrivial data where applicable.
7. Consistent labels, dates, currency, status colors and next actions across related pages.

Do not add decorative complexity that hides operational information. Keep the app coherent: overview → record → action → updated record/summary, with predictable navigation. Remove dead buttons and placeholder claims rather than pretending unfinished features work.

## Tests and proof

- Add focused tests with each domain slice, not after the whole UI is built.
- Maintain deterministic fixtures distinct from large-data benchmark fixtures. Use synthetic records, not private customer data.
- Run automated validation, authorization, date/money, lifecycle, replay and concurrency checks appropriate to the implemented scope.
- Run actual browser end-to-end journeys and the final production build. A test passing against mocks alone does not prove the database or UI works.
- For performance, record dataset shape/count, hardware, server/database configuration, cold/warm state, query/filter, timing boundary and sample results. Separate API timing from full rendered interaction. Report every observed breach of the two-second target and limitations; do not invent results or substitute a best-case number.
- Keep all 28 requirement IDs linked to implementation and evidence. A planned test remains unverified until run against the current build.
- Re-run affected checks after a bug fix or policy change. Before handoff, run the actual aggregate lint/typecheck/test/build commands and report passed, failed, blocked and not-run stages separately.

## AI and external services

The application must remain useful locally without a model API. Optional AI may propose a quotation using authorized existing catalog IDs and quantities; it may not choose customer identity, authoritative prices/taxes/discounts, payment status or execute writes. Staff review and normal server validation still apply.

Availability of OpenAI keys is not authorization to create credentials, expose secrets, configure new persistent access, spend money or transmit customer data. Use the applicable approved secure setup. Never put a key in the frontend, repository, logs, screenshots or chat. No runtime AI feature is required by the brief and no judging bonus has been established.

Use controlled test email recipients and an approved delivery mechanism. A development outbox proves generation, not real delivery. Never send real payment requests, move money, create financial accounts, accept new agreements or publish a contest entry merely because a test/demo step describes it. Obtain the applicable authorization.

## Team collaboration

Divide work by stable feature ownership with shared contracts, then integrate frequently. Every teammate should contribute genuine work and understand it. Do not forge authorship, create empty commits to simulate contribution or attribute AI work to an uninvolved person. Keep commits focused and explainable. Do not write to another teammate's active files without coordination.

## Definition of ready for review

- Every mandatory requirement has an implemented path and evidence, or a plainly disclosed blocker.
- The main quote → active subscription → batch invoice → partial/full payment → finance journey works from the final build.
- Lifecycle and discount boundary cases, role isolation and duplicate protection have been exercised.
- Send/print/reset paths are accurately labelled and verified to the extent claimed.
- Large-data performance has real measurements.
- The team can run locally and explain its choices.
- README setup and environment examples match reality; no secrets or private data are committed.

Report the final commit, changed scope, exact verification performed, failures/unrun checks, known limitations and next action. Do not claim production readiness, security certification, revenue recovered or contest submission without evidence.
