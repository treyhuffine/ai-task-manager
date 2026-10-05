# tRPC WebSocket transport

WebSocket is the default for browser tRPC requests. The transport uses the same router,
domain operations, types, TanStack Query caches and optimistic hooks. No database
migration is involved. Terminal output has a typed subscription with the same
replay cursor and ring-buffer recovery as the compatibility SSE adapter. Browser
terminals always use an independent WebSocket connection, including in API HTTP mode.

## Selecting a transport

Open **Settings > General > Connection transport**. New views use
**WebSocket (default)**. A saved HTTP choice is respected. The preference belongs
to this browser origin. Browsers with unavailable storage also default to WS.
The status explains whether the socket is ready or
the view is using HTTP fallback. The diagnostics show successful query/mutation
counts and the latest response time for each transport.

Select **HTTP** to revert ordinary API requests immediately. Terminal creation,
listing, input, resize, closing and output stay on their independent WebSocket.
Writes already sent on an API socket finish there before it closes. No database
migration, cache clearing, component rewrite or data rollback is needed.

Operators can set `RI_TRPC_WS_DISABLED=1` and restart Home to disable the socket
endpoint for every viewer. Ordinary API clients negotiate capabilities through
authenticated HTTP before attempting WS and fall back when the endpoint is unavailable. A
proxy that blocks upgrades also causes API fallback. Terminals connect directly
over WS and show an unavailable notice instead of falling back. Disabling this
endpoint therefore disables browser terminals. The built-in TLS gateway
supports WSS using an HTTP/1.1 upgrade alongside HTTP/2 requests.

## Runtime and authorization

`src/service/http-server.ts` handles `/api/trpc/ws` upgrades. Next instrumentation
publishes the WS handler from its own application runtime, using the same
`AppRouter` and process as HTTP, the PTY registry, workers and harness state.
Development, direct production, CLI and supervised desktop launchers use this
host. Direct production and development launchers hold the Home owner lock.
The Next router's HMR listener has a separate registration target so each
upgrade is dispatched once and tRPC cannot bypass maintenance admission.
HTTP route hot reload publishes the current procedure definition to existing
sockets. Router changes become available when Next recompiles the HTTP route.
The tRPC server package remains external to both Next bundles so tracked
subscription envelopes share their symbol identity. Domain errors use a shared
brand to preserve their status and body across the same bundle boundary.

Native `next dev`/`next start` commands bypass this custom host, advertise no WS
capability and continue to serve HTTP, but cannot serve browser terminals. Use `pnpm dev`, `pnpm start` or the CLI
launcher for WebSocket transport. `pnpm dev --port ...`, `--hostname ...`, `--webpack` and
`--turbopack` are supported. CLI development requires the normal `pnpm cli:build`
after changes to the custom host.

The first tRPC connection message carries the API token and protocol number,
never the URL. Cookies and explicit bearer credentials are supported. Browser
origins must exactly match the public Host and scheme. Viewer scope, expiry,
revocation, Home identity, API compatibility and forwarded identity headers are
validated before effects. Worker and session tokens cannot become viewer keys.
Every procedure revalidates its connection credential, and a one-second sweep
closes revoked or expired connections even when only subscriptions remain.
Host-token changes also remove cached Home-machine privileges.

The procedure middleware admits reads and task/note/area saves during drain,
refuses new work, and takes the same activity leases as HTTP. Offline maintenance
and service validation refuse upgrades and all procedure effects. A passive
subscription does not hold an activity lease for its lifetime. Shutdown sends
a reconnect notification and closes sockets with a bounded force-close deadline.
Heartbeat messages detect dead connections, incoming frames are capped at 2 MiB,
terminal subscriber queues at 512 KiB/256 frames, and socket output at 1 MiB.

## Client recovery and terminal input

`createAppTRPCClient` routes the same inferred procedures and query options over
HTTP or WS. Query keys, optimistic partial merges, editor bodies and input-carrying
mutation metadata are unchanged. Calls with per-operation identity headers
remain isolated on HTTP because a socket has connection-scoped authentication.
`context: { httpOnly: true }` also selects HTTP for a particular call.
The capability check always uses HTTP. A disabled or unavailable socket, a
background view, or an explicit HTTP preference also routes requests over HTTP.
Non-browser clients default to HTTP. A native JS client can opt into WS by
passing an absolute API URL, its WebSocket implementation and
`getMode: () => 'websocket'` to `createAppTRPCClient`. Thus the browser default
does not mean every tRPC request uses WS.

The client confirms an authenticated WS ping before sending an application write.
A failed API connection uses HTTP for 30 seconds before negotiating again. Reads
that lose a response can retry over HTTP. A sent mutation that loses its
acknowledgement returns `424 / unconfirmed_write` and is never replayed on HTTP.
Autosaves retain the draft for explicit recovery. Existing request abort signals
and deadlines are honored, with a two-minute bound for otherwise unbounded WS
queries/mutations. Token changes negotiate a fresh connection. A background view
releases its socket after five seconds, after any pending writes finish, and
reconnects when shown.

The dedicated `terminalTRPCClient` uses `websocketOnly: true`, with no HTTP
capability request or fallback. It shares one socket across this view's terminals
and does not change the API mode or its diagnostics. Switching the API preference
never interrupts a terminal subscription. General API and terminal connections
may coexist as two sockets. Authentication, protocol checks and deadlines still
apply to both.

