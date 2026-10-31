# Product ideation: an explainable subscription lifecycle

**Status:** Research and design proposal, October 31, 2026. No implementation is represented as complete. The confirmed problem-statement information available to this document is the title **Subscription Management System**. The full statement, mandatory features, scoring rubric, permitted stack, and integration requirements must override this proposal when received.

The likely event has an eight-hour build window; that is a provisional planning constraint, not a reason to invent requirements. An Odoo-organized hackathon does not by itself establish that the solution must use the Odoo ERP framework.

## Recommended direction

> From quotation to renewal, every subscription change is visible, financially consistent, and understandable before the customer commits.

Build a merchant-facing subscription system with a customer portal, not merely a personal tracker for streaming-service bills. Reconsider that orientation if the full statement specifies something else.

The differentiator is one coherent **subscription timeline**. It explains what happened, why, what was billed, what access the customer currently has, and what will happen next. A small, explicitly sandboxed clock lets the team demonstrate a month of lifecycle behavior without waiting a month. This is not a claim of globally original technology: billing simulation already exists in industry.

A polished lifecycle, including one real failure-and-recovery path, is stronger than a large collection of unrelated features. Do not make a chatbot or speculative churn model the centerpiece.

## Facts, inferences, and proposals

### Facts from official product documentation

Odoo documents recurring plans, automated invoicing, renewals, lifecycle tracking, and optional customer self-service. Its upselling documentation describes prorated recurring products. These are useful domain reference points, not the hackathon's confirmed requirements. [Subscriptions](https://www.odoo.com/documentation/19.0/applications/sales/subscriptions.html), [Upselling](https://www.odoo.com/documentation/19.0/applications/sales/subscriptions/upselling.html).

Odoo's automatic-payment documentation distinguishes a payment exception requiring verification: scheduled processing is stopped to avoid an accidental duplicate charge. This supports a design principle of separating a known decline from an unknown outcome. [Automatic payments](https://www.odoo.com/documentation/19.0/applications/sales/subscriptions/automatic_payments.html).

