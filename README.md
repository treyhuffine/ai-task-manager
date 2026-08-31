# Flow

The work OS for the human + agent era.

Agents are becoming co-workers, not co-pilots. The bottleneck is no longer doing the work — it's deciding what to do, handing it off cleanly, and reviewing what comes back. Flow is the system for all three.

> **Status:** pre-1.0, actively evolving. APIs, schema, and the project name itself may still change.

## Why

Every task tool puts you in two roles: the worker *and* the system administrator. Tagging, prioritizing, weekly reviews, snoozing — maintenance compounds until you abandon the system. With agents in the loop, the overhead doubles: now you're administrating their work too.

Flow's design constraint is to keep only enough structure for an agent to engage cleanly, and let AI handle the rest. You capture and execute. The system routes, triages, and resurfaces. Agents pick up clearly-defined work on their own, and surface back into one place when they need a decision.

The fuller product thinking lives in [`docs/prd.md`](docs/prd.md).

## What it's after

- **Keep the human in flow.** One recommended next thing, with a reason. Not a list of 50.
- **Don't rot.** No tags to curate, no buckets to drag between, no weekly review ceremony. The system has to scale with you for years, not collapse under its own weight the moment life gets busy.
- **Treat agents as co-workers.** Every action a human can take is exposed as a typed action to agents — same invariants, same query layer, same data. Agents read your brain, do their job, and queue what needs your call.
- **Make agent review the easy part.** Their work shows up in the same surface you already use. Approving, redirecting, or merging an agent's output should feel like triaging your own thoughts, not switching tools.
- **Stay local.** SQLite, a markdown mirror, and attachments — all under one directory you own. Vector search for semantic recall.

## Stack

- **Framework:** Next.js 16 (App Router), React 19, TypeScript
- **Database:** SQLite (`better-sqlite3`) + Drizzle ORM, vector search via `sqlite-vec`
- **AI:** Vercel AI SDK, Anthropic, OpenAI, Google Generative AI
- **UI:** Tailwind CSS v4, shadcn/ui (Radix), Vercel AI Elements, Tiptap
- **State:** TanStack Query
- **CLI:** Commander, packaged via tsup
- **Voice (optional):** Parakeet STT — git submodule at `modules/parakeet-stt`, runs as a Docker sidecar
- **Package manager:** pnpm (required)

## Quick start

```bash
pnpm install
pnpm approve-builds       # one-time: allow better-sqlite3 + sqlite-vec to compile native bindings
pnpm dev                  # Next dev, brain at ~/flow-dev, port 42241
```

