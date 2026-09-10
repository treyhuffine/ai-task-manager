# Optional built-in HTTP/2 — implementation

Status: Implemented (opt-in, V1). Spec: [optional-http2-spec.md](optional-http2-spec.md).

This document records how the optional HTTP/2 feature is built, how to use it, the
decisions made on points the spec left open, and exactly what has and has not been
verified in this environment.

## What it does

With `--http2`, Flow fronts the app with a built-in TLS listener that negotiates
`h2` (or HTTPS/1.1 for older clients) on the public app port and relays to the
normal Next server over HTTP/1.1 on a private loopback port. Ordinary requests and
long-lived SSE streams then share multiplexed HTTP/2 connections instead of
competing for the browser's small HTTP/1.1 pool. SSE stays SSE. No component,
route, hook, or schema changes. The default startup path is unchanged and never
initializes any TLS or gateway code.

```
Browser --HTTPS/h2--> Flow gateway (public port, in the launcher process)
                          |
                          +--HTTP/1.1 loopback--> Next (private port, 127.0.0.1)
```

## Using it

```sh
# Enable the built-in HTTPS + HTTP/2 gateway.
flow start --http2

# Force the direct HTTP path (overrides FLOW_HTTP2).
flow start --no-http2

# Environment equivalents.
FLOW_HTTP2=1 flow start
FLOW_HTTP2=0 flow start

# Bring your own certificate instead of the generated one.
flow start --http2 --tls-cert /path/cert.pem --tls-key /path/key.pem

# Install / remove browser+OS trust for the generated local CA (explicit only).
flow tls trust
flow tls untrust
flow tls status
```

Precedence: explicit CLI flag, then `FLOW_HTTP2`, then disabled. Switching modes
requires a stop/start; the launcher refuses to start a second backend against a
live instance and reports the running mode. `--http2` and `--portless` are two
different frontends and cannot be combined in V1.

## Module layout

| Location | Responsibility |
| --- | --- |
| `src/lib/config/http2.ts` | Flag resolution (`--http2`/`FLOW_HTTP2`). |
| `src/lib/config/tls.ts` | CA/leaf generation (`@peculiar/x509`), supplied-cert loading, atomic versioned publish, renewal, lock. |
| `src/lib/config/tls-trust/` | Native trust adapters, ownership manifest + journaling, per-target results. |
| `src/cli/commands/tls.ts` | `flow tls trust|untrust|status` (lazy-imports the TLS modules). |
| `src/cli/http2-gateway/` | TLS/HTTP2 listener, streaming proxy, header translation, upgrade forwarding, readiness probe, bounded pools. |
| `src/lib/server-runtime/record.ts` | Generic discovery/ownership record under `getWorkDir()`, public-URL resolution input. |

Integration points touched: `src/cli/commands/start.ts` and `stop.ts` (launch +
process ownership), `src/cli/lib/server.ts` (loopback bind for Next),
`src/lib/auth/bootstrap.ts` (`getLocalBaseUrl()` resolution order),
`src/cli/commands/pair.ts` (LAN guard), `src/cli/index.ts` (flags + command),
`tsup.config.ts`/`package.json` (deps; the CLI artifact is unchanged).

## Decisions made on open points

- **In-process gateway.** The gateway runs inside the `flow start` launcher via a
  lazy dynamic `import()`, not as a separate child process. This gives the
  simplest ownership model (one child to supervise: Next) and satisfies the
  "disabled path does not initialize TLS/gateway code" requirement because the
  default path never evaluates the dynamically-imported modules. The single
  `dist/cli/index.mjs` artifact is preserved.
- **Certificate library.** `@peculiar/x509` over Node WebCrypto (`reflect-metadata`),
  as the spec selected. RSA-2048/SHA-256, 5-year CA, 90-day leaf renewed under 30
  days, atomic versioned-directory publish with a single manifest-pointer rename.
- **Certificate inspection uses Node built-ins.** `crypto.X509Certificate` handles
  fingerprinting and cert/key matching, so the trust layer needs no crypto library
  and is algorithm-agnostic for supplied certs.
- **Windows store via `certutil`.** The current-user `Root` store is managed with
  the built-in `certutil -user -addstore/-delstore/-store Root`, which takes the
  cert path and thumbprint as fixed arguments (no shell interpolation). This
  targets the current-user store, matching the spec's intent.
- **Linux system stores are not auto-elevated.** Writing to the Debian/Fedora
  anchor directories needs root. The app is never run elevated and never captures
  a password. A blocked write returns `permission-denied` with guidance to re-run
  with privileges, rather than silently invoking `sudo`/`pkexec`.
