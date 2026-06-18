# Hosted beamd auth — the Flow-side spec

Status: **design**. Captures how remote-preview onboarding should work against
*hosted* beamd, where the OSS/self-hosted path was built first and the hosted
specifics were never fully thought through. Companion to
[`beamd-device-code-contract.md`](./beamd-device-code-contract.md) (what Flow
needs from the beamd *CLI*) and [`preview-system-spec.md`](./preview-system-spec.md)
(the preview system overall). This doc is the Flow-side product + integration
view; the device-code contract is the wire detail.

## TL;DR

- Keep the credential model: **Flow owns nothing.** The login lives in beamd's
  shared `~/.beamd/` store; Flow is just another client (human + agent + Flow,
  one machine, one credential). Nothing here changes that.
- The hosted gaps that the OSS path glosses over are three: **token source**,
  **token lifecycle**, and the **edge ≠ dashboard** split.
- The aligned hosted on-ramp is **device-code (browser-approve) login that mints
  a durable workspace key**, folding into the existing connect → resolve → QR
  flow with no Flow rework. Token-paste stays as the always-available fallback.
- Flow must run a beamd **new enough** to (a) read the account format and (b)
  speak `--device --json`. The binary-resolution + skew-legibility work for (a)
  shipped — see [Binary & version compatibility](#binary--version-compatibility).

## Why hosted is different from OSS

The OSS/self-hosted path (already built) is: the user runs their own beamd edge,
copies its static token, and pastes `server` + `token` into Flow, which runs
`beamd login --server <edge> --token <token>` and verifies with `beamd check`.
Three assumptions in that flow quietly break for hosted:

### 1. Token source — dashboard, not edge config

- **OSS:** the token is a static string in the edge's own config; the user
  already has it because they run the edge.
- **Hosted:** the token is a **workspace API key minted by the hosted
  dashboard**. The user has to go get it. There's no on-ramp for someone who has
  never used beamd — which is most hosted users, whose *only* relationship with
  beamd is "previews inside Flow."

### 2. Token lifecycle — session vs durable

The stored account can be one of two kinds, and they are not interchangeable for
Flow's use:

- **`kind: session`** — a short(er)-lived token from an interactive login. It can
  expire, at which point previews silently 401 and the machine reads as
  disconnected with no obvious cause.
- **`kind: api-key`** (durable) — a long-lived workspace key with no interactive
  expiry.

Flow runs unattended (the agent opens tunnels on its own, lazy-start brings
previews up on first view). It must therefore connect with a **durable key**, not
a session token. Observed in the wild: a `~/.beamd/accounts/<edge>.yaml` with
`kind: session` — exactly the footgun. **Requirement:** the hosted connect path
must result in a durable credential in `~/.beamd/`.

### 3. Edge ≠ dashboard

The host you *log in against* (the tunnel **edge**) and the host that **mints the
key / shows the dashboard** can be different domains. Concretely, on staging:

| Role | Host | What it is |
|------|------|------------|
| Dashboard / marketing / key page | `staging.beamd.ai` | A normal web origin (HTTP 200). **Not** a beamd edge — `beamd check` against it fails `tls: no application protocol`. |
| Tunnel **edge** (what `--server` wants) | `staging.beamd.run` | Real beamd edge. `beamd check` → `{ ok: true, slug, baseDomain }`. Tunnels serve at `*.staging.beamd.run`. |

So "set Server to `beamd.ai`" is wrong for hosted — that's the dashboard. The
connect UI must make the **edge host** the thing the user enters (or, better,
discover it for them — see [Edge discovery](#edge-discovery)). The connect form
copy was updated to say "set Server to the edge host the dashboard shows you."

## Goals / non-goals

**Goals**

- A first-run user with no beamd key can connect remote preview in one approval,
  from inside Flow, without leaving to find a token.
- The resulting credential is durable (survives restarts, no silent expiry).
- The same flow works for the terminal-first user (they may already be logged in;
  Flow inherits it and never asks again).
- Zero new Flow-owned credential surface — `~/.beamd/` stays the single source of
  truth, shared by human + agent + Flow.

**Non-goals**

- Flow storing, proxying, or refreshing tokens. (Still no.)
- A Flow-owned config file for beamd. The active provider lives in `preview.json`;
  the credential lives only in beamd's store.
- Multi-account / per-execution credentials. One machine, one beamd account.

## Target UX — device-code, browser-approve

The headline entry point is unchanged: **"Open on your phone"** (`open-on-device.tsx`)
and the Beamd sheet (`beamd-sheet.tsx`). What changes is the *connect step* inside
them when the machine isn't connected yet.

```
Not connected
   │  user clicks "Connect" (or "Open on your phone" → connect inline)
   ▼
Flow spawns:  beamd login --server <edge> --device --json     (NDJSON stream)
   │
   ├─ first line {event:"device_code_unsupported"} ──► fall back to TOKEN PASTE form
   │
   └─ first line {event:"pending", verification_uri_complete, user_code, …}
          │  Flow shows: the user_code + an "Approve in beamd" button
          │  (same machine → Flow can open the browser itself)
          ▼
      user approves in browser (durable key minted under their workspace)
          │
          ├─ {event:"connected", server, slug}  ──► credential persisted in ~/.beamd/
          │        │
          │        ▼  Flow flips activeProvider → beamd, re-resolves, shows QR
          │      CONNECTED → QR / live preview
          │
          └─ {event:"error", code:"expired"|"denied"|"timeout"} ──► show reason + retry
```

The wire format and the exact CLI surface are specified in
[`beamd-device-code-contract.md`](./beamd-device-code-contract.md). This doc only
adds the **hosted product requirements** on top of it:

1. The terminal `{event:"connected"}` must leave a **durable** credential
   (`kind: api-key`-equivalent), not a session token — see lifecycle above.
2. The approval page is hosted (the dashboard origin, e.g. `*.beamd.ai`); the
   minted key authorizes against the **edge** (`*.beamd.run`). The CLI hides this
   split from Flow — Flow only ever passes the edge `--server` and consumes the
   two events.

### Edge discovery

To spare the user the edge-vs-dashboard trap entirely, the ideal is that Flow
does **not** ask for a server at all in the hosted path:

- Option A (preferred): a well-known hosted edge default. Flow ships the canonical
  hosted edge host (e.g. `beamd.run`) so "Connect to hosted beamd" needs zero
  text entry — just approve. Self-hosted users still get the manual server field.
- Option B: the device-code `pending` event (or a discovery call) returns the
  edge `baseDomain`, and Flow stores/uses that. The user picks "hosted" vs
  "self-hosted (enter edge)", nothing more.

Until one of these lands, the connect form keeps the manual **edge host** field
with corrected copy.

## Connect → resolve → QR integration

This is deliberately a *small* change because the surrounding flow already exists:

- `BeamdConnect` (`src/components/settings/beamd-connect.tsx`) gains a primary
  **"Connect with beamd"** (device-code) button; the existing server/token inputs
  become the "Use an API key instead" fallback (auto-shown when the edge reports
  `device_code_unsupported`, or behind a disclosure).
- The device-code stream is driven by a new server route (e.g.
  `POST /api/preview/settings/connect-device`) that spawns the CLI, relays the
  `pending` object to the client, and resolves on the terminal event. The client
  shows `user_code` + an approve link and waits. **No token ever touches Flow.**
- On `connected`, reuse the existing `onConnected` hook: flip `activeProvider` to
  `beamd` and re-resolve the preview URL straight to the QR (`qr-code.tsx`) — the
  same path the token flow uses today.
- `beamd check` still runs post-connect (verified-on-connect stays), so
  "connected" always means "reached the edge".

Everything downstream — `beamdProvider.resolve`, lazy start, idle-evict, the
shared-store reads — is unchanged.

## Binary & version compatibility

Device-code requires a beamd that ships `--device --json`, and reading a
hosted-written account requires a beamd new enough to parse its on-disk format.
Both are the same underlying concern: **Flow must run a current-enough beamd.**

The resolution + legibility half of this is **done** (the (b) work):

- `resolveBeamdBin()` (`src/lib/preview/beamd/cli.ts`) now **prefers a
  user-installed `beamd` on PATH** over Flow's bundled copy, skipping
  `node_modules/.bin` shims and anything resolving into the bundled package. The
  store's on-disk format tracks the newest CLI that writes it, and an older CLI
  can't read a newer store — so deferring to the user's own beamd avoids a silent
  misread. `FLOW_BEAMD_BIN` still overrides everything.
- `beamdBinInfo()` reports the resolved binary + version + an `outdated` flag, and
  the settings/test responses now carry `beamd.bin` and a `beamd.error` reason.
  A version-skew account (old binary, newer store) surfaces as a legible
  `beamd_cli_outdated` message in the connect panel instead of a blank
  "not connected".

What's **not** yet done and belongs to the hosted milestone:

- A **minimum-version gate** that blocks/`warns` device-code when the resolved
  beamd predates `--device --json`, with a clear "update beamd" CTA.
- Optionally, preferring the *newest* available beamd by version (today we prefer
  any external one and surface staleness rather than auto-selecting by version).

## Token-paste fallback (today)

Until a reachable hosted edge advertises device-code, the token path stays and is
already decent: verified-on-connect (`beamd login` → `beamd check`, rollback on
failure), guided "where do I get a key?" help, and a one-tap "Use Beamd" when the
machine is already logged in. The only correctness fixes folded in now:

- Connect copy clarifies **edge host vs dashboard domain**.
- (Recommended) when the dashboard mints a **session** token, surface a hint that
  a durable workspace key is preferred for unattended use.

## What Flow builds vs what beamd/hosted must provide

**beamd (CLI + hosted edge) must provide** — see the device-code contract for
wire detail:

- [ ] `beamd login --server <host> --device --json` (NDJSON: `pending` →
      `connected`|`error`; `device_code_unsupported` to trigger fallback).
- [ ] The hosted edge advertises device-code in auth discovery and hosts the
      approval page.
- [ ] Approved device-code exchange mints a **durable** workspace credential into
      `~/.beamd/` (not a session token).
- [ ] (Edge discovery) a hosted edge default or a discoverable `baseDomain` so
      Flow needn't ask for a server.

**Flow builds** (no rework of the credential model) — **the Flow side is built**;
the fallback is live-tested and the happy path lights up the moment beamd ships
`--device --json`:

- [x] `POST /api/preview/settings/connect-device` — spawns `beamdLoginDevice`,
      relays the NDJSON stream (`pending`/`connected`/`unsupported`/`error`),
      verifies-on-connect (`beamd check`, rollback on failure), falls back to
      token paste on `device_code_unsupported`. Streams `application/x-ndjson`.
- [x] `beamdLoginDevice` CLI wrapper (`src/lib/preview/beamd/cli.ts`) — drives
      `beamd login --device --json`, classifies an unknown `--device` / missing
      terminal event as `beamd_device_unsupported`, honors an `AbortSignal`.
- [x] `BeamdConnect` device-code UI — "Connect with beamd" primary + pending
      card (code + approve link + waiting/cancel); API-key inputs demoted to a
      fallback that auto-reveals on `unsupported`. `useConnectDevice` hook reads
      the stream.
- [x] Reuse `onConnected` → flip provider → re-resolve → QR (unchanged path).
- [x] Prefer the user's beamd binary + skew legibility (`resolveBeamdBin`,
      `beamdBinInfo`, settings `beamd.bin`/`beamd.error`).
- [x] Edge-vs-dashboard connect copy.
- [~] Minimum-version gate: capability is **runtime-detected** (the `unsupported`
      fallback), and a below-floor binary already surfaces via `bin.outdated` +
      the skew banner. A hard version-pin for device-code can't be set until
      beamd's `--device` ships and we know its minimum version.

> Status as of 2026-06-17: built + typechecked; the `unsupported → API-key`
> fallback verified end-to-end against beamd **0.0.5** (still no headless
> `--device --json` — `login --help` lists none, `-device` is an unknown flag).
> The `pending`/`connected` branches are contract-ready but unexercised until
> beamd ships the headless device-code mode. (0.0.5 did land the project-config
> rename `.beamd`→`beamd.yaml` and a `beamd link` command — both transparent to
> Flow, which is filename-agnostic.)

## Acceptance criteria

- A machine with **no** prior beamd login connects hosted remote preview via a
  single browser approval initiated inside Flow, ending on a working QR — with no
  token copy-paste and nothing stored by Flow.
- The resulting `~/.beamd/` credential is durable: a Flow restart and an
  agent-initiated `beamd open` both succeed days later with no re-auth.
- A terminal user already logged in is never prompted to connect again.
- If the resolved beamd is too old for device-code (or for the account format),
  Flow says so specifically and points at the fix — never a silent failure.
- Self-hosted/OSS continues to work unchanged via the token-paste fallback.

## Open questions

- Canonical **hosted edge host** for the zero-entry default (Option A) — needs to
  be fixed before edge discovery can be hidden from the user.
- Durable-key **scopes**: what role/permissions should the device-code-minted key
  carry (owner vs preview-only)? Least-privilege for an unattended preview client.
- Should Flow **proactively warn** when an existing account is `kind: session`
  (nudge re-connect for a durable key), or only act on actual expiry?
