# AI-Native Human+Agent Productivity App

Open source agentic productivity tool built with Next.js 16 (App Router), React 19, and TypeScript. Combines tasks, notes, and AI chat into a single dashboard. It allows agents+humans to seamlessly handle tasks. The goal is to minimize decisions and maintance overhead that lead to system and task/note rot. We enable the user to: get into flow, minimal context switching between tasks, and focus on execution.

Our design constraint is to remove the pieces of digital system that were created only for human organization. We want to be simple/minimal and only have the necessary structure to make it easy for a human to utilize and straightforward for agents to engage. The rest relies on AI intelligence to manage. We believe simple systems are ultimately the most robust and what will have longevity.

Local-first with SQLite (via better-sqlite3 + Drizzle ORM) and vector search (sqlite-vec) for semantic embeddings.

IMPORTANT: When writing any copy or text for the website, never us em or long dashes (—). Use other punctuation or write the text in a different manner. You should also avoid semicolons as well ";"

## Stack

- **Framework:** Next.js 16 (App Router) with React 19
- **Database:** SQLite (better-sqlite3) with Drizzle ORM — schema at `src/lib/db/schema.ts`
- **AI:** Vercel AI SDK, Anthropic SDK, OpenAI SDK
- **UI:** Tailwind CSS v4, shadcn/ui (Radix primitives), Vercel AI Elements, Tiptap rich editor
- **State:** TanStack Query
- **Voice:** Parakeet STT — Git submodule at `modules/parakeet-stt`, runs as a Docker sidecar (`pnpm dev:stt`)

## Commands

