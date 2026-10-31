# Odoo hackathon research: Subscription Management System

Research date: 31 October 2026. Scope: public organizer material and first-person historical participant accounts. This is research and ideation, not a substitute for the current problem statement or judging instructions.

## Executive finding

The title **Subscription Management System** has appeared in previous Odoo partner hackathons. Those accounts describe an ERP-style recurring-revenue system, not simply a personal tracker for Netflix and Spotify spending. They provide useful domain clues, but the current full statement remains authoritative.

Historical winners and finalists emphasize data modeling, lifecycle transitions, transactional correctness, and the ability to explain implementation decisions. This supports prioritizing a working, understandable business workflow over decorative complexity. It does not prove that a specific feature causes a win.

## Current-event evidence and uncertainty

The likely matching event is [Odoo x Make-A-Ton 9.0 Kochi Hackathon 2026](https://hackathon.odoo.com/event/odoo-x-make-a-ton-9-0-kochi-hackathon-2026-40/register), also promoted by [Make-A-Ton](https://www.makeaton.in/).

The Odoo registration page specifies:

- An **8-hour virtual round on 31 October 2026, 9 am–5 pm**. Its timeline does not explicitly state the timezone; confirm timing against the organizer's current instructions rather than assuming.
- Results on 19 November and a **24-hour final on 19–20 December**, with different surprise problem statements.
- Dynamic data rather than static JSON beyond prototypes; consistent responsive UI; robust input validation; intuitive navigation; meaningful Git participation by the team.
- Encouragement for backend APIs, data modeling, a local database, understanding AI-assisted code, local/offline resilience, and technology chosen for actual value.

The generic “About Challenge” description calls the event a 24-hour marathon. That should not override the specific eight-hour virtual-round schedule.

**No numeric weighted rubric was visible on this registration page.** The linked [participant documentation folder](https://drive.google.com/drive/folders/1vVv97oF6wPrljV9c6j1eBa09kcA_H3hd) was not readable through the research browser's text extraction. Do not present another Odoo edition's weighting as confirmed for this one.

The page permits all programming languages. It does not establish that an Odoo module is compulsory. Recheck the actual statement before selecting a stack or integration strategy.

## Historical evidence ledger

### Odoo x SNS, Coimbatore: 7–8 February 2026

**Organizer confirmation:** [SNS institutional announcement](https://snsce.ac.in/newsroom_6_35539/) confirms the 24-hour final at SNS College of Technology on 7–8 February 2026. The announcement is dated 4 February 2026.

**Second-place team account:** [Anurag Rao U, Team A^4](https://www.linkedin.com/posts/anurag-rao-u_thrilled-to-announce-that-team-a4-secured-activity-7429090123830665216-J4Ul) explicitly identifies the problem as Subscription Management System. The author reports:

- Designing the database before implementing backend and frontend modules.
- Invoices and payments, subscription orders and renewals, scheduled jobs, and email functionality.
- Three technical evaluation rounds.
- Architecture questions, including the choice of UUIDs versus auto-incrementing primary keys.
- Advancing to the top-eight presentations and placing second.

**Evidence classification:** first-person participant account, not an official scoring sheet. This does not make UUIDs preferable: the lesson is to justify a suitable choice.

**Winner account:** [Gnaneswar Lopinti](https://www.linkedin.com/posts/gnaneswar-lopinti-5bb480109_odoohackathon-odooxsns26-kluniversity-activity-7426586808886681600-G2-F) reports winning solo. His account stresses strong data models, clear state transitions, transactional workflows, and architectural decisions under changing conditions, rather than flashy demonstrations.

**Evidence classification:** winner's retrospective. It supports an engineering-focused interpretation but does not reveal scores, a complete implementation, or causal proof about why the project won.

### Odoo x Indus University: 4–5 April 2026

**Organizer source:** [Indus University event page](https://indusuni.ac.in/hackathon2k26/index.html) confirms the April final and a separate eight-hour qualifier. Its rules require work developed during the event, attribution for libraries/APIs, and timely submission. It lists innovation, feasibility, technical implementation, and presentation quality as judging considerations. These are this historical edition's rules, not automatically the current rules.

**Exact-title participant account:** [Madhav Bhayani, RecurIN](https://www.linkedin.com/posts/madhavbhayani_hackathon-odoo-indushackathon2026-activity-7447884779561218048-6sPj) describes Subscription Management System as a recurring-billing platform covering products, plans, subscriptions, invoices, payments, taxes, discounts, and analytics. He reports using React, Go, and PostgreSQL, implementing a payment-provider sandbox, and addressing a challenge requiring 500 constraint-valid records per table with API and interface pagination.

The author explicitly says the team **did not win**. Do not portray RecurIN as a winning submission, or its two reported challenges as present requirements.

## What to borrow, and what not to borrow

### Reasonable strategic inferences

1. **Prefer a real business workflow over disconnected CRUD screens.** Show how a configured plan produces a subscription, an invoice, a payment, and a later renewal.
2. **Make state transitions explicit.** A system should reject an invalid transition on the server, not merely hide a button.
3. **Keep financial history stable.** Invoice line snapshots should preserve agreed prices and taxes when product configuration changes later.
4. **Make recurring work safe to retry.** Repeating a renewal operation should not issue duplicate invoices.
5. **Demonstrate data integrity.** Relationships, uniqueness rules, indexes, and validation should have clear business reasons.
6. **Explain each architectural choice.** Team members should understand their implementation and the boundaries of AI assistance.
7. **Use real derived metrics.** A dashboard should distinguish billed amounts, payments received, unpaid invoices, and recurring-revenue measures rather than interchange them.
8. **Prepare for inspection, not only presentation.** A judge should be able to change data and observe persisted, consistent results.

### Unsupported conclusions to avoid

- “Every Odoo hackathon has the same rubric.”
- “Today's task requires all modules implemented by a previous 24-hour finalist.”
- “A particular database, framework, UUID scheme, or payment provider guarantees a higher score.”
- “The current title alone proves the exact lifecycle, roles, taxes, or billing rules required.”
- “Previous participants' payment sandbox and bulk-data challenges will recur today.”
- “A self-described winning feature caused the placement.”

## A focused demonstration concept

Subject to the full statement, a strong differentiator is an **explainable subscription lifecycle**:

- Create a subscription from an actual configured plan.
- Show an invoice calculation breakdown and the policy behind it.
- Record payment through the supported, honestly labeled mechanism.
- Display the subscription's audit/history timeline.
- In an isolated demonstration mode, advance a controllable billing clock to trigger a renewal.
- Repeat the renewal operation to demonstrate duplicate protection.
- Show updated persisted metrics and a rejected unauthorized action.

A demo clock is a testing tool, not proof that production scheduling has run. A sandbox payment is not a live payment. Keep those distinctions visible.

## Research-to-build gate

Before implementing, reconcile this document with the current full problem statement and organizer rules:

- Required roles and role permissions.
- Exact subscription and invoice states.
- Recurrence, renewal, cancellation, and payment semantics.
- Tax, discount, rounding, and pricing order if specified.
- Required screens, reports, integrations, and submission artifacts.
- Current evaluation weights, if published.
- Current AI-assistance, originality, and external-service rules.
- Submission deadline and timezone.

Treat any conflict as a reason to update the plan, not to force the current task into a historical template.
