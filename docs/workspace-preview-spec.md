# Workspace Preview: Proxy + Embed Spec

Self-contained plan for testing a workspace's running app from any
browser — laptop, phone, tablet — without cloning the repo, without
installing the runtime, without exposing dev ports. Flow runs a
reverse proxy on its existing origin and the execution view embeds
it as an iframe. The user clicks "Start preview," types (or accepts)
the dev command for that workspace, and the app appears in-place
next to the chat, tree, and diff.

Builds on `docs/execution-view-spec.md` (which landed the four-pane
review surface). Slots in as a peer to the Files/Diff/Terminal panes.
Listed there as a non-goal for that spec; here it gets its own.

This is intentionally scoped narrower than the takeover spec
(`docs/local-remote-takeover-spec.md`) — that one solves *editing
code* from a remote machine; this solves *running and testing the
app*. For the common "I just want to see what the agent built" case,
preview replaces the need for takeover entirely.

### Two modes, one proxy

The proxy itself is mode-agnostic — it forwards HTTP to a local port.
What differs is who owns the dev-server process and how Flow learns
about its port:

- **Command mode (default).** Flow spawns and supervises the
  workspace's `preview_command`, scrapes the port from stdout, and
  owns lifecycle (start, stop, crash detection, startup sweep of
  orphans). Self-contained — works with no external tools installed.
