# Brightloop Software — Subscription Management System

**Updated 31 October 2026 after reading all four supplied problem-statement pages.** This is a documentation-only planning pass. No application implementation or performance result is claimed.

## Read in this order

1. [Authoritative requirements](REQUIREMENTS.md): every visible requirement, proof expectation and unresolved policy.
2. [Standing hackathon constraints](HACKATHON_CONSTRAINTS.md): dynamic data, validation, responsive UI, navigation and genuine team Git participation.
3. [Product and scope](PRODUCT_IDEATION.md): complete Brightloop workflows before optional differentiation.
4. [Domain and edge cases](DOMAIN_AND_EDGE_CASES.md): records, states, billing safety, pricing and payment rules.
5. [Demo and proof](DEMO_AND_PROOF.md): traceability, coherent scenarios, batch correctness and performance evidence.
6. [Prior-event research](RESEARCH.md): historical context, explicitly subordinate to this brief.

## Fast path for the team

- **First five minutes:** read REQUIREMENTS, then agree the proposed defaults in [DECISIONS.md](DECISIONS.md).
- **Build planning:** [EXECUTION_BLUEPRINT.md](EXECUTION_BLUEPRINT.md) maps connected slices, ownership and acceptance gates. Rebase its timing to the actual remaining event window.
- **Reviewer preparation:** [JUDGE_WALKTHROUGH.md](JUDGE_WALKTHROUGH.md) makes each claim easy to find and inspect.
- **Optional enhancement:** [OPTIONAL_AI.md](OPTIONAL_AI.md) scopes a human-reviewed quotation proposal only after mandatory workflows work. API access is an option, not a verified judging bonus or permission to spend.

## What the brief actually asks for

A unified business system spanning products and variants, recurring plans, quotation templates, subscriptions, automatic invoice generation, taxes, bounded discounts, partial payments and finance reporting. Admin, internal staff and customer portal roles have different access. Hundreds of due subscriptions must not be double-billed or missed; views must remain responsive in under two seconds with thousands of subscriptions.

The core story is **configure → quote → confirm/activate → bill → collect → renew/pause/close → report**. Each step must use persisted data and enforce policy on the server.

## Competitive approach

First satisfy every requirement with one connected product. Then make correctness easy to inspect through a useful subscription history, explainable invoice amounts and an actionable queue of billing exceptions. Show partial payments and overdue balances, automatic discount expiry, safe batch retries and a measured large-data finance view. Do not replace required work with optional proration, a clock simulator, AI forecasting or a payment-provider integration.

The earlier title-only idea has been revised: mid-cycle upgrades and sandbox time travel are stretch only. A real payment gateway, automated bank matching and automatic card collection are not specified by the supplied brief. An admin-recorded payment workflow can meet the payment-recording requirement; any simulation or development inbox must be labelled accurately.

## Implementation decision gate

Before coding, reconcile the team's chosen stack and task ownership, document ambiguous tax/discount/pause/renewal policies, and assign requirement IDs to screens, API operations and tests. Keep the actual organizer deadline and submission instructions visible. Do not infer numeric rubric weights from a different Odoo event.

Preserve teammates' changes. Documents are a planning contract, not evidence that implementation, test gates, email delivery or the two-second target has passed.
