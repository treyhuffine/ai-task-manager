# beamd device-code login — the contract Flow needs

Status: **proposal for beamd** (not yet implemented there). This is what beamd
must expose for Flow to turn remote-preview onboarding from "paste an API key"
into "click Connect → approve in your browser → done." Written from first
principles against what the `beamd` CLI does today — treat beamd's own docs as
drafts, not ground truth.

## Why

Today Flow connects a machine to beamd by running `beamd login --server S
--token T`. That stores a credential in `~/.beamd/` and Flow verifies it with
`beamd check`. It works, but the human has to *already have a key* and paste it.
There's no on-ramp for someone who has never used beamd.

beamd's CLI already has the right primitive — `beamd login` **without** `--token`
is meant to do a device-code dance (browser approves, no copy-paste). Two things
block Flow from driving it:

1. **It's interactive.** `beamd login` prints a verification URL + user code to a
   TTY and blocks. There's no machine-readable mode, so a GUI like Flow can't
   show the code, open the browser, and detect completion without scraping
   stdout (fragile).
2. **The edge must advertise it.** If the server doesn't advertise device-code in
   its auth discovery, `beamd login` errors with "pass `--token` instead." The
   public demo edge is OSS static-token, so device-code isn't offered there.

This contract fixes (1). (2) is an edge/hosted-side decision — see the bottom.

## What Flow needs from the CLI

A **headless, scriptable device-code login**. Same effect as `beamd login`
today (writes `~/.beamd/`, no Flow-stored credential), but drivable by a program.
Preferred shape: one long-running command that streams two JSON events.

```
beamd login --server <host> --device --json
```

- Resolves the edge's auth discovery. If the edge does **not** offer device-code,
  exit non-zero with `{"error":"device_code_unsupported","detail":"...","hint":"pass --token"}`
  so Flow can fall back to the token form automatically.
- Otherwise immediately writes **one JSON object per line** (NDJSON) to stdout:

  1. The pending challenge, as soon as it's issued:
     ```json
     {
       "event": "pending",
       "verification_uri": "https://beamd.ai/device",
       "verification_uri_complete": "https://beamd.ai/device?code=ABCD-1234",
       "user_code": "ABCD-1234",
       "expires_in": 900,
       "interval": 5
     }
     ```
  2. Exactly one terminal event when the dance resolves:
     ```json
     { "event": "connected", "server": "beamd.ai", "slug": "my-workspace" }
     ```
     or
     ```json
     { "event": "error", "code": "expired" | "denied" | "timeout", "detail": "..." }
     ```
- On `connected`, the credential is already persisted in `~/.beamd/` (exactly as
  `--token` login does today) and the process exits 0. On any `error` event,
  exit non-zero and persist nothing.
- `--insecure` keeps its current meaning (skip TLS verify for a self-signed
  self-hosted edge).

### How Flow drives it

1. Spawn the command. Read the first NDJSON line.
2. If it's `device_code_unsupported`, silently fall back to the token paste form.
3. If it's `pending`, render the flow: show `user_code`, a "Open beamd to approve"
   button → `verification_uri_complete`, and a "waiting for approval…" spinner.
   (On the same machine Flow can even open the browser itself.)
4. Block on the process's terminal event. `connected` → flip the UI to connected
   and re-resolve the preview URL (straight to the QR). `error` → show the reason
   with a retry.

No polling endpoint to call from Flow, no token to store, no stdout scraping —
beamd owns the poll loop, Flow just consumes two events. This composes cleanly
with everything Flow already has: the connected state is read the same way
(`beamd status` / `beamd check`), and the agent on the same machine inherits the
login for free.

### Acceptable alternative (if streaming is awkward)

A split pair also works:

```
beamd login --server <host> --device --json --begin   # prints the `pending` object, exits 0
beamd login --device --json --wait                     # blocks, prints the terminal event, exits 0/non-zero
```

Slightly more state to manage on Flow's side, but equivalent. The single
streaming command is preferred.

## What the edge / hosted side must do (out of scope for the CLI)

For device-code to be *offered* at all, the edge must:

- Advertise device-code in its auth-discovery payload.
- Implement the device-code grant: issue `{user_code, verification_uri}`, host
  the `/device` approval page, and exchange an approved code for a durable
  credential that lands in `~/.beamd/`.
- Mint that credential under the user's account/workspace (the hosted dashboard).

Until a reachable edge offers this, Flow keeps using the token paste path (which
is already good: verified-on-connect, guided, with a one-tap "Use Beamd" when the
machine is already logged in). The moment an edge advertises device-code and the
CLI ships `--device --json`, Flow's connect step becomes one-click with **no Flow
rework** — it's the same "connect → resolve → QR" flow, just a nicer first step.

## Non-goals

- Flow will never store or proxy the credential. `~/.beamd/` stays the single
  source of truth, shared by human + agent + Flow.
- No new Flow-owned config file. The active provider lives in `preview.json`;
  the credential lives only in beamd's store.