- **Portless mode (optional upgrade).** If the user has installed
  [Portless](https://github.com/vercel-labs/portless), Flow reads
  `~/.portless/routes.json` to discover the workspace's app + port,
  and forwards there. Portless owns the process. Flow's supervisor,
  port scraper, and startup sweep are bypassed entirely. Worktree
  hostnames (`<branch>.<app>.localhost`) come for free from Portless's
  built-in convention.

Command mode is the safe default. Portless is a recommended upgrade
surfaced as hints in the UI when we detect it on the host.

## The architectural premise

The workspace already runs on the host machine — that's where the
worktree, the agent process, and the agent's terminal live. If the
agent runs `pnpm dev`, the dev server is sitting on some local port
on the same machine Flow is running on. Flow can already read the
terminal output, so Flow already knows (or can learn) which port.

The only thing missing is a path from the user's remote browser to
that local port. We give it one: a reverse-proxy route on Flow's
own origin that forwards to the dev server. No new ports exposed,
no DNS setup, no tunnel per workspace, no extra cert. The Flow URL
the user already has — `https://flow-host:4224`, `https://flow.tail.ts`,
ngrok, whatever — covers it.

Critically, this is **framework-agnostic.** The proxy speaks HTTP
to whatever HTTP server the workspace is running: Next dev server,
Vite, Flask `app.run()`, Rails, Phoenix, `python -m http.server`,
`cargo run` with axum, Storybook, a static `python -m SimpleHTTPServer`,
a Go binary with net/http. The discovery regex matches any
`localhost:<port>` printed to stdout. The proxy code doesn't branch
on framework.

## Goals

1. A **Preview** pane in the execution view that displays the
   workspace's running app inline, next to Files / Diff / Terminal.
2. Works with any dev server that binds to a local TCP port and
   speaks HTTP — no per-framework code paths.
3. Same-origin with Flow so authentication is uniform and remote
   browsers reach it through the existing Flow URL.
4. One button starts and stops the preview process; the dev port
   is auto-detected from the process's stdout (command mode), or
   read directly from `routes.json` (Portless mode).
5. Manual refresh button on the pane — user reloads to see new
   changes from the agent.
6. Open-in-new-tab for full-window testing without the surrounding
   chrome.
7. Detect Portless and surface it as an upgrade path — workspace
   that opts in gets cleaner URLs, free worktree isolation, zero
   spawn/supervise code on Flow's side, and automatic Tailscale
   sharing for remote test devices.

## Non-goals (v1)

- WebSocket / SSE proxying. **No HMR, no live reload.** Refresh
  manually. The proxy will return 502 for upgrade requests so the
  failure mode is loud rather than mysterious.
- Per-workspace subdomain mounting (`<workspace>.preview.<host>`).
  Requires wildcard DNS + wildcard cert; not worth it for v1.
- Active rewriting of JS/CSS bodies to inject path prefixes. We
  inject a `<base href>` tag into HTML and document the dev-server
  base-path knobs for apps that use root-absolute paths in JS.
- Multiple simultaneous previews per workspace.
- Authenticated upstream dev servers — assume the dev server is
  unauthenticated localhost.
- Reverse-engineering the dev server's port from system state
  (lsof, /proc). Stdout scraping only.
- Agent-facing screenshot / page-state APIs — those are covered by
  the `/browse` skill on the agent's side.

## Decisions log

| Topic                            | Decision                                                                          |
|----------------------------------|-----------------------------------------------------------------------------------|
| Proxy mount                      | Subpath on Flow origin: `/preview/<workspace-id>/*`                               |
| HTTP-only at launch              | Yes. WebSocket returns 502 with `preview_websocket_unsupported`.                  |
| Path-prefix strategy             | Inject `<base href="/preview/<id>/">` into HTML. Document framework base-path config. |
| Two preview modes                | `command` (Flow-supervised, default) and `portless` (Portless-owned).             |
| Mode default                     | `command`. Portless is opt-in with detection-based hints in the UI.               |
| Portless discovery               | Read `~/.portless/routes.json` directly (`fs.watch` for live updates). No CLI shelling. |
| Portless hostname derivation     | `<workspace>` for main worktree, `<branch>.<workspace>` for linked — matches Portless. |
| Upstream URL (portless)          | `http://127.0.0.1:<route.port>` with `Host: <hostname>` header — bypass Portless TLS. |
| Startup sweep scope              | Command mode only. Portless owns its own lifecycle (`portless prune`).            |
| Tailscale URL surfacing          | Item in execution header's 3-dot overflow popover, not on the pane itself.        |
| Port discovery (command mode)    | Scrape stdout for `(localhost\|127\.0\.0\.1):(\d+)`. First match wins.            |
| Preview command storage          | `preview_command` column on `workspaces`. Free-form text. No defaults.            |
| Port override (command mode)     | `preview_port_override` column on `workspaces`. Nullable.                         |
| Mode storage                     | `preview_mode` column on `workspaces`: `'command' \| 'portless' \| null` (auto).  |
| Hostname override (portless)     | `portless_hostname` column on `workspaces`. Nullable; otherwise derived.          |
| Process owner (command mode)     | Flow daemon spawns and supervises one subprocess per workspace.                   |
| Process owner (portless)         | Portless. Flow does not spawn or supervise. Detects via `proxy.pid` + routes.json. |
| Process lifetime                 | Command: until Stop / pane close / Flow shutdown. Portless: owned by Portless.    |
| Auth into the iframe             | Short-lived preview token in query → `Set-Cookie` scoped to `/preview/<id>/`.     |
| Schema delta                     | Four new columns on `workspaces`; runtime state lives in memory only.             |
| UI placement                     | Sibling pane in execution view alongside Files / Diff / Terminal.                 |
| Refresh behavior                 | Manual button reloads iframe `src`. No polling.                                   |
| Open in new tab                  | `<a href="/preview/<id>/" target="_blank">` on the pane chrome.                   |
| Multiple workspaces, port clash  | Command: frameworks pick alternates on bind fail. Portless: ephemeral ports, no clash. |
| Logs                             | Command: stdout/stderr in a strip under the iframe. Portless: not shown (Portless owns it). |

## Architecture

### Topology

The proxy route is identical in both modes — only the port lookup
differs. Mode resolution happens per-request based on the workspace's
`preview_mode`.

**Command mode:**

```
┌──────────────────────────────────────────────────────────────┐
│  Remote browser                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Flow UI (chat / tree / diff / terminal / preview)      │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │  <iframe src="/preview/ws_abc/?_pt=tok_xyz">     │  │  │
│  │  │  ┌──────────────────────────────────────────┐    │  │  │
│  │  │  │  Dev app (proxied HTML/CSS/JS/JSON)      │    │  │  │
│  │  │  └──────────────────────────────────────────┘    │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                            │ HTTPS
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  Host machine                                                │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Flow server (port 4224)                                │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │  /preview/<ws-id>/[...path] route handler        │  │  │
│  │  │  - validates preview token / cookie              │  │  │
│  │  │  - resolves mode for workspace                   │  │  │
│  │  │  - looks up port via supervisor                  │  │  │
│  │  │  - fetch() → 127.0.0.1:<port>/<path>             │  │  │
│  │  │  - streams response (injects <base> for HTML)    │  │  │
│  │  └──────────────────────┬───────────────────────────┘  │  │
│  └─────────────────────────┼─────────────────────────────┘  │
│                            ▼                                 │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Preview supervisor (in-process)                        │  │
│  │  - spawns workspace.preview_command in worktree cwd     │  │
│  │  - captures stdout/stderr to ring buffer                │  │
│  │  - scrapes port from stdout                             │  │
│  │  - exposes { workspaceId → { pid, port, status, logs } }│  │
│  └────────────────────────────────────────────────────────┘  │
│                            │ spawns                          │
│                            ▼                                 │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Dev server subprocess (cwd: worktree path)             │  │
│  │  - whatever the user configured (pnpm dev, flask run,   │  │
│  │    cargo run, python -m http.server, ...)               │  │
│  │  - binds to some 127.0.0.1:<port>                       │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

**Portless mode:**

```
┌──────────────────────────────────────────────────────────────┐
│  Remote browser (same iframe URL — mode is transparent)      │
└──────────────────────────────┬───────────────────────────────┘
                               │ HTTPS
                               ▼
┌──────────────────────────────────────────────────────────────┐
│  Host machine                                                │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Flow server (port 4224)                                │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │  /preview/<ws-id>/[...path] route handler        │  │  │
│  │  │  - resolves mode → portless                      │  │  │
│  │  │  - reads hostname from workspaces row            │  │  │
│  │  │  - lookup in portless route store (cached)       │  │  │
│  │  │  - fetch() → 127.0.0.1:<route.port>/<path>       │  │  │
│  │  │    with Host: <hostname> header                  │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  └─────────────────────────┬─────────────────────────────┘  │
│                            │ reads                           │
│                            ▼                                 │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  ~/.portless/routes.json (file, watched by Flow)        │  │
│  │  [{hostname, port, pid, tailscaleUrl?, ...}, ...]       │  │
│  └─────────────────────────▲─────────────────────────────┘  │
│                            │ writes                           │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Portless daemon + dev server subprocesses              │  │
│  │  (started by user via `portless run` in the worktree)   │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

Flow never spawns anything in Portless mode. The user runs
`portless run` (or `portless <name> <cmd>`) inside the worktree;
Portless registers a route; Flow reads the route and proxies.

### Proxy route

Catch-all App Router handler at
`src/app/preview/[workspace]/[[...path]]/route.ts`. Exports `GET`,
`POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`.

```ts
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
```

Per-request logic:

1. **Auth.** Accept either:
   - A valid preview cookie `flow.preview.<workspace-id>` (set on a
     prior request).
   - The `_pt=<token>` query param (the iframe's initial src includes
     this). On success, set the cookie via `Set-Cookie` with
     `Path=/preview/<ws-id>/; HttpOnly; SameSite=Lax`.
   - As a fallback, the standard Flow bearer header — useful for
     debugging via curl.
   On failure, return 401 with a small HTML body that explains the
   pane needs to be reopened.
2. **Mode resolution.** Load the workspace row. Resolve effective
   mode: explicit `preview_mode` if set, else auto-detect — if
   Portless is running and a route matches the workspace's derived
   hostname, use `portless`; else `command`.
3. **Port lookup.**
   - **Command mode:** read the runtime port from the supervisor.
     If no process is running, return 503 with the
     `preview_not_running` HTML stub.
   - **Portless mode:** look up the route in the in-memory snapshot
     of `routes.json` (maintained by the portless watcher). If no
     route matches, return 503 with the `portless_route_missing`
     HTML stub explaining to run `portless run` in the worktree.
4. **Build upstream URL.** Always `http://127.0.0.1:<port>/<rest-of-path>?<query>`
   regardless of mode. In Portless mode, also set the outgoing
   `Host` header to the portless hostname so the dev app sees the
   correct host (matters for cookie scopes, OAuth callbacks,
   host-aware routing in the app).
5. **Forward.** Use `fetch(upstreamUrl, { method, headers, body, redirect: 'manual', cache: 'no-store' })`.
   - Strip hop-by-hop headers from the inbound request (`connection`,
     `keep-alive`, `proxy-*`, `te`, `trailer`, `transfer-encoding`,
     `upgrade`).
   - Strip Flow's own auth headers/cookies before forwarding.
   - In Portless mode, overwrite `Host` to the portless hostname.
   - For `Upgrade: websocket` requests, short-circuit with
     `502 preview_websocket_unsupported` (we documented this).
6. **Mirror response.** Pass through status, status text, headers
   (minus hop-by-hop). Body handling:
   - If `Content-Type` starts with `text/html`: pipe through a
     `<base>` injector (see below). Stream as it arrives — don't
     buffer the whole document.
   - Otherwise: pass the body stream through verbatim.
7. **Set cookie** if the request used `_pt` and the cookie wasn't
   already present.

The handler should not throw on upstream errors — wrap fetch in
try/catch and return 502 with a small HTML payload describing what
went wrong (ECONNREFUSED, ETIMEDOUT, etc.). Most often: "dev server
isn't listening on the expected port yet — refresh in a moment."

### HTML base-tag injection

Most dev apps generate a mix of relative URLs (`./style.css`,
`assets/foo.png`) and root-absolute URLs (`/static/bar.js`). The
relative ones break when the app is served under `/preview/<id>/`
unless we inject a `<base href>` tag so the browser resolves them
against the prefix.

`src/lib/preview/inject-base.ts` exports a `TransformStream` that:

- Scans incoming HTML for `<head>` (case-insensitive, in the first
  few KB).
- Inserts `<base href="/preview/<workspace-id>/">` immediately
  after it.
- If `<head>` doesn't appear in a buffered window (e.g. partial
  HTML fragments from `htmx`), falls back to inserting before the
  first `<` after some byte budget. Worst case: passes through
  unchanged.
