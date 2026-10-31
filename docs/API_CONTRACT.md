# Shared application contract

Owner: root integrates shared persistence/domain contracts; domain owns catalog/subscription schema and routes; ui owns src/design context/browser journeys; independent review verifies boundaries. Coordinate active files. P0–P5 are verified; P6 is next.

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

## P3 quotation/agreement contract (verified)

`shared/subscriptions.ts` owns the strict schemas and safe DTOs. POST `/subscriptions/preview` calculates a commercial preview; POST `/subscriptions` stores a numbered Draft. Input is customer/plan IDs, optional template ID, start date, whole `termPeriods` (or an explicitly aligned exclusive `expiryDate`), nonnegative payment-term days, validity days and product/variant quantities. Template lines/validity may be copied from the database or explicitly overridden for this instance. No prices, totals, roles, stage or clock overrides are accepted.

Creation requires a UUID `idempotencyKey`. Exact actor/payload replay returns the original record; another actor or conflicting payload returns 409. Counter, request receipt, snapshot and history commit atomically. PUT `/:id` is Draft-only and requires `version`; the server explicitly reprices an edited Draft. GET lists accept search, stage and customer filters with bounded pagination. Customer ownership is always added by the server, independent of requested filters.

POST `/:id/issue`, `/:id/confirm`, `/:id/activate` require the last-read version and internal access. Issuing stores the immutable offered snapshot and inclusive validity date. Confirmation preserves it exactly, rechecks current publication/availability and line eligibility, and stores accepted terms. Activation requires the server business date to be within the service term and never depends on payment. Identical transition receipts replay without another history event. Database triggers freeze offered and accepted commercial values.

POST `/subscriptions/process-due` accepts only a bounded limit, activates due Confirmed agreements and reports outcomes/backlog. Ended Confirmed terms are reported separately as blocked; they cannot starve actionable work. This is activation processing, not P6 expiry/closure. The operational service preference applies once stage is Active; Draft/Quotation/future Confirmed views state that service has not started. Customer detail includes only its own safe snapshot/history; costs and internal product notes are absent.

## P4 invoice and discount contract (verified)

`shared/billing.ts` owns strict inputs and safe invoice DTOs. Admin alone creates/edits `/discounts`; internal staff can read their eligibility, reserved/consumed usage and holding Drafts. Rules support fixed amounts or percentage basis points, amount/quantity thresholds, inclusive business dates, maximum uses, product scope and an optional subscription target. Selection is non-stacking: ascending priority then stable ID. Percentage is rounded once over the eligible scope; fixed and percentage amounts use deterministic largest-remainder line allocation. Exclusive tax follows the discount and rounds per line.

POST `/subscriptions/:id/invoices/preview` takes `expectedPeriodStart` and reserves nothing. POST `/subscriptions/:id/invoices` also requires a UUID `idempotencyKey`. It processes only the oldest unprocessed due period using accepted prices and generation-date tax/discount eligibility. One logical charge occupies each period; actor/payload-bound replay resolves its current invoice revision. Counter, immutable header/lines, discount reservation, cursor, history and receipt commit atomically. Existing or canceled charges cannot be silently regenerated.

GET `/invoices` and `/:id` enforce customer ownership. Internal rule decisions and global usage never enter customer snapshots. POST `/:id/confirm` and `/:id/cancel` require the last-read `version`, internal access and a valid transition. Confirmation consumes a reserved use once even after later rule edits/expiry. A zero-total confirmation becomes Paid with zero payments. Draft cancellation releases any reservation; unpaid Confirmed cancellation retains any consumed use. Paid invoices cannot be canceled. Pricing and original eligibility snapshots remain immutable.

## P5 billing workbench and output contract (verified)

`shared/billing-workbench.ts` owns strict bounded run/retry/replacement inputs and paged results. GET `/billing/queue` accepts `q`, `customerId`, `view=due|exceptions` and pagination. It selects the next oldest owed period per accepted subscription using an indexed original-anchor cursor, without excluding debt because of the current service badge. Failed periods and canceled current revisions remain visible exceptions. Future accepted subscriptions are counted as not due; that is not a waiver of their future charge.

POST `/billing/runs` takes `limit` (1–500, default 250), optional distinct `subscriptionIds`, and a UUID `idempotencyKey`; it returns 202 and a persisted run. GET `/billing/runs`, `/:id` and `/:id/items` expose saved progress and paginated/filterable outcomes. POST `/:id/retry` with a fresh request key targets only the original failed periods. Remaining backlog is explicitly a subscription count observed at the end of that run. Same actor/payload key replays the original run; conflicting keys fail. Short item transactions yield between items, so a batch is not one blocking page request. Worker leases, recovery and shutdown preserve unfinished work. Successful row outcome/counters commit in the same transaction as invoice, reservation and cursor; a failed item cannot advance past its period or monopolize the same bounded run.

POST `/invoices/:id/replacement/preview` takes `version`; POST `/:id/replace` also requires a UUID key and returned `previewHash`. Only the current canceled revision with no payments may receive one explicit linked successor. The write rechecks the financial preview under lock. Changed current tax/discount eligibility conflicts before any reservation or pointer change. Ordinary period replay follows the current revision and never silently rebills a canceled one. Replacement does not advance the subscription cursor or restore consumed discount usage.

`shared/invoice-output.ts` owns send and metadata DTOs. POST `/invoices/:id/send` takes only a UUID `idempotencyKey`; the actor/invoice-bound receipt and outbox message commit once. The recipient is the saved registered customer address. New sends reject canceled/superseded revisions. GET `/:id/deliveries` is internal-only, paginated metadata: generated, sending, accepted, failed and unknown remain distinct. All notices in this local build are marked controlled tests and request no real payment. SMTP acceptance alone is not an inbox witness.

GET `/invoices/:id/print` returns escaped saved HTML for authorized internal users or the owning customer. Its nonce-restricted style/print handler loads no remote assets and invokes the browser Print/Save as PDF path. Draft/Canceled labels remain explicit. Output actions never confirm or settle an invoice. Payments/lifecycle and finance remain later gates.
