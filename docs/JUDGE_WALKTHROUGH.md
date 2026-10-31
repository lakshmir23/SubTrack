# Judge walkthrough and evidence scorecard

Planning document, not a passed evaluation. Optimize for observable compliance with the supplied Brightloop brief and current hackathon expectations. No numeric rubric or automatic bonus for AI has been verified.

## What the reviewer should understand in one sentence

**Brightloop turns configured subscriptions into correct, traceable invoices, records partial payments, and shows the team exactly what is still owed.**

The memorable claim is not "we have many features." It is "you can inspect every business step, change the data, and verify that the totals and permissions remain correct."

## Three-minute first demonstration

Use the consistent fixture and amounts in [DEMO_AND_PROOF.md](DEMO_AND_PROOF.md). These timings are rehearsal targets, not organizer-imposed limits. Ask for the available presentation time rather than assuming it.

| Time | Show | Evidence rather than narration |
|---|---|---|
| 0:00–0:20 | Brightloop's problem and the operational overview | Real persisted counts, with every count linking to matching records. State which fixture data is synthetic. |
| 0:20–0:50 | Product variant, recurring plan and quotation template becoming a subscription | Configured Odoo variant price adjustment; required fields; visible Draft → Quotation → Confirmed → Active progression. |
| 0:50–1:25 | Billing preview and generation for A/B, with C not due | Prefilled customer/lines, explicit discount and tax calculation; A 3,088.80 and B 1,100 under the declared demo policy. |
| 1:25–1:45 | Repeat billing and inspect outcomes | Zero new period invoices; existing invoice references and the not-due reason remain visible. No fake counter animation. |
| 1:45–2:10 | Record A's partial payment, then settle the balance | Confirmed while partially paid, Paid only at zero balance; method/date/note and invoice association visible. |
| 2:10–2:35 | Switch to the labelled, isolated November 9 finance fixture from DEMO_AND_PROOF, filter finance and open overdue B | November 1 billing does not make B overdue immediately. Use the declared later synthetic date, not a fabricated overdue flag; invoiced, collected, outstanding and overdue reconcile with underlying records. |
| 2:35–3:00 | Customer isolation plus an evidence summary | Another customer's invoice is denied by the server; display actual test and performance results only if measured, otherwise disclose the gap. |

If interrupted, answer the question directly and use the corresponding record or test. Do not continue a rehearsed speech while the reviewer asks to inspect something.

## Extended review drawer

Keep these ready as ordinary application pages or test evidence, not hidden presentation-only behavior:

- Customer signup, duplicate email, exact password boundary and reset delivery.
- Administrator-only staff creation, discount configuration and pricing controls.
- Daily, weekly, monthly and yearly recurrence; month-end/leap-year policy explanation.
- Plan availability and quantity boundaries; quotation validity and immutable instance values.
- Product-scoped fixed discount and subscription-wide percentage discount, threshold, expiry and use-cap behavior tested separately.
- Plan-permitted pause, early close, renewal and automatic expiry; disallowed action rejected.
- Invoice cancel/send/print, including the distinction between an email preview and actual controlled delivery.
- Concurrent billing, partial batch failure and retry; no silently missing eligible subscriptions.
- Filtered and paginated large-data finance view with measured response evidence.
- Genuine team contributions and each teammate explaining their own decisions.

## Four proof layers for each requirement

1. **Visible:** the required control or record can be found easily.
2. **Persisted:** changing it survives refresh and updates dependent views.
3. **Protected:** invalid, unauthorized or repeated requests cannot corrupt it.
4. **Explained:** the team can state the policy, calculation and limitation in plain language.

A disabled button proves none of the server rules. A successful API response alone proves neither correct UI nor correct totals. A screenshot of many records proves no performance result.

## Evidence record template

Use one short record per demonstrated claim:

- Requirement ID(s):
- Build/commit:
- Fixture and preconditions:
- Action and expected invariant:
- Observed result:
- Evidence location:
- Status: not run / passed / failed / blocked:
- Known limitation and owner:

Do not prefill passed results. Retain failed runs when explaining fixes; rerun after relevant changes.

## Benchmark integrity

The brief's under-two-second requirement needs an explicit measurement contract. Follow the [execution blueprint](EXECUTION_BLUEPRINT.md) performance plan. Record at minimum dataset count, valid relationship distribution, hardware, database, query/filter, cold/warm state and end-to-end timing boundary. Report sample count and distribution, not just a best-case screenshot.

Synthetic data must obey the same relationships as real records. Do not create thousands of unusable rows solely to print a large number. Include mixed statuses, payments and overdue dates so the costly queries are real.

A seeded database is compatible with dynamic behavior only when the application reads and writes it normally. Never swap in hardcoded JSON or precomputed demo totals while presenting them as live results.

## Questions the team should be able to answer

- How do you prevent two workers from billing the same subscription period?
- How does the system expose an eligible subscription that failed billing?
- What happens if two invoices compete for the final discount use?
- Which values are snapshots, and which can change when an administrator edits a product?
- Why is a partly paid invoice not marked Paid?
- How do cancellation, pause and expiry affect the next billing boundary?
- What do revenue and overdue mean under the chosen policy?
- How do you stop a customer from opening another customer's invoice directly?
- How did you measure the two-second target, and what have you not tested?
- Which part did each teammate build and review?

Use honest tradeoffs. There is no universal extra credit for UUIDs, WebSockets, a particular framework or an AI API. A justified simple design is stronger than an impressive tool name with no demonstrated need.

## Presentation cut order

If time is short, cut narration, animations and optional AI first. Keep the connected business journey, the billing replay, partial-payment math, ownership boundary and actual performance evidence. Do not hide incomplete required features: state the remaining gap and show what works.
