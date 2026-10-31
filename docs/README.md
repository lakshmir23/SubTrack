# Subscription Management System — research and ideation

Planning-only documentation for the current Odoo hackathon. No application code is supplied by this documentation pass. The detailed problem statement may add requirements; ideas below are provisional until reconciled with it.

## Read first

1. [Standing hackathon constraints](HACKATHON_CONSTRAINTS.md): required dynamic data, validation, UI, navigation and genuine team Git participation.
2. [Research and prior editions](RESEARCH.md): what official sources establish versus historical participant reports.
3. [Product ideation](PRODUCT_IDEATION.md): a coherent recurring-revenue product and carefully prioritized differentiation.
4. [Domain and edge cases](DOMAIN_AND_EDGE_CASES.md): relational boundaries, state transitions and financial consistency.
5. [Demo and proof](DEMO_AND_PROOF.md): show a complete lifecycle and test the claims, not just a static dashboard.

## Current recommendation

A business-facing subscription operations system with an **explainable lifecycle timeline**. Complete the required quote/activation/billing/renewal/cancellation journey, then make every amount and state transition inspectable. An explicitly sandboxed billing clock can demonstrate future events quickly, but is optional and not a substitute for working normal workflows.

The main competitive advantage should be that reviewers can change data, trigger a failure, retry an operation and still see correct money, permissions and customer access. Avoid a broad, fragile fintech platform or unrelated AI features.

## Decisions still open

- Exact current problem statement, required roles, fields and workflows.
- Current numeric rubric, if one is supplied.
- Technology stack and team responsibilities after inspecting implementation plans.
- Payment integration requirements, allowed sandbox and credentials.
- Billing/proration policy, cancellation behavior and tax/discount scope.
- Actual submission deadline/timezone and required evidence.

Do not silently turn a proposed feature into an official requirement. Keep research, decisions, implemented behavior and verified results distinct. Preserve teammates' implementation and documentation changes.