- Operates on bytes (`Uint8Array`), not strings, to avoid mangling
  binary content if a server mislabels.

The transform is the only HTML-specific code in the proxy. CSS, JS,
JSON, images, and everything else pass through untouched.

Root-absolute paths in JS (e.g. `fetch('/api/users')`) are not
fixed by the base tag. For those, the workspace's dev server must
be configured with a matching base path. Common knobs (documented
in the spec doc and surfaced in the UI):

- Next.js: `basePath: '/preview/<id>'` in `next.config.ts`
- Vite: `--base=/preview/<id>/`
- Create React App: `"homepage": "/preview/<id>"` in package.json
- Astro: `base: '/preview/<id>'` in `astro.config.mjs`
- Express: app-level path prefix `app.use('/preview/<id>', ...)`
- Flask: `APPLICATION_ROOT='/preview/<id>'` + `ProxyFix`
- Django: `FORCE_SCRIPT_NAME='/preview/<id>'`
- Phoenix: `url: [path: '/preview/<id>']`
- Rails: `config.relative_url_root = '/preview/<id>'`

We don't enforce this. Apps that only use relative URLs work fine
out of the box; apps that don't, the user configures their dev
server and it works. The pane UI shows the canonical `<base>` URL
near the address strip so the user can copy it.

### Preview supervisor

Module at `src/lib/preview/supervisor.ts`. Process-scoped singleton
that holds `Map<workspaceId, PreviewProcess>`.

```ts
type PreviewStatus = 'idle' | 'starting' | 'running' | 'crashed' | 'stopped';

type PreviewProcess = {
  workspace_id: string;
  pid: number;
  command: string;
  cwd: string;
  status: PreviewStatus;
  port: number | null;
  started_at: string;
  exit_code: number | null;
  log_buffer: RingBuffer<string>; // last ~256 KiB of stdout+stderr, line-tagged
};
```

API:

- `start(workspaceId, opts?)` — spawn the workspace's `preview_command`
  with `cwd = worktreePath(workspaceId)`. Idempotent: if already
  running, returns existing record.
- `stop(workspaceId)` — SIGTERM, then SIGKILL after 5s if still alive.
- `status(workspaceId)` — current record.
- `tailLogs(workspaceId, fromCursor?)` — return new log lines since
  cursor. Used by the UI's log strip.
- `subscribe(workspaceId, listener)` — event bus for status changes
  (used to push updates over the existing session stream channel).

Spawn details:

- `child_process.spawn(shell, [-c, command], { cwd, env: { ...process.env, ...workspaceEnv }, detached: false })`.
  Use a shell so users can write `cd packages/web && pnpm dev` or
  whatever. `process.env` carries through node/python/cargo paths.
- `stdio: ['ignore', 'pipe', 'pipe']`.
- On stdout/stderr `data` events:
  - Append to ring buffer with timestamp + stream label.
  - Run port detector (see below).
  - Emit `logs` event for subscribers.
- On `exit`: set `status = 'crashed'` if exit code ≠ 0 and the user
  didn't explicitly stop; else `stopped`. Clear `port`. Don't
  auto-restart in v1.
- Lifecycle: process group is killed via `process.kill(-pid)` so
  shell-spawned children (`pnpm` → `next dev` → ...) all die.

### Port discovery

`src/lib/preview/detect-port.ts`. State machine that consumes
stdout/stderr chunks line-by-line and emits a port number once
found.