Terminal input retains its immediate first send and adaptive single-flight
batching. Input waits for the output feed to be ready. Disconnects pause input
and discard unsent bytes, including keys typed during the outage. Acknowledgement
gates each subsequent batch. An unconfirmed input
pauses typing, drops unsent bytes and requires **Continue typing** after reviewing
the screen. Keystrokes entered while paused are discarded. Output uses
`terminals.output`, a typed tracked subscription over the existing local/worker
feed without an HTTP round trip. Reconnects use only the cursor actually
delivered to that screen. A replay gap resets to the PTY ring snapshot. Hidden
terminal screens release their subscriptions. Disconnects or subscription errors
show a reconnecting notice and retry WS with backoff from one to thirty seconds.
The server-side shell keeps running. A fresh `ready` resumes typing unless an
unconfirmed write still needs explicit review. Resizing is resynchronized then.
A terminal that exited or disappeared is never reopened by the retry loop.
Unavailable terminal lists are polled every five seconds over WS. Unconfirmed
create/close results refresh the list without retrying the mutation.

External terminal REST/SSE adapters and worker HTTP/SSE relays remain supported.
Browser terminal traffic does not use either HTTP input or SSE output fallback.

Chat and global live events keep their multiplexed SSE transport. Uploads,
downloads, OAuth, pairing, MCP and external REST compatibility keep their
protocol-specific adapters.

## Verification and measurement

Implementation acceptance checklist:

- [x] Same-process Next runtime, development, production and supervised launchers
- [x] Viewer authentication, origin checks, protocol negotiation, revocation
- [x] Maintenance admission, passive subscriptions, bounded buffers and shutdown
- [x] WebSocket browser default, connection diagnostics and immediate HTTP rollback
- [x] HTTP fallback for reads, no automatic replay of ambiguous writes
- [x] WS-only terminal control/input/output, API preference independence and replay
- [x] Direct and gateway socket tests, disconnect and transport-switch tests
- [x] Typecheck, production/CLI builds and full regression suite

The local CLI still dispatches locally or through authenticated HTTP when the
server owns the action. Connected CLI calls remain authenticated HTTP. Workers
retain their durable HTTP/SSE command and output relay. Viewer WebSockets reach
remote terminals through that existing worker relay.

The socket integration tests exercise real loopback connections and the TLS
gateway, authenticated reads/writes, key rotation and revocation, protocol and
origin refusals, drain saves, lost acknowledgements, safe read fallback and
switching to HTTP while an original write awaits its acknowledgement. Terminal
tests cover replay, snapshots, bounded queues, cancellation, visibility,
API preference independence, bounded reconnect backoff and paused input. The
production and development smoke also exercise nine domains and a real PTY
shared across HTTP and WS.

Verified on 2026-10-03: 5,076 tests passed and 35 skipped, typecheck and
transport-code lint passed, production and CLI/service builds passed. The
existing `useMemo` callbacks in General settings still fail its React hook lint
rule, outside the transport-control insertion. Isolated
development, direct production and packaged-service smokes passed typed terminal delivery, WS/SSE replay,
HTTP rollback and structured protocol refusals after the HTTP router was loaded.
A native development HMR socket check also passed. Manual browser interaction
was unavailable in this session, so the settings control and terminal notice
have build, type and transport coverage but no manual UI verification.
The default-transport checks exercise real browser reads/writes with no saved
preference and with a saved HTTP rollback choice. They also cover unavailable
storage and the non-browser HTTP default.

Verified on 2026-10-05 for the WS-only terminal change: 78 focused tests passed,
including all terminal transport/input tests and the icon-test rerun. Production
build, typecheck and lint for every changed code file passed. The isolated
production smoke passed terminal create/list/resize/input/output and WS replay
while ordinary API calls used HTTP, plus external SSE compatibility.
The full suite reported 5,146 passed, 35 skipped and two failures. The icon test
passed alone without the concurrent build. The PostHog browser-sign-in assertion
in `hosted-routes.test.ts` also fails on unchanged main. No manual browser UI
interaction was performed.

Reproduce the smoke against a running isolated Home under the system temporary
directory:

```sh
pnpm iso /tmp/ri-ws-trial --init --port 42271 -- pnpm dev --port 42271
# A second shell, with the same isolated Home:
pnpm iso /tmp/ri-ws-trial -- pnpm exec tsx scripts/smoke-trpc-websocket.ts http://localhost:42271
```

The smoke refuses real Homes, disables machine-wide skill installation, uses
only its temporary folder and removes its task and terminal afterward. Its test
agent is archived. To check production, build with `pnpm build` and use
`pnpm start --port 42271` inside the same `pnpm iso` command instead of `pnpm dev`.

A production loopback sample of 30 sequential warm `transport.ping`
calls measured HTTP median 4.34 ms / p95 4.68 ms and WS median 1.82 ms / p95
1.91 ms. This measures local transport overhead, including the same admission
check and procedure work. It does not establish internet/tunnel latency, total
app speed or behavior under contention. Measure the real connection and compare
the same operations when assessing transport performance.

Official API references: [WS adapter](https://trpc.io/docs/server/websockets),
[WS link](https://trpc.io/docs/client/links/wsLink),
[tracked subscriptions](https://trpc.io/docs/server/subscriptions).
