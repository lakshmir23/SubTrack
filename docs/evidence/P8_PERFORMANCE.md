# P8 performance and release evidence

Measured on 31 October 2026. The complete desktop inventory was exercised, its measured bottlenecks were corrected, and affected paths were repeated. This record retains failed runs and distinguishes completed evidence from the later interrupted repeat. It is local evidence for this dataset and environment, not a production capacity guarantee.

## Preserved evidence

[P8_RESULTS.json](P8_RESULTS.json) contains conventional median, nearest-rank p95, maximum, errors and every response at or above 2,000 ms, both by path and by run. [P8_RAW.json.gz](P8_RAW.json.gz) contains every sanitized original field and all **20,922 observations across seven runs**, including failures, diagnostics and the interrupted repeat. Password/CSRF/reset-token fields are redacted again during packaging. No observation is trimmed or imputed.

The archive SHA-256 is `f5a703abd18ba3d80e19476c89e2762ca7d7398a8bf657e4864b044787f70211`. Packaging verified all seven original source hashes, all recorded durations and all original completion states. The package records **15 threshold entries**: two original list API breaches, one readiness-harness timeout, one complete-desktop queue breach and eleven queue-diagnostic breaches. Three recorded error entries describe two readiness/setup failures; a completion error and its observation may describe the same failure. Completed full desktop and corrected-queue runs have no HTTP/readiness errors.

The [dataset evidence](P8_DATASET.md) and [independent raw-fact audit](../../scripts/verify-benchmark.py) cover **10,000 subscriptions, 30,000 invoices, 60,000 lines, 27,400 positive payments, 31,056 logical charges and 2,600 lifecycle events**. Every cadence has 2,500 subscriptions. Synthetic data is separate from the November walkthrough and local user database.

## Environment and timing boundaries

The full desktop run used commit `51342fa204ecb20042f335e607a0bc671071fc68`; corrected queue measurements used `b362b75b5f9a1c1ec8ac8336a5dd14ea837933c9`. Both recorded a clean worktree and production asset fingerprints. The served entry HTML fingerprint is unchanged across these runs; the correction changes queue SQL, not the UI. Per-run metadata retains exact asset sizes/hashes, page IDs, roles, paths, filters, indexes and machine details.

- AMD Ryzen 9 5900HX; 16 logical processors; reported RAM 16,477,028,352 bytes, with 3,753,672,704 free at the full run's start.
- Windows x64, reported release `10.0.26300`; Node `v26.8.1`; headless Chromium `156.0.8078.4`; desktop viewport 1440 × 1000.
- Native SQLite `3.53.4`, 281,014,272-byte starting database; WAL, synchronous FULL, foreign keys enabled and 1,000 ms busy timeout. Seed schema 10 is upgraded by normal startup to runtime schema 11. The final independent runtime audit observed both new order indexes, all 25 triggers, 40 explicit indexes, no FK violations and `integrity_check=ok`.
- HTTP loopback, separate server and timing-driver processes, no CPU/network throttling. Business clock is explicitly fixed to November 9 on the labelled synthetic fixture. Normal bounded startup/ten-second lifecycle processing remains enabled.

API timing includes the complete GET and response-body read with real sessions. Each cold-server probe follows a server-process restart; server startup itself is outside that request timer. Warm API samples follow separately. Cold browser navigation uses a fresh browser context with copied authenticated cookies and an empty browser HTTP cache. Server and OS filesystem caches are **not flushed**. Warm hard navigation reuses a role context after an untimed preparation.

Rendered timing starts before navigation and ends after real destination data and useful controls are ready, `document.fonts.ready` and two animation frames. Actions include user input, applicable debounce, response and rendered readiness. Readiness checks do not stop at a heading. Full per-destination definitions are preserved in the inventory. The literal threshold is **every observation below 2,000 ms**; a passing p95 never conceals a slower sample.

## Complete desktop coverage and retained failure

The completed full run contains **93 destination/role/state variants × 50 warm navigations**, one cold-browser navigation for each, **14 interactions × 50**, and **115 distinct role/API paths × 50 warm requests plus a cold-server probe each**. It covers authentication/reset, staff/customer directories, configuration and variants, plans, quotation templates, discounts/taxes, every agreement stage, service actions, invoices/print/payment forms, batch results, finance and portal isolation pages. Search, filter and pagination actions are real input-to-render operations.

The following are pooled summaries by timing boundary in milliseconds, rounded to three decimals. Per-path distributions and every original value remain in the JSON/archive.

| Boundary | Count | Median | p95 | Maximum |
|---|---:|---:|---:|---:|
| Cold-server API | 115 | 14.320 | 297.404 | 1,069.249 |
| Warm API | 5,750 | 1.900 | 227.096 | 635.810 |
| Cold-browser page | 93 | 258.800 | 741.707 | **2,647.127** |
| Warm page | 4,650 | 116.100 | 499.496 | 1,283.574 |
| Search/filter/page/preview action | 700 | 205.131 | 869.603 | 904.373 |
| Five-context concurrent navigation | 150 | 199.252 | 1,083.161 | 1,317.487 |