```ts
const PORT_PATTERNS = [
  /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1?\]?):(\d{2,5})\b/i,
];
```

First match wins. Once a port is captured, the detector stops
running for that process. If the user has set `preview_port_override`,
the override wins and the detector is bypassed.

Edge cases covered by the regex:

- Vite: `Local:   http://localhost:5173/`
- Next: `▲ Next.js 15.x - Local:        http://localhost:3000`
- Flask: ` * Running on http://127.0.0.1:5000`
- Rails: `Listening on http://127.0.0.1:3000`
- Phoenix: `[info] Access LiveDashboardWeb at http://localhost:4000`
- Cargo+axum: `listening on 127.0.0.1:3000`
- Static: `Serving HTTP on 0.0.0.0 port 8000`

Not covered (need manual override):

- Servers that bind silently and print only an unhelpful "ready"
  message.
- Servers that print only `:::3000` (bare IPv6 wildcard) without a
  host prefix.

Detection timeout: 30s from process start. If no port appears by
then, the supervisor sets `status = 'running'` (process is up) but
leaves `port = null`. The pane shows a "no port detected — set
manually?" affordance.

### Portless integration

`src/lib/preview/portless.ts` — small read-only adapter over
Portless's on-disk state. Flow never writes to Portless's files;
Portless owns them. Flow watches and reads.

```ts
type PortlessRoute = {
  hostname: string;
  port: number;
  pid: number;
  tailscaleUrl?: string;
  tailscaleHttpsPort?: number;
  tailscaleFunnel?: boolean;
};

type PortlessStatus = {
  installed: boolean;        // PORTLESS_STATE_DIR or ~/.portless exists
  proxyRunning: boolean;     // proxy.pid present and alive
  stateDir: string;
};

getPortlessStateDir(): string                              // honors PORTLESS_STATE_DIR
detectPortless(): PortlessStatus
readRoutes(): PortlessRoute[]                              // tolerant of concurrent writes
findRoute(hostname: string): PortlessRoute | null
startWatcher(onChange: (routes) => void): () => void       // fs.watch on routes.json
derivePortlessHostname(workspace, worktreeBranch?): string
```

**Reading routes.** Direct `fs.readFile` of `<state>/routes.json`.
JSON-parse; on parse failure (concurrent write mid-read), retry once
after a 10ms backoff before returning `[]`. Don't acquire Portless's
`routes.lock` directory for reads — Portless's own `loadRoutes`
doesn't either, and the file format is array-of-objects which JSON
either parses or doesn't. We accept the rare empty-read on conflict.

**Watcher.** Single `fs.watch` on `routes.json` shared across the
process. Each call to `startWatcher` registers a listener; returns
an unsubscribe. The watcher debounces (50ms) and re-reads on
change. Snapshot is kept in memory; the proxy route reads from the
snapshot, never directly from disk on the request path.

**Detection.** `detectPortless()` checks:
1. State dir exists (default `~/.portless`, override via
   `PORTLESS_STATE_DIR`).
2. `proxy.pid` file present.
3. PID in that file is alive (`process.kill(pid, 0)`).

The result is cached for 10s — auto-detection is consulted on every
workspace settings open and pane mount, but we don't need to stat
the filesystem on every cache hit.

**Hostname derivation.** Mirrors Portless's own convention so Flow
and Portless agree without coordination:

- Main worktree: `<workspace-name>` (sanitized to DNS-safe form).
- Linked worktree: `<branch>.<workspace-name>` (branch sanitized,
  slashes replaced with `-`).

If `workspaces.portless_hostname` is set explicitly, that wins. The
derivation is also exposed in workspace settings as the
auto-populated default value of the override input.

**No process management.** No spawn, no kill, no log capture in
Portless mode. The user runs `portless run` themselves; Flow simply
proxies whatever shows up in `routes.json`. The supervisor module
(`src/lib/preview/supervisor.ts`) is bypassed entirely when a
workspace is in Portless mode.

### Schema delta

Four nullable columns on `workspaces` (`src/lib/db/schema.ts`):

```ts
preview_mode:          text('preview_mode'),          // 'command' | 'portless' | null (auto)
preview_command:       text('preview_command'),       // command mode only
preview_port_override: integer('preview_port_override'), // command mode only
portless_hostname:     text('portless_hostname'),     // portless mode override
```

Resolution at read time:

1. If `preview_mode` is explicitly set, honor it.
2. Else, if `detectPortless().proxyRunning` and a route exists for
   `derivePortlessHostname(ws)`, treat as `portless`.
3. Else, treat as `command`.

Why scalar columns vs a JSON blob: cheap to read, simple to set
from the UI, matches the existing scalar-column pattern. The
runtime port and process state live in memory only — no need to
persist them; on Flow restart, command-mode previews are all
stopped and the user restarts them on demand. Portless state is
owned by Portless and persists across Flow restarts for free.

### API routes

All under the bearer-token middleware except the proxy itself,
which has its own preview-token mechanism (described above).

`POST /api/workspaces/[id]/preview/start` *(command mode only)*
- Validates `preview_mode` resolves to `command` and that
  `preview_command` is set. If portless → 400 `preview_mode_not_command`.
  If no command → 400 `preview_no_command`.
- Calls `supervisor.start(id)`. Returns `{ pid, status, port, started_at }`.
- Mints a fresh preview token, returns it as `preview_token` for
  the client to embed in the iframe src as `?_pt=<token>`. Token
  TTL: 24h, scoped to that workspace.

`POST /api/workspaces/[id]/preview/stop` *(command mode only)*
- Calls `supervisor.stop(id)`. Returns `{ status: 'stopped' }`.
- 400 in Portless mode — stopping is `portless` CLI's job.

