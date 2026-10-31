# P5 invoice communication proof

## Controlled SMTP

On 31 October 2026, `npm run verify:invoice` created one explicitly synthetic agreement and Confirmed invoice through the real authenticated local API, then queued one test notice using the invoice's saved registered customer address. The approved SMTP account and exact recipient allowlist were already configured by the user. No real payment was requested or recorded.

- Invoice: `INV-000001` in the local controlled-delivery fixture.
- Outbox message: `cbd7c0da-0ff7-45fd-8610-fadd862390b5`.
- Observed result: **SMTP accepted**, no delivery error.
- Actual registered-inbox receipt: **Verified by the integration owner in the approved recipient's existing Gmail browser session.** The exact subject `TEST · SubTrack invoice INV-000001 · Confirmed` appeared in the Primary inbox, received **31 October 2026 at 12:57 PM IST**. A focused `in:inbox` subject search returned exactly one matching message carrying the Inbox label. This is recipient-inbox evidence, separately observed from SMTP acceptance. No user confirmation is inferred.

The saved `.env` default was `outbox`. Its settings were preserved. A temporary, tool-managed loopback server on port 3001 used process-only `MAIL_MODE=smtp`, `PORT=3001` and `APP_ORIGIN=http://localhost:3001` for the approved test. There were zero pending messages before starting. The proof server was stopped after acceptance. Credentials, addresses, private email bodies and reset tokens are excluded from this evidence and Git.

The connected Gmail account did not expose this test message, so it was not used as receipt evidence. The existing browser session at the recipient inbox supplied the witness. The agent-created tab was closed after the scoped check; no message was opened, replied to, forwarded, labeled or deleted, and no new login or access permission was created.

## Actual print renderer

`npm run verify:print` uses a fresh isolated SQLite database, seeded synthetic identities, authenticated real HTTP routes and Chromium's actual PDF renderer. It never loads `.env` or uses SMTP. It exercises the nonce-authorized Print button, checks escaped product markup, and generates three A4 PDFs in ignored `output/pdf/`:

- Draft: one page, exact **3,088.80** total, Draft/noncollectible label.
- Confirmed: one page, the same exact saved total and zero recorded payments.
- Maximum valid amount with 50 lines: seven pages, **1,000,000,000,000 minor units**, all 49 add-ons plus the primary line retained. Deliberate `<img ...>` product text stays text; no image or injected script is created.

Final generation: **2026-10-31 07:33:45 UTC**. `pdftoppm -scale-to 1600 -png` rendered all three PDFs. The integration owner inspected both typical documents and every edge-case page, then reinspected changed pages after corrections. Numeric columns and all page breaks are legible; no clipped or overlapping values remain. `pypdf` extraction independently confirmed all add-on labels, the maximum amount, Draft status, and both total and footnotes on the final page.

The first edge rendering wrapped the maximum amount's decimals onto a separate line and left a footnote-only final page. Adaptive compact money spans now retain that complete value, and the closing totals/footnote block stays together. The eight output tests, targeted lint and server typecheck passed again after these fixes. Normal invoice output remains unchanged.

Print is the browser's Print/Save as PDF path, not a claim that the server stores or emails a PDF attachment. Printing and sending do not alter financial settlement. New sends reject canceled/superseded invoices; historical print views remain available with their saved status. Customer ownership is enforced on the print route. Focused HTTP tests also cover idempotency conflicts, metadata-only delivery states, recipient override rejection, direct role denial, nonce CSP and immutable settlement.
