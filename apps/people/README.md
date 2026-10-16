# People

Your relationships, conversations and follow-ups in one place.

People is a lightweight personal and professional relationship app for Ri. It works with twenty important contacts or thousands of professional ones, with one set of records and no setup decisions. It starts with people, conversations and meetings. Companies, saved views, lists and small opportunity pipelines grow the same experience when they help.

## What it does

- **Today** shows upcoming meetings, chosen follow-ups, what you are waiting on, chosen keep-in-touch reminders and a short sourced review queue. When nothing needs attention it says so.
- **People** is a fast directory with saved views, structured filters, sortable columns, a views picker, lists and selection of up to 50 loaded records for pin, list and archive changes.
- **A person** has a header with sourced role and company, last direct exchange and next meeting, a briefing ("Before you meet"), relationship context with evidence, a timeline of emails, meetings, notes and your changes, private notes, and details with corrections.
- **Companies** (internally organizations, so nonprofits, communities, funds and schools fit) show current, former and date-uncertain people, explicitly linked activity (one row per thread), commitments from linked conversations, opportunities and notes.
- **Follow-ups** separates I owe, Waiting on and Suggestions. Suggestions are labeled and never become commitments or tasks until you choose. Create follow-up makes exactly one Ri task, even on retry.
- **Pipelines** are optional and hidden until you add them: named stages with stable IDs, opportunities linked to people or companies, append-only stage history, an optional value in integer minor units with an explicit currency, a board and list, and a Move to stage menu as the keyboard path.
- **Sources** keeps account access, automatic updates, history range, coverage, imports, the separate Extract relationship context switch, identity review, excluded senders, collections and export together.

Add view and Hide view only change navigation. They never delete records, change grants or stop sync.

## Inputs

| Input | Use | Boundary |
| --- | --- | --- |
| Gmail (selected accounts) | People you correspond with, direct exchanges, evidence passages | Read only. Sent mail, confirmed direct replies and small meetings create people. Bulk, list and no-reply mail is left out by headers before anything else. Nothing is sent or changed. |
| Google Calendar | Meetings with participants, organizer, recurrence, time zone and cancellations | Meetings with you plus at most eight other non-resource attendees create people. Larger events are counted and can be included. Events never imply attendance: they read "Meeting scheduled" or "Past calendar event" until you confirm. |
| CSV | People, company, role, notes, lists, external IDs | Previewed before apply. Unmapped columns are kept. |
| vCard 2.1 to 4.0 | People, company, role, notes, categories | Previewed before apply. |
| LinkedIn connections export | Connections with available company, role and profile URL | A user-imported snapshot. Missing email is normal. Roles keep the export date. No live LinkedIn access. |
| Ri tasks | Follow-ups | One task per follow-up with a durable operation ID. Ri owns task status. |
| Ri bounded AI (`ai_text`) | Optional relationship extraction and generated briefings | Off until you enable it, separate from sync. With it off or unavailable, no AI call happens anywhere. |

Accounts are read in bounded steps by Ri's single five-minute schedule: one provider page and at most ten new messages per step, current changes before history, and fair rotation between accounts. History is limited to 30, 90 or 365 days (90 by default).

## Identity rules

- Email addresses are trimmed and only the domain is lower-cased. Dots and plus suffixes are never removed. Aliases are explicit.
- An exact address joins its existing person unless it is a shared inbox. Shared role mailboxes such as support@ are never a person.
- A shared name, company name or domain only proposes a review. Nothing merges automatically, and a pair you keep separate is never proposed again.
- An address seen in a signature proposes an alias with evidence.
- A personal mail provider's domain never implies a company. A calendar co-attendee never implies a relationship or employer.
- Your corrections win and survive resync, re-extraction and backup restore.
- Merges record every reference they move. Undo previews the restore, lists references added after the merge for you to place, and fails without changes if anything moved since the preview.

## Privacy and access

Every query, search, count, sort key, snippet, briefing and export is filtered by the caller's sources before results are assembled. Sources are connected accounts (`account:<connection>`), your collections (`manual`, `collection:<id>`) and imports (`import:<id>`). A chat sees only the sources the owner chose for it, with read or read and write. Generated briefings are cached by exact scope and evidence revisions, so an owner briefing never reaches a narrower chat. Ri's schedule generates briefings only from the accounts it was granted, and Prepare briefing runs your own step at once. An opportunity is visible to a chat only when the chat may see both the opportunity and its pipeline. Delete imported data removes a source's conversations, stored text, observed identities, facts, suggestions and search rows while keeping your notes and decisions. Export produces CSV and JSON with stable IDs and a format version. It never includes message bodies and is not a full backup.

## Limits

- Lists return 50 rows by default and at most 100. Selection and bulk changes cover at most 50 loaded records.
- Imported files up to 512 KiB and 5,000 rows.
- Context for chat is at most 20 facts or commitments and 20 interaction references, within 16 KiB.
- AI prompts are at most 16,000 characters, mark source text as untrusted, and results are checked against a strict format with exact passages.

Measured on the synthetic release volume (10,000 people, 1,000 companies, 100,000 interactions) in a temporary database: repeated list, search and detail calls stayed far under the 300 ms p95 target. See `test/performance.test.ts`, which writes its numbers to `artifacts/performance.json`.

## Qualification

All tests use fictional people and fake connector, task and AI capabilities. Nothing here is evidence of live Gmail, Calendar, LinkedIn or AI behavior. Live provider qualification is a separate step with owner-authorized accounts.

## Development

From the repository root:

```sh
pnpm --filter ri-people typecheck
pnpm --filter ri-people test
pnpm --filter ri-people package
```

`package` builds the portable artifact into the dev catalog (`release/local-apps/dev-catalog/`) and regenerates `contract.json`. Do not edit `contract.json` by hand.

`test/view.packaged.test.ts` packages the app, imports the archive, runs it under the kit's AppEngine with fictional host capabilities and drives the built view in headless Chromium through the real AppViewController. It saves populated, empty, partial, dark, 1280, 760, 390 and 360 px screenshots and a 200% text size check to `artifacts/` (ignored). `PEOPLE_VIEW_OFFLINE=1` builds from source with the kit's offline builder instead, for use when packaging is unavailable.