`GET /api/workspaces/[id]/preview/status` *(both modes)*
- Returns a unified status envelope:
  ```ts
  { mode: 'command' | 'portless',
    status: 'idle' | 'starting' | 'running' | 'crashed' | 'stopped',
    port: number | null,
    hostname?: string,             // portless only
    tailscale_url?: string,        // portless only, if present in route
    started_at?: string,
    exit_code?: number | null,     // command only
  }
  ```
- In Portless mode, computed from `findRoute(hostname)`. In Command
  mode, from the supervisor record (minus the log buffer).

`GET /api/workspaces/[id]/preview/logs?cursor=<n>` *(command mode only)*
- Returns lines since cursor. 404 in Portless mode (Portless owns
  its own logs; user reads them in their terminal).

`POST /api/workspaces/[id]/preview/refresh-token` *(both modes)*
- Mints a fresh preview token. Used when the cookie expires and the
  iframe needs to re-init. Same TTL as start.

`GET /api/system/portless-status` *(new)*
- Returns `{ installed, proxy_running, state_dir }` from
  `detectPortless()`. Used by the workspace settings UI to show
  "Detected on this host" hints and by the auto-detect mode logic.

Note: the proxy itself (`/preview/<id>/...`) is **not** under `/api`;
it sits at the root so iframe absolute paths work cleanly. Middleware
allowlist entry needed:

```ts
// middleware.ts
if (req.nextUrl.pathname.startsWith('/preview/')) {
  return NextResponse.next(); // auth handled in the route
}
```

### Preview token mechanics

