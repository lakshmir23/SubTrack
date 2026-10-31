# Domain, lifecycle and edge-case decisions

> **Planning document — 31 October 2026. Not an implementation or a claim of completed tests.**
> The confirmed problem title is **Subscription Management System**. The full current problem statement and judging rubric have not yet been supplied. Everything below is a proposed, defensible baseline, not an organizer requirement. Reconcile this document against the actual brief before building. The user-confirmed [hackathon constraints](HACKATHON_CONSTRAINTS.md) apply throughout: dynamic database-backed data, clean responsive UI, robust validation, intuitive navigation and genuine Git participation by every teammate. Local resilience, understandable code and justified technical choices take precedence over fashionable infrastructure.

## 1. The central design bet

Build a subscription system whose money and lifecycle decisions can be explained. A judge should be able to ask “Why is this customer charged this amount?” or “What happens if this runs twice?” and receive an answer backed by persisted records, not a rehearsed dashboard.

Three independent questions must stay independent:

1. **Service:** Is the customer's subscription active, paused, or ended?
2. **Debt:** What has been invoiced, and how much remains unpaid?
3. **Collection:** What happened during each attempt to collect that debt?

A failed collection does not erase an invoice. A canceled subscription does not erase old debt. A successful payment does not silently reactivate a canceled contract. This separation is the foundation for an understandable demo and prevents a single overloaded `status` field from lying.

### Proposed scope boundary

- One organization, one configured currency, one simple recurring cadence initially.
- A real local/hosted relational database; no mandatory Odoo integration unless the brief requires it.
- Server-enforced access checks with the smallest role model the brief needs. Do not build a multi-tenant identity platform.
- Explicitly labeled **simulated payments** or a permitted provider sandbox. No live charges, real credentials, or claims of a production payment integration.
- No complete accounting ledger, foreign exchange, usage metering, revenue recognition, or tax compliance engine in the baseline.
- Working vertical lifecycle first; proration and time-travel controls are additions only after it works.

## 2. Lean relational model

Names describe concepts, not prescribed framework classes. Use database constraints, not just form validation. This ten-record model is a reference design, **not ten mandatory CRUD screens or ten parallel implementation tickets**. For eight hours, retain the invariants with the smallest model that serves the actual brief: for example, accepted price snapshots on subscription/invoice lines can replace a standalone price-version editor. Do not add multi-item contracts or a separate price-version administration workflow unless required. Preserve immutable accepted prices, historical invoices and referential integrity even when simplifying.

| Record | Purpose and minimum meaningful fields | Invariant / rationale |
|---|---|---|
| **Customer** | ID, display name, contact fields required by brief | Separate customer identity from a login. A staff-created customer need not have a portal account. |
| **Product** | ID, name, description, active/archived | Describes **what** is sold. Archive rather than deleting products referenced by contracts. |
| **Plan** | ID, name, interval unit/count, active/archived | Describes **when** billing repeats. Avoid combining product identity, price and billing cadence in one mutable record. |
| **PriceVersion** | ID, product ID, plan ID, currency, unit amount in minor units, effective date, active/retired | Immutable commercial price. A new price creates a new version; it never rewrites accepted history. |
| **Subscription** | ID, customer ID, plan ID, service state, current period start/end, next billing boundary, cancel-effective-at, collection hold/reason, version counter | Describes the continuing agreement. Subscription-level cadence means all its lines share a billing boundary. |
| **SubscriptionLine** | ID, subscription ID, price-version ID, positive quantity, effective start/end | Records accepted items and prices. Close and replace a line for a plan/price change rather than overwriting historical terms. |
| **Invoice** | ID, subscription ID, customer ID, issue/due date, currency, covered period, invoice state, totals, renewal key | One receivable for a specific charge. Snapshot customer display/billing details needed to reproduce it. |
| **InvoiceLine** | ID, invoice ID, description snapshot, quantity, unit-price snapshot, period, subtotal, discount/tax amounts if supported, total, source line/version | Reproducible evidence. An invoice must not change when a product is renamed or its current price changes. Credit/debit adjustment lines carry a reason. |
| **PaymentAttempt** | ID, invoice ID, idempotency key, amount/currency, adapter/provider reference, outcome, attempted/resolved timestamps, sanitized failure reason | Attempts are not invoices. Multiple failures may precede one successful payment; ambiguous outcomes remain unresolved. |
| **LifecycleEvent** | ID, subscription/invoice/attempt reference, event type, actor, occurred-at, correlation key, safe structured details | Append-only explanation of actual business transitions. Never invent timeline entries solely in the UI. |

### Deliberate simplifications