- **Discovery record and portless.** Direct-HTTP and HTTPS launches publish the
  runtime record. Portless is left on its existing `staticUrl` behavior and does
  not publish a record, because the launcher does not own the portless-assigned
  port. `getLocalBaseUrl()` still resolves portless via `staticUrl`.
- **Windows key permissions.** Generated key files are written with POSIX
  `0600`/`0700`, which Windows largely ignores. The `tls/` directory lives under
  the user-profile config dir (already user-scoped). Tightening to explicit
  per-user ACLs via `icacls` is a follow-up to validate on the Windows leg of the
  disposable-environment matrix rather than ship untested here.

## Post-review fixes

A review of the first cut found real failure-path bugs (all now fixed, each with a
regression test):

- **Internal self-calls (P1).** `serverBaseUrl()` returned the public origin,
  which is HTTPS under `--http2`, so the harness's own `fetch` (session sends,
  stop, notify, live signals) failed cert validation. It now targets the private
  HTTP loopback: the `PORT` private port in the server process, or the recorded
  `privateUpstreams.next` out of process. Direct/portless modes are unchanged.
- **Supplied-cert readiness probe (P1).** The probe used the supplied leaf as its
  own trust anchor, so a normal CA-signed cert failed the probe and aborted
  startup. Supplied certs are now probed against their bundle plus the system
  roots, and a supplied-cert probe failure is a warning (proceed) rather than
  fatal — the browser may trust a cert the local probe cannot chain. Generated
  certs stay strict. Validation is never globally disabled.
- **Private-port URL leakage (P2).** Inside the gateway'd Next process
  `getRunningPort()` is the private port, so `getLanBaseUrl()` emitted an
  unreachable `http://<lan>:<privateport>` into external notification links. It
  now returns null in loopback HTTP/2 mode. The gateway also upgrades a
  self-referential `http://<publichost>` redirect (OAuth callbacks Next builds
  from the loopback HTTP connection) to the canonical HTTPS scheme.
- **Gateway socket leaks (P2).** A rejected upgrade (upstream replies non-101)
  now relays the response instead of hanging the client; upgraded WebSocket
  sockets are tracked and destroyed on shutdown; and `clientError` destroys the
  socket instead of leaking it.
- **untrust safety (P2).** Removal honors `createdByUs` (never touches a store
  entry we did not create), keeps the ownership record on a partial or failed
  removal (Linux refresh failure, partial Firefox-profile cleanup) so it can be
  retried, and converges on retry.

### Second review round

A follow-up review found deeper trust-ownership and a few remaining edge bugs
(all fixed, each with a regression test):

- **Trust ownership is now explicit, not inferred from the outcome (P1).** Adapters
  return an `owned` flag. untrust removes an entry only when we actually created
  it. Specifically: the Linux anchor keeps an owned record even when the bundle
  refresh fails (its uniquely-named file is ours) and converges on retry; NSS
  install reports `already-present` (not `installed`) and does not claim
  ownership when the CA was already in the database, so untrust never deletes a
  pre-existing certificate.
- **NSS inspection failures are no longer read as "absent" (P1).** A `certutil -L`
  failure counts as absence only for a recognized not-found error; any other
  failure (locked/unreadable DB) is indeterminate, so removal reports `error`
  and keeps the record instead of falsely reporting success while trust remains.
- **Supplied-cert probe is no longer a blanket bypass.** An expired or not-yet-
  valid supplied cert is rejected at load. A probe failure is only tolerated when
  it is specifically an untrusted chain; a failed health check, h2-negotiation
  failure, or connection error stays fatal.
- **OAuth redirect URIs use the public origin.** `getConnectorRedirectUri()` fell
  back to `http://localhost:<getRunningPort()>`, which is the private Next port
  under `--http2`. It now uses the remote tunnel or `getLocalBaseUrl()` (the
  public HTTPS origin), so provider callbacks are reachable.
- **Internal self-calls follow only a live record.** A stale HTTPS record (crashed
  run, or after switching back to HTTP) no longer redirects self-calls to a dead
  private port.
- **Gateway shutdown / framing.** Shutdown now also destroys lingering ordinary
  HTTPS/1.1 connections (`closeAllConnections`), and a rejected (chunked) upgrade
  response is re-framed correctly (strip framing headers, delimit by close)
  rather than forwarding a decoded body under a `chunked` header.

### Third review round

A further review was right on two things I had wrongly dismissed, plus more edge cases:

