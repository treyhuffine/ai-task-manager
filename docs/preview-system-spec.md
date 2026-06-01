# Flow — Preview System Rebuild: Spec & Task List

> Self-contained work plan to replace Flow's brittle preview system with a
> small **provider** model. Each item is a checkbox with concrete
> acceptance criteria. You should not need any external context beyond
> this file + the codebase.

---

## 0. Background (read first)

**What Flow is.** A local-first "work OS" (Next.js 16 / React 19 / TS,
SQLite + Drizzle). Agents act as co-workers: each agent **execution** runs
in its own **git worktree** named `<workspace>-<uuid-substring>` (e.g.
`flow-a3f9`). Flow typically runs on an **always-on Mac Mini** so you can
drive agents from any device.

**The problem.** When an agent builds an app, you want to **review the
running app** — from the Mini, from your laptop, or from your phone. The
current preview system grew organically and is brittle: a path-proxy
(`/preview/<id>`) that rewrites `<base href>` and `Set-Cookie`, breaks on
absolute paths/manifests, and 502s WebSocket/HMR; plus ad-hoc Portless and
Tailscale paths and a stdout-port-scraper. We're replacing it.

**The decision (what we're building toward).**
- A preview is reached one of two ways: **localhost** (browser is on the
  same machine as the app) or a **remote URL**.
- **beamd is the first-class remote provider** (self-hosted HTTPS tunnel on
  your own domain — see the beamd repo). **Portless is supported** (the
  existing read-only `routes.json` adapter). **Everything else** (ngrok,
  cloudflared, Tailscale, …) is either a **community plugin** or the user
  **runs their own tunnel and pastes the URL into the execution**, which
  Flow stores and uses for the preview.
- Reference ergonomic we like (Portless): `portless $(basename $PWD) next dev`
  — name the route by the worktree, autoassign a port, wrap the dev cmd.
- **Naming:** the worktree basename is the preview name. Multi-service
  worktrees append a service suffix with **hyphens** (`flow-a3f9-web`,
  `flow-a3f9-api`) — must be a single DNS label (≤63 chars, lowercase
  `[a-z0-9-]`), because beamd's wildcard cert is one label deep.
- **Keep:** the supervisor (process lifecycle), screenshots
  (`/api/capture`), the settings/remote-base-url/pairing UI patterns.
- **Retire:** the `/preview` path-proxy + `inject-base` +
  `rewrite-set-cookie`; Tailscale-specific UI; the stdout port-scraper as
  the *primary* mechanism; the proxy branch of `resolve-iframe-src`.

**Relevant existing files (verify exact paths before editing):**
- `src/lib/preview/supervisor.ts` — spawn/stop, `PortDetector`, `portOverride`, `pid-store`, status states, log ring buffer.
- `src/lib/preview/portless.ts` — read-only `~/.portless/routes.json` adapter (`detectPortless`, `readRoutes`, `findRoute`, `derivePortlessHostname`).
- `src/lib/preview/resolve-iframe-src.ts` — direct-vs-proxy mode picker.
- `src/app/preview/[workspace]/[[...path]]/route.ts` — the path-proxy (to retire).
- `src/app/api/workspaces/[id]/preview/{start,stop,status,logs,refresh-token}/route.ts` — preview lifecycle endpoints.
- `src/app/api/capture/route.ts` — screenshots.
- `src/components/executions/*`, `src/components/workspaces/preview-settings-section.tsx` — UI.
- DB: Drizzle schema under `drizzle/` + `src/lib/db/`.

**Companion spec:** the canonical "drive beamd from a host app" guide lives in
the beamd repo at `docs/consuming-beamd.md` — read it. beamd is **one binary**
(`beamd serve` = edge; `beamd open`/`close`/`run`/`list`/`status` = client).
Key facts this integration depends on:

- **Package: `@beamd/cli`** (the npm name — the bare `beamd` was blocked by
  npm's name-similarity guard). It installs a `beamd` command; spawn it via
  `node_modules/.bin/beamd` or `require.resolve("@beamd/cli/bin/beamd.cjs")`.
- **Command surface:** `beamd open <port> --as <name> [-d] [--json]` (foreground
  by default — Flow **always** passes `-d` for the detached, non-blocking path)
  / `beamd close <name> [--json]` / `beamd list --json` / `beamd status --json`.
  `--json` has shipped; always use it (one object/array, nothing else).
- **Auth is `--config <path>`, NOT `~/.beamd/config`.** `~/.beamd/config` is now
  the *interactive profile store* — automation must stay out of it. Write a
  dedicated `{server, token}` YAML (under Flow's data dir) and pass `--config
  <that path>` to **every** beamd call; it bypasses profiles entirely (the
  documented automation path). Per-call `--server/--token` are not the model.
- **Read the `url` from `open --json`; never assemble it.** beamd defaults to
  **flat** routing (`https://<name>.<base>`); a namespaced edge is
  `https://<name>.<slug>.<base>`. Either way `url` is authoritative and `slug`
  may be `""`.

---

## Phase 0 — DO NOW (personal use, against today's beamd)

The sections below are the full plan. For immediate personal use with the
current `@beamd/cli` binary, do only these, in order. Skip auth, manual URLs,
settings, plugins, and the preview-object polish for now.

- [ ] **Minimal provider seam** (§1, trimmed): just `LocalhostProvider` + `BeamdProvider`. No plugin registry/manual/settings yet.
- [ ] **Port handling** (§2, trimmed): assign a stable port per worktree, inject `PORT`, confirm-listening, persist `{ startCommand, port, name }`.
- [ ] **BeamdProvider** (§4): `beamd open <port> --as <worktree> -d --json` (detached), read `{url}` from the JSON; lazy bring-up; `stop()` = `beamd close <worktree>`. Point `--config` at your `{server, token}` file.
- [ ] **2-mode picker** (§5): `localhost` on the Mini, beamd URL elsewhere; retire the `/preview` path-proxy.

**Defer:** auth/sharing, manual-URL storage, settings panel, multi-service
injection, thumbnails/preview-object, community plugins.

---

## 1. `PreviewProvider` abstraction + registry  `[P0]`

The seam everything hangs off. Supports **dynamic** providers (start/stop a
tunnel) and **static** ones (a URL already exists).

- [ ] Define `src/lib/preview/providers/types.ts`:
  ```ts
  export interface PreviewTarget { url: string; stop?: () => Promise<void>; }
  export interface PreviewContext {
    worktreeName: string;        // e.g. "flow-a3f9"
    service?: string;            // e.g. "web" | "api"
    port: number;                // local port the app listens on
    workspaceId: string;
  }
  export interface PreviewProvider {
    id: string;                  // "localhost" | "beamd" | "portless" | "manual" | <plugin>
    label: string;
    kind: 'dynamic' | 'static';
    // Return a reachable URL for this context (start a tunnel if needed).
    resolve(ctx: PreviewContext): Promise<PreviewTarget>;
  }
  ```
- [ ] `src/lib/preview/providers/registry.ts`: register built-ins, look up by id, list available. Allow external registration so community plugins can `registerPreviewProvider(provider)`.
- [ ] Document the plugin contract in `docs/preview-providers.md` (how a community provider is shaped + registered).
- **Acceptance:** `getProvider(id).resolve(ctx)` returns a `PreviewTarget`; unknown id throws a clear error; a trivial test plugin can register and be selected.

---

## 2. Port allocation in the supervisor  `[P0]`

Make "what port is this app on" deterministic and robust (replaces the
fragile stdout scrape as the primary mechanism).

- [ ] Add a free-port allocator (bind `:0` to grab, or scan a configured range) in the supervisor.
- [ ] **Persist the per-worktree desired-state record** (this is the source of truth — see note below): `worktree → { startCommand, port (stable), previewName, pinned? }`. Store in DB (new table `preview_targets` or columns on the execution/worktree). The **stable port** means restarts reuse it → stable URL; the **startCommand** is what makes lazy revival possible (§4) — you can't restart a server you don't know how to launch.
- [ ] Inject the assigned port into the child env (`PORT=<n>`, plus the `--port` passthrough convention) when starting.
- [ ] **Confirm-listening:** after spawn, TCP-poll `127.0.0.1:<port>` until it accepts (timeout → `crashed`/`no-port` status). Only mark `running` once it accepts.
- [ ] Keep the stdout `PortDetector` as a **fallback** for apps that ignore `$PORT` (detect the actually-opened port via the existing scraper or `lsof -aPi -nP -p <pid>`).
- **Acceptance:** starting a Next app yields a known, stable port without scraping; restarting the same worktree reuses the same port; an app that never opens a port surfaces a clear `crashed`/`no-port` status instead of hanging; the desired-state record survives a Flow restart.

> **Source of truth: Flow, not beamd.** Only Flow knows how to (re)start a
> server (the `startCommand`); a tunnel to a dead port is a useless URL.
> So Flow owns "what should be running," and beamd stays stateless about
> *desired* tunnels (it only tracks currently-live sessions, and replays
> across network blips while the daemon stays up). Don't persist desired
> tunnels in beamd — it would re-point at dead ports.

---

## 3. Built-in providers  `[P0]`

- [ ] **LocalhostProvider** (`kind: static`): returns `http://localhost:<port>` (or `<name>.localhost` if Portless is active). Used when the viewing browser is on the same host as Flow.
- [ ] **BeamdProvider** (`kind: dynamic`): see §4.
- [ ] **PortlessProvider** (`kind: static`): reuse `src/lib/preview/portless.ts`; map `worktreeName` → route → `http://127.0.0.1:<port>` / its hostname. (Mostly exists — wrap in the provider interface.)
- [ ] **ManualProvider** (`kind: static`): return a URL stored on the execution (see §6).
- **Acceptance:** each provider returns a working `PreviewTarget` for a running app; selecting a provider in settings routes `resolve()` to it.

---

## 4. BeamdProvider — drive the bundled `beamd`  `[P0]`

- [ ] Add **`@beamd/cli`** as a dependency (bundles the right per-platform binary; resolve it via `node_modules/.bin/beamd` or `require.resolve("@beamd/cli/bin/beamd.cjs")`). Until published you can point at a local `beamd` build path.
- [ ] On configure (from settings, §7): write a dedicated `{server, token}` config file under Flow's data dir (e.g. `~/.flow/beamd.yaml`) and pass `--config <that path>` to **every** beamd call. **Do not write `~/.beamd/config`** — that's the user's interactive profile store; `--config` is the automation path that bypasses it entirely (so Flow never collides with the user's own `beamd login`).
- [ ] `resolve(ctx)`: **lazy bring-up.** (1) Is the app listening on its assigned port? If not, start it from the persisted `startCommand` (§2) and confirm-listening. (2) Is the tunnel up? If not, `beamd open <port> --as <previewName(ctx)> -d --json --config <cfg>` (detached, non-blocking), and read the `url` field from the JSON object. Return `{ url, stop: () => beamd close <name> --config <cfg> }`. (Trust `url` — it's correct whether the edge is flat (`<name>.<base>`) or namespaced (`<name>.<slug>.<base>`); don't reconstruct it.)
- [ ] **No eager reconcile on boot.** Because the URL = a stable name and bring-up is lazy, a Flow/host restart is a non-event: the first `resolve()` cold-starts *both* the server and the tunnel. (Optional: eagerly bring up only the `pinned` set from §2 — never everything, or you melt the host.)
- [ ] **Idle-evict (symmetric):** after N idle minutes, stop the server and `beamd close` the tunnel; the name/URL stays reserved so it cold-starts again on next `resolve()`.
- [ ] Add a **"restore set"** action (per workspace) that brings up a chosen group at once, reading from the §2 desired-state.
- [ ] Surface beamd errors (not logged in, agent down, tunnel cap hit) as actionable preview statuses.
- **Acceptance:** for a worktree, `BeamdProvider.resolve` returns the `url` from `open --json` (e.g. `https://<worktree>.<base>` on a flat edge) that loads the app with a real cert from another device, **cold-starting the server if it was down**; `stop()` removes the tunnel; after a host reboot, opening a worktree's preview brings server+tunnel back at the same URL with no manual step.

---

## 5. Reachability picker (simplify `resolve-iframe-src`)  `[P0]`

Collapse to **two modes**.

- [ ] Rewrite `resolve-iframe-src.ts`: if the viewing browser is on the same host as Flow (existing `localhost`/`127.0.0.1`/`*.localhost` heuristic) → use LocalhostProvider URL; otherwise → the active remote provider's URL (beamd/portless/manual).
- [ ] Remove the path-proxy ("proxy") mode and its mixed-content special-casing.
- **Acceptance:** on the Mini the iframe/link uses `localhost`; from a phone it uses the remote URL; there is no `/preview/...` path-proxy branch left.

---

## 6. Manual URL on an execution (BYO tunnel)  `[P0]`

The "run your own tunnel (ngrok/cloudflared/whatever) and paste the URL"
path — Flow stores it and uses it for the preview.

- [ ] Schema: add `preview_urls` to the execution (and/or workspace): a small list of `{ service?: string, url: string, label?: string }` (Drizzle migration).
- [ ] API: `PUT /api/executions/[id]/preview-urls` (or extend an existing route) to set/clear them.
- [ ] UI: an input in the execution view to paste/edit one or more URLs (per service).
- [ ] ManualProvider reads these; if a manual URL exists for a worktree/service it takes precedence (or is selectable).
- **Acceptance:** pasting `https://abc.ngrok.app` on an execution makes the preview pane load it; clearing it reverts to the active provider.

---

## 7. Settings panel  `[P1]`

One place to choose how previews are reached.

- [ ] Extend the preview settings UI: choose the **active remote provider** (Localhost-only / Beam / Portless / Manual / installed plugins).
- [ ] Beam fields: `server` (e.g. `demobeamd.dynami.sm`) + `token`, written to the dedicated `--config` file from §4 (**not** `~/.beamd/config`); "Test connection" runs `beamd status --json --config <cfg>` (reports `{profile, agentRunning, server, slug, healthy}`).
- [ ] Manual default: optional URL **template** (e.g. `https://{name}.mytunnel.com`) used when no explicit per-execution URL is set.
- [ ] Persist settings (existing settings store / `~/.flow` or DB).
- **Acceptance:** changing the provider in settings changes which URL previews resolve to, with no code edit; beamd config entered here is what BeamdProvider uses.

---

## 8. Naming helper  `[P0]`

- [ ] `previewName(worktreeName, service?)`: returns `<worktreeName>[-<service>]`, lowercased, non-`[a-z0-9-]` replaced with `-`, collapsed, trimmed to ≤63 chars. (Worktree is already `<workspace>-<uuidsub>`.)
- [ ] Use it in BeamdProvider and PortlessProvider.
- **Acceptance:** `previewName('flow-a3f9','api') === 'flow-a3f9-api'`; weird inputs still produce a valid RFC-1123 label.

---

## 9. Retire the old preview system  `[P1]`  (after §1–6 land)

- [ ] Delete `src/app/preview/[workspace]/[[...path]]/route.ts` and its helpers `inject-base`, `rewrite-set-cookie`, the preview-proxy auth (`_pt`/preview-cookie) if unused elsewhere.
- [ ] Move Tailscale UI (`tailscale-menu-items.tsx`, `use-tailscale-url`) behind a provider/plugin or remove.
- [ ] Remove dead code paths in the supervisor/status now that port handling is deterministic.
- [ ] Update any execution view code that linked to `/preview/...` to use the provider URL.
- **Acceptance:** `grep -rn "/preview/" src` shows no remaining path-proxy usage; the app builds and previews work end-to-end via providers; no references to removed helpers.

---

## 10. Multi-service URL injection  `[P2]`

Make multi-service worktrees actually work remotely (a web app calling
`localhost:<apiport>` breaks off-machine).

- [ ] When a worktree exposes multiple services, resolve all their preview URLs first, then inject siblings as env into each child (e.g. `API_URL=https://flow-a3f9-api.<base>`), via a per-worktree convention/config.
- **Acceptance:** a web+api worktree, opened from a phone, has the web app talking to the api's public URL (not localhost).

---

## 11. Preview object + UX polish  `[P2, after beamd is confirmed]`

The first-class model the rest hangs off (status, thumbnail, lazy start,
share). Spec separately before building; summary tasks:

- [ ] Model `Preview { worktree, service?, status, urls, thumbnail, lastViewedAt }` with states `building|starting|running|crashed|stopped`.
- [ ] **Thumbnails:** on `running` (or on completion), capture via `/api/capture` and show on the execution card for glanceable triage.
- [ ] **Lazy start + idle-evict:** start the server on first view; stop it after N idle minutes; keep the name/URL stable so it cold-starts on next open.
- [ ] **Share:** a "Share" action that produces a public (optionally signed/expiring — needs beamd preview-auth; see the beamd repo's `docs/preview-auth-spec.md`) link.
- **Acceptance:** an overnight queue of finished tasks shows thumbnails; opening a cold task spins it up with visible status; idle tasks stop on their own; the URL still works later.

---

## Suggested order
**Phase 0 (confirm beamd, ~this week):** §1 (minimal) + §2 (minimal) + §4 → one worktree live via beamd end-to-end.
**Phase 1 (integrate + simplify):** finish §1–3, §5, §6, §7, §8, then §9.
**Phase 2 (UX):** §10, §11.