**One cadence per subscription.** Mixed monthly and annual items require separate subscriptions for now. If the brief explicitly needs mixed cadences, change the model before coding billing logic.

**Full settlement only in the baseline.** A successful attempt settles the complete outstanding invoice amount. Partial payments, multiple allocations and refunds need a separate Payment/Allocation/CreditNote model; do not bolt them onto a boolean `paid` field. An actual provider may still report an unexpected amount or duplicate success: quarantine that fact for review instead of discarding it or inventing a refund.

**IDs are an engineering choice, not a score trick.** Integer keys are easy to inspect; UUIDs are useful for distributed generation and opaque public references. Either is defendable. Neither replaces authorization. A separately generated human-facing invoice number can coexist with an internal ID.

### Essential constraints

- Positive quantities; positive interval count; valid period start < end.
- Currency consistent across subscription terms, invoice lines and attempts.
- Foreign keys prevent orphaned lines, attempts and events.
- Unique renewal identity, such as `(subscription_id, period_start, period_end, charge_kind)`; a renewal retry must not create another charge.
- Unique provider event ID when provider events exist; unique collection idempotency key per attempt.
- At most one unresolved collection attempt for an invoice in the baseline, enforced transactionally.
- Nonnegative regular price; adjustment lines may be signed under an explicit rule. Never let a general negative quantity bypass validation.
- Finalized invoice totals and line snapshots cannot be edited. Corrections use explicit void/replacement or credit flow, according to supported scope.

## 3. State machines without state explosion

### Subscription service state

| Transition | Allowed effect | Must not happen implicitly |
|---|---|---|
| Draft → Active | Validate customer and accepted lines; establish first period; create the initial invoice under the chosen activation policy | Claim payment succeeded just because activation succeeded |
| Active → Active with scheduled cancellation | Set cancellation effective at period end; show the date prominently | End service immediately or silently refund old invoices |
| Active → Paused → Active | Optional only if the brief requires pause; define billing and date-shift semantics first | Treat “pause collection” and “pause service” as the same action |
| Active → Canceled | End at the agreed effective boundary, or explicit authorized immediate cancellation | Delete financial history or auto-refund |
| Canceled → New subscription | Preferred simple restart policy | Reuse old billing boundaries and accidentally collect old periods again |

Use **a cancellation date/flag**, not a separate `cancel_scheduled` service state, unless the UI needs that presentation label. Use a **collection hold** independently of service state. This avoids combinations such as “active-past-due-cancel-scheduled-payment-unknown.”

Activation policy must be decided: **invoice then activate** is easy to demonstrate, but creates service before payment. **Activate on paid invoice** is stricter and introduces a pending-activation state. Neither is universally correct; reflect the brief and label the chosen rule.

### Invoice state

- **Draft:** editable and not collectible.
- **Open:** finalized, collectible, amount due remains.
- **Paid:** full settlement recorded; no second collection.
- **Void:** canceled as a receivable through an explicit authorized action; not deletion.

“Overdue” can be a derived label: open invoice with due date earlier than the system's business time. Do not maintain a second status that can drift from the actual dates. Zero-total invoices need an explicit no-payment-needed finalization rule, not a fabricated successful payment attempt.

### Payment attempt outcome

- **Pending:** submitted/in progress; block a second attempt.
- **Succeeded:** confirmed settlement evidence; terminal under this simplified model.
- **Declined:** definitive failure, no settlement; a *new* attempt may be allowed by policy.
- **Unknown:** timeout, disconnected response, or ambiguous result; reconcile before another collection.

A timeout is **not** a decline. A response arriving late must not turn a confirmed success into failure. A failure on attempt A must not reopen an invoice settled by attempt B. Refunds/reversals, if required, are separate supported events, not permission to mutate `succeeded` into `declined`.

## 4. Renewal and collection: two boundaries, not one giant transaction

### Safe renewal sequence

1. Determine the subscription's next due boundary using authoritative server/demo time.
2. Lock the subscription or use a version comparison inside a database transaction.
3. Recheck service state, cancellation date, existing renewal identity and eligible terms.
4. If the period is already invoiced, return that existing invoice. Otherwise snapshot its lines, finalize the invoice, record the event and advance the billing cursor together.
5. Commit. Only then request collection through the adapter.

**Do not hold a database transaction open across an external payment call.** A committed invoice can legitimately remain open while collection is unresolved. Advancing the invoicing cursor must not be confused with receiving money. If policy says payment failure blocks future renewals, record and enforce that hold explicitly.

The smallest reliable hackathon implementation is a deterministic renewal service callable both by a scheduler and a protected demo action. It must use the same checks in both cases. A transactional outbox is a good later hardening step for reliably delivering collection jobs; it is not compulsory infrastructure for the first vertical slice.