Goal: the iframe can authenticate without the parent injecting
Authorization headers (iframes can't), without exposing the dev
server publicly, and without long-lived cookies that survive past
session end.

Flow:

1. UI calls `POST /api/workspaces/<id>/preview/start` → response
   includes `preview_token` (opaque, ~22 chars).
2. UI sets iframe `src="/preview/<id>/?_pt=<token>"`.
3. First request arrives at the proxy. Handler validates token
   against the supervisor's in-memory token map. If valid, sets
   cookie `flow.preview.<id>=<cookie-token>` with
   `Path=/preview/<id>/; HttpOnly; SameSite=Lax; Max-Age=86400`.
4. Subsequent requests use the cookie; the `_pt` query param can
   be stripped from the URL via History API but the cookie covers
   it.
5. On Stop or process crash, the token is invalidated.

Tokens live in the supervisor's memory, not the database — they
share lifetime with the process and disappear on Flow restart
(which is fine; previews don't survive restart either).

The cookie is path-scoped to `/preview/<id>/` so it doesn't leak
across workspaces or to the rest of Flow.

### Action / pane integration

The execution view (per `docs/execution-view-spec.md`) currently
has Files / Diff / Terminal panes. Preview is added as a fourth
sibling. Concretely:

- The right-column tab strip gets a "Preview" tab.
- When selected, renders `<PreviewPane>` filling the column
  (taking over the terminal slot when active, or as a new vertical
  region — depends on the final pane layout; see Phase 3).

`<PreviewPane>` (`src/components/executions/preview/preview-pane.tsx`):

The pane has two visual variants driven by the workspace's resolved
preview mode. The iframe area is shared; the controls and empty
states differ.

**Shared:**

- **Iframe area:** `<iframe src="/preview/<id>/?_pt=<token>" sandbox="allow-scripts allow-forms allow-popups allow-same-origin" />`. Same-origin since the proxy is on the Flow origin; `allow-same-origin` keeps cookies and storage working inside the app.
- **Header strip:** [URL bar showing `/preview/<id>/<current-path>` — read-only in v1] [Refresh button] [Open-in-new-tab button] [Settings cog opens workspace preview config].
- The Tailscale URL (when present in Portless mode) is **not** in the pane header — it lives in the execution view header's 3-dot overflow popover, since it's a workspace-wide concept rather than a pane-specific one. See `ExecutionHeader` integration below.

**Command mode adds:**

- **Start/Stop button** at the left of the header strip.
- **Log strip (collapsible, default 80px):** last ~200 lines of process output. Auto-scrolls. Color-codes stderr.
- **Empty state (no command):** "Set a preview command for this workspace." Inline text input + Save. Below: a small "Tip: use Portless for named URLs and zero config — `npm i -g portless`" hint linking to https://portless.sh. When `portless-status` indicates installed-but-not-used, the hint upgrades to a one-click "Switch to Portless mode" button.
- **Empty state (command set, not started):** "Start preview" button. Below: small text showing the command.
- **Starting state:** spinner + "Starting <command>…" + streaming logs.
- **Crashed state:** red banner with exit code and last 20 lines of logs. "Restart" button.
- **No port detected:** "Process running but no port detected. Set port manually?" → inline number input.

**Portless mode adds:**

- **No Start/Stop button.** Portless owns lifecycle.
- **Hostname chip** in the header: `<hostname>.localhost` (read-only).
- **Empty state (no matching route):** "No app registered as `<hostname>`. Run this in the worktree:" with a copy-button block showing `portless run` (or the inferred command). Below: small "Portless docs" link.
- **Stale route (PID dead):** "App crashed. Restart it in your terminal." Manual refresh button reattempts the lookup.
- **No log strip** — Portless owns its own logs; we don't try to capture them.

### ExecutionHeader integration

The existing `ExecutionHeader` already has a 3-dot overflow popover
(used by the takeover button, per
`docs/local-remote-takeover-spec.md`). Add a new item there, gated
on Portless mode AND the workspace's route having `tailscaleUrl`:

- **"Open on Tailscale"** — opens `route.tailscaleUrl` in a new
  tab. Adjacent "Copy Tailscale URL" item copies to clipboard.
- **"Open on Tailscale Funnel"** — only shown if
  `route.tailscaleFunnel` is true and a public URL is available.

Reading source: `useTailscaleUrl(workspaceId)` hook tails the
portless route store and returns the current `tailscaleUrl` (or
null). Item is hidden when null.

This placement keeps the preview pane simple — the iframe-via-proxy
path doesn't change based on whether a Tailscale URL exists — while
giving the user a one-click escape to a direct, non-proxied URL
when their browser can reach the tailnet.

### Settings UI for the workspace

New fields in the workspace settings sheet
(`src/components/workspaces/...`):

- **Preview mode** — dropdown with `Auto-detect` (default) / `Command` / `Portless`. Helper text below explains current resolution: "Auto-detect → Portless (detected on this host)" or "Auto-detect → Command (Portless not detected)". Updates live as the host's Portless state changes.
- **Preview command** *(command mode only)* — text input. Helper text: "Command to start your dev server in this workspace. Examples: `pnpm dev`, `flask --app app run`, `cargo run`, `python -m http.server`."
- **Port (optional)** *(command mode only)* — number input. Helper text: "Override auto-detection if your dev server doesn't print its port on startup."
- **Portless hostname** *(portless mode only)* — text input. Helper text: "Defaults to `<derived-from-workspace+worktree>`. Override to match a portless name you've already registered."

**Portless hint banner** (shown when mode resolves to `command` AND
`detectPortless().installed === false`):

> Tip: install [Portless](https://portless.sh) for named URLs
> (`myapp.localhost`), automatic worktree isolation, and Tailscale
> sharing. Then this workspace will auto-detect it. [Learn more]

**Portless upgrade banner** (shown when mode resolves to `command`
AND `detectPortless().proxyRunning === true`):

> Portless is running on this machine. Want to switch this
> workspace to Portless mode for cleaner URLs and free worktree
> isolation? [Switch to Portless]

The banner sets `preview_mode = 'portless'` and prefills
`portless_hostname` with the derived default; the user can edit it
before saving.

No "preset" buttons in v1 for command mode (`pnpm dev`, `npm start`,
etc.) — keeps the surface minimal. We can add presets in a polish
phase if users ask.

## CLI commands

None in v1. The Flow CLI doesn't need to know about preview — it's
entirely a server-side feature. If we add CLI surface later, likely
candidates:

- `flow preview start <workspace>` — start a workspace's preview
  from the laptop without opening the UI (command mode only).
- `flow preview logs <workspace>` — tail logs (command mode only).

Portless mode users use Portless's own CLI directly:

- `portless run` — start the workspace's dev server (inside the
  worktree).
- `portless list` — see all registered routes.
- `portless prune` — clean orphans.
- `portless get <name>` — print the URL.

Flow's UI surfaces these commands as copy-paste hints in the
Portless-mode empty state rather than wrapping them.

## Build phases

Each phase ships independently. Don't merge a phase until the prior
one is stable.

### Phase 1 — Proxy + supervisor (command mode server side)

- [ ] Migration: add `preview_mode`, `preview_command`, `preview_port_override`, `portless_hostname` to `workspaces`. `pnpm db:generate`.
- [ ] `src/lib/preview/supervisor.ts` — process map, start/stop/status, ring buffer.
- [ ] `src/lib/preview/detect-port.ts` — regex matcher, line-by-line consumer.
- [ ] `src/lib/preview/inject-base.ts` — TransformStream for `<base>` injection.
- [ ] `src/app/preview/[workspace]/[[...path]]/route.ts` — catch-all proxy. Command-mode lookup only in this phase; Portless branch added in Phase 5.
- [ ] `src/app/api/workspaces/[id]/preview/start/route.ts`
- [ ] `src/app/api/workspaces/[id]/preview/stop/route.ts`
- [ ] `src/app/api/workspaces/[id]/preview/status/route.ts` — return `mode: 'command'` shape only in this phase.
- [ ] `src/app/api/workspaces/[id]/preview/logs/route.ts`
- [ ] `src/app/api/workspaces/[id]/preview/refresh-token/route.ts`
- [ ] `middleware.ts` allowlist for `/preview/*`
- [ ] `src/lib/db/queries.ts` — `getWorkspacePreviewConfig`, `setWorkspacePreviewConfig`
- [ ] Verify end-to-end with `curl` before any UI: start a workspace's preview, hit the proxy with cookie auth, get the dev app's HTML back with `<base>` injected.

### Phase 2 — Preview pane UI (command mode)

- [ ] `src/hooks/use-preview.ts` — wraps start/stop/status/logs queries and mutations, holds the active preview token.
- [ ] `src/components/executions/preview/preview-pane.tsx`
- [ ] `src/components/executions/preview/preview-header.tsx` (start/stop, URL strip, refresh, new-tab, settings)
- [ ] `src/components/executions/preview/preview-logs.tsx` (tail strip)
- [ ] `src/components/executions/preview/preview-empty.tsx` (empty + crashed + no-port states)
- [ ] Wire pane into the execution view's pane strip — sibling to Files / Diff / Terminal.

### Phase 3 — Workspace settings (command mode)

- [ ] Workspace settings sheet: preview command + port override inputs.
- [ ] Mutation through `src/lib/api/workspaces.ts`.
- [ ] Persist immediately on blur. No save button.

### Phase 4 — Polish (command mode)

- [ ] Process auto-cleanup on Flow shutdown (SIGTERM all supervised processes).
- [ ] Startup sweep: scan `<brain>/preview/*.pid`, verify command, kill orphaned process groups.
- [ ] Log strip: line virtualization if it grows large; default-collapsed if status is healthy.
- [ ] Surface the `<base href>` value near the URL strip with a copy button + brief tooltip explaining the base-path knob for the user's framework.
- [ ] Friendly 502 page when upstream connection refused — explain it's likely the dev server starting up; offer Retry button.
- [ ] End-to-end manual test: localhost host + laptop on Tailscale, multiple frameworks (Next, Flask, plain `python -m http.server`).
- [ ] End-to-end manual test: phone browser — confirm pane is usable on narrow viewport.

### Phase 5 — Portless integration

Lands as a clean layer on top of the working command-mode MVP.
Adds the second mode without touching the supervisor.

- [ ] `src/lib/preview/portless.ts` — `detectPortless`, `readRoutes`, `findRoute`, `startWatcher`, `derivePortlessHostname`. Honors `PORTLESS_STATE_DIR`.
- [ ] Singleton portless-watcher in the server process — one `fs.watch` on `routes.json`, in-memory snapshot updated on change, debounced 50ms.
- [ ] Mode resolution in `src/lib/db/queries.ts`: `resolveWorkspacePreviewMode(workspace)` returns the effective mode using explicit setting → detection → fallback.
- [ ] Proxy route: add Portless branch. Upstream URL stays `http://127.0.0.1:<port>` but `Host` header is overwritten to the portless hostname.
- [ ] `src/app/api/system/portless-status/route.ts` — exposes `detectPortless()` to the UI.
- [ ] `src/app/api/workspaces/[id]/preview/status/route.ts` — extend response to include `mode`, `hostname`, `tailscale_url` when applicable.
- [ ] `src/hooks/use-portless-status.ts` — polls `/api/system/portless-status` every 30s, snappier on focus.
- [ ] `src/hooks/use-tailscale-url.ts` — reads current Tailscale URL for the workspace (from preview status).
- [ ] Settings UI: add Preview-mode dropdown, Portless-hostname input, the two hint banners (not-installed and installed-but-not-used).
- [ ] Pane: add Portless-mode empty states (no route, stale route). Hide start/stop and log strip when mode is `portless`.
- [ ] `ExecutionHeader` 3-dot popover: add "Open on Tailscale" and "Copy Tailscale URL" items, gated on `tailscaleUrl` being present.
- [ ] Migration of existing workspaces: leave `preview_mode = null` (auto-detect). No backfill needed.
- [ ] End-to-end manual test: install Portless on the host, `portless run` a Next app in one worktree and a Flask app in another, verify both load through Flow's proxy from a remote browser.
- [ ] End-to-end manual test: a workspace with Portless route registered but Flow set to Command mode — verify it doesn't accidentally pick up the portless route.

### Out of scope (deferred to a later spec)

- WebSocket / HMR proxying. Would land as a thin custom Node server intercepting `upgrade` events before Next.js handles the request. Real complexity; needs its own design. Same gap exists in both modes.
- Server-Sent Events. The current proxy preserves streaming, so SSE *should* work out of the box for content-typed responses, but it's untested.
- Auto-restart on crash (command mode). Portless mode users restart in their terminal.
- Detect dev server already running on a known port (skip spawn) — in command mode. Less relevant in Portless mode since Portless owns the spawn.
- Preset commands (`pnpm dev`, `npm start`) in the settings UI.
- Portless install / setup flow inside Flow. We link out to portless.sh and let the user install via npm. No in-app installer in v1.
- Reading per-app Portless config (`portless.json`, `package.json#portless`) to pre-populate Flow's workspace settings. Future: we could parse these files in the worktree and auto-fill `portless_hostname`.

## Files

### New

- `docs/workspace-preview-spec.md` (this doc)
- `src/lib/preview/supervisor.ts`
- `src/lib/preview/detect-port.ts`
- `src/lib/preview/inject-base.ts`
- `src/lib/preview/portless.ts` *(Phase 5)*
- `src/app/preview/[workspace]/[[...path]]/route.ts`
- `src/app/api/workspaces/[id]/preview/start/route.ts`
- `src/app/api/workspaces/[id]/preview/stop/route.ts`
- `src/app/api/workspaces/[id]/preview/status/route.ts`
- `src/app/api/workspaces/[id]/preview/logs/route.ts`
- `src/app/api/workspaces/[id]/preview/refresh-token/route.ts`
- `src/app/api/system/portless-status/route.ts` *(Phase 5)*
- `src/hooks/use-preview.ts`
- `src/hooks/use-portless-status.ts` *(Phase 5)*
- `src/hooks/use-tailscale-url.ts` *(Phase 5)*
- `src/components/executions/preview/preview-pane.tsx`
- `src/components/executions/preview/preview-header.tsx`
- `src/components/executions/preview/preview-logs.tsx`
- `src/components/executions/preview/preview-empty.tsx`
- `src/components/executions/preview/preview-portless-empty.tsx` *(Phase 5)*

### Modified

- `src/lib/db/schema.ts` — four columns on `workspaces` (`preview_mode`, `preview_command`, `preview_port_override`, `portless_hostname`)
- `src/lib/db/queries.ts` — preview config helpers + `resolveWorkspacePreviewMode`
- `src/lib/api/workspaces.ts` — preview methods + settings update
- `src/components/executions/execution-view.tsx` — preview pane slot in the pane strip
- `src/components/executions/execution-header.tsx` — 3-dot popover gains Tailscale items in Portless mode *(Phase 5)*
- `src/components/workspaces/...` — settings sheet adds preview-mode dropdown, command/port fields (command), hostname field (portless), Portless hint banners
- `middleware.ts` — allowlist `/preview/*`

## Edge cases

- **Preview command exits immediately.** Supervisor sees exit within 1s and marks `crashed`. UI shows logs + Restart. No retry loop.
- **Dev server binds to a unix socket / pipe (no TCP).** Out of scope; the proxy is TCP-only. If demand arises, supervisor can detect via lsof and the proxy can switch to a unix socket fetch backend.
- **Dev server prints port to a file rather than stdout.** Out of scope in v1; user sets `preview_port_override` manually.
- **App makes `fetch('/api/...')` from JS.** Browser hits Flow's `/api/...`, not the dev server's. User configures their dev server with a matching base path (knob list above) and rebuilds. Without it, dynamic JS-issued absolute paths break.
- **App uses cookies with `Path=/`.** Cookie is set on Flow's origin's root path, leaks across workspaces and to Flow itself. Mitigation: the proxy could rewrite outgoing `Set-Cookie` headers to scope `Path` to `/preview/<id>/`. Add in polish if it causes issues; for v1 we accept the leak since dev cookies are short-lived and the user controls both ends.
- **Multiple workspaces on the same default port.** Second framework fails to bind to 3000, picks an alternate. Supervisor scrapes the alternate from stdout. No special handling needed.
- **User changes `preview_command` while preview is running.** UI shows "Restart to apply" banner. New command takes effect only on next Stop+Start.
- **`<base>` injection misses the `<head>` tag.** Server sent malformed HTML or used a non-standard structure. Transform falls back to passing through unmodified. App may have broken relative URLs; user works around it with a real base-path config.
- **Flow restarts while preview is running.** Supervisor state is in-memory, so processes are orphaned. On boot, supervisor starts empty. Orphans need to be killed manually (or via Flow's existing process-group teardown if we register them with the OS process group). Phase 4 should add a startup sweep: scan for orphaned children of the previous PID and reap.
- **User opens two browser tabs of Flow against the same workspace.** Both iframes share the same preview process and same token. Each is independently authed via cookie. No collision.
- **Dev server takes 60s to start (Rails, big monorepo Vite, slow Docker image).** Port detection timeout is 30s; relax to a per-workspace timeout setting if needed, or let the user set the port manually. Process keeps running either way; user can refresh once they see it bind.
- **WebSocket / EventSource subscription from the dev app.** WS → 502 with a clear error. SSE *should* pass through since the proxy streams response bodies; not explicitly tested in v1.
- **Open in new tab → URL is `/preview/<id>/` without `_pt`.** Cookie is path-scoped to `/preview/<id>/` and SameSite=Lax, so the new tab inherits it. Works as long as the cookie hasn't expired.

### Portless-specific edge cases

- **`routes.json` mid-write during a Flow read.** Portless writes the whole file atomically inside its `routes.lock`. JSON parse failure is rare but possible if the OS reports the file before the new bytes are durably written. Flow retries the read once after 10ms; if still bad, returns the previous in-memory snapshot.
- **Portless proxy daemon dies but dev servers keep running.** `routes.json` is stale-ish but the `pid` entries still point at live processes. Flow's lookup finds them and the proxy still works. `portless prune` is the user's recourse.
- **Workspace's portless hostname collides with another workspace.** Both worktrees register the same hostname, last one wins in Portless. Flow's derivation includes the branch prefix for linked worktrees, so this only happens if two workspaces share both name and branch. Surface as a settings-screen warning when detected.
- **Workspace renamed in Flow.** Derived hostname changes. If the user already ran `portless run` under the old name, Flow loses the route lookup. Settings UI shows "Expected hostname `<new>` — no route. (Running as `<old>`? Re-run `portless run`.)"
- **User has `PORTLESS_STATE_DIR` set in their shell but not in Flow's environment.** Flow looks in `~/.portless` and sees no proxy; mode resolution falls back to command. The detect logic reads `process.env.PORTLESS_STATE_DIR`, so the user just needs to start Flow from a shell with the same env. Document this in the settings hint.
- **Portless route has `tailscaleUrl` but Flow's host isn't on the user's Tailnet.** Doesn't matter — Flow doesn't try to reach the Tailnet URL itself; it only surfaces it to the user as a clickable link. The user's browser does or doesn't reach it based on their own network.
- **Workspace explicitly pinned to Portless mode, but Portless not installed.** Settings UI surfaces a red banner: "Portless not detected on this host. Install it or switch to Command mode." Proxy returns 503 `portless_not_running` with the same explanation inside the iframe.
- **Workspace explicitly pinned to Command mode, but Portless also has a route registered for the same hostname.** Flow respects the explicit pin — uses the supervisor, ignores the Portless route. No mixing.
- **Portless's local TLS CA isn't trusted on this machine.** Doesn't affect Flow at all — we don't talk to Portless over TLS; we go straight to the loopback port from `routes.json`. The user's browser only sees Flow's certs, never Portless's.
- **Multiple Node processes reading `routes.json` concurrently.** All readers are independent; the file is reread on watcher events. No coordination needed between Flow instances or between Flow and other tools.

## Reference paths

### Inside Flow

- Existing route pattern (auth + streaming): `src/app/api/sessions/[id]/messages/route.ts`
- Middleware: `middleware.ts`
- Workspace surface: `src/lib/workspaces/index.ts`
- Worktree path lookup: `src/lib/config/paths.ts` (use `getAppRoot` / workspace-specific helpers)
- Workspaces table: `src/lib/db/schema.ts` (`workspaces`)
- Queries layer: `src/lib/db/queries.ts`
- Execution view shell: `src/components/executions/execution-view.tsx`
- Execution header (3-dot popover host for Tailscale items): `src/components/executions/execution-header.tsx`
- Pane sibling examples: `src/components/executions/execution-terminal-panel.tsx` (terminal slot — same shape preview will occupy)
- Session stream channel (for log subscription, if reused): `src/hooks/use-session-stream.ts`
- Existing config column pattern on workspaces (the `setup_*` analog mentioned in the takeover spec)

### Portless (external)

- Repo: https://github.com/vercel-labs/portless
- npm package: `portless` — published, exports `RouteStore`, `RouteInfo`, types from the package main (`dist/index.js`). Could be added as a runtime dep if we want type-safe access to the routes file format; otherwise we read `routes.json` directly and define our own types.
- Routes file shape: `~/.portless/routes.json` — JSON array of `{ hostname, port, pid, tailscaleUrl?, tailscaleHttpsPort?, tailscaleFunnel? }`. Source-of-truth: `packages/portless/src/routes.ts` and `types.ts` in the repo.
- State dir override: `PORTLESS_STATE_DIR` env var (default `~/.portless`).
- Other state files (for reference, not used by Flow): `proxy.pid`, `proxy.port`, `routes.lock` (directory used for write-side locking; Flow doesn't write).
- Agent skill (useful for documenting our portless integration in the open-source release): https://github.com/vercel-labs/portless/blob/main/skills/portless/SKILL.md
