# UX Contract

## Product context

SubTrack serves Brightloop administrators, internal staff and customer portal users. Primary jobs and current scope are in `PRODUCT.md`; mandatory business rules come from `docs/REQUIREMENTS.md`, `docs/DECISIONS.md` and `docs/API_CONTRACT.md`. English (India), Gregorian calendar and Asia/Kolkata business dates; timestamps display their timezone. Accessibility target is WCAG 2.2 AA. No claim of completed certification is made.

## Business-context sources

| Domain                 | Source                                                                       | Reviewed   |
| ---------------------- | ---------------------------------------------------------------------------- | ---------- |
| Permission model       | `docs/DECISIONS.md` D-09; `docs/API_CONTRACT.md`                             | 2026-10-31 |
| Identity lifecycle     | `docs/REQUIREMENTS.md` AUTH-01–05; shared schemas                            | 2026-10-31 |
| Billing and payment    | `docs/DECISIONS.md` D-01–08; not implemented in P1                           | 2026-10-31 |
| Retention and deletion | No destructive account UI in baseline; tokens expire, reset revokes sessions | 2026-10-31 |
| Delivery claims        | `docs/ROADMAP.md` P1/P5; outbox generation differs from inbox delivery       | 2026-10-31 |
| Legal copy             | No legal/compliance claim or agreement acceptance flow                       | 2026-10-31 |

## Visual contract

`DESIGN.md` owns appearance; `src/styles.css` maps its concrete tokens. Light theme only. Components in `src/ui.tsx` own reusable visual and behavioral primitives. Do not add per-screen alternate form or feedback systems. Token changes require both contract and runtime edits.

## Canonical UI Map

| Capability | Canonical owner                                             | Source of truth | Allowed variants       | Verification              |
| ---------- | ----------------------------------------------------------- | --------------- | ---------------------- | ------------------------- |
| Form       | `src/ui.tsx` Field, PasswordField, Feedback; shared schemas | This contract   | auth / create          | E2E validation and focus  |
| Scrollbar  | `src/styles.css` global baseline                            | DESIGN.md       | global                 | computed style            |
| Toast      | `src/ui.tsx` Feedback, inline live region                   | This contract   | success / info / error | E2E status text           |
| CRUD       | `src/App.tsx` routes and `src/api.ts`                       | API contract    | return / stay          | E2E full create/read path |

Table selection, select/listbox and date input are not applicable to P0/P1. Adding them later requires a canonical owner first.

## Dataset navigation

Staff/customer/delivery lists are server-paginated, 20 rows per page, with count/range and previous/next buttons. Search state and page live in URL parameters. Search is 300ms debounced, composition-safe, explicitly clearable and ignores superseded responses using AbortController. Changing search resets the page. Empty, no-results, loading and failure states all occupy the list region; errors retain entered search and expose Retry. Lists do not support bulk selection or a misleading sort affordance.

## Flow ledger

| Operation       | Pending                        | Success destination and feedback   | Failure recovery                               | Focus                                         | Source        |
| --------------- | ------------------------------ | ---------------------------------- | ---------------------------------------------- | --------------------------------------------- | ------------- |
| Signup/login    | fixed-size busy primary action | Role's workspace                   | retain fields and inline error                 | title on navigation; invalid field on failure | AUTH-01/02/04 |
| Forgot password | busy primary action            | Same form, generic acknowledgement | retain email and safe error                    | status region                                 | AUTH-03       |
| Reset password  | busy primary action            | Login, confirmation message        | retain password on recoverable request failure | invalid field or login title                  | AUTH-03       |
| Add staff       | busy Save button               | Staff list, success notice         | retain fields and field mapping                | new list heading or invalid field             | AUTH-05       |
| Search/page     | stable loading region          | Same list, URL state               | Retry uses current filters                     | preserve search; page heading remains         | API contract  |
| Logout          | busy action                    | Login                              | inline error, session remains                  | login heading                                 | AUTH-04       |

## Navigation and responsive behavior

Every route sets document.title and has one h1. App-owned 403/404 states distinguish unavailable access from a missing route and provide a valid return link. Customer navigation omits internal destinations; direct routes still check role and all APIs enforce server permissions. Desktop sidebar becomes a visible wrap-capable navigation row on narrow screens, without a hidden mobile-only control. Main content scrolls naturally. A skip link targets main. Auth forms remain one column. Long emails wrap and action labels stay visible.

## Feedback and preservation

Feedback is inline and accessible (`role=status` for success/info, `role=alert` for errors), stable and specific. No native alert/confirm/prompt. There are no destructive modals in P1. Entered form values remain on a failed save. For authentication fields no local/session storage is used. Safe nonsecret input can remain in React state while a form remains mounted. Form navigation links preserve no passwords. Explicit navigation away from changed forms asks through an app-owned dialog when implemented; a beforeunload guard protects a real unload only.

## Async and resilience

Mutations are pessimistic. A pending ref plus disabled button prevents repeated submits; no automatic retry of account/staff creation or email generation. API requests have a bounded timeout and cancellation. Lists abort superseded requests. Session expiry displays a sign-in recovery action without sending the failed mutation again. Session events on window focus revalidate the boundary. Error messages never expose tokens or SMTP credentials. HTTP responses are not treated as email inbox evidence.

## Validation and secrets

Use `shared/validation.ts` with `.safeParse` on client and server. Validation runs on submit, maps field errors, marks aria-invalid, associates error/help IDs, and focuses the first invalid input. Forms have noValidate. Passwords have correct autocomplete, masked default, show/hide accessible labels and no copy/log/toast of values. Signup role is never editable. Reset token is read from the URL fragment, sent only in the POST body and removed from the displayed URL; no analytics run. Password requirements exactly match the brief, including no added digit requirement.

## Verification

Required static commands are `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and the strict premium UI auditor. Browser checks cover populated, empty, error/retry, client validation, preserved input, direct navigation, keyboard focus, 390px/1440px widths and reduced motion. Root owns final gate evidence and records actual results in `docs/IMPLEMENTATION_STATUS.md`. A planned check is not a pass. Real email delivery remains separately blocked until observed or organizer-approved fallback.