### Idempotency in plain language

- **Renewal key:** “This contract, this period, this type of charge” is invoiced once.
- **Attempt key:** retrying the same collection request reuses its key; a new attempt after a confirmed decline gets a new key.
- **Provider event key:** receiving the same event twice changes state once.
- **UI mutation key/version:** double-clicks and stale browser tabs cannot create conflicting transitions.

For simulated payments, use deterministic scenario outcomes and persist them. Do not randomly change an attempt result on every refresh. For a real sandbox, respect the provider's own idempotency/reconciliation semantics; local keys alone cannot guarantee external exactly-once execution.

### Concurrency cases worth defending

| Collision | Chosen behavior |
|---|---|
| Scheduler and “renew now” execute together | Database uniqueness plus lock/version yields one invoice; other request returns it. |
| Cancellation races renewal | Both serialize on the subscription; cancellation effective at the boundary blocks that boundary's renewal. Return a clear conflict if a stale action loses. |
| Two plan changes from two tabs | Expected-version check rejects the stale command; do not silently overwrite. |
| Two collection workers | One unresolved attempt allowed; the second returns existing attempt state. |
| Webhook arrives before HTTP response | Both reconcile the same provider attempt; confirmed success cannot regress. |
| Old failure arrives after a later successful attempt | Preserve attempt history; leave invoice paid. |
| Duplicate confirmed provider payment | Record/anomaly flag and halt further collection; never hide the second payment or automatically issue an unsupported refund. |

## 5. Money, periods and plan changes

### Money policy

Use integers in the configured currency's **minor unit**, not binary floating point. Do not assume every currency has two decimals. For the baseline, configure a single supported currency and its scale explicitly.

For ratios such as proration, retain exact integer numerator/denominator until the documented rounding step. Proposed rule: round half up per adjustment line; sum the rounded line amounts to obtain the invoice total. Different valid policies can differ by a minor unit, so display the policy and test tie cases. Use safe integer ranges/decimal database types as appropriate to the stack.

Tax, discounts and inclusive/exclusive pricing remain **unconfirmed requirements**. If required, specify calculation order, eligibility, rounding and invoice snapshots before building them. Do not describe a simple percentage demonstration as legally compliant GST invoicing.

### Billing period policy

- Represent service periods as half-open intervals **[start, end)**. The ending instant belongs to the next period.
- Store authoritative timestamps consistently; display the configured business timezone.
- Monthly means calendar-month arithmetic, not “add 30 days.” Decide month-end anchoring, e.g. January 31 → February's last day → March 31, rather than accidental drift to March 28.
- Persist the original anchor and document leap-year behavior.
- Demo time is isolated from wall-clock scheduling and labeled. Never let arbitrary customers alter system time.

### Proposed change policy: defer first, prorate second

The low-risk baseline is **plan changes effective next renewal**. Show the pending terms and effective date. It solves the core problem without inventing credit balances, refunds and mid-cycle taxation.

If time and the brief justify proration, add a transparent upgrade preview:

> Illustrative untaxed 30-day period: ₹900 old plan → ₹1,500 new plan with 10 of 30 days remaining. Unused old-plan credit ₹300; new-plan remainder ₹500; net adjustment ₹200. This example uses an explicit 30-day period, not a rule that every month has 30 days.

The preview and committed change must use the **same calculation service** and expected subscription version. Store the inputs, effective time, rounding rule and adjustment lines. Do not rewrite the original invoice. If payment is required for an upgrade, specify whether entitlement changes immediately or only after payment; for a short build, activate paid upgrades only after confirmed settlement.

**Delayed-payment boundary:** the optional demo's decline and recovery occur at the same simulated effective instant. A preview based on November 16 must not silently charge the same unused-time adjustment for access first granted November 20. Check expected subscription version and effective time again before issuing an adjustment. For a short build, reject stale previews and require a fresh quotation; an already issued but definitively unpaid stale adjustment must be explicitly voided before replacement. Never rewrite settled history. An unknown attempt cannot be treated as unpaid, expired and safe to retry: reconcile it first. Until late settlement and service-effective-time policy are deliberately supported, keep immediate changes demo-bounded or use next-renewal changes instead.

Defer mid-cycle downgrades to the next period unless credit handling is explicitly built. Otherwise a negative invoice raises unanswered refund/credit-balance questions. A price catalog update alone must never upgrade, downgrade or reprice an existing subscription silently.

## 6. Permissions and audit evidence

Suggested minimal permission matrix, subject to the brief:

