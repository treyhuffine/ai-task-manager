# Travel

Travel turns plans, reservations and changes into one trip you can inspect and discuss with Ri. Open an upcoming trip to see what is booked, what is still an idea and what needs attention. It is an included Ri app (`ri-travel`) that runs as a local Node app with its own SQLite database inside its instance data folder.

## What it does

- **Trips**: upcoming and past trips with dates, the number of recorded reservations and one attention summary each. With one upcoming trip, Travel reopens it. With several, it reopens the last one you viewed or shows the list.
- **Trip**: an itinerary grouped by local date with a day rail, a dense Bookings table (filter by confirmed, planned, canceled or needs review, and search), and Ideas. Selecting a booking opens its inspector beside the itinerary at wide widths and as its own screen with Back when narrower.
- **Review**: reservations without a trip, changes and cancellations to confirm, possible duplicates and extracted details to check. Each compares recorded and proposed values with the source before anything changes.
- **Sources**: Gmail and Google Calendar accounts granted to Travel, imported files, history range, coverage, last update, pending and failed counts, pause, continue import, delete imported data, chats with access and Travel settings.

## Time

Every segment keeps the local wall time the provider wrote, the IANA zone when known and the resolved instant when it can be computed. Overnight journeys appear on both local dates with zone labels, such as departing Denver at 17:55 MST and arriving in Lisbon at 08:40 WET the next day. A hotel is a date span with an exclusive check-out date, never an hour block. All-day items use dates, never midnight timestamps. A time in a daylight saving gap moves forward and says so. A repeated hour uses the earlier occurrence and says so. A time without a zone has no instant, is placed by its local time and is marked, and it is never used for overlap arithmetic. The itinerary sorts by instant where known and by explicit local order otherwise, with a stable tie-breaker.

## Inputs

| Input | How it works |
| --- | --- |
| Gmail | Searches the chosen history window (30, 90 or 365 days, default 90) for confirmations from airlines, hotels, rail, car rental and booking platforms, and subjects such as confirmation, itinerary, reservation and booking. New mail is checked against its headers before a body is read. Search is a relevance filter, so an older or unusual booking may be missing. |
| Booking attachments | A PDF attachment with a likely booking name is read through Ri's `extract_text` only when the message body has no details. |
| Calendar invitations in mail | Used to fill zones and, when the text has nothing else, to suggest a booking for Review. |
| Google Calendar | Optional. Chosen calendars are read to show events while you are away. Nothing is written. |
| File | PDF (through Ri's `extract_text`), text, HTML and saved email files up to 512 KB, previewed before anything changes. The original file is kept with the booking. |
| Paste | Any confirmation text, previewed first. |
| Manual form | Flights, trains, stays, car rentals and activities. |

Extraction is deterministic first: flight numbers and airline codes, IATA airports, departure and arrival local times, booking references, traveler names, hotel names, addresses, check-in and check-out, car pick-up and return, train segments, activities and restaurants, in common English forms with Portuguese, Spanish, French and German month names. An optional AI fallback (off by default, in Sources) uses Ri's `ai_text` with a bounded prompt that marks the source as untrusted data, validates a strict schema and keeps a suggestion only when every value is supported by an exact passage. AI suggestions always wait in Review. When AI is unavailable, Travel shows Extraction unavailable and everything else keeps working. Invalid or partial extraction leaves a reviewable source, never a fabricated booking.

## Rules

- Grouping uses the source first (the same message, invitation or thread), then provider, reference, travelers and compatible dates. A booking reference alone is never a global ID. Several possible bookings, several travelers, a forwarded confirmation, a booking for someone else or overlapping trips go to Review.
- A matching exact provider confirmation updates the booking with a visible change record. Anything less certain, or any change to a field you corrected, waits in Review. Your correction stays in force until you choose.
- A cancellation needs matching reservation evidence. The booking stays in history and its nights become an itinerary gap.
- A message deleted upstream marks its source unavailable. It never cancels a booking.
- Gap checks are deterministic: nights with no stay or overnight journey within explicit trip dates, and overlapping timed bookings. A car rental counts only at pick-up and return. An uncovered night is a prompt to check and can be dismissed. The dismissal holds until the bookings around it change. Absence is described as "No booking recorded".
- Ideas never count as confirmed. Prices are integer minor units with their currency, never converted or added across currencies. Comparison shows known values and "Not provided" for the rest, with no ratings or rankings.
- Open directions opens the address in an external map through Ri. No map loads inside the view.

## Actions

Read: `list_trips`, `get_trip`, `list_bookings`, `get_booking`, `list_ideas`, `compare_ideas`, `list_review_items`, `list_follow_ups`, `get_evidence`, `export_trip` (owner only), `open_view`, `describe_view_context`, `list_sources`, `list_calendars`, `list_scopes`.

Write: `save_trip`, `save_booking`, `delete_booking`, `save_idea`, `review_change`, `dismiss_gap`, `create_follow_up`, `check_follow_up`, `preview_import`, `apply_import`, `setup_source`, `pause_source`, `delete_source_data`, `continue_import`, `create_scope`, `revoke_scope`, `save_settings`, `remember_view`.

Schedule: `run_background_step`, `sync_step`, `enrich_step`.

Source management, scope creation, review decisions, deletion and imports are owner only. Background steps are schedule only. Every list takes a cursor and limit and returns items, next cursor, coverage and revision. Every update takes the revision you edited and returns the current record on conflict.

## Data access

The owner's view sees everything. A chat sees only the accounts and collections the owner shared with it (`account:<connection>`, `manual` for trips, bookings and ideas you entered, and `imports` for files and pasted text), and only bookings whose contributing sources are all shared. A trip that came from an unshared source is shown only through the shared bookings in it, without its title or notes. The scheduled job reads only its own automatic accounts and reads no records. Context for a chat re-resolves every selected record under that chat's access.

## Limits

- One mail page and at most ten message bodies per step, within a 20 second budget. One calendar page per step. Enrichment reads at most three saved sources per step.
- Files up to 512 KB. Imported text is kept up to 64,000 characters. Previews expire after an hour.
- Microsoft accounts, live fares, flight status, maps, weather, booking or cancelling anything, shared editing and passport storage are not part of this release.

## Qualification

All tests use fictional people, providers, messages and fake Gmail, Calendar and Ri capabilities. They are not live provider qualification. The preview (Try) seeds fictional trips for Alex Rivera into its own empty database and reads no account.

Run from the repository root:

```sh
pnpm --filter ri-travel typecheck
pnpm --filter ri-travel test
pnpm --filter ri-travel package
```
