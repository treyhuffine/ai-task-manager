# Maintaining Job Search

This is the source of the Ri included app `ri-job-search`. Read `README.md` for what it does. These rules keep its records trustworthy.

## Layout

- `src/actions.ts` exports `definition`, `initialize` and `shutdown`. Importing it must not open storage or do I/O: the build imports it to generate `contract.json`.
- `src/server.ts` serves the definition over Ri's private IPC.
- `src/domain/` is pure logic with no storage: classification, matching, posting extraction, compensation, diffs and AI prompt validation. `labels.ts` has no schemas so the view can import it.
- `src/server/` is the query layer on Node SQLite. Every write goes through these modules, never through raw SQL in an action.
- `src/api/` defines actions: strict zod input and output, audience, effect, retry and fictional examples that validate.
- `src/view/` is the React view, built on `@ri/app-kit/ui`. App classes use the `js-` prefix and kit tokens only.
- `src/server/fixtures.ts` is the fictional preview set. It runs only for a fixture principal with an empty database.
- `test/` is not packaged.

## Invariants

- Migrations are forward only. Never edit a migration that has shipped. Add the next numbered one.
- Posting snapshots, material versions and submission material links are immutable (database triggers refuse updates). Editing a material saves a new version with a parent link.
- Every stage change goes through `changeStageFor`, which records an event with author, source, confidence and decision. A person's change sets the stage lock. Automatic changes never move a stage backward, never reopen a closed opportunity, and are suppressed and sent to review while a lock disagrees.
- Never infer a rejection from a canceled meeting or from silence. Cancellations update the interview only.
- A company domain alone must never attach a message to one of several roles. Matching evidence and decisions live in `src/domain/match.ts`, with tests for two roles at one company and two recruiter threads.
- Imported values, user corrections and effective values are stored separately for interviews (`source_values`, `overrides`). A sync never overwrites a correction.
- Every read filters by the caller's scope before assembling results, including counts, sort keys, the projected stage and suggestions. Owned collections are `manual` and `materials`. Accounts are `account:<connection>`.
- AI output is untrusted. Prompts mark sources as data, replies are validated against strict schemas, quotes must be exact substrings, and AI readings only produce suggestions. AI never sets grants, sends anything or changes a stage by itself.
- Policy defaults (initial stage, history range, statuses) come from the query layer, never SQL defaults.
- Background work is one bounded step per call, committed with its checkpoint in one transaction. No loops and no timers.

## Copy

User-visible text never uses em or long dashes and avoids semicolons. Write "October 9 to 14", not a dash range. No sparkle, magic wand or star icons or emoji.

## Checks

Run `pnpm --filter ri-job-search typecheck`, `pnpm --filter ri-job-search test` and `pnpm --filter ri-job-search package` before handing off. The packaged view test packages the app and drives `dist/ui.html` in a real headless Chromium. `JS_VIEW_OFFLINE=1` builds the same source with the kit's offline fixture builder instead, only for when packaging itself is unavailable. Tests use only fictional data and fake capabilities and remove only directories they created with `mkdtemp`.
