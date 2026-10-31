# SubTrack — proposed baseline decisions

**Status: D-01–D-10 adopted as implementation defaults on 31 October 2026 under the instruction to execute ROADMAP.md. These are team policies, not organizer requirements. Adoption is not proof of implemented behavior or unanimous teammate review.** The supplied brief leaves these semantics open; this register gives implementation one coherent interpretation. [REQUIREMENTS.md](REQUIREMENTS.md) remains authoritative. Record amendments here and in affected tests.

The historical handoff was documentation only. Implementation is now authorized; actual gate results are tracked in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md), which does not infer passing tests or performance from this policy register. SubTrack is the product; Brightloop Software is the fictional client in the brief.

## D-01 — Price meaning and accepted terms

**Default:** A plan identifies one primary product. Its price is the recurring base unit price for that product, replacing—not adding to—the catalog base sales price in that plan. Add the chosen variant adjustment per unit. Additional product lines use their accepted catalog unit prices and share the plan cadence. Require exactly one primary-product line; no separate invisible plan fee. The minimum quantity applies to the primary-product line, not unrelated add-ons.

At subscription confirmation, snapshot plan policies, prices, quantities, variant adjustments and payment terms. Catalog/plan/template edits do not change accepted subscriptions. A different plan or commercial price requires a fresh quotation; automatic repricing and general mid-term commercial amendments are deferred. Taxes/discounts are selected when an invoice is generated and then snapshotted on that invoice. Prices and currency must be compatible before confirmation.

**P3 clarification, adopted for implementation:** a Draft is priced by the server when created or explicitly edited. Issuing a Quotation freezes that offered commercial snapshot and plan capabilities for its validity window; confirmation copies that exact offer into accepted terms. Current publication/availability and product/variant eligibility are rechecked at confirmation, but later catalog or template edits cannot silently reprice an issued offer. Minimum quantity is enforced from the offered plan snapshot. New quotes use current configuration. Taxes on quotations are labelled estimates; invoice-time tax/discount rules remain governed by D-07.

The brief also describes add-ons customers switch on/off. Bounded proposed policy: represent these as optional existing product lines with effective active intervals. An authorized enable/disable request takes effect at the first original schedule boundary on or after its request date that is not already invoiced. Preserve prior owed periods and invoice snapshots; use accepted unit prices without proration or silent repricing. The primary-product line cannot be disabled. Persist requested/effective dates and enforce customer ownership; this is not a separate add-on CRUD platform.

**Why:** Both plan price and product sales price must have a real purpose, without double billing. **Proof:** catalog base 1,200, plan base 1,000, variant +560 gives 1,560 per primary-product unit, not 2,760; an add-on is separately priced. Existing accepted terms survive later edits. This is a proposed interpretation, not text asserted by the brief.

## D-02 — Time, boundaries and activation

Use `Asia/Kolkata` for business dates and UTC for recorded timestamps. Periods are **[start, end)**: start included, end excluded. Bill in advance at period start. Invoice issue date is the generation business date; due date is issue date plus the nonnegative integer payment-term days. Today's due invoice is not overdue; overdue starts when business date is later than due date and outstanding is positive.

Daily/weekly intervals advance by calendar days/7 days. Monthly/yearly boundaries are computed from the **original** start anchor and period index, clamping only the target month's day. Never advance from the previous clamped date: Jan 31 → Feb 28 → Mar 31; leap-day annual anchors recover Feb 29 in leap years. Preserve the original anchor on pause and renewal. Expiry must be a full-period boundary; reject partial final periods rather than silently inventing proration.

Plan availability and discount end dates are inclusive. Plan availability limits new confirmation, not accepted running terms. A quote with N positive validity days is valid from issue date through issue date + N − 1. Check quote validity and plan availability at confirmation. Future-start confirmations remain Confirmed until start date; a normal server-side due-processing operation activates them when due. Activation does not require payment. A persisted stage/status and effective dates must agree; do not rely on browser badges to perform transitions.

**Proof:** month-end/leap-year, inclusive last date, expired quote, future start and today's-due tests. A server-owned clock supplies all time decisions. A synthetic date is allowed only in an isolated, clearly labelled demo/test environment; ordinary clients cannot override production business date.

## D-03 — Pause, resume and early close without retroactive gifts

Capabilities are enforced from accepted plan policy. **Pause/early-close requests take effect at the first original schedule boundary on or after the request business date that is not already invoiced.** Display request date and effective date. Never waive an older owed period or cancel a previously generated invoice simply because the user asks to pause now. This includes overdue unbilled periods: they remain owed. No partial-period refund or proration is implied.

While paused, every complete period beginning at/after the pause effective boundary and before resume/expiry is recorded as **non-billable: paused**. A small period-outcome record or equivalent persisted interval plus auditable period outcomes is enough; no event-sourcing platform is needed. Resume takes effect at the first original boundary on or after its request date, after the pause boundary; it cannot change prior waived/owed outcomes. If that boundary reaches expiry, renewal is required before service resumes. Pause does not extend expiry or shift the original anchor. Early close moves the subscription stage to Closed at its effective boundary, stops future periods and does not erase debt.

