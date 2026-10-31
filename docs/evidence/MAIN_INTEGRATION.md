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

## P5: a4a98d7

Fetched current remote state, checked the main worktree was clean, fast-forwarded it and pushed `a4a98d7e7fdeb8f6d80ab925282a982509c26401`. Verified the remote main ref equals this exact commit. The source tree passed aggregate lint/typecheck/125 tests/build and all 19 current production-browser journeys, plus independent transaction/visual reviews. Real controlled invoice inbox receipt and actual PDF rendering are evidenced separately. No integration conflict or source change required retesting a different tree. Main remains a verified checkpoint while P6 proceeds on the feature branch.

## P6: a6b473c

Fetched remote state, confirmed the separate main worktree was clean, fast-forwarded it and pushed `a6b473cf68c9b7904623c2ee7d40f66b52a515d0`. Verified that exact remote ref. Backend aggregate lint/typecheck/159 tests/build passed; final UI corrections were rebuilt/typechecked/linted, and root's full current browser regression passed 23/23. Independent transaction/migration/privacy review and the normal-server automatic-expiry witness passed. No integration conflict or source edit changed the verified checkpoint. P7 continues on the feature branch.

## P7: abaf9f0

Fetched remote state, confirmed the separate main worktree was clean, fast-forwarded it and pushed `abaf9f097baa695028469546debe7e19750ee274`. Verified the exact remote main ref. Aggregate lint/typecheck/167 tests/build passed; final bounded UI changes were rebuilt/typechecked/linted and root's full production-browser regression passed 26/26 in 43.8 seconds. Independent finance/privacy and six-capture visual reviews passed. The merge changed no source beyond the verified tree. P8 performance and final repository/local-demo handoff follow; organizer submission checklist remains pending.


## P8: a6d4da8

Fetched remote state, fast-forwarded the clean main worktree and pushed `a6d4da8216f8186445e747b6eb77f2ea4b4f25a0`; the remote ref matched. Complete desktop baseline, corrected affected-route measurements, independent data audit, 170 tests/26 browser journeys and actual clean-checkout startup passed within the documented evidence scope. Failed and interrupted runs remain archived. User canceled further mobile benchmarking. P9 source was left uncommitted during this P8 integration and followed only after separate key/budget approval.


## P9 and teammate integration: ec4e10d

The repository was renamed to `lakshmir23/SubTrack`; origin was updated to the new URL. Fresh fetch found teammate commit `25a03bb` adding the study guide. Its identical untracked workspace copy was preserved under ignored data before merging, and the genuine commit/history was retained. Merged main into the feature branch, then fast-forwarded the clean main worktree and pushed `ec4e10d878392a41e0a8b31c9f984255438fd937`; remote main matched. The incoming change was documentation only. P9 had passed aggregate lint/typecheck/181 tests/build,30 browser journeys, three real synthetic provider calls, independent budget/authority review and normal schema12 startup. The later development-watch exclusion passed targeted lint/typecheck/build and actual dev startup. No force push, external deployment or contest submission occurred. The requested README overhaul follows this verified source integration.
