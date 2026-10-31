# SubTrack

Brightloop Software's subscription operations workspace. The supplied four-page brief and `docs/REQUIREMENTS.md` are authoritative. The intended connected journey is configure → quote → activate → bill → collect → understand, driven by persisted records rather than sample dashboard values.

## People and scene

Administrators configure the business and add staff. Internal staff handle agreements, invoices and collection. Customers access only their own records and plan-permitted actions. The product is used repeatedly at a desk for precise operational work and on narrow screens for record checks. The UI is English, with INR and Asia/Kolkata business dates under adopted implementation defaults. No Japan-market scope is established.

## Current surface

P0 proves reproducible local database startup; P1 establishes identity and authorization. Later workflow pages must wait for their gates. No decorative data, invented revenue, or implied completed billing capability is permitted. Root's current instruction is to execute the roadmap autonomously; all domain defaults come from `docs/DECISIONS.md`.

## Success and constraints

Make the next permitted action clear, explain amounts and states, preserve entered data on failure, and support direct navigation. Respect server ownership, never expose internal costs in customer payloads, and never present local message generation as inbox delivery. The product must run locally without a model API.

## Design brief

Operate mode: clear, deliberate and calm enough for daily financial work. Use restrained cool blue, precise ink typography and white working surfaces. A continuous agreement trail can become the product signature across the accepted-term and billing journey. This direction is inferred from the supplied operational brief; no pre-existing visual identity or customer research is claimed.