Open [http://localhost:42241](http://localhost:42241).

You'll need at least one LLM provider key in `.env.local` — copy `.env.example` and fill in `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_AI_API_KEY`, or `OPENROUTER_API_KEY`.

> **Native modules:** pnpm blocks postinstall scripts by default. `better-sqlite3` and `sqlite-vec` need them to build their `.node` bindings — `pnpm approve-builds` enables them. If you skip it and see "Could not locate the bindings file" later, run `pnpm rebuild better-sqlite3` to recover. macOS needs Xcode Command Line Tools (`xcode-select --install`).

## Running the CLI (prod)

The `flow` CLI is the canonical entry point. It bootstraps the brain (auth, skills, voice) and runs the production Next.js server.

From the repo, the simplest path is:

```bash
pnpm install
pnpm build                # Next.js production build
pnpm cli:dev start        # run the CLI from source against ~/flow + next start
```

`pnpm cli:dev` is `tsx src/cli/index.ts` — the CLI itself runs from source, but it spawns a real `next start` against your production build, against the prod brain at `~/flow`. No global install, no bundling step.

Other CLI commands work the same way:

```bash
pnpm cli:dev start --dev          # dev brain (~/flow-dev) + next dev — skip pnpm build
pnpm cli:dev start --no-voice     # skip the STT sidecar
pnpm cli:dev pair                 # mint a device key + show pairing URL/QR
pnpm cli:dev doctor               # diagnostics
pnpm cli:dev agent <action>       # drive the typed agent surface from the shell
```

If you want a real `flow` binary on your PATH (still from this repo, no npm publish):

```bash
pnpm cli:build            # bundle the CLI to ./dist/cli/index.mjs (also runs on install via `prepare`)
pnpm link --global        # symlink the `flow` bin from this repo
flow start                # works from anywhere
```

`./dist` is a build artifact, not source, so it is gitignored and never committed. The `prepare` hook rebuilds it on every `pnpm install`, so a fresh clone gets a working binary automatically. Re-run `pnpm cli:build` after CLI changes to refresh the bundle the symlink points at. To undo the link: `pnpm unlink --global flow`.

## Two ways to run dev

| Command | What it does | Use for |
|---|---|---|
| `pnpm dev` | `next dev` only, brain preset to `~/flow-dev` | Fast UI iteration, no bootstrap |
| `pnpm cli:dev start --dev` | Full CLI: bootstrap + Next dev + optional voice | Realistic dev — what end users see |
| `pnpm cli:dev start` | Full CLI against `~/flow` (prod brain, dev tooling) | Daily personal use without rebuilding |

## Data roots

Flow keeps independent brains so dev never touches your real data:

```
explicit FLOW_ROOT       > --dev auto-set (~/flow-dev) > prod default (~/flow)

flow start               → ~/flow         (prod)
flow start --dev         → ~/flow-dev     (dev)
pnpm dev                 → ~/flow-dev     (script preset)
pnpm smoke               → ~/flow-test    (wiped on every run)
FLOW_ROOT=~/x flow start → ~/x             (explicit wins)
```

Each home is a single directory. Content lives at the **root** — `data.db`, the markdown mirror (`tasks/`, `notes/`, `areas/`, `streams/`), and `attachments/` — so the whole home is the unit you sync (git recommended). Machine-local plumbing is tucked into two hidden subdirs: `.config/` (auth token + settings — precious, never synced) and `.work/` (regenerable scratch: worktrees, clones, tmp, backups — disposable, never synced). Resolve paths through `src/lib/config/paths.ts` — never hardcode the data root path.

Installs predating this layout (content under a `brain/` subfolder) convert with `pnpm migrate:layout`: stop the server, run it, restart.

## Architecture overview

### The agent surface

There are two distinct agent surfaces — don't conflate them:

- **Typed action registry** (`src/lib/orchestrator/registry.ts`) — one definition per action, generates both:
  - The CLI: `flow agent <action> [params]` (JSON to stdout)
  - The HTTP MCP server at `/api/orchestrator/[transport]`
- **Natural-language MCP** at `/api/[transport]` — two tools (`query` / `update`) that route through `runMcpAgent` for free-form interpretation.

Every handler dispatches through `src/lib/db/queries.ts` — never raw SQL. The query layer enforces embedding upserts, markdown-mirror sync, and attachment derivation, so agent writes hold the same invariants as human writes.

### Skills

`skills/orchestrator/SKILL.md` teaches Claude Code, Codex, and compatible harnesses how to use the action surface. It ships as a template: the installed skill name is composed from `APP_SHORT_ID` (`AGENT_SKILL_NAME` in `src/constants/app.ts`, currently `agent-work-tasks-notes_flow`), materialized into `.work/skills/` with the name substituted, so a rebrand propagates from one constant. The `{{SKILL_NAME}}` placeholder in the template is the only source of the name — nothing hardcodes the short id.

By default the skill installs into `~/.claude/skills/` and `~/.agents/skills/`, so agents can manage your tasks and notes from any project. This is the default because it removes an onboarding decision most users can't meaningfully answer. Individual repositories are never written into either way. To scope it back to sessions the app launches from its own directory, use **Settings → Agents → Task and note access** (the app-root install is always present regardless). The CLI installs the app-root copy during bootstrap; the global copy is toggled via `PUT /api/agent/skills/global`.

### Device pairing

The web app uses cookie-based session auth. Other devices (a phone, the CLI on another machine, an agent) pair via `flow pair` — a one-time URL/QR exchange that mints a per-device API key. Middleware enforces `Authorization: Bearer <key>` on `/api/*`.

### Capture integrations

- [Pebble Index 01 webhook](docs/pebble-index-01-webhook.md)

### Schema

Authoritative schema is `src/lib/db/schema.ts`. Drizzle-derived types live in `src/db/types.ts` — don't duplicate.

## Common commands

```bash
# dev
pnpm dev                  # Next dev only, ~/flow-dev
pnpm cli:dev start --dev  # full CLI in dev mode
pnpm dev:reseed           # reseed ~/flow-dev (preserves auth + paired devices; rm -rf ~/flow-dev for a true reset)
pnpm dev:seed             # additive seed
pnpm dev:reset            # wipe ~/flow-dev only

# voice (optional)
pnpm dev:stt              # Parakeet STT sidecar (Docker)

# tests
pnpm smoke                # bootstrap smoke (~5s, ~/flow-test)
pnpm smoke:agent          # end-to-end: dev server + headless Claude
pnpm test                 # vitest
pnpm ts                   # typecheck

# database
pnpm db:push              # push Drizzle schema to SQLite
pnpm db:generate          # generate migrations
pnpm db:migrate           # run migrations
pnpm db:studio            # Drizzle Studio
pnpm db:embed             # backfill embeddings (needs OPENAI_API_KEY)

# build
pnpm build                # next build
pnpm cli:build            # bundle CLI to ./dist
```

## Project conventions

- **Use pnpm.** Not npm or yarn.
- **Dev server runs on 42241.** Production defaults to 4224, so both can run at once.
- **Installable UI components** (shadcn, Vercel AI Elements) come in via their CLI tools — don't manually copy component source.
- **Types** are derived from the Drizzle schema. Don't duplicate.
- **API routes** call shared functions from `src/lib/db/queries.ts`. No raw SQL in handlers.
- **Paths** resolve through `src/lib/config/paths.ts` helpers. Never hardcode the data root.
- **Orchestrator handlers** throw `ActionError` with a stable code, return plain data, and never `console.log`.

See [`CLAUDE.md`](CLAUDE.md) for the full set of project rules.

## Repository layout

```
src/
  app/                 # Next.js App Router (pages + /api routes)
  cli/                 # `flow` CLI: start, pair, doctor, agent, voice, …
  components/          # React UI
  lib/
    ai/                # provider adapters, agent prompts, deck generation
    db/                # Drizzle schema, queries (the only write path)
    orchestrator/      # typed action registry → CLI + HTTP MCP
    mcp/               # NL MCP agent (query/update tools)
    embeddings/        # sqlite-vec backfill + helpers
    config/paths.ts    # canonical brain-path resolution
skills/orchestrator/   # Cross-agent skill template; installed name composed from APP_SHORT_ID, global by default
modules/parakeet-stt/  # voice submodule (Docker sidecar)
docs/                  # PRD, specs, architecture notes
scripts/               # smoke tests, seed-dev, backups
```

## Contributing

Pre-1.0 and moving fast. The right doors:

- **New agent action?** Add it to `src/lib/orchestrator/registry.ts`. Both CLI and MCP pick it up.
- **New write path from the UI?** Add it to `src/lib/db/queries.ts` so agents and humans go through the same code.

Issues and PRs welcome.

## License

TBD.
