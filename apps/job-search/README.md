# Job Search

Job Search keeps the description, correspondence, submitted materials, interviews and next action for every opportunity together, from saving a posting to preparing for its interview. It is a Ri included app (`ri-job-search`): a native Node backend on Node SQLite and one sandboxed React view.

## What it does

- **Today**: upcoming interviews in their own time zones, invitations to choose times, deadlines you set, responses waiting for a decision and clearly labeled follow-up suggestions. No scores. A quiet application is never treated as a rejection or given an invented deadline.
- **Opportunities**: a board (Saved, Applied, Interviewing, Offer) and a table over the same records, with search by company or role, a stage filter and Active, Closed (rejected, withdrawn, accepted) and Archived views. Move to stage is a keyboard menu. Dragging cards is optional. Narrow frames show stage sections or row cards, never a sideways scrolling board.
- **Opportunity workspace**: overview, every saved posting snapshot, correspondence with the reason each message matched, recorded submissions with their exact material versions, interviews with full history, stage history and Ri follow-ups.
- **Interview preparation**: requirements quoted from the posting snapshot, your own examples, questions and notes saved with revisions, and AI suggestions kept in their own labeled list with their evidence. Without AI the workspace stays fully usable.
- **Materials**: résumés and cover letters as immutable versions. Editing v3 saves v4 with a parent link and content digest, and an application recorded with v3 keeps pointing at v3. Versions can be compared line by line.
- **Sources**: matching review, connected accounts, coverage and sync state, imported files, chats with access and a personal export.

## Inputs

| Input | Use |
| --- | --- |
| Pasted text | A job description, résumé or cover letter. |
| PDF, Word, text, Markdown or HTML file (up to 512 KB) | Read through Ri's `extract_text` capability. The original file is kept beside the extracted text. |
| A link | Stored as written, never fetched. "Add the description to prepare with this role" until a description is added. |
| CSV of opportunities | Company and title or role columns are required. Status, link, location, applied date and notes are optional. |
| Gmail (read only) | Application, recruiter, interview and offer mail within the chosen window (30, 90 or 365 days, 90 by default), received and sent, so your own applications appear. |
| Google Calendar (read only, chosen separately) | Events on the chosen calendars that match a saved role become interviews with participants and original time zone. |

Nothing is ever sent, applied for, booked or written to a calendar. Follow-ups create a Ri task only after confirmation.

## Stage and matching rules

- Saving a posting creates a Saved opportunity and an immutable posting snapshot (SHA-256 digest). A changed description becomes a new snapshot, and preparation keeps citing the one it was built from.
- An exact or strong application acknowledgment moves Saved to Applied. A weaker match only suggests it.
- An invitation to choose times is "Scheduling needed", not an interview.
- A confirmed time (calendar event, invitation file, or a time stated with its zone) creates or updates the interview. Reschedules and cancellations update the same interview and keep its history. A canceled or deleted meeting never closes the application.
- Offers and rejections change the stage only on an exact or strong match. Ambiguous messages, and messages naming two of your roles, go to review with every candidate, the evidence for each and an Ignore choice. Related messages in one thread share one review item.
- A company domain alone never attaches a message to one of several roles at that company. Identity comes from the thread, replies, invitation IDs, requisition IDs, posting links, explicit role titles and known contacts.
- A stage you set is a correction. It stays, and later automatic changes that disagree are held for your review until you accept one or turn automatic updates back on. Every change is recorded with its author or source, confidence and decision.
- Compensation is stored exactly as stated, in integer minor units with currency, period and qualifiers such as base or total. Annual and hourly amounts are never converted into each other.

## Actions

Domain: `list_opportunities`, `get_opportunity`, `save_opportunity`, `change_stage`, `set_stage_tracking`, `get_posting`, `record_submission`, `list_interviews`, `save_interview`, `list_materials`, `get_material`, `save_material_version`, `compare_material_versions`, `archive_material`, `get_preparation`, `save_preparation`, `suggest_preparation`, `list_review`, `resolve_match`, `get_correspondence`, `get_today`.

Common: `open_view`, `describe_view_context`, `create_scope`, `list_scopes`, `revoke_scope`, `list_sources`, `set_source`, `list_source_calendars`, `preview_source`, `continue_import`, `delete_source_data`, `run_background_step`, `sync_step`, `enrich_step`, `preview_import`, `apply_import`, `list_imports`, `delete_import`, `create_follow_up`, `list_follow_ups`, `export_records`.

Reads are paginated (limit 50 by default, 100 at most) and filtered by the caller's scope before anything is assembled. Writes take the revision they edited and a durable invocation ID, so a retry returns the first result. `contract.json` is generated from the action definitions by packaging. Do not edit it by hand.

## Access

The owner's view sees everything. A chat sees only the collections and accounts its scope names: "Saved jobs, interviews and preparation" (`manual`), "Résumés and other materials" (`materials`) and each account (`account:<connection>`). A stage, next event, last activity or count that a chat sees is computed only from sources it may see. Contacts learned from an account appear only to readers of that account. AI preparation suggestions appear only to readers of every source the model was given for that run, whatever the suggestion cites. A repeated write is answered from its saved result only while the caller's sources are unchanged. A chat with no scope is refused. The schedule sees only its automatically updated accounts.

## Limits

- One provider page and at most ten new message bodies per background step, stopping before 20 seconds. The schedule runs one step every five minutes. Continue import runs the same step on request.
- Posting and material text up to 200,000 characters, files up to 512 KB, chat context up to 16 KB, view context selections up to 50 records.
- AI is used only through Ri's bounded `ai_text`: preparation suggestions on request and a closer reading of up to three job emails per step that the rules could not classify. AI readings only ever suggest. When AI is unavailable the app says "Extraction unavailable" and everything else keeps working.

## Qualification

All tests use synthetic, fictional data and fake capabilities: fictional companies, people, mailboxes and calendars. This package has not been qualified against live Gmail or Google Calendar accounts. Live provider qualification is a separate step with owner-authorized accounts. The preview shown by Try is seeded with the same fictional records and marked as fictional.

## Development

```
pnpm --filter ri-job-search typecheck
pnpm --filter ri-job-search test
pnpm --filter ri-job-search package
```

Packaging builds the portable artifact into `release/local-apps/dev-catalog/ri-job-search.tar.gz` and refreshes `contract.json`. The packaged view test drives the built `dist/ui.html` in a real headless Chrome and writes screenshots to `artifacts/`.