- `pnpm dev` — starts dev server on port 42241
- `pnpm build` — production build
- `pnpm ts` — typecheck (tsc --noEmit)
- `pnpm lint` — ESLint
- `pnpm db:push` — push schema to SQLite
- `pnpm db:generate` / `pnpm db:migrate` — generate / apply Drizzle migrations (`db:migrate` uses the app's safe runner, never `drizzle-kit migrate`)
- `pnpm db:seed` — seed dev data
- `pnpm db:reset` — reset and re-seed

## Rules

- **Use pnpm** — not npm or yarn
- **Dev server runs on port 42241** by default (production defaults to 4224, so both can run side by side). Override either with `PORT` / `--port`.
- **Installable UI components** (shadcn, Vercel AI elements, ElevenLabs, etc.) must be added via their CLI tool — do not manually write or copy component source files
- **Types** are derived from the Drizzle schema in `src/db/types.ts` — do not duplicate type definitions
- **API routes** use shared query functions from `src/lib/db/queries.ts` — do not write raw SQL in route handlers
- **Paths** resolve via `src/lib/config/paths.ts` helpers (`getAppRoot`, `getDbPath`, `getAttachmentsDir`, `getConfigDir`, `getWorkDir`) — never hardcode the `<app-short-id>` directory name; use placeholders like `<app-root>` or defer to the orchestrator's `describe_paths` action. The helpers respect the `<APP>_ROOT`, `<APP>_DB_PATH`, `<APP>_CONFIG_DIR`, `<APP>_WORK_DIR` env overrides. (`getBrainDir` is a deprecated alias for `getAppRoot` — content lives at the home root now; there is no `brain/` subfolder, and `<APP>_BRAIN_PATH` is ignored.)
- **Harness** means the engine a chat runs on (`claude | codex | cursor | opencode`, the `HarnessId` values), stored as `harness` on chats, triggers and runs. Don't call the engine an "agent" in new code.
- **Hotkeys** are defined in `src/constants/commands.ts` and must be used by components. Use `matchesHotkey(e, HOTKEYS.focusChatInput)` etc. rather than ad-hoc checks.

## Timestamps

- Every table has `created_at` and `updated_at` (NOT NULL, default `(datetime('now'))`), declared right after `id`. Use a shared `timestamps` spread so every table is identical: `sqliteTable('x', { id: text().primaryKey(), ...timestamps, ...rest })`.
- `updated_at` adds `.$onUpdate()` returning `(datetime('now'))` so it bumps on every write, not just insert. A plain default only fires on insert, leaving `updated_at` stuck equal to `created_at`.
- Declare timestamps at table creation, never reorder them onto an existing table. Position is cosmetic and not worth a migration, and retrofitting a NOT-NULL timestamp onto a populated table is not cleanly autogeneratable (drizzle-kit either fails the ADD COLUMN or emits a broken rebuild). New timestamp columns go on nullable, then backfill, then enforce NOT NULL.

## Column defaults

- SQLite cannot `ALTER` a column default (there is no `SET`/`DROP DEFAULT`). Changing or removing a default is the one thing that forces drizzle-kit into a full table rebuild, which reassigns rowids and desyncs any external-content FTS5 index keyed by rowid (e.g. `tasks_fts`, `notes_fts`, `stream_fts`). So a default that later needs to change is a trap.
- Use DB defaults freely for STRUCTURAL, invariant values: `(datetime('now'))` timestamps, empty JSON collections (`[]`), zero counters (`0`), and the `userId 'local'` sentinel. These never need to change.
- Boolean columns carry NO schema default, ever. State-like flags get a write-time `input.x ?? value` in their query-layer creator (e.g. `triggers.enabled ?? true`); preference flags are nullable and resolved `?? value` at read time so NULL keeps meaning "user never chose" (e.g. `userState.voiceAutoSend`); fact flags (`workspaces.isGit`) are required params with no fallback anywhere — a forgotten fact is a bug, not a default.
- NEVER put a DB default on a column whose value encodes a POLICY or business choice that could change (an entity's initial status, a mode, a model id, a routing policy). The schema carries ZERO policy defaults (enforced by the 2026-09 baseline squash — see `docs/schema-defaults.md`): the query-layer creator sets the value explicitly (as `createTask` does with `status: 'todo'`), and the matching `Create*Input` type in `src/db/types.ts` re-optionalizes the field via `PolicyOptional` so callers may still omit it. A new policy column follows that same pattern: NOT NULL, no default, creator supplies the value.
- If you must change/remove a default on a populated table, do NOT accept drizzle's generated table rebuild. Hand-roll a rowid-safe column swap in the migration (`RENAME COLUMN x TO x_old` / `ADD COLUMN x ... DEFAULT ...` / `UPDATE x = x_old` / drop dependent indexes / `DROP COLUMN x_old` / recreate the indexes). Column-level ALTERs preserve rowids, so FTS stays intact. Worked example: `drizzle/0016_lyrical_network.sql` in git history (pre-squash) or `personal/schema-rebuild/drizzle-pre-squash/`.
- Migrations apply through `runMigrations` (`src/lib/db/migrate.ts`, used at boot and by `pnpm db:migrate`): foreign keys OFF for the whole migration, `foreign_key_check` before COMMIT, so a table rebuild never cascades into child tables and a migration that breaks a link rolls back. Never apply migrations with `drizzle-kit migrate`. better-sqlite3 opens connections with foreign keys ON and Drizzle's runner wraps migrations in one transaction (where `PRAGMA foreign_keys=OFF` is ignored), so a `chat_sessions` rebuild would delete every chat message. A rebuild still reassigns rowids unless it copies `rowid` explicitly.
- Collapsing the history into a fresh baseline (delete `drizzle/`, `pnpm db:generate`) means every existing database must be rebuilt: `scripts/db-rebuild.ts --from <snapshot> --to <new>` builds the new schema and refills it table by table, keeping rowids, then verifies every row. Run it on a snapshot with the app stopped, then swap the file in. New code refuses to boot on an old journal, on purpose.

## Attachments

One generic attachment system across the whole app:

- Files live on disk under `<app-root>/attachments/<file_name>` (UUIDv7-named).
- Metadata is an `Attachment` JSON record: `{ file_name, original_name, mime_type, size, uploaded_at }` — stored as an `Attachment[]` JSON column on every entity that can carry files (`tasks`, `notes`, `areas`, `stream`, `chat_events`).
- Upload: `POST /api/attachments` (multipart, 50 MiB cap, mime allowlist). Serve: `GET /api/attachments/:file_name` (auth-protected).
- Client helpers in `src/lib/attachments/client.ts` (`uploadAttachment`) and `src/lib/attachments/view.ts` (`attachmentUrl`).
- Chat-specific: chat composers use `ChatInputEditor` + `FileChipNode` (Tiptap). Messages carry `[[file:<file_name>]]` markers inline in `content`; the matching `Attachment` lives in `chat_events.attachments`. Transcript renders chips via `MessageFileChip` (image thumb / expandable text / download), branching on mime.
- Send-to-model: every chat is a harness session, so `src/lib/attachments/expand-markers.ts` substitutes `[[file:...]]` markers with the absolute disk path when the harness reads the mime natively (text, code, images, PDF), or an inline `<attachment>` block of extracted text otherwise (`src/lib/attachments/extract-text.ts`: docx/xlsx/pptx via mammoth/xlsx/officeparser, audio via STT through `pickProvider`, svg as XML). 200k-char per-attachment cap to bound context.
- See `docs/chat-sessions.md` for the chat-specific flow end-to-end.

## Client data layer (TanStack Query)

- **Mutations are optimistic, at the hook layer.** Task/note/area mutations live in `src/hooks/use-{tasks,notes,areas}.ts` and all funnel through `src/lib/query/optimistic-entity.ts`: patch the cache in `onMutate` (`optimisticPatch` / `optimisticRemove`), roll back in `onError` (`rollbackOptimistic` + a sonner toast), reconcile in `onSettled` (`settleEntity`, a background invalidate). Do **not** add a blocking `onSuccess: invalidateQueries` — that reintroduces the second round-trip the optimistic layer exists to remove, and is the lag this replaced.
- **Patches are partial merges, never record replaces** — the same update hook carries every field (`title`, `areaId`, `dueAt`, `body`, `sortKey`, ...).
- **Two cache shapes per root:** single-entity `[root, id]` holds the full record (with `body`); lists `[root, filter]` hold DTOs that omit `body` and carry `bodyExcerpt` / `bodyLen`. The helper projects a body patch to the excerpt shape for lists (`projectPatchToList`) — never write a raw `body` onto a list row.
- **Never write a server-normalized `body` into the live cache.** The Tiptap editor (`src/components/editor/rich-editor.tsx`) is authoritative while focused, and the server stores `body` verbatim, so the optimistic `body` already equals what the editor emitted. Writing a server echo back is the one thing that can reflow an open document or clobber newer keystrokes.
- **Creates stay non-optimistic for lists** (the server owns filter placement); they seed the detail cache and let settle place the row. Recurring-task completes skip the optimistic `done` flip (the server bumps `nextRecurrenceAt`).
- Full rationale and the body-editor safety analysis: `docs/optimistic-updates.md`.

## Orchestrator (agent surface)

Actions defined in `src/lib/orchestrator/registry.ts` generate both the CLI (`<cli> agent <action>`) and the HTTP MCP at `/api/orchestrator/[transport]`. Single source of truth — add an action once, both surfaces pick it up.

Distinct from the thin NL MCP at `/api/[transport]` (two tools `query`/`update`, routes through `runMcpAgent`). Don't conflate them.

Handler rules:

- **Dispatch through `queries.ts`** — never raw SQL, never direct Drizzle from a handler. The query layer enforces embedding upsert, markdown-mirror sync, and attachment derivation. Bypassing it corrupts invariants silently.
- **Throw `ActionError`** with a stable code (`not_found | invalid_params | conflict | unsupported`), not raw `Error`. The envelope renders these cleanly for both transports.
- **Return plain data.** The envelope is JSON-serialized.
- **No `console.log` in handlers** — CLI uses stdout for results, MCP returns structured content.
- **Branch on `ctx.remote`** for security-sensitive work: `false` = trusted local CLI, `true` = untrusted HTTP. Default to `true` behavior when unset.

Data roots (precedence: explicit `RI_ROOT` > `--dev` auto-set > prod default):

- `~/<app-short-id>/` — prod, real data home
- `~/<app-short-id>-dev/` — dev (`pnpm dev`, `ri start --dev`)
- `~/<app-short-id>-test/` — test (`pnpm smoke`, `pnpm smoke:agent`) — wiped on every run

When NOT to add an action: behavior that belongs in the NL MCP (free-form interpretation), one-off CLI commands that aren't part of the agent surface (shared ones go in `src/cli/commands/`, contributor-specific scripts go in `/personal/`), or anything that duplicates an existing `queries.ts` function under a different name.

## Background AI calls

Server-side background AI (deck generation, the stream urgency lane, image-capture extraction, the NL MCP inner agent) runs through the user's default subscription harness via `src/lib/harness/one-shot.ts` (`runHarnessText` / `runHarnessJson`), never through a direct model API key. The only sanctioned direct OpenAI API use in the app is embeddings (`src/lib/embeddings/`). STT providers are Parakeet (local) and Groq only. New background AI features must use the one-shot helper. Full architecture: `docs/background-ai.md`.

Invariants: action names are the public contract (renaming breaks every agent that learned them). Params are Zod raw shapes, not `z.object(...)` — the generators wrap. Names are `snake_case` on the wire. Every mutating action should be safe under retry.

## Boil the Ocean

The marginal cost of completeness is near zero with AI. Do the whole thing.
Do it right. Do it with tests. Do it with documentation. Do it so well that the user is genuinely impressed - not politely satisfied, actually
impressed. Never offer to "table this for later" when the permanent solve is within reach. Never leave a dangling thread when tying it off takes five more minutes. Never present a workaround when the real fix exists.
The standard isn't "good enough" - it's "holy shit, that's done." Search before building. Test before shipping.
Ship the complete thing. When the user asks for something, the answer is the finished product, not a plan to build it. Time is not an excuse. Fatigue is not an excuse. Complexity is not an excuse. Boil the ocean. That doesn't mean over-engineer. It means don't leave work on the table. Do it well.
