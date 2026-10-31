# SubTrack

Subscription operations for Brightloop Software. Implementation follows [the roadmap](docs/ROADMAP.md) in order; current gate results and outstanding blockers are in [the implementation record](docs/IMPLEMENTATION_STATUS.md). The repository directory may still be named `odoo`.

## Local setup

Requires Node.js 24+ and npm. Development was started on Windows with Node 26.8.1. SQLite is bundled with Node; no Docker or hosted database is required. Keep the database on a local disk, not a network share. This is a single-machine fallback; multi-worker correctness must be verified before subsequent billing gates.

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

`npm run check` runs lint, typecheck, domain/integration tests and the production build. `npm run test:e2e` runs browser checks once their fixtures exist; install the matching browser with `npx playwright install chromium`. Exact executed checks are recorded in the implementation ledger; an available command is not a passing result.

## Environment and delivery

`.env` is ignored by Git. The optional `OPENAI_API_KEY` entry is server-only and unused by the mandatory product. No key or model access is needed to run locally. Never use a `VITE_` prefix for credentials.

Default `MAIL_MODE=outbox` stores development email locally. It proves message generation, **not delivery to a registered inbox**. Real delivery gates require an approved SMTP test account and controlled recipient. Configure the SMTP fields in `.env` and the exact `MAIL_ALLOWED_RECIPIENTS` allowlist only after authorization. Never commit credentials or paste them into chat. No contest submission, external deployment or money movement is part of local startup.

`npm run mail:check` reports only missing setting names, never credential values. After approving a controlled recipient and starting the app with `MAIL_MODE=smtp`, `npm run verify:email` registers that allowlisted address if necessary and sends one real password-reset email. This explicit side-effect command is excluded from automated tests. SMTP acceptance is recorded separately from observed inbox arrival. Restart the server after changing SMTP settings.

## Architecture and ownership

React/TypeScript/Vite client, Express server, SQLite with WAL/foreign keys and immediate write transactions. Root owns integration, migrations and shared contracts; UI and verification agents own their real changes. No teammate authorship is fabricated. See [API contracts](docs/API_CONTRACT.md) and [decisions](docs/DECISIONS.md) for policy and gate limitations.
