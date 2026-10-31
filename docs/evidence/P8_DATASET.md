# P8 synthetic dataset and integrity evidence

This record describes the dataset and its validation. It does not certify the application’s latency or production capacity. The release performance record owns the full API, rendered-page, concurrent-user and batch measurements, including every observed two-second breach.

## Reproducible source and observed artifacts

The [fixture generator](../../server/benchmark-fixture.ts) creates a fresh, isolated SQLite database. Its [manifest contract](../../server/benchmark-data.ts) records actual counts, distributions, exact monetary totals, sample record IDs, synthetic accounts, the fixed clock and validation results. The [read-only validator](../../server/benchmark-validation.ts) recomputes the financial and calendar facts after seeding.

Two complete fresh runs succeeded:

- `data/benchmark-p8-first.sqlite`, manifest created **2026-10-31 09:10:51.337 UTC**; generator exited 0 and validation passed.
- `data/benchmark-p8-repro.sqlite`, manifest created **2026-10-31 09:13:14.610 UTC**; the finalized `--output=` command exited 0 with identical counts and passing validation.

Each has an adjacent `.manifest.json`. These local artifacts are ignored by Git. The primary fixture is the first database; benchmark runs work on copies. Both original manifests truthfully record **schema 10**. The later runtime upgrades to **schema 11** without rewriting those initial artifact records. A newly generated fixture from the current source will record its actual current schema.

The fixed synthetic instant is **2026-11-09T04:00:00.000Z**, corresponding to business date **November 9, 2026** in Asia/Kolkata. The runtime must use that instant and a visible synthetic-environment label. Generation does not read `.env`, call OpenAI, deliver SMTP mail or move money. Local manifests contain synthetic account credentials and a reset-form test token; keep them out of published timing reports and screenshots.

## Actual dataset shape

There are **202 customer accounts**: 200 generated benchmark customers plus the two standard synthetic customer identities. Admin and staff accounts are additional roles.

The **10,000 subscriptions** contain:

- 500 Draft and 500 Quotation records.
- 1,000 Confirmed agreements: 500 with a future start and no invoices, and 500 with older due periods.
- 6,500 Active-stage agreements: 5,400 Running, 1,000 Paused and 100 TermEnded with automatic closure disabled.
- 1,500 Closed agreements: 1,000 closed at expiry and 500 closed early.

Across all stages, service-state counts are 7,400 Running, 1,000 Paused, 100 TermEnded and 1,500 Closed. Each cadence—daily, weekly, monthly and yearly—has exactly **2,500 subscriptions**. The finance definition therefore counts **6,400 current Active agreements**, including paused service; the 100 expired TermEnded records do not count merely because their stage remains Active.

There are exactly **30,000 invoice revisions**, each backed by its own logical period charge, and **60,000 invoice lines**. Invoice status counts are:

- 6,000 Draft.
- 15,399 Confirmed, including invoices with positive partial payments.
- 7,701 Paid, including one genuine zero-total settlement with no payment.
- 900 Canceled, with their logical charges retained and no recorded money.

The dataset also contains **27,400 immutable positive payment allocations**, **30,000 discount applications**, **2,600 lifecycle events** and **31,056 logical charges**. The charges comprise 30,000 invoiced periods, **1,000 explicit full-period paused waivers** and **56 retryable failed periods**. Failed periods remain at the oldest cursor; they have no invoice and do not advance it.

The 8,500 agreements with historical invoices have a contiguous prefix of three or four invoiced periods: 4,000 have three and 4,500 have four. Future Confirmed agreements start at cursor zero; Draft and Quotation records have no accepted financial history. Paused agreements add an explicit non-billable period after their invoiced prefix. Some closed and expired agreements retain older unprocessed owed periods so a current badge cannot conceal backlog.

## Exact lifetime reconciliation

All values below are INR minor-unit integers, aggregated over the complete unfiltered dataset:

- Billed, excluding Draft and Canceled: **6,982,446,350** (₹69,824,463.50).
- Payments received: **3,385,420,842** (₹33,854,208.42).
- Current outstanding: **3,597,025,508** (₹35,970,255.08).
- Current overdue at the fixed business date: **3,008,190,110** (₹30,081,901.10).

Billed equals payments received plus current outstanding. These are lifetime benchmark totals. They are distinct from the isolated three-agreement November demo and its explicit November invoice/payment ranges; the demo’s ₹4,188.80 / ₹3,088.80 / ₹1,100 witness must not be substituted for this dataset.

## Construction and validation

Seventeen real authenticated API agreement/invoice prototypes establish accepted pricing, variants, tax and discount snapshots: sixteen ordinary combinations and one fully discounted period. One real bounded billing run has one persisted created item. The remaining records are bulk clones of those validated domain shapes inside a transaction.

Foreign keys, STRICT/CHECK constraints, immutable accepted/invoice/line guards, discount capacity/state guards and payment allocation triggers remain enabled. Original daily/weekly/monthly/yearly boundaries include January 31 and leap-day anchors. New accepted line identities are mapped to each instance; invoice lines refer to those saved identities. No price comes from a benchmark browser request.

