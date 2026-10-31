# Verified main checkpoints

## P0–P2: 1f4070a

On 31 October 2026, fetched current remote state and fast-forwarded a separate clean main worktree to `1f4070a32aacafcac665165917a0fdb40b96129e`. No teammate changes were overwritten and no force push was used. The implementation checkout continued on `junaid/subtrack-implementation`.

Executed from `C:/Github/odoo-main`:

- `npm ci`: installed the locked dependencies; audit reported zero vulnerabilities.
- `npm run check`: lint, both TypeScript checks, **47 tests**, and production build passed. Test-runner duration: **25,428.1316 ms**.
- `npm run test:e2e`: **10 passed**, **20.6 seconds**, production assets and a new isolated persisted SQLite fixture.

Pushed `main` and verified the remote ref equals the full commit above. No `.env`, credentials, local database, private screenshots, payment operation or external deployment was included. Browser/domain checks use an isolated outbox and send no real email. These test durations are not page-performance benchmarks; FIN-02 remains unverified until P8.

## P3: 0468231

Fetched remote state, then fast-forwarded the clean main worktree and pushed `0468231f0a9fdfc7236a827e4684d0cd5755bd15`. The exact feature tree had passed aggregate lint/typecheck/63 tests/build and all 13 production-browser journeys before integration. No conflict or integration edit changed that tree; tests were not redundantly repeated merely for the fast-forward.

## P4: e75c015

Fetched remote state, confirmed main was unchanged, fast-forwarded the clean main worktree and pushed `e75c015973de04c228431ab9e6fd689cd00662ef`. Verified `git ls-remote origin refs/heads/main` equals that commit. The exact tree passed lint/typecheck/102 tests/build and all 16 production-browser journeys, plus independent backend and visual reviews. No force push, squash, conflict resolution or integration edit was needed. Complete gate evidence remains in the implementation ledger; final release regression and large-data timings are still separate P8 work.
