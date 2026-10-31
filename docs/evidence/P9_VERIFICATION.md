# P9 quotation assistant verification

The user explicitly approved the existing server key and a $5 total allowance. No credential was created or exposed. Mandatory P0–P8 evidence was complete before the approved optional assistant was integrated.

## Actual live provider proof

[P9_LIVE.json](P9_LIVE.json) records three real synthetic requests using `gpt-4.1-mini`, Responses Structured Outputs, no tools and `store:false`. The known request selected two Odoo-variant Business Software units. Ordinary server preview calculated **312,000 minor units (₹3,120)**. Proposal and preview created no subscription, invoice or payment. Explicit reviewed Save added one **Draft**; replay returned that same draft. Subscriptions changed 3→4, while invoices and payments stayed 3/3. Unsupported and ambiguous requests returned zero proposed lines and one/two clarification questions.

The persisted ledger accounted for **1,075 micro-USD ($0.001075)** from returned token usage. This is conservative application accounting at the [documented model rates](https://developers.openai.com/api/docs/models/gpt-4.1-mini), not a provider billing statement. Evaluation was allocated at most $0.10; after it completed, the normal app's remaining cap was set to **$4.998925**, so evaluation plus that allowance stays within the approved $5. The existing `.env` was updated without changing its key or creating another environment file. [P9_EVALUATION_AUDIT.json](P9_EVALUATION_AUDIT.json) independently reconciles the real database ledger and business counts.

The three observed generation latencies were 3,735 ms, 3,942 ms and 999 ms. AI is an explicit optional operation, separate from ordinary page rendering. The provider deadline is eight seconds; timeout and unknown outcomes retain a full $0.02 reservation, with no automatic retry.

## Automated and browser checks

- `npm run check`: lint, client/server typecheck, **181 tests passed**, production build passed. Domain/integration test duration: **66,664.1167 ms**.
- `npm run test:e2e`: **30/30 passed in 50.3 seconds**, including all 26 mandatory journeys and four actual UI/server/database AI journeys with an injected provider and no real key.
- Eleven focused AI tests cover authorization before transport, protected context, strict schema/IDs/quantity, refusal/incomplete/invalid output, timeout/offline fallback, reservations/concurrency, actor/customer/expiry binding, changed-price rejection and idempotent save replay.
- The four new browser journeys cover explicit Apply/review/Save, response-loss replay, changed customer/catalog, retained manual entry after failures and template-only suggestions loading real stored lines/validity.
- Strict premium audit: zero findings. Official DESIGN lint: zero errors or warnings. Independent backend and desktop UI review found no outstanding authority/budget issue.

[P9_FORM_PERFORMANCE.json](P9_FORM_PERFORMANCE.json) repeats the three changed quotation-form variants against the valid **10,000-subscription / 30,000-invoice** fixture: 150 warm navigations plus three cold-browser navigations, zero errors/breaches and a **289.1794 ms maximum**. This is affected-path desktop verification, not an additional mobile benchmark or a fresh complete-inventory claim.

## Final runtime and boundaries

[P9_RUNTIME.json](P9_RUNTIME.json) records actual normal compiled production startup at port 3000, schema 12, sign-in, protected new-draft direct navigation/reload and enabled approved AI configuration, without another provider call. The separately restarted November demo on port 3003 reconciled three active agreements, 418,880 invoiced / 308,880 received / 110,000 outstanding and overdue minor units. It uses a conspicuous synthetic Nov 9 clock and never reads `.env` or sends SMTP.

A final development-only correction excludes generated databases/builds/reports from Vite watching after observed Windows file-watch lock errors during benchmarking. Targeted lint, typecheck/build and actual development startup with schema 12 and the Vite entry passed afterward. Production behavior is unchanged.

AI budget enforcement persists within **one application database**; it is not a provider-project or arbitrary-cross-database cap. Per-user limits are one in-flight request and five requests per 15 minutes, with no separate global rate cap. Catalog context is bounded and may omit choices; manual selection remains available. Customer identity, prices, costs, internal notes and payment records are absent from provider context. Manual save uses the ordinary server calculator and authorization, with a current-price review hash for applied suggestions.

The configured model is deprecated in official documentation but was available to the approved key and passed this live evaluation. Future unavailability falls back to manual entry without a silent model substitution. The 633.24 kB minified JavaScript chunk warning remains; it was not the traced P8 queue bottleneck. No additional mobile optimization, external deployment, real payment operation or contest entry is claimed.
