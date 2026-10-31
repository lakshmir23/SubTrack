# Verified main checkpoints

## P0–P2: 1f4070a

On 31 October 2026, fetched current remote state and fast-forwarded a separate clean main worktree to `1f4070a32aacafcac665165917a0fdb40b96129e`. No teammate changes were overwritten and no force push was used. The implementation checkout continued on `junaid/subtrack-implementation`.

Executed from `C:/Github/odoo-main`:

- `npm ci`: installed the locked dependencies; audit reported zero vulnerabilities.
- `npm run check`: lint, both TypeScript checks, **47 tests**, and production build passed. Test-runner duration: **25,428.1316 ms**.
- `npm run test:e2e`: **10 passed**, **20.6 seconds**, production assets and a new isolated persisted SQLite fixture.

Pushed `main` and verified the remote ref equals the full commit above. No `.env`, credentials, local database, private screenshots, payment operation or external deployment was included. Browser/domain checks use an isolated outbox and send no real email. These test durations are not page-performance benchmarks; FIN-02 remains unverified until P8.