The full run had **zero readiness/HTTP errors and one genuine threshold breach**, the cold admin due-workbench page. It is not reported as an all-under-two-second run. Its independent audit passed coverage and database integrity, while correctly rejecting the response threshold.

Five-context samples are separate from single-user measurements: three workloads, ten rounds each. The finance workload includes three internal finance destinations and two customer permission-denial pages; it is not five finance users. The later planned mixed operational supplement did not run and is not claimed.

A separate real 250-item batch acknowledged in **38.555 ms** and finished in **48,407.193 ms**, with 250 persisted created results, same-run replay and no duplicate logical periods. All 126 concurrent finance GET probes returned 200 below two seconds. Batch completion measures throughput; it is not mislabelled as a page response. Baseline read-only timing left counts and stage distribution unchanged; the batch used a separate database copy.

## Measured corrections and affected-path proof

The first smoke exposed cold global-list APIs at **2,016.675 ms** for subscriptions and **2,872.224 ms** for invoices. Query plans showed wide table scans and temporary ORDER BY sorts. Migration 11 adds the matching created-date/id indexes; subsequent complete API measurements, including the interrupted repeat's 115 paths, have no remaining list breach. Financial facts and custom teammate objects are preserved by the populated upgrade regression.

The complete run's **2,647.127 ms** queue breach was investigated with three queue variants, twenty cold navigations and fifty warm samples each. That diagnostic retained eleven breaches, with a **3,755.223 ms** worst warm page and **3,021.800 ms** queue HTTP request. Document navigation was 44 ms; fonts/frame waits were negligible. This localized the bottleneck to the request.

The corrected canceled summary begins with indexed Canceled invoices, joins their logical charge and checks the current pointer. Exceptions use an indexed UNION of failed-charge IDs and current-canceled IDs before the same customer/search/order/pagination rules. Historical canceled predecessors remain excluded. No financial write, pricing rule or additional index was introduced. Old/new responses matched **27 comparisons across nine scopes**; sixteen queue/workbench regressions and independent semantic review passed.

At corrected commit `b362b75`, the repeated affected run completed with **zero errors and zero threshold breaches**:

| Corrected queue boundary | Count | Median ms | p95 ms | Maximum ms |
|---|---:|---:|---:|---:|
| Cold-server API, nine role/paths | 9 | 11.184 | 150.171 | 150.171 |
| Warm API | 450 | 2.006 | 128.740 | 162.701 |
| Cold-browser page, three variants × 20 | 60 | 461.866 | 494.576 | 515.857 |
| Warm page, three variants × 50 | 150 | 333.349 | 381.347 | 416.717 |

The accepted desktop coverage therefore combines the complete inventory with repeat verification of the only changed workload. It does not discard the earlier failures or pretend the complete inventory was rerun after this SQL correction.

## Interrupted repeat, checks and limits

The user requested a faster wrap-up and cancellation of additional mobile benchmarking. The redundant post-fix desktop repeat was stopped by Ctrl+C. Its preserved file still says `running`; its package label is `interrupted-desktop-repeat`. Recorded coverage is **115 cold API probes, 5,750 warm API samples, 43 cold pages and 2,150 warm pages**, all without recorded errors or breaches. This is an interrupted run, not a completed release pass. Remaining destinations/actions, a new mixed concurrency sample and its batch were not run. A 390px thousands-row benchmark was canceled before execution; earlier functional mobile browser journeys remain separate evidence, not mobile performance proof. Unused layout/viewport combinations are unmeasured.

After the queue change, root observed `npm run check` pass lint, typecheck, **170 domain/integration tests** and production build, and `npm run test:e2e` pass **26/26 in 43.4 seconds**. These include authorization, exact money/date boundaries, lifecycle, rollback/replay and real worker/payment races. Test-suite durations do not substitute for the page timings above. The existing large JavaScript chunk warning remains disclosed; it was not the traced queue bottleneck.

Root completed fresh-checkout README verification at detached clean commit `b362b75` in `C:/Github/odoo-release-verify-b362b75`: `npm ci` passed with zero reported vulnerabilities, `npm run build` passed, actual `npm run db:migrate` produced schema11, and `npm run db:seed` passed twice while preserving accounts. The normal compiled production server ran on port3005 with an isolated process environment, local outbox and **no newly created `.env`**. Real Chromium form sign-in, protected `/workspace`, the empty persisted subscription list and reload passed. The server was stopped afterward. [P8_STARTUP.json](P8_STARTUP.json) preserves the compact witness. Final main integration remains a separate integration record.

The previously exercised isolated November walkthrough is runnable. Organizer checklist/submission remains pending under the user's repository-and-local-demo scope; no deployment or contest entry is claimed.

Reproduce from the README's benchmark commands. `python scripts/package-benchmark-evidence.py --run LABEL=PATH ...` packages preserved results without remeasurement, and `python scripts/audit-benchmark-run.py PATH` independently checks declared coverage, thresholds and persisted integrity. Raw local databases are ignored; the compressed sanitized observation archive is committed evidence. P9, later code changes, other hardware, WAN latency and untested traffic levels are outside these timings.
