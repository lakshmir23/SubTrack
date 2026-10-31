# Shared application contract

Owner: root integrates server/shared/schema; ui owns src and design context; verification owns tests and evidence. Coordinate changes to shared types before editing. Current implementation is P0–P1 only; later endpoints below remain planned.

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

Later roadmap contracts will be added at their gates: catalog/plans/taxes/templates → subscriptions/lifecycle → logical charges/invoice revisions/discount reservations → payments → finance. Do not build them before the preceding gate passes.
