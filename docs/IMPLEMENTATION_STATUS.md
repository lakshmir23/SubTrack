# SubTrack implementation evidence ledger

Started 31 October 2026 from documentation-only commit `85e8074`. The team's current instruction authorizes implementation in roadmap order. Historical “documentation only” statements describe the handoff, not a completed implementation.

Status vocabulary: **Not started**, **In progress**, **Verified**, **Blocked**. A planned location or witness is not implementation or passing evidence. Update a row only after observing the current build. Keep failures and external evidence gaps visible.

Ownership: **root/core** owns integration, persistence and domain/API behavior; **ui** owns the connected interface; **verification** owns independent requirement review and verification evidence. These are coding-agent work areas, not claims about human teammate authorship. Planned paths are intentionally unspecified until the implementation contracts exist.

| Requirement | Owner | Implementation location | Test / demo witness | Current result | Blocker |
|---|---|---|---|---|---|
| AUTH-01 | root/core; ui | `server/identity.ts`, `server/database.ts`, `src/Auth.tsx` | HTTP and independent-process signup race; browser signup/reload passed | Verified | — |
| AUTH-02 | root/core; ui; verification | `shared/validation.ts`, `src/Auth.tsx` | Eight/nine-character, Unicode, class and 128-character parity; browser boundary passed | Verified | — |
| AUTH-03 | root/core; ui; verification | `server/identity.ts`, `server/mail.ts`, reset UI | Reset tests and browser reset passed; controlled SMTP and user-confirmed inbox receipt in `docs/evidence/P1_DELIVERY.md` | Verified | — |
| AUTH-04 | root/core; ui; verification | `server/security.ts`, identity serializers; business-record portal in P3/P7 | `tests/auth.test.ts`, `tests/security.test.ts` passed for P1 scope; later cross-record checks not started | In progress | — |
| AUTH-05 | root/core; ui; verification | `server/identity.ts`, `src/Workspace.tsx` | API admin success and role denial; browser staff create/reload/conflict/repeat passed | Verified | — |
| CAT-01 | root/core; ui | Planned — catalog | Planned — create/edit/reload all product fields; protected cost | Not started | — |
| CAT-02 | root/core; ui; verification | Planned — variant pricing | Planned — persisted Odoo +560; 1,200 catalog / 1,000 plan produces 1,560 | Not started | — |
| PLAN-01 | root/core; ui; verification | Planned — plans/calendar | Planned — persist all four cadences; original-anchor month/leap recovery | Not started | — |
| PLAN-02 | root/core; ui; verification | Planned — plan eligibility | Planned — minimum quantity and inclusive availability boundaries | Not started | — |
| PLAN-03 | root/core; ui; verification | Planned — accepted lifecycle policies | Planned — permitted/denied pause, resume, renewal, early close and auto-close on/off | Not started | — |
| QUOTE-01 | root/core; ui; verification | Planned — templates/quotation | Planned — two independent template instances and valid-days expiry | Not started | — |
| SUB-01 | root/core; ui | Planned — subscriptions | Planned — unique number/customer/plan/dates/terms survive reload | Not started | — |
| SUB-02 | root/core; ui; verification | Planned — accepted lines/calculator | Planned — quantities, unit prices, tax and amounts from server; immutable snapshots | Not started | — |
| SUB-03 | root/core; ui; verification | Planned — transitions/history | Planned — Draft → Quotation → Confirmed → Active → Closed; invalid and future-start cases | Not started | — |
| SUB-04 | root/core; ui | Planned — subscription list/detail | Planned — persisted shared staff view with search/pagination | Not started | — |
| BILL-01 | root/core; ui; verification | Planned — billing batch | Planned — hundreds of due records; prefilled invoices and reconciled outcomes | Not started | — |
| BILL-02 | root/core; ui; verification | Planned — tax configuration/calculator | Planned — configured exclusive tax after discount and half-up line rounding | Not started | — |
| BILL-03 | root/core; ui; verification | Planned — invoice actions/delivery/print | Planned — confirm/cancel/replacement/send/inspected print; real controlled delivery | Not started | Approved sender/recipient and real delivery evidence not established |
| BILL-04 | root/core; ui; verification | Planned — invoice settlement | Planned — Draft → Confirmed → Paid; partial remains Confirmed; zero total without payment | Not started | — |
| BILL-05 | root/core; ui; verification | Planned — unique logical periods/outcomes | Planned — replay, two workers, injected failure/retry, rollback and closed backlog | Not started | — |
| DISC-01 | root/core; ui; verification | Planned — discount administration | Planned — admin create; staff/customer direct API denial | Not started | — |
| DISC-02 | root/core; ui; verification | Planned — discount eligibility/reservations | Planned — fixed/percentage, amount/quantity, inclusive dates, limit and final-use race | Not started | — |
| DISC-03 | root/core; ui; verification | Planned — discount scope/allocation | Planned — product and subscription scopes; deterministic fixed remainder allocation | Not started | — |
| DISC-04 | root/core; ui; verification | Planned — invoice-time discount selection | Planned — automatic next invoice, separate expiry/exhaustion, reservation/consumption replay | Not started | — |
| PAY-01 | root/core; ui; verification | Planned — immutable payment allocation | Planned — method/amount/date/note, review, replay/conflicting key and concurrent overpay | Not started | — |
| PAY-02 | root/core; ui; verification | Planned — invoice balances/overdue | Planned — A pays 1,000 then 2,088.80; today's due versus overdue; portal refresh | Not started | — |
| FIN-01 | root/core; ui; verification | Planned — finance aggregates/filters | Planned — 4,188.80 billed / 3,088.80 collected / 1,100 outstanding; full-filter reconciliation | Not started | — |
| FIN-02 | root/core; ui; verification | Planned — bounded queries/page inventory | Planned — valid thousands-row dataset, every page, cold/warm API and rendered timings | Not started | — |

