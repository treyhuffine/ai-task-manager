# CLI Distribution

How to make the app runnable via a single `npx <app>` command — spinning up the server, handling first-run setup, and opening the browser automatically.

Throughout this doc, `<app>` is a placeholder for the published npm package name (TBD).

## Goal

Users should be able to run one command and have a working local instance:

```bash
npx <app>
```

No clone, no `pnpm install`, no manual DB setup, no API-key config file editing. Returning users run the same command and it just boots.

## How `npx` actually works

`npx <name>` is not magic — it downloads `<name>` from the npm registry, resolves the `bin` field in its `package.json`, and executes the resulting symlink.

Minimum contract:

```json
{
  "name": "<app>",
  "bin": "./dist/cli.js"
}
```

Plus:

- A shebang at the top of the bin file: `#!/usr/bin/env node`
- The bin file is included in the published tarball (via `"files"` in `package.json`)

That's it. `npx <app>` then resolves to running `./dist/cli.js`.

## Packaging strategy

The app ships as a **single npm package** containing:

- A thin CLI entry point (`dist/cli.js`)
- The Next.js app built in [standalone output mode](https://nextjs.org/docs/app/api-reference/config/next-config-js/output) so the server is self-contained
- DB schema + migration files
- Static assets

A single-package layout is preferred over splitting into CLI + server packages. The split adds release complexity without much payoff at this stage — revisit if a plugin SDK or alternate frontends show up.

## Commands

The CLI should expose a **minimum viable set**. Resist adding commands until users ask.

### `<app>` (default, no subcommand)

The 95% case. Idempotent — does the right thing whether it's the first run or the hundredth.

Flow:

1. Detect first run (data dir missing) → run onboarding inline
2. Detect pending migrations → run silently
3. Detect missing required API keys → prompt for just those
4. Ensure a pairing token exists (create if missing)
5. Pick a free port (default preferred, fall back if taken)
6. Start the server
7. Open the browser — to the pairing URL on first run / unpaired devices, otherwise to `/`

Flags:

- `--port <n>` — override port selection
- `--bind loopback|lan|tailnet` — control which interface the server binds to. Loopback is the safe default; `lan` lets phones on the same wifi reach the instance; `tailnet` is for Tailscale users.
- `--no-open` — skip the browser launch (useful for SSH sessions, CI, headless usage)
- `--yes` — skip all interactive prompts (CI/scripting; fails if required config is missing)
- `--pair` — force the browser to open the pairing URL even if a valid local session exists

### `<app> pair`

Prints the current pairing URL to stdout. Creates a token if one doesn't exist. This already exists as the `flow:pair` script (`scripts/pair.ts`) and is the primitive the default command uses internally.

Useful for:

- Pairing a second device (phone, another laptop)
- Piping to `pbcopy` for sharing
- Re-pairing after clearing browser storage

### `<app> doctor`

Diagnostics. Checks:

- Default port available?
- Data directory readable/writable?
- DB file present and not corrupted?
- Required API keys set?
- Native modules loadable (`better-sqlite3`, `sqlite-vec`)?
- Docker running (only if voice features are enabled)?

Exits non-zero if any critical check fails. Cheap to build, catches the majority of "it doesn't work" cases before they become support threads.

### `<app> reset`

Escape hatch. Removes the data directory after a confirmation prompt.

Flags:

- `--keep-keys` — preserve API keys from the previous install
- `--yes` — skip confirmation (dangerous; use in scripts only)

### Commands intentionally **not** included

- `start` / `stop` — the default command starts; Ctrl-C stops. Don't reinvent a process manager.
- `update` — npm handles this via `npx <app>@latest`.
- `export` / `import` — premature. Add when there's a concrete use case.
- `login` / `logout` — auth is pairing-based; the URL is the login.
- `config` — env vars + the onboard prompts are enough until a real config surface is needed.

## Onboarding

Onboarding is a **state the default command enters**, not a separate top-level command. The first-run path:

1. Detect fresh install (no data dir)
2. Prompt for the required AI provider key (stored in the `api_keys` table)
3. Prompt for optional keys (embeddings provider, etc.)
4. Run migrations
5. Seed a starter workspace
6. Create a pairing token
7. Start the server and open the pairing URL

Returning users skip straight to steps 5–7 (with the token already cached).

A `<app> onboard --force` alias can re-run the prompts without touching data — useful for swapping keys without the user needing to find where they're stored.

## Data location

Use the OS-appropriate user data directory:

- macOS/Linux: `~/.<app>/`
- Windows: `%APPDATA%\<app>\`

Contents:

- `db.sqlite` — the main database
- `pairing.json` or equivalent — local auth state
- Cached embeddings, blobs, etc.

Do **not** write into the install directory. That breaks when npm updates the package.

## Hard parts worth calling out

These are where real time gets spent, not the CLI plumbing:

1. **Native module prebuilds** — `better-sqlite3` and `sqlite-vec` must have prebuilt binaries for macOS / Linux / Windows × arm64 / x64. If a user hits `node-gyp`, the experience is broken. Verify prebuilt coverage before publishing; consider `prebuildify` or equivalent if gaps exist.
2. **Voice / STT sidecar** — the Parakeet container is a Docker dependency most `npx` users won't have. Recommended v1 approach: skip voice in the published CLI, keep it as a contributor-only feature behind `pnpm dev:stt`. Revisit when there's a non-Docker STT path.
3. **Port conflicts** — default port must gracefully fall back. `detect-port` or equivalent.
4. **Migration on upgrade** — when a user runs `npx <app>@latest` after a schema change, migrations must run automatically before the server accepts connections. No manual step.
5. **First-run browser timing** — the browser launch must wait for the server to be listening, not just spawned. Poll the health endpoint or the Next ready signal.

## Library choices

At its core, a `npx`-able CLI is just a Node script with a shebang. Libraries buy polish and save tedious work — but the temptation to overbuild is real. Keep the stack small.

Recommended dependencies:

| Need | Library | Why |
|---|---|---|
| Arg parsing & subcommands | **`commander`** | Smallest sensible choice. Subcommands, flags, auto-generated help. |
| Interactive prompts | **`@clack/prompts`** | Polished UX with grouped prompts, spinners, and cancel handling. |
| Free port detection | **`get-port`** (or `detect-port`) | Avoids hand-rolling port probing. |
| Browser launch | **`open`** | Cross-platform (macOS, Linux, Windows, WSL). |
| Terminal colors (optional) | **`picocolors`** | Tiny, matches `chalk`'s ergonomics for the basics. Only needed for styled output outside clack's blocks. |

Total added install footprint is small (~200KB).

### Explicitly avoided

- **`yargs`** — more powerful than commander, but the API sprawl isn't worth it for a few commands.
- **`oclif`** — designed for enterprise-scale CLIs with plugins and update systems. Overkill here.
- **`ink`** — React for terminals. Great for long-running dashboards, unnecessary for a prompt-then-exit flow.
- **`inquirer`** — still fine, but `@clack/prompts` has better defaults and a tighter API.
- **`chalk`** — fine, but `picocolors` is significantly smaller with the same ergonomics.
- **`boxen` / `ora` / `cli-table`** — `@clack/prompts` already covers spinners and visual structure. Mixing in other UI libs leads to inconsistent output.

### Zero-dep baseline

Worth knowing that Node's stdlib covers most of this if dependencies ever become a concern:

- `process.argv` → crude arg parsing
- `node:readline` → prompts
- `child_process.spawn` → run the Next server
- `node:net` → port availability
- `node:util`'s `styleText` (Node 20+) → colors without a dep

Starting with the four libraries above is the right trade-off. Drop down to stdlib only if there's a specific reason to.

## Build setup

The CLI is written in TypeScript (matching the rest of the codebase) and compiled to JavaScript for the published tarball. The `bin` field in `package.json` points at the compiled output, not the source.

### Tooling

Use **`tsup`** (a thin wrapper over `esbuild`) to build the CLI. It's the de-facto choice for TypeScript CLIs because it:

- Bundles the entry into a single `dist/cli.js`
- Preserves the `#!/usr/bin/env node` shebang through minification
- Handles ESM/CJS output without config gymnastics
- Builds fast enough to not matter

Alternatives — `tsc` (slower, emits a tree of files) or `esbuild` directly (max control, more setup). Prefer `tsup` unless there's a reason not to.

### Layout

```
src/cli/index.ts   ──tsup──▶   dist/cli.js   ◀──── bin points here
```

### `package.json` wiring

```json
{
  "bin": "./dist/cli.js",
  "files": ["dist", ".next/standalone", "drizzle"],
  "scripts": {
    "build:cli": "tsup src/cli/index.ts --format esm --clean",
    "prepublishOnly": "pnpm build && pnpm build:cli"
  }
}
```

Key points:

- `files` must include every artifact the CLI needs at runtime: the compiled CLI, the Next standalone build, migration files, and any seed data.
- `prepublishOnly` runs automatically on `npm publish` / `pnpm pack`, so a stale build can't ship.
- The bin file must start with `#!/usr/bin/env node`. `tsup` preserves this from the source file.

## Publishing

- **Version scheme:** date-based (e.g. `2026.416.0` for April 16, 2026). Removes version-bump decision-making and fits a local tool's release cadence better than semver.
- **Release automation:** GitHub Actions with npm OIDC trusted publishing. No long-lived tokens to rotate.
- **Two paths coexist:**
  - `npx <app>` for end users
  - `git clone && pnpm install && pnpm dev` for contributors (voice included)

## Checklist before first publish

- [ ] `bin` entry in `package.json` with shebang in the CLI file
- [ ] `files` in `package.json` includes the built CLI + standalone Next output + migrations
- [ ] Next config uses `output: 'standalone'`
- [ ] All file paths in the app resolve relative to the user data dir, not the install dir
- [ ] `better-sqlite3` and `sqlite-vec` prebuilt binaries verified for all target platforms
- [ ] Migrations run on startup, not manually
- [ ] Onboarding flow tested on a clean machine (no existing data dir)
- [ ] `doctor` command covers the top failure modes
- [ ] Browser launch waits for server-ready, not spawn
- [ ] `--no-open` and `--yes` flags tested (headless/CI path works)