Invoices begin with no payment allocation. Positive payment inserts against Confirmed invoices invoke the existing allocation trigger, which derives amount paid, payment count, remaining balance and Paid status. The generator never invents paid caches. Discount reservations are consumed on confirmation or released after Draft cancellation. Zero-total confirmation settles without inserting a fake payment.

The generator’s post-seed validation passed on both complete fresh databases. The standalone validator also passed read-only against the primary database. It checks:

- SQLite integrity, foreign-key consistency and installed financial guards.
- Every accepted-price binding, quantity, line/header sum, saved discount eligibility and exclusive half-up tax.
- Every original calendar period, whole-term expiry, decided cursor prefix, indexed next boundary, failed period and pause-backed waiver.
- Every payment sum/count/status, zero-total settlement, current logical-charge pointer and discount reservation/consumption/release state.

An independent Python standard-library audit also passed with **zero errors**, checking all 10,000 subscriptions, 31,056 charges, 30,000 invoices, 60,000 lines and 27,400 payments and recomputing all four manifest totals. Its local result is `data/p8-independent-audit.json`. The checked-in source is [scripts/verify-benchmark.py](../../scripts/verify-benchmark.py); it uses Python's standard library and opens the database read-only.

## Measured list-sort correction

The first real cold-server smoke exposed API breaches: the admin subscription list took **2,016.675 ms**, and the admin invoice list took **2,872.224 ms**, both for empty search, page 1 and page size 20. These observations remain part of the baseline evidence.

Actual list queries used `SELECT * ... ORDER BY created_at DESC,id LIMIT ? OFFSET ?`. On schema 10, `EXPLAIN QUERY PLAN` showed a table scan and `USE TEMP B-TREE FOR ORDER BY` for both wide snapshot tables. Empty search already omitted the `LIKE` predicate; no search-policy change was needed.

[Forward migration 11](../../server/performance-schema.ts) adds only `subscriptions_created_page(created_at DESC,id)` and `invoices_created_page(created_at DESC,id)`. After migration, both plans stream the matching order index without a temporary sort. No financial table, trigger, snapshot or business rule was changed. Seven affected database/migration tests passed; the later cleanup-guard refinement reran both focused migration tests successfully. Targeted lint and server typecheck passed. The populated upgrade test preserves accepted terms, invoices, payments and unknown teammate indexes/triggers and verifies payment and immutable-history guards still operate.

A separate upgraded copy recorded 50 warm SQL samples per query in `data/p8-index-query-probe.json`:

- Subscriptions: median **0.1216 ms**, p95 **0.3271 ms**, maximum **0.5558 ms**.
- Invoices: median **0.0986 ms**, p95 **0.1353 ms**, maximum **0.6643 ms**.

These measure only the bounded SQL statement. The operating-system cache was not flushed, and migration had just read the copied database. They do not represent cold API, network, browser rendering or the final under-two-second result. The release harness must report those boundaries separately and retain failures and limits.

## Measured queue correction

The first full desktop candidate retained one real workbench cold-load breach (**2,647.127 ms**). A diagnostic run repeated three queue variants with 20 empty-browser-cache navigations and 50 warm samples each and observed 11 breaches. Its slow due-page sample took **3,755.223 ms**; the queue HTTP request itself took **3,021.800 ms**, while document navigation took 44 ms and font/frame waits were negligible. This localized the work to the request rather than the frontend bundle.

Actual plans showed the canceled summary scanning all 31,056 charges and looking up invoice snapshots. The correction joins indexed Canceled invoices to their logical charge and checks the current pointer. Exceptions now select narrow IDs through an indexed UNION of failed charges and current canceled invoices before applying the original customer/search/order/page rules. No financial write or new index was introduced. Old/new responses matched across nine scopes and 27 page comparisons. Sixteen focused queue/workbench regressions passed, including replacement histories, literal wildcard search and worker races. Final repeated API/page measurements remain a separate release record; these query changes alone are not a latency pass.

## Reproduction and limits

From the repository root, after installing the documented dependencies:

```powershell
npm run benchmark:seed -- --output=data/p8-example.sqlite
npx tsx server/benchmark-validation.ts data/p8-example.sqlite
npm run build
npm run benchmark -- --manifest=data/p8-example.sqlite.manifest.json --samples=50 --label=release
```

The seed path must be new: existing databases, sidecars and manifests are preserved. Omitting `--output=` selects a timestamped path under `data`. Run `python scripts/verify-benchmark.py data/p8-example.sqlite` for the independent raw-fact audit. Run `python scripts/audit-benchmark-run.py data/benchmark-<run>/results.json` to verify measured sample coverage, conventional median/p95/max, every breach, final database guards and batch reconciliation.

This is a synthetic local correctness and performance fixture with **two stable ordinary pricing patterns**, four cadences, representative variants, partial/full payments and a single zero-total edge case. It has **one historical billing run with one item**, and each charge has one invoice revision. Longer replacement histories, discount last-use races, concurrent payments and response-loss retries are covered by focused domain tests rather than a claim that this seed reproduces every workload. The fixed clock and compact catalog are deliberate limits. Counts, complete iteration checks and successful seeding prove data consistency; they do not prove production load, realistic traffic or final page latency.
