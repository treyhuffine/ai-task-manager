# Maintaining People

People is an included Ri app (`ri-people`). It runs as a native Node app over `ri-ipc-v1` with `node:sqlite`, and its view is one self-contained HTML resource built from React with the Ri app kit.

## Layout

- `src/actions.ts` exports `definition`, `initialize` and `shutdown`. Importing it must not open the database or do I/O: the build imports it to generate `contract.json`.
- `src/actions/*` define every action with strict zod input and output, audience, effect, retry, errors and fictional examples. `action()` in `shared.ts` keeps examples typed by the schemas.
- `src/domain/*` holds the records and rules: `schema.ts` (forward-only migrations), `people.ts`, `organizations.ts`, `identity.ts`, `affiliations.ts`, `interactions.ts` (ingestion and timelines), `sync.ts` (bounded background steps), `extraction.ts` and `briefings.ts` (the only AI paths, through `ai.ts`), `merge.ts`, `imports/*`, `views.ts`, `lists.ts`, `pipelines.ts`, `commitments.ts`, `facts.ts`, `followups.ts`, `export.ts` and `context-packets.ts`.
- `src/view/*` is the React view. `src/fixtures/*` holds the fictional preview world and payload builders.
- `test/*` covers the spec's rules and release bullets, scopes, sync, imports, merges, pipelines, follow-ups, extraction, performance and the packaged view in Chrome.

## Rules that must not regress

- Every read, search, count, sort key, snippet, export and context packet filters by the caller's scope first (`sourceFilter`, `canSee`). A chat never sees another account's names, companies, stages, amounts, participants or activity, including through ordering.
- Derived per-person and per-company rows (`person_sources`, `organization_sources`, search rows) are recomputed from base rows by `refreshPerson` and `refreshOrganization`. Call them after changing base rows.
- Identity: never strip dots or plus suffixes, never merge on a name or domain, never treat a shared inbox, personal mail domain or calendar co-attendance as identity or employment. User decisions (`decision = 'user'`) are never overridden by ingestion.
- Calendar events never imply attendance.
- AI runs only through `callAi`, only when the owner enabled extraction, with bounded prompts that mark source text untrusted, and strict validation with exact passages. With AI off, no `ai_text` call may happen anywhere.
- Decisions are keyed by stable source and claim keys (`decisions` table) and must survive resync, a new extraction version, source deletion and restore.
- Writes go through `ctx.mutate` with the invocation ID. Updates check `expectedRevision` and return `{ status: 'conflict', current, message }` instead of overwriting.
- Follow-ups persist the link and operation ID before calling `create_task`. Never recreate a task Ri reports missing.
- Pipelines never sum values and never move a card from a suggestion without the user's decision.
- Lists default to 50 and cap at 100. Index anything you query. Run `test/performance.test.ts` after query changes.
- Copy: no em or long dashes, avoid semicolons, no sparkle or wand icons.

## Migrations

Migrations in `src/domain/schema.ts` are forward-only and immutable once shipped. Add a new numbered migration for any change. Policy defaults belong in the query layer, never in SQL defaults.

## Release

Run `pnpm --filter ri-people typecheck`, `pnpm --filter ri-people test` and `pnpm --filter ri-people package`. Look at the screenshots in `artifacts/` before shipping a view change. Do not claim live provider qualification from fixture tests.
