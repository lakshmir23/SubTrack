# SubTrack

Subscription operations for Brightloop Software. Implementation follows [the roadmap](docs/ROADMAP.md) in order; current gate results and outstanding blockers are in [the implementation record](docs/IMPLEMENTATION_STATUS.md). The repository directory may still be named `odoo`.

## Local setup

Requires Node.js 24+ and npm. Development was started on Windows with Node 26.8.1. SQLite is bundled with Node; no Docker or hosted database is required. Keep the database on a local disk, not a network share. This is a single-machine fallback with WAL and bounded write transactions; tests exercise real independent-process duplicate and discount races. It is not a distributed database deployment.

```powershell
npm ci
if (-not (Test-Path -LiteralPath .env)) { Copy-Item -LiteralPath .env.example -Destination .env }
npm run db:migrate
npm run db:seed
npm run dev
```

Open [SubTrack locally](http://localhost:3000). The server binds to `127.0.0.1`. Database records live in ignored `data/subtrack.sqlite`. Migration and synthetic seed commands are additive and preserve existing users; there is no destructive reset command. Do not overwrite an existing `.env`.

Synthetic demo identities use password `Brightloop!2026`: `admin@brightloop.test`, `staff@brightloop.test`, `maya@brightloop.test`, `arun@brightloop.test`. These are local fixtures, not real accounts or customer activity. Seeds are explicitly opt-in; the server never seeds automatically.

## November walkthrough

After `npm run build`, run `npm run demo` and open [the isolated November demo](http://localhost:3003). It creates a fresh synthetic database, fixes the business date to **9 November 2026**, and labels every screen as a demo. It never loads `.env` or sends real email. The normal application continues to use its real business clock and configured database.

Sign in as `admin@brightloop.test` or `staff@brightloop.test`, using `Brightloop!2026`. Portal accounts are `studio@brightloop.test`, `shop@brightloop.test` and `services@brightloop.test` with the same synthetic password. The default settled fixture follows [the proof plan](docs/DEMO_AND_PROOF.md): A is Paid after 1,000 and 2,088.80 payments; B owes 1,100; C has a real paid October period and next bill on November 15. With November invoice/payment ranges, totals are 4,188.80 billed, 3,088.80 collected and 1,100 outstanding/overdue.

For a live collection demonstration, use `npm run demo -- --settlement=unpaid` or `npm run demo -- --settlement=partial`, then record the remaining synthetic payments through the interface. `--port=3004` selects another local port. Every launch creates a new retained `data/november-demo-*.sqlite` file; existing databases are preserved. Stop with Ctrl+C. Demo startup seeds through the same authenticated business routes and persisted batch engine as the application. It is separate from the large-data performance fixture.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm start
```

`npm run check` runs lint, typecheck, domain/integration tests and the production build. After building, `npm run test:e2e` runs actual browser journeys against production assets and a fresh isolated SQLite fixture on port 3100; install the matching browser with `npx playwright install chromium`. The browser fixture never uses the local SMTP configuration. Exact executed checks are recorded in the implementation ledger; an available command is not a passing result.

## Large-data verification

After building, `npm run benchmark:seed` creates a fresh synthetic database and prints its manifest path. The default fixture contains 10,000 agreements across all four calendar cadences, 30,000 invoices, real positive payment allocations, paused waivers and retryable failures. It refuses to overwrite an existing file and never reads `.env` or sends email. `-- --output=data/my-new-benchmark.sqlite` chooses a new file explicitly.

Run `npm run benchmark -- --manifest=data/<printed-file>.sqlite.manifest.json --samples=50 --label=release`. The runner starts a separate local production server on port 3004, copies the seed into isolated runtime and batch databases, measures all page destinations and interactions, and preserves raw timings in ignored `data/benchmark-*/results.json`. Allow at least 1.5 GB of free disk for the seed and copies. Cold server API, empty browser cache, warm navigation, concurrent users and batch completion are reported separately. `--viewport=390x844` selects a narrow viewport; `--only=pattern` runs a disclosed subset. Smoke runs use fewer samples and never count as the final performance gate. See the implementation ledger for actual measured results.

## Environment and delivery

`.env` is ignored by Git. The optional `OPENAI_API_KEY` entry is server-only; only explicitly enabled quotation suggestions use it. No key or model access is needed for the mandatory product or manual quotation form. Never use a `VITE_` prefix for credentials.

Default `MAIL_MODE=outbox` stores development email locally. It proves message generation, **not delivery to a registered inbox**. Real delivery gates require an approved SMTP test account and controlled recipient. Configure the SMTP fields in `.env` and the exact `MAIL_ALLOWED_RECIPIENTS` allowlist only after authorization. Never commit credentials or paste them into chat. No contest submission, external deployment or money movement is part of local startup.

`npm run mail:check` reports only missing setting names, never credential values. After approving a controlled recipient and starting the app with `MAIL_MODE=smtp`, `npm run verify:email` registers that allowlisted address if necessary and sends one real password-reset email. This explicit side-effect command is excluded from automated tests. SMTP acceptance is recorded separately from observed inbox arrival. Restart the server after changing SMTP settings.

`npm run verify:invoice` is a separate explicit P5 delivery check. It requires the first approved address to be an existing customer and the opt-in synthetic admin seed to be available locally. It creates a clearly labeled synthetic service/agreement/invoice, sends one test invoice to that registered allowlisted address, and reports metadata without credentials or the recipient address. The email requests no real payment. This command is excluded from automated checks; do not use it as a benchmark or bulk-send tool. Actual inbox arrival still needs a separate witness.

`npm run verify:print` creates three real Chromium PDFs from authenticated print routes using an isolated synthetic database: Draft, Confirmed, and 50-line/maximum-amount examples. It does not load `.env` or send email. Outputs are ignored in `output/pdf/`; inspect the rendered PDFs after a print-layout change. See [the communication evidence](docs/evidence/P5_DELIVERY_AND_PRINT.md) for observed rendering and delivery results.

## Optional quotation suggestions

Admin and staff can request a catalog-grounded suggestion from **New quotation** after selecting a customer. Suggestions contain catalog IDs, quantities, an optional start date and clarification questions. Explicit **Apply**, ordinary server preview, review acknowledgement and **Save Draft** remain separate human steps. AI never confirms an agreement, generates an invoice, sends email or records a payment. Continue manually preserves entered fields after any model failure.

The current session explicitly approved reuse of the existing ignored `.env` key and a **$5 USD total allowance**, including live evaluation. No new credential was created. For an authorized setup, keep `OPENAI_API_KEY` server-side and configure:

```dotenv
AI_QUOTE_ENABLED=true
AI_QUOTE_BUDGET_USD=4.998925
```

The current remaining allowance is $4.998925 after three controlled live calls accounted for $0.001075 of the approved $5 total; preserve the existing key and remaining cap. The live known request resolved to a server-calculated 3,120 subtotal, then an explicit Draft save and replay; unsupported/ambiguous requests returned clarification. Restart the normal server after configuration changes. Defaults in `.env.example` keep AI off. Missing key, missing/nonpositive allowance, allowance above $5, or exhausted conservative capacity disables suggestions. `gpt-4.1-mini` is fixed: the official model page marks it deprecated; an authorized model lookup returned HTTP 200 on October 31, 2026. There is no automatic model substitution. A future availability failure leaves manual entry available.

Budget reservations are persisted and shared across users of **one application database**, rather than across arbitrary databases or the provider project. Each request reserves $0.02 atomically; known token usage reconciles at the documented model prices, while timeout/unknown outcomes retain the full reservation. Do not reset/copy the ledger or enable separate databases to extend the approval. Evaluation usage counts toward the same owner-approved $5 allowance. One request per user may be in flight, and each user may request five per 15 minutes; there is no separate global rate limit.

Request text is limited to 1,000 characters. The bounded catalog includes at most 20 active plans, 30 products, 100 variants and 20 templates; truncation can omit valid choices, so use manual selection when needed. Instructions plus request/catalog are limited to 20 KiB UTF-8, the complete JSON request to 24 KiB, and output to 800 tokens. One eight-second deadline covers the provider response; there are no automatic retries. Server-supplied customer identity, emails, prices, costs, notes and payment context are excluded; enter synthetic needs without personal information. `store:false` is used, without a zero-retention claim.

The [implemented AI contract and limits](docs/OPTIONAL_AI.md) and [API contract](docs/API_CONTRACT.md#p9-optional-quotation-suggestions-implemented) describe the ownership/expiry and price-change review guards. Stub-only tests exercise failures without loading `.env`; actual live results are recorded separately by the release owner. Optional AI request latency is separate from the mandatory page-performance evidence.

## Architecture and ownership

React/TypeScript/Vite client, Express server, SQLite with WAL/foreign keys and immediate write transactions. Root owns integration, migrations and shared contracts; UI and verification agents own their real changes. No teammate authorship is fabricated. See [API contracts](docs/API_CONTRACT.md) and [decisions](docs/DECISIONS.md) for policy and gate limitations.
