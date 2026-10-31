# Optional AI — implemented quotation suggestions

P9 implements one optional staff tool: request text becomes a reviewable proposal using existing catalog choices. The complete manual quotation workflow remains available without a model key. This adds no organizer requirement or demonstrated judging bonus.

The user explicitly approved reuse of the existing ignored `.env` key and a **$5 USD total allowance**, including controlled live evaluation. No new OpenAI credential was created. The implementation uses the exact approved **`gpt-4.1-mini`** model, with no silent substitution. Its [official model page](https://developers.openai.com/api/docs/models/gpt-4.1-mini) supports Responses and Structured Outputs and currently marks the model deprecated. A controlled model-availability lookup returned HTTP 200 on October 31, 2026. Availability is not a future guarantee.

The release owner's **three real synthetic generation calls passed**: the known request resolved through normal server preview to 312,000 minor units (3,120), followed by an explicit Draft save and safe replay; unsupported and ambiguous requests returned clarification with no proposed lines. No business record existed before the explicit save. Accounted usage was **1,075 micro-USD ($0.001075)**. The owner set the normal application's remaining allowance to **$4.998925**, keeping evaluation plus application within the approved $5 total and leaving the existing key unchanged. The implementation ledger and separate P9 live evidence own the detailed outcomes, token usage and measured latency.

## Human workflow and business authority

1. Admin or staff selects the customer in **New quotation**. Customers cannot call the suggestion/status APIs.
2. Staff describes synthetic product needs without personal information. The selected customer identity stays server-side; the model does not choose a customer.
3. One explicit request returns a structured suggestion: existing plan/template/product/variant IDs, quantities, an optional start date and at most five clarification questions. Unknown choices and ambiguous fields require manual resolution.
4. Staff reviews and explicitly applies fields. A template-only proposal loads that template's real stored lines through the normal form rather than inventing lines or mutating the template.
5. The ordinary server preview calculates all prices and estimates. Staff acknowledges that preview and explicitly saves **Draft** through the existing create operation.
6. Issue, confirm, activate, invoice, payment and email actions retain their ordinary separate authorization and controls. AI cannot execute any of them.

The model cannot supply authoritative prices, taxes, discounts, totals, customer identity, roles, status or executable commands. It has no tools, SQL, retrieval, shell or arbitrary URL access. Catalog names and user requests remain untrusted data. Output is rendered as text. Entered fields remain available after timeout, refusal, invalid output, budget exhaustion or offline failure; **Continue manually** removes AI binding without discarding the form.

For the standard example, two units of a 1,000 plan replacement price plus a 560 variant resolve to a **3,120 subtotal** through the normal calculator. A model response does not establish that amount. Quotation taxes remain estimates under the existing billing policy.

## Wire contract

[shared/ai-quote.ts](../shared/ai-quote.ts) and the [P9 API contract](API_CONTRACT.md#p9-optional-quotation-suggestions-implemented) are the authoritative schemas.

- Internal `GET /api/ai/quote-assist` reports enablement, reason, fixed model, budget strings and disclosure.
- Internal `POST /api/ai/quote-proposals` accepts only `{customerId,request}` and returns a bound proposal plus allowlisted display labels. It creates no subscription, invoice or payment.
- Proposal fields are `schema_version="quote-proposal-v1"`, nullable `template_id`, nullable `plan_id`, `lines`, nullable `requested_start_date` and `clarifications`. Each line contains only `product_id`, nullable `variant_id` and an integer quantity from 1 to 10,000. At most ten lines and five 240-character clarifications are accepted. Additional properties, unknown IDs, cross-product variants, duplicate products and invalid dates/quantities are rejected.
- Normal `/subscriptions/preview` accepts optional `aiProposalId`; it returns an opaque `aiReview.reviewHash` after the normal calculation and proposal checks.
- Normal subscription creation accepts `aiProposalId` and `reviewHash` with its ordinary commercial input and UUID submission key. The opaque review receipt is bound to actor, customer, proposal, current calculated terms and expiry. Proposals expire after 15 minutes.

Editing fields requires a fresh preview and acknowledgement. Changing the customer invalidates the proposal. Current price or policy changes before a fresh save return `409 AI_REVIEW_CHANGED`; preserve the form, preview again and explicitly review. Archived/invalid choices fail normal validation. Generated line IDs are excluded from the financial comparison, while real commercial facts remain included.

Existing successful create-key replay is checked **before** AI expiry/review revalidation. Its actor/commercial-payload hash excludes AI review metadata, so a lost-response retry with unchanged terms returns the same Draft even if another preview issued a new review receipt. A changed commercial payload still conflicts. There is no separate autonomous save endpoint.

## Provider, context and privacy boundaries

The server calls the REST Responses API once with fixed model, `store:false`, `tools:[]` and strict `text.format` JSON Schema. See [official Structured Outputs guidance](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses). Refusal, incomplete/truncated responses, malformed output and unavailable service produce manual fallback, without repair loops or hidden retries.

Only explicitly selected catalog columns are sent: IDs, names, product types, catalog versions, primary-product relationships, cadence, minimum quantity, availability and template validity metadata. Server-supplied customer IDs/names/emails, selling/cost prices, variant price adjustments, internal notes, addresses and payment history are excluded. Email-like request text and the selected customer's name are rejected; this is not a general personal-data detector. Staff must use synthetic needs and avoid personal information in free text or catalog names.

Context is a bounded name/ID-ordered subset: at most **20 active plans, 30 active products, 100 active variants and 20 active templates**. Plans whose primary product is outside the chosen product subset, and templates outside the resulting plan subset, are omitted. Variants outside selected products are not sent. A large catalog can therefore omit an otherwise valid selection; the manual form remains the complete path. No full-database transmission is attempted.

Request text is limited to 1,000 characters. Instructions plus request/catalog are bounded to **20 KiB UTF-8**; the complete request JSON is bounded to **24 KiB**. Output is limited to **800 tokens**. One deadline of at most **eight seconds** covers the provider response, with no automatic retry. A timeout cannot prove that no provider usage occurred.

`store:false` is used without claiming zero retention: provider abuse-monitoring and endpoint-specific data controls remain separate. See [official data controls](https://developers.openai.com/api/docs/guides/your-data). Operational audit stores actor, request correlation ID, a catalog-version digest, outcome, latency and aggregate token usage, not raw prompts, secrets or raw provider diagnostics. Bound proposals/review receipts and the spending ledger persist in the application SQLite database; expiry prevents reuse rather than promising immediate physical deletion.

## Approved enablement and persisted spending limit

The feature defaults off. An authorized normal-server setup requires all three server-only settings:

```dotenv
OPENAI_API_KEY=
AI_QUOTE_ENABLED=true
AI_QUOTE_BUDGET_USD=4.998925
```

The blank key above is documentation only; reuse the existing private value and never paste it into chat or a client variable. Preserve the current remaining allowance rather than resetting it to $5 after evaluation. `.env.example` uses disabled/zero defaults. Missing key, missing/nonpositive allowance, allowance above $5 or insufficient reserved capacity keeps AI unavailable. No model/account access is required by the mandatory product.

The **database-wide** allowance is shared atomically across actors using that one application database. Before dispatch, an immediate transaction reserves **20,000 micro-USD ($0.02)**. Integer accounting uses the verified current prices of **$0.40 per million input tokens and $1.60 per million output tokens**; known usage charges `ceil((inputTokens*2 + outputTokens*8)/5)` micro-USD. Cached-input discounts are not assumed. The bounded request/output make the reservation conservative for this fixed model.

Timeouts, unknown usage, provider/network failures without trustworthy usage and abandoned in-flight claims retain the full reserve. A process restart does not reset committed usage. New requests stop when another full reserve would exceed the configured allowance. The status endpoint shows the cap, committed allowance and remaining amount; a remaining balance below $0.02 cannot admit another call.

Each user has at most **one in-flight request** and **five requests per 15 minutes**. There is **no separate global rate limit**. Persistence is scoped to one SQLite database, not the OpenAI project or arbitrary independent databases. Do not clone/reset the ledger or enable multiple databases to extend the approval. The owner accounts for controlled evaluation usage within the same approved $5 total; actual evaluation/accounting results belong in the separate live evidence.

## Verification and limits

The stub-only focused suite passed **11 tests**, including privacy of outbound context; no business writes before human save; the deterministic 3,120 example; disabled/missing/invalid configuration; unauthorized callers and personal-data rejection; invented IDs/money and invalid quantities; unresolved choices; timeout/network/refusal/truncation fallback; actor/customer/expiry and price-change guards; same-commercial create replay; persisted allowance contention across independent app connections; and one in-flight request per actor. Subscription and migration regressions also passed. Independent review found no concrete budget or authority defect.

The release owner reported **30 actual browser journeys passing in 50.3 seconds**, including the assisted/manual workflow. Browser AI tests inject a synthetic provider; they never load `.env` or make live model calls. The separate three-call live witness above is real, while its detailed charges and latency belong to the owner-recorded evidence rather than the stub tests.

The feature is on demand and separate from page rendering, invoice generation, payments and finance queries. P8 measurements describe their recorded build and scope; adding optional AI does not establish a new all-page latency result. No productivity gain, security certification, production capacity or judging benefit is claimed. Manual quotation entry remains the supported complete workflow whenever the optional service is unavailable.
