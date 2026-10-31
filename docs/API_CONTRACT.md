# Shared application contract

Owner: root integrates shared persistence/domain contracts; domain owns catalog/subscription schema and routes; ui owns src/design context/browser journeys; independent review verifies boundaries. Coordinate active files. P0–P2 are verified; P3 is in progress.

Adopt D-01–D-10 as implementation defaults under the current instruction to execute the roadmap. They remain team policies, not organizer requirements. Currency is INR with 100 minor units. Business date is server-owned Asia/Kolkata, timestamps are UTC, periods are half-open and derived from original anchors. No client date override. Public roles, ownership, price and totals are never accepted from the browser.

Stack: React/TypeScript/Vite, Express 5, Node built-in SQLite. Docker daemon is unavailable; use the documented SQLite fallback, WAL, foreign keys, bounded busy timeout and immediate write transactions. Real cross-process concurrency tests are required before this fallback passes. No hosted service, paid access or deployment is provisioned.

Routes use same-origin cookie sessions; session tokens and reset tokens are stored hashed. Authenticated mutations require `X-CSRF-Token` from `GET /api/session`. Unauthenticated auth mutations check Origin when supplied and require JSON. Request validation rejects additional fields. Errors: `{error:{code,message,fields?,requestId}}`. Money is integer minor units, dates are ISO strings, lists are `{items,total,page,pageSize}`. Default page size 20, maximum 100.

P0–P1 implemented route targets:

- `GET /api/health`: persisted database health/schema without secrets.
- `GET /api/session`: `{user: User|null, csrfToken: string|null}`.
- `POST /api/auth/signup`: `{name,email,password}` → session; always customer.
- `POST /api/auth/login`: `{email,password}` → session.
- `POST /api/auth/logout`: revoke current session.
- `POST /api/auth/forgot-password`: `{email}` → same generic public acknowledgement.
- `POST /api/auth/reset-password`: `{token,password}` → revoke existing sessions and tokens; login again.
- `GET /api/workspace`: authenticated persisted, role-safe workspace summary.
- `GET /api/staff`, `POST /api/staff`: admin only. Creation uses `{name,email,password}`; role fixed to staff.
- `GET /api/customers`: internal only; paginated/searchable, safe fields only.
- `GET /api/deliveries`: admin only; metadata only, no reset body/token. Automated tests inspect their isolated local outbox, never a public message-body route.

Email: `MAIL_MODE=outbox` proves generation only. SMTP requires configuration and an exact approved-recipient allowlist. User authorized the test account and entered settings locally. Controlled reset delivery (P1) was accepted by SMTP and confirmed received in the actual inbox; see evidence/P1_DELIVERY.md. Invoice delivery remains a separate P5 witness. Sending, acceptance, failure and uncertain interrupted outcomes remain distinct; uncertain messages are not silently resent. The optional OpenAI key is reserved in ignored `.env`; no model code/calls or credential provisioning are enabled.

## P2 configuration contract (verified)

`shared/catalog.ts` owns strict input schemas and DTOs. Admin alone writes products, variants, plans, taxes and templates. Internal staff may read necessary operational configuration without product costs; customer-published catalog omits cost and notes. Archived records retain identity. No delete endpoint is planned. Full PUT includes the last-read `version`; stale updates conflict and preserve the newer record.

`/products`, `/plans`, `/taxes`, `/quotation-templates`: GET paginated lists, GET `/:id`, admin POST and PUT `/:id`. Lists use `q`, `page`, `pageSize` (1–100). Product variants belong to their product. Plans identify one primary product, replacement unit price, cadence, minimum primary quantity, inclusive availability and accepted-policy capability flags. Templates carry plan, copied line selections and positive validity days. Exactly one primary-product line is required.

`POST /catalog/preview` accepts plan ID and product/variant IDs with whole quantities; it returns a server-priced breakdown. Plan price replaces the primary catalog price, then the selected variant adjustment applies; add-ons use catalog price. Automatic tax selects one active rule per line by ascending priority, product scope ahead of global at a tie, then stable ID. Tax is exclusive, half-up per line; fictional rule labels make no statutory claim. Eligibility uses the server's Asia/Kolkata date. No browser totals are trusted.

`server/money.ts` owns exact bounded BigInt arithmetic (INR scale two); `shared/money.ts` owns exact decimal entry/display conversion. `server/calendar.ts` owns original-anchor calendar/date arithmetic. Read-only previews use a consistent read transaction; mutations acquire an immediate write transaction with a one-second busy bound and a useful retryable 503 on contention.

## P3 quotation/agreement contract (in progress)

`shared/subscriptions.ts` owns the strict schemas and safe DTOs. POST `/subscriptions/preview` calculates a commercial preview; POST `/subscriptions` stores a numbered Draft. Input is customer/plan IDs, optional template ID, start date, whole `termPeriods` (or an explicitly aligned exclusive `expiryDate`), nonnegative payment-term days, validity days and product/variant quantities. Template lines/validity may be copied from the database or explicitly overridden for this instance. No prices, totals, roles, stage or clock overrides are accepted.

Creation requires a UUID `idempotencyKey`. Exact actor/payload replay returns the original record; another actor or conflicting payload returns 409. Counter, request receipt, snapshot and history commit atomically. PUT `/:id` is Draft-only and requires `version`; the server explicitly reprices an edited Draft. GET lists accept search, stage and customer filters with bounded pagination. Customer ownership is always added by the server, independent of requested filters.

POST `/:id/issue`, `/:id/confirm`, `/:id/activate` require the last-read version and internal access. Issuing stores the immutable offered snapshot and inclusive validity date. Confirmation preserves it exactly, rechecks current publication/availability and line eligibility, and stores accepted terms. Activation requires the server business date to be within the service term and never depends on payment. Identical transition receipts replay without another history event. Database triggers freeze offered and accepted commercial values.

POST `/subscriptions/process-due` accepts only a bounded limit, activates due Confirmed agreements and reports outcomes/backlog. Ended Confirmed terms are reported separately as blocked; they cannot starve actionable work. This is activation processing, not P6 expiry/closure. The operational service preference applies once stage is Active; Draft/Quotation/future Confirmed views state that service has not started. Customer detail includes only its own safe snapshot/history; costs and internal product notes are absent.

Later contracts: logical charges/invoice revisions/discount reservations → batch/retry/print/send → payments/lifecycle → finance. These later gates are not implemented yet.
