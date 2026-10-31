# Standing constraints for this hackathon

Updated 31 October 2026. These expectations were supplied directly in the current event screenshots and corroborated on the [official event page](https://hackathon.odoo.com/event/odoo-x-make-a-ton-9-0-kochi-hackathon-2026-40/register). They apply throughout planning, implementation, review and demonstration, even if the selected problem later changes.

## Required expectations and visible proof

| Expectation | Project interpretation | Evidence to demonstrate |
|---|---|---|
| Dynamic or real-time data; static JSON only during initial prototyping | Persist records in a real database and read them through backend APIs. Seed data is acceptable as clearly labelled initial data, not the final source of truth. | Create or change a subscription, refresh/reopen it, and show dependent lists/metrics change from persisted records. |
| Responsive, clean and consistent UI | One coherent visual system, usable forms/tables and clear loading, empty, success and error states. | Exercise the main journey on desktop and narrow screen without hidden actions or broken layouts. |
| Robust input validation | Validate in both client and server; enforce relational constraints and permission rules independently of UI visibility. | Invalid amount/date/state transition and unauthorized record access fail safely, without partial writes. |
| Intuitive navigation and spacing | Predictable menus, clear page titles, breadcrumbs where helpful and obvious next actions. | A reviewer can find customers, plans, subscriptions and invoices without verbal rescue. |
| Proper Git participation across the team | Every teammate contributes real work and understands their changes. | Genuine commits, reviews and explainable ownership. Never forge authorship, backdate commits or manufacture activity. |

Dynamic data does not automatically require external internet APIs or WebSockets. A local database-backed workflow can satisfy changing persisted data; use polling or live updates when they make the interface correct. Do not mislabel precomputed numbers as live metrics.

## Encouraged expectations

- Explain backend APIs, relational data modeling and local database setup.
- Understand, test and adapt AI-generated code. Each teammate must be able to defend the logic they present.
- Keep the core runnable locally; do not make a judging demo depend entirely on internet access, hosted authentication, model APIs or a payment provider.
- Use fashionable tools only when they solve a clear problem. An unrelated chatbot or elaborate infrastructure earns no assumed credit.

## Scope and honesty

Current activity is research and documentation only. No application implementation has been authorized in this workstream yet. The selected topic is **Subscription Management System**. The full four-page Brightloop Software brief has now been supplied; [REQUIREMENTS.md](REQUIREMENTS.md) is the authoritative domain checklist. The screenshot says problem statements are updated at 9 am and only the team leader selects/updates the choice. Do not change the team's selection.

The current event page describes an eight-hour virtual round and a separate 24-hour final. Confirm the team's actual timezone, deadline and submission instructions from its event materials. Historical Odoo rubrics and finalist feature lists are context, not current requirements. No numeric scoring weights have been verified for this round.

Use the supplied full brief to map every requirement to a screen, server operation, stored record and test/demo proof. Required functionality comes before optional differentiation. Preserve the exact requirement wording in that mapping.

Do not claim a simulation is a real payment, seeded records are customer activity, a planned benchmark has passed, or team members authored work they did not do. Demo clock and sandbox payment controls must be clearly labelled and call the same domain rules as the normal workflow.

## Review gate for every proposed feature

1. Which explicit requirement or useful business problem does it serve?
2. What persisted data and server-side behavior prove it works?
3. What can fail, and what does the user see then?
4. Can the team explain and demonstrate it locally?
5. Does it threaten completion of a required flow within the remaining time?