**Proof:** pause mid-month, resume next month, verify current issued bill remains owed, paused complete periods are explicitly waived, later periods resume on original anchor. An overdue period before the request remains billable even if processed after closing.

## D-04 — Expiry and renewal

No service period starts at or after the exclusive expiry boundary. The required visible progression is Draft → Quotation → Confirmed → Active → Closed. With auto-close enabled, both stage and operational state become Closed at expiry. Without it, show the interim **Term ended — close or renew** condition, block new service/billing periods, and provide staff/admin an explicit end-of-term Close action that moves the stage to Closed. End-of-term closure does not require permission to close early; it does not reopen service or erase debt. Historical owed periods remain recoverable in either case.

If renewal is allowed, extend the existing term by a positive whole number of plan periods at its existing accepted terms. Preserve previous/new expiry in audit history and use an idempotent renewal action. Renewal never resets billing cursor or repeats old periods. Do not renew an early-closed contract; create a fresh quote instead. For a term that already ended, do not silently charge the expired gap: baseline rejects late renewal and requires a fresh quote/start date. Renew before expiry, or exactly at its boundary before any gap arises. New pricing requires a new quote rather than invisible amendment.

Serialize renewal and expiry processing with the same subscription lock/version check, and re-evaluate the persisted expiry inside that transaction. Record closure cause: at the exact expiry boundary, expiry-closed is still eligible for the permitted renewal, but early-closed is not. A successful boundary renewal restores Active stage and the appropriate running/paused condition under the existing lifecycle policy; an expiry worker must not close a term that has already been extended. After that boundary date, the late-renewal rejection still applies; no expired gap is back-billed.

**Why:** Makes “renew” a demonstrable operation while avoiding retroactive service/debt. **Proof:** renew one term, generate exactly its new next-period invoice, replay renewal request without extending twice; disabled renewal and late renewal fail clearly.

## D-05 — No duplicate or skipped period outcomes

Enumerate due scheduled periods, not only subscriptions whose **current** badge says Active. Eligibility uses effective historical start/pause/close/expiry policy. A now-paused, closed or expired subscription can still owe an earlier billable period. An unstarted Draft/Quotation is never billable.

Each due period has one persisted outcome: invoice created, invoice already exists, explicitly non-billable with reason, or failed and retryable. Use an original-schedule identity such as `(subscription_id, period_start, period_end, charge_kind)`, unique at the database layer on the logical charge/period-outcome record. That record points to its current invoice revision; invoice revisions are unique by `(logical_charge_id, revision_number)`, not by period alone. Within a short transaction lock/version-check the subscription, then acquire any discount locks in a consistent order. Persist invoice, discount reservation, period outcome, audit event and cursor advance atomically. Rollback cannot advance the cursor. Work through backlog oldest-first under a stated batch limit and show remaining work.

Canceled invoice revisions retain their logical charge link and immutable history. Ordinary replay returns the current revision/outcome and cannot regenerate a canceled invoice. An accidental cancellation produces a visible exception. Explicit staff/admin replacement locks the logical charge, verifies its current revision is Canceled with no payment ever recorded, inserts one linked successor revision and updates the current-invoice pointer atomically. At most one current collectible revision exists per logical charge; old canceled revisions are never collectible. Replacement recalculates taxes/discounts under the generation-date policy in D-07 and requires a visible preview and normal confirmation. Its total may differ: a consumed discount use retained by a canceled Confirmed invoice is not restored or silently reused. Failed periods remain retryable; explicitly waived periods are not failures or hidden skips. Database uniqueness and the locked current-revision check—not only a disabled button—are required.

## D-06 — Invoice freeze, cancellation and zero totals

Generated Draft invoice prices, quantities, taxes and discount calculations are **read-only snapshots**. Review then Confirm; fix an erroneous draft through explicit Cancel/replacement, not arbitrary line editing. This restriction is our scope choice; the brief requires invoice actions, not a general invoice editor. Draft is not collectible. Confirmation freezes/consumes the already recorded financial decision; partially settled invoices stay Confirmed. Paid means outstanding is zero.

Cancel is allowed only for Draft or Confirmed invoices with **no payment ever recorded**. A paid invoice, including a zero-total Paid invoice, is not cancelable in this baseline. Confirmed cancellation does not restore a consumed discount use. Never delete financial history. Credit notes, refunds and payment reversals are deferred.

Confirming a zero-total invoice immediately settles it as Paid with reason **zero amount due** and creates **no fake zero payment**. Preserve confirmation and settlement events. Send/print do not change financial status. Draft output must be labelled Draft; failed delivery must not be reported as sent.

## D-07 — Discount allocation, reservation and expiry

