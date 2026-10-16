# Maintaining Travel

Travel is an included Ri app. These rules keep it correct and safe to change.

## Layout

- `src/actions.ts` defines every action and exports `definition`, `initialize` and `shutdown`. Importing it must not open the database or do I/O, because the build imports it to generate `contract.json`.
- `src/actions/schemas.ts` holds strict input and output schemas. `src/actions/examples.ts` holds fictional examples that the build validates.
- `src/domain/` is pure: time (`clock.ts`), places and zones (`places.ts`), effective bookings with corrections (`booking.ts`), itinerary (`itinerary.ts`), coverage and gaps (`coverage.ts`), matching (`match.ts`) and deterministic extraction (`parse/`).
- `src/db/` holds forward migrations and row access. `src/services/` holds ingestion, sync, imports, writes, follow-ups, sources and the read model.
- `src/view/` is the React view. It may import only `@ri/app-kit/ui`, `@ri/app-kit/time` and type-only imports from the schemas.
- `src/fixtures/` holds fictional messages and the preview seed.

## Rules

- Migrations are forward only. Never edit an applied migration. Append a new one.
- Policy defaults live in the query layer (`DEFAULT_SETTINGS`, `DEFAULT_HISTORY_DAYS`, initial booking status), never as SQL defaults.
- Filter by scope before assembling any list, search, count, snippet, export or context. Use `repo.bookings(scope, ...)`, `read.visibleTrip` and `reviewVisible`. Never return a record because it was named in input.
- Name a trip shown beside anything else (a booking, a review, an import preview or result, a history entry) with `read.tripTitle` or `read.tripHeading`, never `trip.title`. A caller who may see only some of a trip's bookings gets a projection built from those bookings, the same one `get_trip` returns.
- Review reasons are stored text that every reader of the item sees, so they never name another booking or trip. Candidates carry those, projected per reader. A trip move records trip IDs beside the names so history can be projected too.
- Write receipts are keyed to the caller's data access (`store.useAuthority` in `services/core.ts`). A retried write returns its first result only while that access is unchanged, and is refused after a scope narrows or is revoked.
- Never overwrite a person's correction from a source. Store the source value with `repo.setBase`, keep the override, and open a Review item.
- Never create a booking from a cancellation, and never cancel because a source disappeared.
- Keep local wall times, zones and instants separate. Use `@ri/app-kit/time` for zone math. Never turn a date into a midnight timestamp.
- Never sum or convert prices across currencies.
- Model output is untrusted. Validate it with a strict schema and keep only values backed by exact passages. It can never set grants, call capabilities or apply external writes.
- Background work runs one bounded step per call. No loops, timers or unbounded scans.
- Copy has no em or long dashes and avoids semicolons. No sparkle, magic wand or star cluster icons.

## Tests

`pnpm --filter ri-travel test` runs domain, workflow, scope, sync, contract and the packaged view tests. The packaged view test needs `pnpm --filter ri-travel package` first and a Chrome install, and saves screenshots to `artifacts/`. All data is fictional.
