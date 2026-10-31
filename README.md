# SubTrack

Subscription operations for Brightloop Software. Implementation follows [the roadmap](docs/ROADMAP.md) in order; current gate results and outstanding blockers are in [the implementation record](docs/IMPLEMENTATION_STATUS.md). The repository directory may still be named `odoo`.

## Local setup

Requires Node.js 24+ and npm. Development was started on Windows with Node 26.8.1. SQLite is bundled with Node; no Docker or hosted database is required. Keep the database on a local disk, not a network share. This is a single-machine fallback with WAL and bounded write transactions; tests exercise real independent-process duplicate and discount races. It is not a distributed database deployment.

```powershell
npm ci
Copy-Item .env.example .env # only if .env does not already exist
npm run db:migrate
npm run db:seed
npm run dev
```

Open [SubTrack locally](http://localhost:3000). The server binds to `127.0.0.1`. Database records live in ignored `data/subtrack.sqlite`. Migration and synthetic seed commands are additive and preserve existing users; there is no destructive reset command. Do not overwrite an existing `.env`.

Synthetic demo identities use password `Brightloop!2026`: `admin@brightloop.test`, `staff@brightloop.test`, `maya@brightloop.test`, `arun@brightloop.test`. These are local fixtures, not real accounts or customer activity. Seeds are explicitly opt-in; the server never seeds automatically.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm start
```

`npm run check` runs lint, typecheck, domain/integration tests and the production build. After building, `npm run test:e2e` runs actual browser journeys against production assets and a fresh isolated SQLite fixture on port 3100; install the matching browser with `npx playwright install chromium`. The browser fixture never uses the local SMTP configuration. Exact executed checks are recorded in the implementation ledger; an available command is not a passing result.

## Environment and delivery

`.env` is ignored by Git. The optional `OPENAI_API_KEY` entry is server-only and unused by the mandatory product. No key or model access is needed to run locally. Never use a `VITE_` prefix for credentials.

Default `MAIL_MODE=outbox` stores development email locally. It proves message generation, **not delivery to a registered inbox**. Real delivery gates require an approved SMTP test account and controlled recipient. Configure the SMTP fields in `.env` and the exact `MAIL_ALLOWED_RECIPIENTS` allowlist only after authorization. Never commit credentials or paste them into chat. No contest submission, external deployment or money movement is part of local startup.

`npm run mail:check` reports only missing setting names, never credential values. After approving a controlled recipient and starting the app with `MAIL_MODE=smtp`, `npm run verify:email` registers that allowlisted address if necessary and sends one real password-reset email. This explicit side-effect command is excluded from automated tests. SMTP acceptance is recorded separately from observed inbox arrival. Restart the server after changing SMTP settings.

`npm run verify:invoice` is a separate explicit P5 delivery check. It requires the first approved address to be an existing customer and the opt-in synthetic admin seed to be available locally. It creates a clearly labeled synthetic service/agreement/invoice, sends one test invoice to that registered allowlisted address, and reports metadata without credentials or the recipient address. The email requests no real payment. This command is excluded from automated checks; do not use it as a benchmark or bulk-send tool. Actual inbox arrival still needs a separate witness.

## Architecture and ownership

React/TypeScript/Vite client, Express server, SQLite with WAL/foreign keys and immediate write transactions. Root owns integration, migrations and shared contracts; UI and verification agents own their real changes. No teammate authorship is fabricated. See [API contracts](docs/API_CONTRACT.md) and [decisions](docs/DECISIONS.md) for policy and gate limitations.