Choose **one eligible rule per invoice**, with deterministic administrator priority then stable rule ID. A product-targeted rule affects only its eligible product lines; a whole-subscription rule affects all eligible lines. No stacking. Both minimum amount and minimum quantity must pass if both are configured. Thresholds use eligible pre-tax/pre-discount bases and quantities. Global usage limit means one reserved/consumed application per invoice, not per line/unit/customer.

Eligibility uses invoice-generation business date, including for backlog bills. Freeze rule version and eligibility in the Draft. Percentage is 0–100; fixed value is nonnegative and capped at eligible base. Allocate fixed discounts proportionally to eligible line bases in integer minor units, distribute remaining minor units by largest fractional remainder then stable line ID. Calculate exclusive percentage tax on each discounted line, half-up to currency minor units, then sum. This is demo product policy, not statutory tax compliance.

Draft generation reserves limited usage atomically; confirmation consumes that exact reservation even if the rule has since expired or changed. Canceling Draft releases it. Canceling Confirmed does not restore consumed usage. Replays cannot reserve/consume twice. Show consumed, reserved and remaining counts, plus drafts holding reservations; reservations do not expire silently in this baseline. If exhausted, show the reason for not applying a rule. Later rule expiry/edit affects future generation only.

**Proof:** two invoices compete for last use; only one reserves it. Confirm a previously eligible draft after rule expiry; its saved total remains intact. Cancel draft releases its reservation; canceled confirmed does not. Test product targeting, fixed discount remainder allocation and 100% discount.

## D-08 — Payments and corrections

Record positive invoice-linked payments only against Confirmed invoices. Show a review/confirmation step for amount, method, payment date and note. Validate currency and reject overpayments, future payment dates and invalid dates. Preserve both payment date and recorded-at timestamp. Never infer uniqueness from amount/date; distinct equal payments can be legitimate.

Lock the invoice and validate outstanding inside the payment transaction. A unique submission key makes double-click/retry safe. Reusing the same key with a different payload is a conflict. Concurrent payments cannot together exceed outstanding. Derive Paid and balance from committed allocations, then refresh portal and finance from persisted data.

Payments are immutable in baseline. There is **no payment correction/reversal UI**; document this limitation rather than silently editing/deleting records. If later authorized, reversal requires a separate unique record linked to the original, server permissions and transactional recomputation including Paid→Confirmed where appropriate. Do not add that expansion before required workflows pass.

## D-09 — Fixed least-privilege roles

No configurable permission-builder is needed for the round. Enforce these rules on the server and serializer, not only navigation:

| Operation | Admin | Internal staff | Customer |
|---|---|---|---|
| Add staff, roles, catalog/plans/taxes/templates/discount configuration | Yes | Read necessary operational catalog only | Published plan/product information only |
| Create customer quote, issue/confirm/activate subscription | Yes | Yes | Read own quote/subscription; no commercial editing |
| Plan-permitted pause/resume/renew/early close; scheduled optional add-on toggles | Yes | Yes | Own subscription only |
| Explicit end-of-term Close when auto-close is off | Yes | Yes | Read resulting state |
| Generate/confirm/cancel/replace invoice under D-06 | Yes | Yes | No |
| Record payment | Yes | Yes | No |
| Invoice send/print | Yes | Yes | Own invoice print/download only |
| Finance-wide dashboard | Yes | Yes, read-only | No |
| Cost price or internal payment notes | Yes | Cost price excluded; payment notes in authorized invoice workflow | Never |

Staff have operational access across customers for this single-company prototype; do not invent an undefined assignment system. Customers cannot submit accepted price, tax, discount, ownership, role or arbitrary lifecycle-date changes. Restrict customer field updates to explicitly allowed actions, with server-chosen effective dates. Plan capability does not grant configuration permission.

## D-10 — Finance and honest evidence

Active count and outstanding/overdue balances are **current**, evaluated at server business date. Historical “as-of” reconstruction is not supported in baseline. Label invoice issue-date and payment event-date filters explicitly; do not imply a single date filter reconstructs old balances. Billed amount and cash received are separate metrics, not summed as revenue. Exclude canceled/draft invoices from billed/outstanding totals; payments remain separate immutable facts. Filtered summary covers the entire filtered dataset, not one table page. Aggregate invoice lines and payments separately to prevent join multiplication.

Use a labelled isolated synthetic fixture for the November demo and separate valid thousands-row benchmark data. Record counts, hardware/environment, page size, cold/warm response timings and failures. Under-two-second behavior remains a target until measured. Local email outbox proves message generation only, not arrival at the registered address; real delivery or an organizer-approved fallback still needs truthful evidence.

## Team acceptance checklist

- [ ] Team reviewed these defaults; confirmed any organizer clarification takes precedence.
- [ ] Canonical dates, role matrix, price semantics and financial transitions shared by all agents.
- [ ] Every policy has an executable test; test status remains unverified until actually run.
- [ ] Demo values and UI wording match the selected policies.
- [ ] Deferred limitations are explicit; no decorative success buttons or invented benchmark results.