- **The dependency isolation WAS broken (corrected).** My earlier init-marker
  measured Flow's own `tls.ts` body (which stayed deferred), but esbuild hoists a
  bare `import 'reflect-metadata'` to eager execution — so the libraries loaded on
  the default path even though `tls.ts`'s body did not run. Fixed by moving all
  `@peculiar/x509` + `reflect-metadata` usage into `tls-x509.ts` and loading it
  with dynamic `import()`. Verified: `reflectMetadataLoaded=false` on `start`/
  `stop --help`, and generation still works (loaded only when it runs).
- **`closeAllConnections` was a no-op.** It is `undefined` on `Http2SecureServer`,
  so the shutdown call silently skipped. Now every accepted TLS connection is
  tracked via `secureConnection` and destroyed on shutdown; an idle keep-alive
  HTTPS/1.1 connection is torn down (regression-tested).
- **NSS ownership is now per-profile (P1).** untrust removes trust only from the
  exact Firefox/Chromium profiles this install added the CA to, never a profile
  that already trusted it. Owned profiles are recorded on the manifest entry and
  accumulate across retries.
- **Wrong-host supplied certs are rejected up front.** `certCoversHost` validates
  the supplied cert covers the public host independently of the probe, so an
  untrusted-issuer TLS error can no longer mask a hostname mismatch.
- **Pre-handshake upgrade cancellation** now aborts and fully closes the in-flight
  upstream connection (dedicated, non-pooled upgrade socket), so a client that
  cancels before the WebSocket handshake completes does not leak it.

Lesson worth recording: verify the *external* effect (does the library execute?),
not a proxy for it (does our wrapper's first line run?). The isolation claim was
real; my measurement was measuring the wrong thing.

## What is verified in this environment

Automated tests (all green, `pnpm test`):

- `src/cli/http2-gateway/gateway.test.ts` — against a fixture upstream over a real
  TLS handshake: `h2` negotiation, the readiness probe, SSE-over-h2 ordering with
  `Connection: keep-alive` stripped, multiple Set-Cookie preserved, private
  `Location` rewritten, a 5 MiB streamed upload, the connection-pressure gate
  (a normal request completes while 12 SSE streams stay open), stream cancellation
  tearing down only that upstream, an HTTPS/1.1 client through the same listener,
  HTTP/1.1 Upgrade (HMR-style WebSocket) forwarding, a rejected upgrade relayed
  instead of hung, upgraded sockets torn down on shutdown, and a supplied
  CA-signed chain validated via the probe CA list.
- `src/cli/http2-gateway/headers.test.ts` — header translation rules, including
  the self-referential http→https redirect scheme upgrade.
- `src/lib/config/tls-trust/trust.test.ts` — trust adapters via an injected native
  runner: command construction, ownership-verified deletion (never by name/serial,
  never a foreign cert), idempotency, permission handling for macOS/Windows/Debian/
  Linux-Chromium-NSS, and untrust safety (never removes an entry it did not create;
  retains the record on Linux-refresh and partial-Firefox failures, converging on
  retry).
- `src/lib/orchestrator/server-client.test.ts` — internal self-calls route to the
  private HTTP loopback under HTTP/2, never the public HTTPS origin.
- `src/lib/config/http2.test.ts`, `src/lib/server-runtime/record.test.ts` — flag
  precedence and the discovery record (publish/read, liveness, owned-clear).

The TLS generation + a real TLSv1.3 handshake trusting the generated CA were also
verified end to end during development.

## What still needs disposable-environment verification

Per spec §4, real trust-store and real-browser behavior must NOT run against a
developer's working machine and are not exercised by `pnpm test`. The following
matrix must be run in disposable VMs / fresh browser profiles before advertising a
target as supported. Record the actual OS and browser versions.

For each target: create a fresh CA, observe browser rejection, `flow tls trust`,
confirm a trusted browser negotiates `h2` for real app requests and SSE, then
`flow tls untrust` and confirm rejection in a fresh browser process. An unrelated
sentinel CA must survive install and removal.

- [ ] macOS system keychain + real Safari (machine-wide store → disposable host/VM).
- [ ] Windows current-user Root + Edge/Chrome (disposable user profile suffices).
- [ ] Ubuntu/Debian system store + `update-ca-certificates` (disposable VM/root).
- [ ] Fedora/RHEL `update-ca-trust` (disposable VM/root).
- [ ] Linux Chromium + Firefox NSS profiles via `certutil` (disposable profiles).
- [ ] Real Chrome and Safari dev HMR over `h2`: page/API negotiate `h2`, the HMR
      socket opens over HTTPS/1.1, edit a component, confirm Fast Refresh +
      preserved client state, then reconnect and reload. Report browser versions.
- [ ] Performance comparison (spec §11): the three-configuration paired runs and the
      connection-pressure functional gate against a real app workload.

WebKit under Playwright and a Node client given the CA are useful but do not prove
real Safari or OS-store integration.
