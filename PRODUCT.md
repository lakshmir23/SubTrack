# SubTrack

Brightloop Software's subscription operations workspace. The supplied four-page brief and `docs/REQUIREMENTS.md` are authoritative. The intended connected journey is configure → quote → activate → bill → collect → understand, driven by persisted records rather than sample dashboard values.

## People and scene

Administrators configure the business and add staff. Internal staff handle agreements, invoices and collection. Customers access only their own records and plan-permitted actions. The product is used repeatedly at a desk for precise operational work and on narrow screens for record checks. The UI is English, with INR and Asia/Kolkata business dates under adopted implementation defaults. No Japan-market scope is established.

## Current surface

P0–P3 establish reproducible local persistence, role-separated identity, configuration and the Draft → Quotation → Confirmed → Active agreement journey. P4 adds first-period invoice preview/generation, frozen commercial detail, confirmation/cancellation and bounded discount configuration. Each gate is verified before the next begins. Batch billing, delivery/print and collection wait for their gates. No decorative data or invented revenue is permitted. Root's instruction is to execute the roadmap autonomously; all domain defaults come from `docs/DECISIONS.md`.

## Success and constraints

Make the next permitted action clear, explain amounts and states, preserve entered data on failure, and support direct navigation. Respect server ownership, never expose internal costs in customer payloads, and never present local message generation as inbox delivery. The product must run locally without a model API.

## Design brief

Operate mode: clear, deliberate and calm enough for daily financial work. An ink navigation rail, confident blue action, strong Manrope document references and white commercial sheets give the billing desk its character. The continuous agreement trail connects stage, calculation and dated activity with one shared geometry. This direction follows the operational brief and the user's request for a more distinctive, polished frontend; no pre-existing visual identity or customer research is claimed.