Odoo also offers subscription analysis and MRR reports. Attractive charts alone therefore should not be treated as the main innovation. [Reports](https://www.odoo.com/documentation/19.0/applications/sales/subscriptions/reports.html).

Stripe describes test clocks for safely exercising billing scenarios. Our proposed sandbox clock is an application of that established technique, not an invention claim. [Stripe engineering](https://stripe.com/blog/test-clocks-how-we-made-it-easier-to-test-stripe-billing-integrations).

### Working inference

A reviewer of a business-system problem is likely to value coherent records and transitions. This is a planning inference, not a verified scoring weight. Match the actual published rubric as soon as it is available.

### Proposed product policy

The timing of upgrades, downgrades, cancellations, credits, retries, and entitlements must be stated explicitly. The example policies below are choices for a bounded demonstration, not universal subscription rules or tax advice.

## Baseline before the hero feature

Create a requirement traceability list from the full statement before implementation. The following is a provisional domain baseline, not permission to omit mandatory features:

1. Separate administrator and customer permissions.
2. Products and recurring plans with clear prices and intervals.
3. Quotation acceptance creates one subscription.
4. Invoice history and recorded or sandbox payment outcomes.
5. Renewal and cancellation with explicit effective dates.
6. Customer detail, search, and filters that work with persisted records.
7. A customer can see their own subscription and invoices, not another customer's records.

If quotations, taxes, discounts, templates, or specific roles are mandatory, implement them before optional simulation, pause/resume, or additional dashboards. Preserve the statement's exact terminology so reviewers can find the requested workflows.

## One hero feature: the explainable timeline

The subscription detail page joins business events rather than scattering them across disconnected screens:

- Quotation accepted and subscription activated.
- Current billing period and next scheduled invoice.
- Plan-change request and effective date.
- Proration preview with the credit, charge, and net adjustment.
- Payment attempt outcome and its operational consequence.
- Access or entitlement change.
- Cancellation request and actual termination.

Each entry identifies the actor, timestamp, reason, relevant record, and resulting state. Each money adjustment has a **Why this amount?** expansion. Each future action names a date. Avoid an unexplained raw log of database events.

### Suggested screen architecture

1. **Operations overview:** subscriptions requiring attention, upcoming renewals, and overdue invoices. Link every count to the underlying records.
2. **Subscription workspace:** current state, next amount/date, timeline, invoices, and permitted actions.
3. **Plan and product setup:** minimal, validated configuration; historical invoices do not change when a plan's current price changes.
4. **Customer portal:** plan, invoice history, change preview, scheduled cancellation, and payment-recovery action.

Do not add more screens merely to appear feature-rich. Keyboard access, readable status labels, empty states, confirmation previews, and recovery messages are higher-value finishing work.

### Alternative if review favors operational usefulness over timeline polish

Use an **actionable exception queue**, not another analytics dashboard: each persisted overdue invoice or due renewal links to the relevant customer, exact amount/date, explanation, and one permitted next action. Completing the action updates both the underlying record and queue after refresh. This can reuse the operations overview and invoice detail rather than adding a new subsystem. It makes dynamic data, navigation, validation and workflow completion inspectable in one journey. It is a product hypothesis, not a verified judge preference.

Choose **one** presentation emphasis: lifecycle explanation or resolving exceptions. Keep the timeline as supporting record history either way. Neither a simulation clock nor a large number of screens is itself business value. Do not build risk scores, bulk collection, automated dunning policies or another dashboard merely to support this alternative.

## Business model and invariants

Keep these concepts distinct, regardless of the eventual database or framework:

- **Plan:** what is sold, at which interval and price.
- **Subscription:** the customer's agreement and current lifecycle.
- **Billing period:** explicit start and end boundaries.
- **Invoice:** historical financial document, not a mutable reflection of today's plan price.
- **Payment attempt:** one attempt with an outcome; multiple attempts may relate to one invoice.
- **Plan change:** requested, pending, applied, or canceled; not necessarily the current plan immediately.
- **Timeline entry:** evidence of a business transition.

Core invariants to preserve:

- Repeating an already-processed event must not create another invoice, settlement, or upgrade.
- Money uses exact minor units or appropriate decimal arithmetic, not uncontrolled floating-point sums.
- A known decline is not the same as a timeout or unknown payment outcome.
- Access follows an explicit policy, not a random combination of invoice and subscription flags.
- A scheduled cancellation is different from an already-ended subscription.
- Historical invoice totals remain unchanged after a plan-price edit.
- Authorization is enforced on the server, not just by hiding buttons.
- Concurrent changes cannot silently overwrite each other.

This does not require building a complete event-sourcing platform. A clear transaction model and useful audit history are enough for the proposed scope.

## Proposed bounded policies

The baseline policy is **plan changes at the next renewal**; show pending terms and effective date. Demonstrate a successful normal renewal and replay safety before optional mid-cycle changes. Use one currency, one monthly billing model, and no tax or discounts unless mandatory. The following immediate-upgrade rules are an optional extension, not baseline acceptance criteria; daily proration uses the actual billing period.

- An immediate upgrade is previewed first. It becomes effective after the adjustment is successfully paid.
- If that payment is declined, the old paid plan remains active and the upgrade stays pending.
- If the outcome is unknown, reconciliation is required; do not retry automatically as if the first attempt certainly failed.
- A period-end cancellation preserves access until the current period ends and prevents the next renewal.
- Downgrades can be scheduled for the next period rather than implementing immediate refunds, unless the statement requires otherwise.
- Freeze or defer changes that cannot safely be calculated against an unpaid base invoice; explain the restriction rather than inventing a credit.

Renewal failure is a different case from upgrade failure. If implemented, specify the grace period, access policy, retry eligibility, and final closure separately. Do not apply the upgrade demo's rule indiscriminately.

## Provisional eight-hour prioritization

The exact schedule depends on the full statement and the team's division of work. These are checkpoints, not promised completion times.

| Window | Desired evidence |
|---|---|
| First 45 minutes | Read full rules; map mandatory requirements; agree domain records, state transitions, roles, and demo story. |
| Next 2 hours | Persisted quotation-to-subscription-to-invoice vertical slice with authorization. |
| Next 2 hours | Complete mandatory management workflows and portal; validate unhappy paths. |
| Next 1 hour | Add the explainable timeline and one accurate change preview. |
| Next 45 minutes | Add narrowly bounded sandbox time advancement only if the baseline is stable. |
| Remaining 90 minutes | Verify permissions and duplicate handling; rehearse demo; polish error states; prepare submission and evidence. |

If behind schedule, cut the clock before cutting correctness. The timeline and a visible upcoming-renewal field can still communicate the lifecycle without a simulator.

### Explicitly deferred unless required

AI chatbot, learned churn predictions, elaborate workflow designer, multiple payment gateways, tax-compliance claims, multi-currency, usage metering, full accounting ledger, bulk migration, arbitrary policy language, and a general-purpose scenario editor.

Never initiate real charges, refunds, account creation, or financial integration approvals solely to make the demo more impressive. Use a clearly disclosed sandbox or simulated payment adapter within the event rules.

## Decision rule when the full statement arrives

For every proposed feature ask: which exact requirement does it satisfy, which end-to-end action proves it, and what breaks if it is cut? Mandatory flows outrank all suggestions here. Keep one memorable differentiator only after the core is complete.

See [Demo and proof](DEMO_AND_PROOF.md) for the precise synthetic billing example and honest verification gates.
