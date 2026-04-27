# TODO

Real README pending. The notes below are working details for running and
testing the app — keep what's useful when the real README gets written.

## Two routes — when to use each

| Command | What it does | Use for |
|---|---|---|
| `pnpm dev` | `next dev` only, `FLOW_ROOT` preset to `.flow-dev` | Fast UI iteration, no bootstrap chain |
| `pnpm cli:dev start --dev` | Full CLI: auth + skills + Next + optional voice | Realistic dev — what end users see |
| `pnpm cli:dev start` | Full CLI against `~/.flow` (prod brain) | Daily personal use |

The CLI form is the canonical entry point. `pnpm dev` skips bootstrap (auth, skill install, voice subprocess) and is a shortcut for tight inner-loop UI work.

## Test (`~/.flow-test`)

Smoke tests own the test root and wipe it on every run, so they're always safe to invoke.

```bash
pnpm smoke         # Level 1: in-process bootstrap (~5s). Asserts CLAUDE.md, config.json, brain/data.db, skill symlinks.
pnpm smoke:agent   # Level 3: spawns dev server + Claude headlessly, asserts a task gets created end-to-end.
pnpm test          # Unit tests via vitest.
pnpm ts            # Type check.
```

Notes:
- Both smoke tests target `~/.flow-test` only — never touch `.flow-dev` or `.flow`.
- `pnpm smoke:agent` skips with exit code 2 if the Claude CLI isn't authed.
- Override the test root if you want to keep a run for inspection: `FLOW_ROOT=~/my-test pnpm smoke`.

## Dev (`~/.flow-dev`)

```bash
# fresh world
pnpm dev:reseed
pnpm cli:dev start --dev          # or `pnpm dev` for raw Next, no bootstrap

# day-to-day (state persists across restarts)
pnpm cli:dev start --dev          # spin up
# Ctrl+C to spin down — ~/.flow-dev keeps your auth token, skills, and DB
pnpm cli:dev start --dev          # spin back up

# iterate on seed content
# edit scripts/seed-dev/{areas,tasks,notes}.ts
pnpm dev:seed                     # apply additions; areas dedupe by name, tasks/notes don't
pnpm dev:reseed                   # full clean rebuild

# granular
pnpm dev:reset                    # wipe ~/.flow-dev only, no rebuild
pnpm dev:seed                     # seed only, no wipe
pnpm dev:reseed                   # wipe + bootstrap + seed (muscle-memory command)
```

The shared synthetic seed lives in `scripts/seed-dev/{areas,tasks,notes}.ts` and goes through `queries.ts` so embeddings + the markdown mirror stay in sync. Tasks reference areas by `area_name`; notes reference tasks by `task_title` — resolved to ids at insert time.

## Personal copy (`~/.flow`)

```bash
# seed your personal brain from your Notion export
pnpm db:seed                      # seed only
pnpm db:reset                     # wipe + reseed (target: ~/.flow)

# run the app against your personal brain
pnpm cli:dev start                # no --dev → defaults to ~/.flow

# triage workflow (if you use it)
pnpm db:triage                    # also: db:triage:claude / db:triage:codex
pnpm dev:seed-ui                  # triage review UI on :3333
```

Personal Notion importer code + data lives in `personal/notion-import/`. The `/personal/` directory is gitignored so personal data doesn't leak.

Once `pnpm cli:build` is run and the binary is linked, the same workflows become `flow start` (prod) and `flow start --dev` (dev).

## Data root precedence

```
explicit FLOW_ROOT       > --dev auto-set (~/.flow-dev) > prod default (~/.flow)

pnpm dev                 → ~/.flow-dev            (script preset)
pnpm cli:dev start       → ~/.flow                (prod)
pnpm cli:dev start --dev → ~/.flow-dev            (dev override)
FLOW_ROOT=~/x pnpm dev   → ~/x                    (explicit wins)
```

## Other commands worth knowing

```bash
pnpm db:push              # push Drizzle schema to SQLite
pnpm db:generate          # generate migration files
pnpm db:migrate           # run migrations
pnpm db:studio            # Drizzle studio UI
pnpm db:embed             # backfill embeddings (needs OPENAI_API_KEY)

pnpm dev:stt              # voice STT sidecar (Parakeet, Docker)
pnpm auth:pair            # auth pairing flow
pnpm cli:build            # bundle the CLI for distribution
```