## Roadmap gate record

**P0 — Verified.** Shared contracts are recorded in `docs/API_CONTRACT.md`; D-01–D-10 adoption and SQLite fallback are recorded in `docs/DECISIONS.md`. Setup/migration/seed/dev/production commands are available in `README.md`. The integration owner observed actual Edge rendering connected to the database, a 390-pixel mobile viewport without overflow, and a passing production build. These observations were reported to verification by the integration owner; they are not performance benchmarks.

Verification independently executed `npx tsx --test --test-name-pattern=P0 tests/database.test.ts`: **2 passed**, covering fresh repeatable migration, database constraints, WAL/foreign keys, persisted data after reopening and real database health. `npx tsx --test tests/validation.test.ts`: **2 passed**, covering exact password classes/boundary and normalized strict signup validation. `npx eslint tests --max-warnings 0` and `npx tsc -p tsconfig.server.json --noEmit` passed at this P0 checkpoint. A root production build is additional reported evidence; final aggregate checks must run again after P1.

**P1 — Verified.** Final aggregate `npm run check` passed lint, typecheck, **32 tests**, and production build. Test duration was **8,484.3755 ms**; zero failures. Actual SQLite-backed HTTP signup/login/logout, independent-process duplicate-signup race, password boundaries, role denial, CSRF/origin checks, reset expiry/replay/latest-only/concurrent use, session revocation/rotation/expiry, forged cookies, HTTPS headers, escaped-search pagination, safe errors and Kolkata midnight were exercised. Negative-mail tests intercept transport; real delivery is evidenced separately.

`npm run test:e2e`: **7 passed**, production assets and fresh isolated SQLite, **10.6 seconds**. Browser witnesses: signup/password boundary; staff create/repeat/search/reload/conflict; retained fields and unsaved keyboard confirmation; reset fragment removal/replay; role denial; empty/error/retry; mobile 390px/reduced motion; dirty-form session-expiry reauthentication. Initial focus-timing and reset-fragment failures were corrected and rerun. AUTH-04 remains In progress overall because business-record ownership awaits P3/P7.

Controlled SMTP message `19eab82c-b522-497f-b1c5-e97424d683e8` was accepted; user confirmed actual inbox receipt and supplied received-inbox screenshots. See `docs/evidence/P1_DELIVERY.md`; private images/tokens are excluded from Git. DESIGN lint: zero errors/warnings. Strict premium audit: zero findings. Independent visual review found input contrast and color-only password indicators; both were fixed and recaptured, then scored resolved with **ship for P0–P1 scope**. Final control contrast: **3.513:1**.

Independent review raised mail-worker crash/shutdown risks. The fixes now preserve an abandoned claim as **unknown** rather than silently resending, expose an active claim as **sending**, and await an in-flight transport on shutdown before database closure. Affected regression `npx tsx --test --test-concurrency=1 tests/validation.test.ts tests/auth.test.ts tests/database.test.ts tests/mail.test.ts`: **20 passed, 0 failed** in **6,309.3349 ms**. This includes Unicode code-point/character-class and 128-character login parity, version-two-to-three outbox migration preserving messages, atomic rejection of reserved seed-email role collisions, and the crash/shutdown cases without real network access. `tests/mail.test.ts` was rerun after adding the HTTP sending-status assertion: **6 passed**. Tests lint and server typecheck passed again. Final aggregate regression remains to run after browser/delivery work.

**P2–P8 — Not started.** Complete a persisted, role-authorized workflow with UI and a test at each gate before advancing. Do not equate a saved configuration flag with exercised lifecycle behavior.

External evidence still needed: actual invoice delivery (P5), organizer submission instructions and authorized submission status (P8). Reset delivery is verified. The team reported six hours remaining; no exact event cutoff is independently verified. A development outbox proves generation only. User entered approved SMTP settings in ignored `.env`; no contest submission is authorized merely by this ledger.
