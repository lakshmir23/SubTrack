# Controlled reset delivery witness

31 October 2026, local SubTrack build. The user supplied SMTP settings directly in ignored `.env` and explicitly authorized a test to the allowlisted recipient. No credentials were created, printed or committed.

`npm run verify:email` registered the approved test address through the normal persisted signup route if necessary, requested a reset through the normal HTTP endpoint and observed message `19eab82c-b522-497f-b1c5-e97424d683e8` become **accepted** by SMTP. The message subject was “Reset your SubTrack password”. This was a real controlled message, not a mocked transport or development outbox.

The user then confirmed **actual inbox arrival** and supplied received-inbox screenshots in chat. The images and reset link are private evidence; they are not copied into the repository. The visible link targeted the local application's reset route and stated its 30-minute validity and newest-link policy. SMTP acceptance and inbox receipt are separate observations.

Single-use, exact expiry, superseded-token rejection and session revocation are covered by `tests/reset.test.ts`; the real production-browser reset path uses an isolated synthetic outbox in `tests/e2e/identity.spec.ts`. Those automated tests do not send email. This witness proves controlled reset delivery; invoice delivery remains a separate P5 gate.
