# P6 collection and service integrity

## Observed automated checks

- Payments: **13/13 passed**, including A's 1,000 then 2,088.80 allocations, partial Confirmed/final Paid, exact replay after Paid, conflicting keys, equal legitimate payments, role/ownership/privacy, cancellation denial, immutable facts, history-failure rollback and real two-process overpayment/replay races.
- Lifecycle: **21/21 passed**, including future pause/resume on original anchors, old debt, canonical waived periods, failed-period boundary preservation, month end, early closure, accepted flags, Active/Confirmed expiry on/off, boundary renewal/late rejection/replay, optional-line history and real two-process renewal versus expiry.
- Integrated affected subscription/billing/workbench/output/payment regression: **87/87 passed**, **39,811.1972 ms**.
- Aggregate `npm run check`: lint, typecheck, **159/159 tests** (**58,208.3602 ms**) and production build passed. Final current-browser/visual gate results are recorded in the implementation ledger.

An initial lifecycle test expected HTTP 200 for a newly recorded waiver; the documented contract correctly returns 201. The expectation was corrected and all 21 passed. This was not a financial calculation failure. Injected rollback tests deliberately print one generic synthetic server error; their atomicity/retry assertions passed.

Independent review separately verified migration 9's populated upgrade and error path: original subscription columns and child rows, existing indexes/triggers including teammate additions, invoice/payment links and FK defenses were preserved. A forced migration collision left no version marker and restored `foreign_keys=ON`. Payment migration 10 is explicitly forward-only for databases that already applied version 8; no applied migration was silently rewritten.

Independent direct/batch probes verified that an `onResult` failure rolls back a canonical paused-period waiver, receipt, cursor/version and audit together. A batch failure left its earlier created invoice intact and the waived period retryable. Retry committed one explicit nonbillable outcome and advanced once, with no invoice or discount reservation; replay advanced nothing. Historic add-on lines, current invoice snapshots, accepted prices and prior owed debt remained unchanged.

## Normal server automatic-expiry witness

The reviewer created a disposable synthetic database using yesterday's trusted fixture clock, with two accepted daily agreements ending on **31 October 2026**, one auto-close enabled and one disabled. It then started the actual `server/index.ts --production` entrypoint in an isolated temporary working directory with process-only outbox/database/port/origin settings. The repository `.env` was not loaded. A copied minimal index file satisfied the API-only production-start precondition; this witness is not frontend/build validation.

- Start: **2026-10-31 08:08:11.172 UTC**.
- Automatic events applied: **08:08:11.929 UTC**, effective business date **2026-10-31**.
- Direct read-only database inspection, before any subscription GET: **08:08:11.970 UTC**, **798 ms** after start.
- Auto-close enabled: **Closed / Closed**, closure cause **expiry**.
- Auto-close disabled: **Active / TermEnded**.
- Both retained **2026-10-30** as the oldest unbilled cursor, index 0. Invoice/payment/logical-charge counts were all zero; processing invented no financial records.
- Subsequent real HTTP generation recovered both owed **October 30–31** Draft invoices at **125.00** each, without payments.

The real shutdown handler completed after SIGTERM with exit 0 and no stderr. The reviewer verified containment before cleaning its temporary directory. No external email or money movement occurred. The 798 ms observation is an automatic-job witness, not a thousands-row page-performance claim; FIN-02 remains P8 work.