| Action | Staff/admin | Customer portal, if required |
|---|---|---|
| Manage catalog | Allowed | No |
| Read subscription/invoice | Authorized customer scope | Own records only |
| Request plan change/cancellation | Allowed under policy | Own contract under same policy |
| Mark payment confirmed | Adapter/reconciliation flow; manual action restricted and labeled | Never |
| Void finalized invoice | Restricted, reason required | No |
| Advance demo time / seed scenario | Protected demo environment only | No |

Enforce ownership and permissions on the server, not by hiding buttons. Test direct access using another customer's ID. Never trust client-submitted totals, price snapshots, payment status or role names.

Audit events should answer **who, what, when, why and which source record**. Include safe before/after commercial values, correlation keys and simulation labels. Exclude secrets, raw payment payloads, full card data and unnecessary personal information. Record business changes in the same transaction as their corresponding events. Append-only in the application is useful, but do not claim cryptographic tamper-proofing.

## 7. Acceptance scenarios to implement and actually run

These are **planned proof obligations, not passing test results**. Record actual outcomes only after execution.

| Scenario | Observable result |
|---|---|
| Valid activation | Persisted subscription, accepted terms, one initial invoice, coherent timeline. |
| Refresh/restart | Same records remain; no in-memory-only lifecycle. |
| Repeat same renewal 10 times, including concurrent calls | Exactly one invoice for that period; no inflated totals. |
| Definite decline then successful retry | Two distinct attempts, one settlement, invoice paid, no hidden failure. |
| Timeout/unknown then retry click | Collection blocked with reconciliation explanation; no second charge request. |
| Unknown reconciles to success | Existing attempt/invoice resolve consistently; hold cleared by explicit policy. |
| Duplicate and out-of-order payment events | No duplicate settlement; no regression from paid to open. |
| Cancel at period end then cross boundary | No renewal for the canceled next period; historical invoices intact. |
| Rename product / publish a new price | Existing invoice unchanged; existing contract not silently repriced. |
| Invalid quantity, currency mismatch, malformed date | Server rejects; no partial data or orphaned events. |
| Customer A requests Customer B's invoice | Server denies; UI hiding is not considered a pass. |
| January 31 and leap-year boundary | Agreed anchor behavior with no overlap or missing day. |
| Proration preview races another edit, if supported | Stale preview rejected and recalculated; no surprise amount. |
| Repeated demo run | Dedicated reset/seed path restores a known simulated dataset without touching real records. |

Use realistic, constraint-valid data and pagination if required. A large row count is not a performance claim. Report the dataset size, query/action, environment and measured latency if demonstrating performance; do not fabricate benchmarks or seed contradictory billing histories merely to fill tables.

## 8. Eight-hour trade-offs and questions to resolve

**Protect first:** real persistence → catalog/customer → activation → invoice generation → idempotent renewal → simulated payment outcome/reconciliation → cancellation → visible evidence.

**Add only after that works:** plan-change preview, proration, bounded demo clock, richer reporting, email queue. One strong scenario is better than five disconnected screens.

**Cut first:** multi-tenancy, live payments, multiple currencies, general tax engine, metered usage, complex discounts, AI churn prediction, full accounting, refund automation. If the actual brief mandates one of these, reprioritize rather than pretending it is optional.

Before coding, settle:

1. Is this SaaS sold by a merchant, consumer subscription tracking, or an Odoo module? The title alone does not settle this.
2. Exact required roles/entities/workflows and allowed stack/AI policy?
3. Invoice on activation or only after payment? Trial periods required?
4. What does nonpayment do to service, and when? Grace period/retry limit?
5. Must cancellation be immediate, end-of-period, or both?
6. Are proration, tax, discounts, refunds and real/sandbox payments required?
7. Actual current deadline, submission route and evaluation rules?

## 9. Source context and attribution

This document's schema and policies are **our proposed design**, not a claim that Odoo uses these exact tables or that the current hackathon mandates them.

- [Odoo 19: Automatic payments](https://www.odoo.com/documentation/19.0/applications/sales/subscriptions/automatic_payments.html) — project research identified Odoo's caution around automatic-payment exceptions and manual verification. It motivates separating ambiguous payment outcomes from confirmed declines. No provider behavior is assumed solely from this analogy.
- [Odoo 19: Upselling](https://www.odoo.com/documentation/19.0/applications/sales/subscriptions/upselling.html) — relevant official background for prorated subscription changes, not proof that current judging requires proration.
- See [RESEARCH.md](RESEARCH.md) for event evidence, historical accounts and the distinction between past and current requirements.

The domain author encountered timeouts fetching the two official pages on 31 October; those source observations were supplied by the parallel research pass. Recheck the actual rules and provider documentation before implementation. None of the architectural proposals depends on claiming an organizer rubric that has not been verified.
