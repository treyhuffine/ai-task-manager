# App opportunities for Ri

October 15, 2026. These are product hypotheses for choosing another included app, not validated market-size claims or an implementation queue. Health is parked until an acceptable automatic Apple Health path is demonstrated. See [Health feasibility](health-app-discovery.md).

## Selection criteria

A strong Ri app combines records a person already has, a recurring question or consequential decision, and a visual workspace that helps them act. It should deliver useful value before the person builds a new organizational system. Conversations update or interrogate durable domain records, while ordinary tasks and notes remain in Ri's existing surfaces.

Favor a narrow first workflow with usable inputs, clear provenance and a complete outcome. The existing app host, scoped capabilities, MCP Apps views and chat handoff are reusable. A provider appearing in the connector catalog does not establish that its exact actions are implemented or qualified for a new app. Keep manual file inputs useful while qualifying the first connection.

## Candidate experiences

Travel, Job Search and Relationships now have separate implementation proposals with visual concepts: [Travel](travel-app-spec.md), [Job Search](job-search-app-spec.md) and [People](people-app-spec.md). Their [shared foundation](included-apps-foundation.md) defines the reusable Ri seams and remaining connector work. These are specs, not implemented apps. People is the suggested first build among these three, based on its recurring meeting and follow-up workflow.

| App | Likely audience | Experience worth returning to | Feasible first version | Main constraint |
| --- | --- | --- | --- | --- |
| Purchases | People who buy online and manage household purchases | An order becomes a durable record with its receipt, delivery updates, return evidence and warranty documents. Ask "Can I still return this?" or find the receipt years later. | Selected Gmail connection plus uploaded receipts, a purchase timeline, source-linked dates and explicit corrections. | Merchant formats vary. Show uncertain or missing deadlines rather than inventing them. Live tracking and return submission require additional integrations. |
| Client Work | Freelancers, consultants and small agencies | For each client, see agreed scope, decisions, commitments, deliverables and billing evidence. Ask "What did I promise, and what is ready to invoice?" | Contracts, selected email and manual invoice records, linked to existing Ri tasks. | Distinguish agreed scope from proposals and inferred commitments. Integrate accounting systems without creating a competing ledger. |
| Research | Researchers, analysts, students and writers | A question-centered collection of sources with comparison tables, evidence links and unresolved disagreements. Ask "Which sources support this claim?" | PDFs, links and bibliographic imports with source passages and reviewable evidence tables. | Reliable citations, document versions and access to full text matter more than generating fluent summaries. |
| Travel | Occasional and frequent travelers | Reservations become a coherent itinerary with documents, local times, gaps and changes. Ask "What is still missing for this trip?" | Confirmation emails, uploaded documents and a day-by-day itinerary. | Value is episodic. Live disruption alerts, maps, prices and booking actions are separate provider dependencies. |
| Job Search | People actively seeking a role | Each opportunity retains the job description, correspondence, tailored materials, interview preparation and next action. | User-saved postings, email and files, with a pipeline and interview timeline. | Avoid promising universal job-board access or automatic applications. A saved description must remain available after the listing disappears. |
| People | Individuals, founders and independent professionals | A lightweight CRM starts with relationship context and follow-through, then expands to company workspaces, saved lists and optional opportunity pipelines. | Selected email/calendar records, manual people/companies, dated affiliations and sourced commitments, using Ri's own SQLite and bounded AI work. | Keep the default experience simple. Optional CRM views must preserve the same records, scoped evidence and correction history. No gbrain runtime dependency. |
| Home Projects | Homeowners and people undertaking renovations | Compare quotes by scope, track decisions and costs, and keep photos, manuals and warranties associated with the finished work. | Uploaded quotes and documents, comparison tables and a project timeline linked to Ri tasks. | Missing exclusions and mismatched quote scopes must stay visible. Avoid adding broad contractor or smart-home integrations to the first version. |

## Strongest next candidates

Purchases is the strongest candidate for broad everyday appeal. It can turn information already arriving in an inbox into a useful record with little setup. Its core product is ownership and follow-through on a purchase. Finances retains its responsibility for accounts, transactions and budgets. If they later exchange references, each app should use explicit public actions and grants.

Client Work is the strongest candidate for frequent professional value. Its payoff can be concrete: an uncovered scope change, an overlooked commitment or work ready for billing. It should use Ri's existing tasks for execution and its own client records for context. An initial audience of solo consultants would keep the workflow coherent.

Research is the strongest candidate for demonstrating the benefit of combining visuals with conversation. A stable evidence table or source comparison can be more useful than repeatedly rebuilding an answer in chat. The initial workflow should complete one real research question with inspectable sources.

Travel and Job Search have clear, approachable stories and concentrated periods of high value. People could become a frequently used personal or professional CRM, with companies and optional pipelines growing from the same relationship records. It depends on good matching, useful sourced context and a low correction burden. Home Projects is a narrower, consequential workflow with useful file-based inputs.

## Existing products and integration evidence

These categories already have specialist products. Their existence establishes competitive context, not demand for Ri's version. The proposed advantage is reduced upkeep through connected context and actions that flow into the person's existing Ri work.

TripIt already builds itineraries from confirmation emails and supports trip documents. A Ri travel app would need value beyond collecting reservations, such as reasoning about the plan and carrying the resulting actions into Ri. [TripIt](https://www.tripit.com/web/free)

Huntr already combines application tracking, tailored materials and interview preparation. A Ri job-search app would need to make existing correspondence and documents easier to keep current, with less repeated setup. [Huntr dashboard](https://help.huntr.co/en/articles/10393367-your-huntr-dashboard)

Bonsai documents project, time and invoice workflows, along with an API and an MCP server. For users already on a suitable system, an integrated Ri workspace may be preferable to rebuilding the system's records. These are possible integrations, not claims of current Ri support. [Bonsai projects](https://help.hellobonsai.com/en/articles/12783206-all-about-projects), [API](https://docs.hellobonsai.com/api), [MCP](https://docs.hellobonsai.com/)

Zotero documents APIs for items, full text and synchronization. It offers a concrete possible source for Research, alongside ordinary files and exports. A Zotero adapter still needs implementation and testing. [Zotero API](https://www.zotero.org/support/dev/web_api/v3/)

## How to choose

Choose one target user and one complete recurring workflow. Test it against realistic records and measure whether it reduces the user's work, produces trustworthy outputs and remains useful after the first demo. Build the smallest full loop that answers a valuable question and helps the person act. Extract shared components only when another app demonstrates the same need.
