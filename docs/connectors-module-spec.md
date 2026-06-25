# Connectors — Module Spec (canonical)

**Status:** Final (canonical) · **Date:** 2026-06-18 · **License:** deferred (see §19/§20) ·
**Supersedes:** all prior `connectors-*.md` in this folder.

An open-source, local-first **connector engine**: a small, trustworthy runtime that lets a
human-plus-agent system take authenticated actions on a user's real external accounts. It is
designed to be embedded in this app today, published as a standalone package, and run as a
hosted service — from one codebase, unchanged.

---

## 0. Thesis — why this exists and why it's shaped this way

Three things are true at once in 2026, and the design falls out of holding all three:

1. **Agents acting on real accounts is the unlock** — and also the danger. The hard part is
   not calling APIs; it's doing so *trustworthily*: tokens that never silently die, secrets
   that never leak to a model, side-effects that are gated, every attempt auditable.
2. **People have many identities** — personal mail, work mail, several orgs. Multi-account is
   the product, not an enterprise upsell.
3. **Breadth is a solved problem if you let it be.** You do not hand-build 300 connectors.
   You build a *deep, trusted* core for the daily-driver accounts (mail, calendar) and you
   **ingest the long tail through MCP** — behind the same safety gates.

So the engine is small where it can be (model, ceremony) and uncompromising where it must be
(the trust spine). Everything that is not the trust spine or a daily-driver capability is a
**seam, not a build**. The result is a runtime that is bulletproof underneath and yields
ultra-simple DX (a simple action is ~5 lines; connectors grow with capabilities, not ceremony)
and UX (the agent never dead-ends — it always gets a structured next step the UI can render).

**Positioning:** the local-first, token-custody-stays-with-the-user, trust-first alternative
to hosted connector clouds (Composio/Nango/Paragon) — which can still be plugged in as
optional adapters, but are never required and never hold your secrets.

---

## 1. Principles

**The trust spine (non-negotiable, enforced at the runtime — never per-caller):**

1. **Live tokens.** An action always receives a valid token. Refresh is invisible,
   single-flighted, rotation-aware, and degrades to a clean `auth_required` on revocation.
2. **Secret confinement.** Credentials exist only sealed at rest and momentarily in memory at
   call time. Never to the model, logs, tool I/O, errors, or UI.
3. **One gate.** Every side-effectful action passes through a single approval chokepoint
   *inside* `runAction`, regardless of caller (app / agent / MCP). Safety cannot be a
   property a projection remembers to add.
4. **Total audit.** Every attempt — success, block, failure — is emitted for the host to
   record.
5. **No trusted-by-default external code.** Ingested MCP tools pass through the same gates
   (namespacing, approval, redaction, audit, provenance) as native actions.

**The right-size law:** defer *features* (sync, webhooks, marketplace, workflows, normalized
APIs, dynamic tool routing). Never collapse *trust boundaries*. The earlier mistake to avoid
in both directions: too-small lets actions manage their own tokens and leak secrets; too-big
builds a workflow platform before the first email sends.

---

## 2. Architecture

A dependency-free **core** (only `zod`) that owns all semantics, talking to the world through
a few **ports** the **host** implements. Provider SDKs, the AI SDK, and MCP libraries live in
separate entrypoints and never leak into core.

```
@scope/connectors                         (publishable; license deferred, §19)
  /core      zod only. model · registry · runtime · oauth2 · refresh · outcomes · redaction
             ports: ConnectionStore · SecretBox · AuthRequestStore · OAuthAppRegistry (→ AuthConfigRegistry, §20/authconfig)
                    · ApprovalPolicy · Lock · Redactor · (optional) Clock · Logger · onActionRun
  /auth      strategy impls: oauth2 (PKCE) · apiKey · bearer · basic
  /crypto    aesGcmSecretBox(keyProvider)        — the default SecretBox; hosts don't roll crypto
  /store     fileStore(dir) · inMemoryStore       — reference ConnectionStore/AuthRequestStore
  /providers/google   google provider + gmail + google_calendar toolkits   (dep: none; raw REST)
  /ai-sdk    toToolSet(runtime, …)               (peer: ai)
  /mcp       serveMcp(runtime, …)  +  ingestMcpServer(...)   (peer: @ai-sdk/mcp / mcp sdk)
  /testing   fakeClock · fakeHttp · inMemoryStore
```

**Host relationship.** The host implements the ports and drives presentation. The reference
host is this Next.js app (`src/lib/connectors/*`, `src/app/api/connectors/*`): it wires a
SQLite-backed store, an AES `SecretBox` keyed from `.config`, an `ApprovalPolicy` bridged to
the app's existing permission prompts, OAuth callback routes, and the connect UI. The core
**never** imports the app, Next, Drizzle, SQLite, env, or React. A workspace package makes
this boundary mechanical (it physically cannot `import '../src/...'`) — but it isn't enforced
yet: `pnpm-workspace.yaml` is deliberately `packages: []` (to stop pnpm auto-discovering
gitignored `/examples` clones). **Implementation step zero** is adding an *explicit* glob —
`packages: ["packages/connectors"]`, not auto-discovery — which preserves that protection.
This engine/host boundary is also the **licensing boundary** (§20): keeping the core free of
host imports is what keeps the permissive/open-core/BSL decision open, not just what keeps it
testable.

**Open-source flywheel.** The contribution surface is the authoring API (§4). A new connector
is a `defineProvider` + `defineToolkit` + a list of `httpAction`s — no runtime, auth, or
projection code. That low-friction surface (plus MCP ingestion for the tail) is how breadth
arrives without the maintainers hand-writing it.

---

## 3. Domain model

Four nouns. No god-objects. Exact shapes:

```ts
// The AUTH BOUNDARY. One consent → one Connection per account. Coarser than a capability
// surface (Google issues one token spanning Gmail+Calendar). For 1:1 services it's invisible.
interface Provider {
  id: string;                         // 'google'
  displayName: string;
  auth: AuthStrategy;                 // oauth2 | apiKey | bearer | basic
  baseUrl?: string;                   // default base for this provider's http actions
  identityScopes?: string[];          // OAuth: ALWAYS requested; what identify() needs. Google: ['openid','email']
  scopeSatisfies?(granted: string[], required: string): boolean;  // OPTIONAL scope-hierarchy predicate (§7):
                                      // does `granted` authorize `required`? Lets a broader granted scope satisfy
                                      // a narrower action scope (Google: gmail.modify ⊇ gmail.compose). Falls back
                                      // to flat membership when absent. Conservative — encode only sure implications.
  // Discover the account's stable identity + human label right after auth. OPTIONAL: apiKey/
  // bearer providers often have no identity endpoint — they derive accountId from a configured
  // id, a label, or a credential hash. OAuth providers should implement it. `ctx` carries the
  // raw token response and the OAuth callback params so identify() can capture per-connection
  // context: a returned `config` (e.g. cloudId/realmId) and/or `baseUrl` are persisted on the
  // Connection and fed back to every action (see §3b, AccountIdentity).
  identify?(http: AuthedHttp, ctx: IdentifyContext): Promise<AccountIdentity>;
  // OPTIONAL. Cheap runtime-safe liveness probe for testConnection (§13b) — a minimal authed read
  // that throws on failure. DISTINCT from identify: it runs anytime against an existing connection
  // (gets the stored `config`, no connect-time context), so declare it when identify needs callback
  // data it can't have at probe time (e.g. QuickBooks realmId).
  healthCheck?(http: AuthedHttp, ctx: { config: Record<string, unknown> }): Promise<void>;
  // OPTIONAL. For per-instance providers whose API host is only known after auth (Salesforce
  // returns `instance_url` in the token response): derive the connection's baseUrl from the
  // token/callback so identify() AND every action route to the right host with RELATIVE paths.
  resolveBaseUrl?(ctx: IdentifyContext): string | undefined;
}

// What identify() may return. accountId is required; config/baseUrl are the per-connection
// context (captured once at connect, never an action input).
interface AccountIdentity {
  accountId: string;                  // external id
  email?: string; label?: string;     // human disambiguators
  config?: Record<string, unknown>;   // per-connection app config (e.g. { cloudId } / { realmId })
  baseUrl?: string;                   // per-connection API host (alternative to resolveBaseUrl)
}

// Context for identify()/resolveBaseUrl: the raw token exchange response and the OAuth callback
// query params (some providers, e.g. Intuit/QuickBooks, return `realmId` on the redirect).
interface IdentifyContext {
  tokenResponse?: unknown;            // the provider's raw token JSON (carries instance_url, etc.)
  params?: Record<string, string>;   // non-reserved OAuth callback query params
}

// A CAPABILITY SURFACE bound to a provider. The unit a user "connects/enables".
// Thin — for 1:1 providers, one implicit toolkit covers the provider.
interface Toolkit {
  id: string;                         // 'google_calendar'
  providerId: string;                 // 'google'
  displayName: string;
  scopes?: string[];                  // OPTIONAL upfront-consent bundle requested when a user
                                      // connects this surface; defaults to ∪ of its actions' scopes.
                                      // NOT the per-call requirement — that's action-level (below).
  actions: Action[];
}

interface Action<I = unknown, O = unknown> {
  id: string;                         // 'google_calendar.create_event' (toolkit-namespaced)
  description: string;                // shown to the model
  input: z.ZodType<I>;                // PURE domain input — no `account`; the projection injects it (§11)
  output?: z.ZodType<O>;
  scopes?: string[];                  // scopes THIS action needs → the precise per-call requirement
  mutating?: boolean;                 // default false
  risk?: 'low' | 'medium' | 'high';   // feeds ApprovalPolicy; default: low if !mutating else medium
  deprecated?: boolean;               // kept CALLABLE (id is a public contract); projection annotates the description
  replacedBy?: string;                // the action id to use instead — surfaced in the projected description
  execute(ctx: ActionContext, input: I): Promise<O>;
}

// The per-call scope check (pipeline step 4 / `needs_consent`, §7) requires ONLY `action.scopes`
// — the precise resource scopes that gate THIS call — not the toolkit bundle. Gmail proves why
// action-level is mandatory: search needs gmail.readonly, send needs gmail.send, modify_labels
// needs gmail.modify — a single toolkit scope would over-grant all of them.
// `provider.identityScopes` are REQUESTED at auth (and needed by identify()), but are NOT part of
// the per-call check: OIDC/identity scopes aren't echoed back verbatim by real providers (Google
// aliases `email`→`.../userinfo.email`; Microsoft omits `openid`/`email`/`offline_access` from the
// token scope), so requiring them per-call caused a permanent `needs_consent` loop.

// A user's authenticated ACCOUNT. MANY per provider. Credentials are NOT on this object —
// they live sealed in the store; the runtime opens them only at call time.
interface Connection {
  id: string;
  ownerId: string;                    // subject scope; defaults to 'local'. Present from day 1.
  providerId: string;
  accountId: string;                  // external id from identify()
  email?: string; label?: string;     // human disambiguators
  scopes: string[];                   // scopes actually granted
  status: 'active' | 'needs_reauth';
  authConfigId?: string;              // which auth client minted it. undefined ⇒ provider default.
                                      // Single config today; the seam for multi-client (BYO /
                                      // work-personal) — see connectors-authconfig-spec.md.
  config?: Record<string, unknown>;   // per-connection app/site config (e.g. defaultCalendar, cloudId,
                                      // realmId) — captured at connect via identify(); read by actions
                                      // through ctx.config / httpAction's request(input, { config }).
  baseUrl?: string;                   // per-connection API host (e.g. Salesforce instance_url), captured
                                      // via resolveBaseUrl/identify; overrides provider.baseUrl for ctx.http.
  createdAt: string; updatedAt: string; lastUsedAt?: string;
  // sealed credential blob is stored alongside but never present on the in-memory Connection.
}

// Safe metadata handed to action handlers. Explicitly NOT the credential.
interface ConnectionMetadata {
  id: string; ownerId: string; providerId: string;
  accountId: string; email?: string; label?: string; scopes: string[];
}

interface ActionContext {
  connection: ConnectionMetadata;     // no secrets, ever
  http: AuthedHttp;                   // pre-authed; injects header, refreshes + retries, redacts
  getToken(): Promise<string>;        // escape hatch for SDK/signing; ctx.http is the blessed path
  config: Record<string, unknown>;
  clock: Clock; log: Logger;
}
```

The `Provider`/`Toolkit` split exists **only** because consent can be coarser than capability
(Google). It is what makes "one Google connection backs Gmail and Calendar, and a second
toolkit can request more scope on the existing connection" work. For Slack/Notion/GitHub,
declare a provider with one toolkit and the split disappears from view.

**Auth-client multiplicity (the reserved third axis).** The full relationship is
**Provider 1 → AuthConfig 1..N → Connection N**: an *AuthConfig* is the app-level OAuth client (or
auth-scheme setup) for a provider — Nango's *Integration* / Composio's *Auth Config*. Today there
is exactly **one per provider** (the `OAuthAppRegistry` config below), so it's invisible; the
`Connection.authConfigId` seam keeps multi-client (BYO / work-personal / per-instance) a purely
additive, migration-free extension. The load-bearing rule for it: a token is refreshed/revoked
**only with the client that minted it** (resolve via `connection.authConfigId`). Full design in
[`connectors-authconfig-spec.md`](./connectors-authconfig-spec.md).

### 3b. Per-connection context (site id / instance host) — captured once, never an input

Some providers are scoped to a site, company, or instance that's only known *after* auth, and that
every subsequent call must target. The rule: **the agent must never carry that id as an action
input.** It's discovered at connect and bound to the Connection; actions read it from context.

Three capture sources, all flowing through `IdentifyContext`:

| Source | Provider example | How it's captured | Where it lands |
|---|---|---|---|
| API call in `identify()` | Jira / Confluence `cloudId` | `identify()` calls `accessible-resources`, returns `config: { cloudId }` | `Connection.config` |
| Token response | Salesforce `instance_url` | `resolveBaseUrl(ctx) → ctx.tokenResponse.instance_url` | `Connection.baseUrl` |
| OAuth callback param | QuickBooks `realmId` | `identify(_http, ctx)` reads `ctx.params.realmId`, returns `config: { realmId }` | `Connection.config` |

Consumption is symmetric and id-free on the input schema:

- **`Connection.config`** → handed to every action as `ctx.config`; `httpAction`'s
  `request(input, { config })` reads it (e.g. `` `${base(config.cloudId)}/search` ``).
- **`Connection.baseUrl`** → overrides `provider.baseUrl` for `ctx.http`, so actions use **relative**
  paths (`/services/data/v59.0/query`) that resolve against the per-connection instance host. It's
  also applied *before* `identify()` runs at connect, so identity calls hit the right host too.

Precedence for the resolved action base URL: `connection.baseUrl` > `connection.config.baseUrl` >
`provider.baseUrl`. This keeps the four instance-scoped providers (Jira, Confluence, Salesforce,
QuickBooks) free of site-id inputs while the engine mechanism stays generic — a new per-instance
provider needs only `identify`/`resolveBaseUrl`, no engine change.

---

## 4. Authoring (the DX) — a simple action is ~5 lines

Two forms, one `Action`. Config-first for ordinary REST; a handler when there's real logic. A
provider is ~7 lines, a toolkit is its scopes plus its actions, and a single REST action is
~5 — the full connector grows linearly with the number of capabilities, not with ceremony.

```ts
export const google = defineProvider({
  id: 'google',
  displayName: 'Google',
  baseUrl: 'https://www.googleapis.com',
  identityScopes: ['openid', 'email'],                           // always requested; what identify() needs
  auth: oauth2({
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    usePkce: true,
    authParams: { access_type: 'offline', prompt: 'consent' },   // guarantee a refresh token
  }),
  identify: async (http) => {
    const me = await http.get('/oauth2/v2/userinfo');
    return { accountId: me.id, email: me.email, label: me.email };
  },
});

export const calendar = defineToolkit({
  id: 'google_calendar', providerId: 'google', displayName: 'Google Calendar',
  actions: [
    httpAction({
      id: 'google_calendar.create_event', mutating: true, risk: 'medium',
      description: 'Create an event on a Google calendar.',
      scopes: ['https://www.googleapis.com/auth/calendar.events'],   // the precise per-call requirement
      input: z.object({ summary: z.string(), start: z.string(), end: z.string(),
                        calendarId: z.string().default('primary') }),   // no `account` — the projection adds it
      request: (i) => ({ method: 'POST', path: `/calendar/v3/calendars/${i.calendarId}/events`,
                         body: { summary: i.summary, start: { dateTime: i.start }, end: { dateTime: i.end } } }),
      output: (j) => ({ id: j.id, htmlLink: j.htmlLink }),
    }),
  ],
});
```

Auth, refresh, account resolution, approval, audit, redaction, and tool projection are all
free. **Keeping the simple case this small is the property that decides whether breadth
scales** — it is the open-source contribution surface.

---

## 5. The runtime — one path, one gate

```ts
interface ConnectorRuntime {
  beginAuth(providerId, opts?: { ownerId?; scopes?; label?; redirectUri; existingConnectionId?; authConfigId?; tenantId? }): Promise<{ authorizationUrl; requestId }>;
  completeAuth(p: { code; state }): Promise<Connection>;
  listConnections(f?: { ownerId?; providerId? }): Promise<Connection[]>;
  runAction<O>(actionId, input, opts?: { ownerId?; connectionId?; account?; caller?; tenantId? }): Promise<ActionOutcome<O>>;
  disconnectConnection(id, opts?: { ownerId?; revokeProvider? /* default true */ }): Promise<void>;
  getToolkits(): Toolkit[];
}
```

**`authConfigId?` / `tenantId?` are reserved on the opts (dormant until multi-client).** They are
the single, opts-based signature both specs share — the multi-client layer adds *no new positional
parameter*. `authConfigId` picks a specific auth client; `tenantId` is the hosted half of the
resolution context (with `ownerId`). The engine ignores both today; `connectors-authconfig-spec.md`
gives their semantics. (This keeps the two specs' signatures identical, not divergent.)

**`runAction` is the only way to execute an action**, and its pipeline order is the spec —
every step is a place a guarantee is enforced:

1. **Resolve action** in the registry → `error: unknown_action`.
2. **Validate input** against the Zod schema → `error: invalid_input`. *Before anything that
   reveals account state* — a malformed call must learn nothing about the user's connections.
   **Once the action is known and input is valid, emit `onActionRun(start)`** — every attempt
   from here is audited, and the matching `finish` fires on *every* terminal outcome below
   (success, `auth_required`, `needs_account`, `needs_consent`, `approval_required`, `denied`,
   or any error), never only the happy path.
3. **Resolve connection** (§6) → may short-circuit to `auth_required` / `needs_account`. An
   explicit `connectionId` is honored **only if its `ownerId` matches the caller's** → else
   `connection_not_found` (existence is not revealed). Opaque ids are an ergonomic, not a
   security boundary; ownership is the boundary.
4. **Scope check**: connection must hold every required scope (`provider.identityScopes ∪
   action.scopes`) → else `needs_consent` (§7).
5. **Approval gate** (§8): `const d = await approval.check({action, connection, inputPreview, caller})`.
   `'deny'` → `error: denied`; `'ask'` → `approval_required` (with redacted preview);
   `'allow'` → continue. *Before any side effect, before token acquisition.*
6. **Acquire token** (§9): `getToken(connection)` — proactive/expiry refresh, single-flighted.
   Unrecoverable refresh/revocation → mark `needs_reauth`, return `auth_required`.
7. **Build `ActionContext`** with the pre-authed `http` (token injected; never exposed).
8. **Execute.** On a provider auth failure the provider marks refreshable (§9), refresh once
   and retry — **safe only because that failure is rejected before any side effect.** A failure
   *after* the request crosses the wire (5xx / timeout) on a **mutating** action is **not**
   auto-retried (§13); the outcome is indeterminate → return `error` with `indeterminate: true`
   and audit `status: 'unknown'` (the call may have succeeded). Idempotency keys (§9) are the
   seam that makes such retries safe later. Map other provider errors to the taxonomy (§13).
9. **Shape + redact output**; emit `onActionRun(finish, status: 'ok')` (redacted previews).
10. Return `{ ok: true, result }`.

`auth_required`, `needs_account`, `needs_consent`, `approval_required` are **normal runtime
states**, never thrown, each **retry-safe**. Three resolve when a *human acts* and the agent
re-invokes the *same* call; `needs_account` is the exception — it resolves when the *model*
re-invokes with an `account` (different input), not by a human action.

```ts
type ActionOutcome<O> =
  | { ok: true; result: O }
  | { ok: false; reason: 'auth_required';     providerId: string; authorizationUrl: string }
  | { ok: false; reason: 'needs_account';     providerId: string; choices: { connectionId; email?; label?; authConfigLabel? }[] }
  | { ok: false; reason: 'needs_consent';     providerId: string; connectionId: string; missingScopes: string[]; authorizationUrl: string }
  | { ok: false; reason: 'approval_required'; actionId: string; risk: string; preview: unknown }
  | { ok: false; reason: 'auth_config_required'; providerId: string; choices: { authConfigId: string; label: string }[] }
  | { ok: false; reason: 'error'; code: ConnectorErrorCode; message: string; indeterminate?: boolean };
```

`auth_config_required` is **reserved now, dormant until the multi-client layer is enabled** (same
discipline as the `Connection.authConfigId` seam): a single-config provider never emits it. It is
the multi-config analog of `auth_required` — when a connect is needed but more than one auth client
is visible and none resolves as the default. **`runAction` returns it** (the agent path, which
auto-initiates auth); **`beginAuth` throws it** instead (the host-driven path is expected to resolve
the client via `listForProvider` first). Declared in the union from day one so adding multi-client is
not a breaking change to exhaustive consumers. Like `needs_account`, its `choices` carry the opaque
`authConfigId` **for the host/UI only** — the AI projection shows the model the config **labels**,
never the id. Full design in
[`connectors-authconfig-spec.md`](./connectors-authconfig-spec.md) §4a/§6a.

`choices[].connectionId` is for the host/UI only; the AI projection (§11) renders **labels and
emails, never the opaque id**, and the model re-calls with `account` — ids stay out-of-band.

---

## 6. Multi-account resolution

```
runAction(actionId, input, { ownerId='local', connectionId?, account? }):
  if connectionId → use it ONLY if its ownerId == caller ownerId, else connection_not_found
                    (then scope/approval/token checks)
  else conns = store.list({ ownerId, providerId })
    conns.length == 0 → auth_required   (needs a resolvable auth client to build the URL;
                                         if none resolves → error: provider_not_configured)
    conns.length == 1 → use it
    else → matches = conns where account == email | label
           exactly 1 match → use it ; 0 or >1 matches → needs_account(choices)
```

**The match must be UNIQUE** — never first-match. With more than one connection an `account`
hint can match more than one (the same email reached through two auth configs, or an email
colliding with another connection's `label`), so 0 *and* >1 matches both resolve to
`needs_account`. Silently picking the first would let an agent act on the wrong account.
Choices carry a `label` so the caller can disambiguate.

The model never sees opaque connection ids. **`account` is runtime metadata, never an authoring
burden:** the projection layer (§11) wraps each action's input schema with an optional `account`
string (description enumerating the live accounts, `"a@gmail.com" | "a@work.com"`), and on
invocation **pulls `account` out into `opts.account` and passes the remaining clean input to the
action.** So `account` is validated/resolved by the runtime and stripped before `execute` —
connector authors never add it to a schema, and the action's input schema stays pure. The model
maps "send from my work email" → the exact address; the engine does exact matching. One tool,
N accounts — never a tool per account.

---

## 7. Incremental consent (the subtle, load-bearing case)

Because consent (provider) is coarser than capability (toolkit), a connection can be missing
the scopes a newly-used toolkit needs: connect Google for **Calendar**, later ask the agent
to **send mail** → the `google` connection lacks `gmail.send`.

The scope check (pipeline step 4) computes `missing = action.scopes − connection.scopes` —
action-level, so it asks for exactly what this call needs and no more. **It checks `action.scopes`
only, not `provider.identityScopes`:** identity/OIDC scopes are requested at auth and granted at
connect, but real providers don't return them verbatim in the grant (Google aliases
`email`→`.../userinfo.email`; Microsoft omits `openid`/`email`/`offline_access` from the token
scope), so including them in the per-call check produced a permanent `needs_consent` loop — they
are auth/identify concerns, not per-call gates. Membership honors the provider's optional
**`scopeSatisfies`** hierarchy (§3): a connection holding a *broader* granted scope satisfies a
*narrower* required one (e.g. Google's `gmail.modify ⊇ gmail.compose`, `calendar.events ⊇
calendar.events.readonly`), so precise per-action scopes don't cause spurious re-consent. Absent
the predicate it is flat membership. If `missing` is
non-empty it returns **`needs_consent`** with `missingScopes` and an `authorizationUrl` that
requests `connection.scopes ∪ missing` (`include_granted_scopes=true` for Google) against the
**same** connection. (A user who explicitly *connects* a whole toolkit can instead request
`toolkit.scopes` upfront to avoid drip-consent; the per-call check stays action-precise.)

The re-consent must be **bound to the existing connection**, or a user who picks a *different*
account at the provider's consent screen would silently overwrite the wrong connection. So the
`AuthRequest` for this flow carries `intent: 'add_scopes'` and `existingConnectionId`. On
callback, `completeAuth` runs `identify()` and **verifies the re-identified `accountId` equals
the existing connection's `accountId` before updating in place.** On a match it merges scopes
and replaces credentials on that connection. On a mismatch it **refuses** (mutates nothing) and
surfaces a distinct `consent_account_mismatch` error, so the host can offer "connect that
account separately" instead. A bare `intent: 'new_connection'` (no `existingConnectionId`) is
the only path that creates a connection.

This must be in the first slice, because the first slice *is* two toolkits on one provider.
(`permission_required` without a bound re-consent URL is a dead end; this is the fix.)

---

## 8. Safety: the gate, audit, and confinement

**Approval is enforced in `runAction`; policy lives in the host.** The engine calls an
injected hook and obeys it; it does not own a permission engine:

```ts
interface ApprovalPolicy {
  // host decides: auto-allow low-risk reads, block, or defer to a human.
  check(input: { actionId; actionVersion; risk; mutating; connection: ConnectionMetadata;
                 inputDigest: string; inputPreview: unknown; caller: Caller }):
    Promise<'allow' | 'deny' | 'ask'>;
}
```

**The grant contract (load-bearing — the retry-safety property rides on it).** The agent
regenerates its tool call on the retry; if the grant were keyed off a naive serialization, a
reordered key or re-serialized date would change the key and the user gets re-prompted (or the
agent loops on `approval_required`). So **the runtime computes a canonical `inputDigest`** — a
stable hash over the **post-Zod-parse** input (Zod normalizes types/defaults), sorted keys,
canonical serialization — and passes it to `check`. The host stores grants keyed on
`(ownerId, actionId, connectionId, inputDigest, actionVersion)` with a defined **lifetime**
(single-use or short TTL). `actionVersion` is **runtime-derived** (a hash of the action's input
schema + `risk` + `mutating`), so a grant **auto-invalidates** when any of those change — a grant
issued against a low-risk version can't silently approve a now-high-risk one, with no manual
versioning by authors. Canonicalization lives in the runtime (one correct place); grant
storage/TTL stays the host's.

For app code the host can make `check` interactive (await a prompt → `allow`/`deny`). For an
agent tool call the host returns `'ask'`; the runtime returns `approval_required`; the
projection surfaces it; the agent re-invokes after the human acts and the host's policy now
returns `allow` (it matches the grant by `inputDigest`). The
enforcement point is singular and unbypassable; the interaction model is the host's.

**Audit** is an emit, not a table the engine owns: the runtime calls `onActionRun({ attemptId,
phase: 'start'|'finish', actionId, connectionId?, caller, mutating, risk, status, error?,
inputPreview, outputPreview })`; the host records it in its own model. **`attemptId`** is a
runtime-generated id stable across the `start`/`finish` pair, so they're joinable under
concurrency (two simultaneous calls to the same action no longer collide) — and it doubles as
the metering/debugging/compliance correlation key later. Previews are redacted and
size-bounded. **`start` fires once the action is known and input is valid (pipeline step 2); a
matching `finish` fires on *every* terminal outcome** — `ok`, `auth_required`, `needs_account`,
`needs_consent`, `approval_required`, `denied`, `unknown` (indeterminate mutating, §5), and
every error — so "every attempt is audited" is literal, not just the successful ones.
(`connectionId` is absent on a `finish` that short-circuited before a connection resolved.)

**Confinement is a primitive, not just an invariant.** The runtime owns a **`Redactor`** that
secrets are *registered* with (exact-match), rather than relying on regex pattern-scanning that
only catches what it already knows to look for:

```ts
interface Redactor { register(value: string, label?: string): void; redact<T>(value: T): T; }
```

Every token, refresh token, client secret, **PKCE verifier**, and `Authorization` header is
registered the moment it enters memory; every logged/emitted/audited/UI-bound string passes
through `redact()`. The invariant: none of those values ever appears in a log, error, tool
input/output, MCP response, audit preview, or UI. **Redaction is applied inside `runAction` to the
returned outcome itself** — both a success `result` and any error `message` — so confinement
can't be forgotten by a projection (and a secret embedded in a thrown provider/SDK error can't
ride out in the message); the projection-level redactor is then belt-and-suspenders. Action `output` mappers are the default (raw
provider passthrough is opt-in and flagged) — controlling both leakage and context bloat. The
§17 confinement test is **sentinel-based**: register a known fake secret, exercise every
outcome × every sink, assert the sentinel never escapes.

---

## 9. Auth & the refresh algorithm (where "bulletproof" actually lives)

OAuth2 authorization-code + PKCE is the primary strategy; `apiKey`/`bearer`/`basic` share the
same connection/secret/store path. The flow is transport-agnostic so it works in a library:

- `beginAuth` → generate `state` + PKCE verifier, persist an `AuthRequest` via
  `AuthRequestStore` (TTL, single-use) carrying `{ ownerId, providerId, scopes, redirectUri,
  intent: 'new_connection' | 'add_scopes', existingConnectionId?, sealedVerifier }`. The PKCE
  `code_verifier` is a proof-of-possession secret — it is **sealed via `SecretBox`** like any
  credential (short-lived ≠ non-sensitive; with the auth code it completes the exchange). Build
  the URL from `OAuthAppRegistry` creds + `redirectUri`. **The host** presents it (open browser
  to a loopback `127.0.0.1:<port>` for desktop/CLI; 302 for web). The `needs_consent` flow (§7)
  uses `intent: 'add_scopes'` + `existingConnectionId`.
- callback → host calls `completeAuth({ code, state })` → consume the request (reject reused
  state), exchange code, run `identify()`, seal credentials. Then branch on intent:
  `new_connection` → **upsert by the connection natural key `(ownerId, providerId, accountId)`** —
  re-connecting an account you already hold upgrades that connection in place (new credentials,
  unioned scopes) rather than duplicating it; a genuinely new account is a new row. So two Google
  accounts are two connections, but the same account connected twice is one. (The multi-client
  layer extends this key to `(ownerId, providerId, accountId, authConfigId)` — see
  `connectors-authconfig-spec.md` §6; until then `authConfigId` is constant.) `add_scopes` →
  **verify the identified `accountId` equals `existingConnectionId`'s `accountId`** (refuse with
  `consent_account_mismatch` on mismatch, mutating nothing), then merge scopes + replace
  credentials on that existing connection. Either way the connection is scoped to the
  request's `ownerId`.

**`getToken(connection)` — the seam.** Actions never refresh; they ask, and a valid token is
there. The exact algorithm, every clause load-bearing:

```
getToken(conn):
  creds = SecretBox.open(stored sealed blob)         // secrets enter memory only here
  if creds.expiresAt and now() < creds.expiresAt - SKEW(60s):
     return creds.accessToken                        // proactive window
  return await singleFlight(conn.id, async () => {    // ← one refresh per connection, ever
     resp = POST tokenUrl (refresh_token grant)
     if resp is invalid_grant / revoked:
        store.update(conn.id, status='needs_reauth'); throw NeedsReauth   // → auth_required
     next = {
        accessToken: resp.access_token,
        refreshToken: resp.refresh_token ?? creds.refreshToken,  // ROTATE if present, else PRESERVE
        expiresAt: now() + resp.expires_in*1000,
     }
     store.save(conn, SecretBox.seal(next))           // persist rotated token immediately
     return next.accessToken
  })
```

The three classic silent-death bugs are designed out: **single-flight** (concurrent actions
can't double-refresh and invalidate each other), **rotate-or-preserve** (handles providers
that do and don't return a new refresh token), **persist-before-return** (a crash can't lose a
rotated token). Reactive refresh on the call path triggers on **401**, and on **403 only when
the provider declares 403 = expiry** (`auth.refreshableStatuses`) — a blind 403-refresh masks
real permission failures and loops.

`singleFlight` is backed by an injectable **`Lock`** port — `withLock<T>(key, fn)` — not an
implementation detail, because the refresh correctness depends on it. Three impls: an
**in-process mutex** (tests / single process), a **file lock** for *local multi-process* (this
repo runs the CLI and the dev server against the same home, so in-process locking does **not**
span them), and a **distributed lock** (Postgres advisory lock / Redis) keyed by `conn.id` for
multi-instance hosted. It matters only for **rotating**-refresh-token providers — two refreshers
at once let the provider invalidate the loser's token; the lock must be mutual exclusion on the
*network refresh*, not just a DB compare-and-swap. It's **latent for the first slice** (Google
*preserves* rather than rotates), but the local multi-process race is real the moment a rotating
provider lands — so the file-lock impl is the local default, not a hosted-only concern (§20).

**SecretBox lives at the runtime, not the store.** The store persists an opaque sealed blob;
the runtime seals before `save` and opens after `get`. The store never sees plaintext; crypto
is centralized and swappable (file → keychain → KMS) without touching persistence.

**Disconnect revokes at the provider — not just locally.** For a trust-first product, deleting
a local connection while leaving a live grant on Google's side is a hole. `disconnectConnection`
defaults to `revokeProvider: true`: if the provider declares a `revokeUrl`, the runtime makes a
**best-effort** revoke call (failure is logged, never blocks), then deletes the connection and
its sealed secret. OAuth providers should set `auth.revokeUrl` (`https://oauth2.googleapis.com/revoke`
for Google). Added to the §14 acceptance bar.

**Idempotency is a documented seam, not a typed-but-dead field.** A mutating action that times out
*after* the request is sent (§5 step 8) is genuinely indeterminate. The honest signal today is the
`indeterminate` flag on that outcome plus audit `status: 'unknown'`; we accept at-least-once on
post-send failure and surface a cautious-retry UX — we do **not** pretend retry solves it. There is
deliberately **no `idempotencyKey` field on `runAction`**: a typed option that nothing reads is a
false safety affordance. The field returns only when it is backed by an attempt/result ledger
(an action/provider declaring idempotency support and deriving a key) — until then the seam lives
in this paragraph, not in the type.

**Provider-specific OAuth hooks (composition, not subclassing).** `oauth2()` is a factory, so a
provider expresses non-standard OAuth via config rather than overriding a base class. Beyond the
common knobs (`authParams`, `tokenAuthMethod`, `refreshableStatuses`, `revocationErrors`,
`revokeUrl`, `usePkce`), two escape hatches cover the real divergences:

- **`scopeSeparator`** (default `' '`) — the authorize-URL `scope` delimiter. Slack wants commas
  (`scopeSeparator: ','`); most providers use the RFC-6749 space.
- **`mapTokenResponse(raw) → Partial<TokenSet>`** — remap a non-standard token-endpoint shape
  (nested/renamed `access_token`/`scope`, e.g. Slack v2's `authed_user.access_token`). Whatever it
  returns overrides the standard fields; the original body is preserved on `TokenSet.raw`, and a
  remapped `scope` is what the granted-scope check reads.

For anything beyond these, the *ultimate* hatch is inherent to the factory: a provider can spread
and override the returned `AuthStrategy` (`{ ...oauth2(cfg), oauth: { ...base.oauth, buildAuthorizationUrl } }`)
— composition's equivalent of subclassing, with no god-object class.

---

## 10. Storage & ports

Host ports. The store is dumb persistence of opaque records; the runtime owns the crypto and the
trust logic. `Lock`/`Redactor`/`SecretBox` are trust-spine ports (defaulted by the package);
`Clock`/`Logger`/`onActionRun` are optional injections.

```ts
interface ConnectionStore {
  list(f?: { ownerId?; providerId? }): Promise<Connection[]>;
  get(id): Promise<{ connection: Connection; sealed: SealedSecret } | null>;
  save(connection: Connection, sealed: SealedSecret): Promise<void>;   // upsert
  setStatus(id, status, reason?): Promise<void>;
  delete(id): Promise<void>;
}
interface AuthRequestStore { put(req): Promise<void>; take(state): Promise<AuthRequest | null>; sweepExpired(now): Promise<void>; }
interface SecretBox { seal(value: unknown): Promise<SealedSecret>; open<T>(s: SealedSecret): Promise<T>; }
interface OAuthAppRegistry { get(providerId): Promise<{ clientId; clientSecret?; redirectUri }>; }   // staticOAuthApps({...}) — the single-config form; SUPERSEDED by AuthConfigRegistry when multi-client lands (authconfig spec §4)
interface Lock { withLock<T>(key: string, fn: () => Promise<T>): Promise<T>; }   // in-process | file | distributed (§9)
interface Redactor { register(value: string, label?: string): void; redact<T>(value: T): T; }       // exact-match secret confinement (§8)
```

**Secrets are encrypted from day one in every non-test adapter** — including the file store. A
Google refresh token is categorically more dangerous than a local app token; even at
`.config` (0600, never synced) it is sealed. Plaintext is for tests only.

- **v0 file host:** `.config/connectors/{connections,auth-requests}.json` + a non-synced
  `key`; `aesGcmSecretBox({ key })`. Correct, not throwaway — a real adapter behind the port.
  Writes are **atomic** (write-temp + rename), and because this repo's CLI and dev server share
  one home, the file host pairs with the **file-lock `Lock`** (§9) so a token rotation from one
  process can't corrupt a concurrent read/write from the other.
- **v1 SQLite host:** connections + sealed secrets + auth-requests tables in the git-synced
  `data.db`; AES `SecretBox` keyed from `.config` (key never syncs); writes via the app's
  query layer. Swapping is a host change behind a stable interface — zero core churn.

---

## 11. Projections

- **Programmatic:** `runAction(...)` directly. The same gates apply — app code is not
  privileged past the chokepoint.
- **In-app agent:** `toToolSet(runtime, { ownerId, toolkits })` → AI-SDK `ToolSet`. One typed
  tool per action; the projection injects the optional `account` param (so **action input
  schemas must be Zod *object* schemas** — the one authoring constraint the `account`-injection
  requires; a union/non-object input is rejected at registration with a clear error, not a
  silent break). `account` is a **reserved injected name**: an action that declares its own
  `account` field is also rejected at registration (else the projection would silently shadow it).
  Tool results **preserve the structured outcome** — `needs_account` becomes an
  account picker, `approval_required` a confirm, `needs_consent` a re-connect prompt; the model
  never improvises an auth flow. The model is shown **only labels/emails for accounts, never the
  opaque `connectionId`** (ids stay out-of-band for host/UI). Concretely for **`needs_consent`**:
  the model-safe result carries only the prompt (provider + `missingScopes` + instruction) — its
  `connectionId` and `authorizationUrl` go to the **host out-of-band** (the `onPause` channel), which
  drives the re-consent UI. (Same rule as `needs_account`/`approval_required`; the engine's
  `modelSafeOutcome` already omits the id.) Gate visible tools with the AI
  SDK's `activeTools`; a dynamic meta-tool router is the documented escape hatch only past
  catalog scale (~30+ tools), not built now. **No internal MCP** between the app and its own
  connectors — that's serialization between you and yourself.
- **External agents:** `serveMcp(runtime, …)` projects the same actions over MCP for outside
  hosts, behind the same gates.

---

## 12. Breadth via MCP ingestion (modeled as a provider, so it can't bypass safety)

The long tail does not get hand-built. `ingestMcpServer({ url, auth })` registers an external
MCP server as a **dynamic provider** whose tools become actions that proxy to it — and those
actions flow through the **exact same `runAction` pipeline**. Concretely:

- **Namespacing & provenance:** action ids are `mcp.<server>.<tool>`; every result is tagged
  with its origin server. No collision with, or impersonation of, native connectors.
- **Default-conservative safety:** ingested tools are `mutating: true, risk: 'high'` until a
  host policy says otherwise → they hit the approval gate by default.
- **Auth:** the external server's own OAuth (per the MCP authorization spec) is handled as
  that dynamic provider's `AuthStrategy` — tokens are stored and confined identically.
- **Audit** applies unchanged.
- **Two distinct concerns, not conflated:** (a) **secret confinement** on ingested output is
  real and tractable — run it through the `Redactor` like any other sink, because we know our
  own secret bytes. (b) **Prompt injection is *not* solved by scanning** — you cannot regex your
  way out of "ignore previous instructions." The actual defense is structural: the **approval
  gate already sits in front of every side effect** the injected text might try to trigger, and
  ingested tools default to `risk: 'high'`. We do not claim an output scanner stops injection;
  the gate is the answer.

"MCP client for breadth" — yes. "MCP tools are trusted like native actions" — never.

---

## 13. Error taxonomy

```ts
type ConnectorErrorCode =
  | 'unknown_action' | 'connection_not_found' | 'invalid_input' | 'denied'
  | 'provider_error' | 'provider_rate_limited' | 'provider_unavailable'
  | 'provider_not_configured'   // no auth client/app resolves for this provider (+caller, hosted) — §6
  | 'internal_error'
  // multi-client layer — reserved now, dormant until enabled (see connectors-authconfig-spec.md §6a):
  | 'auth_config_ambiguous_default' | 'scope_not_allowed' | 'auth_config_unavailable';
// completeAuth additionally surfaces 'consent_account_mismatch' (§7) on an add_scopes re-consent
// that resolves to a different account than the one being upgraded.
// auth_config_ambiguous_default: two default auth clients at the same visibility level (operator misconfig).
// scope_not_allowed: requested scopes exceed the resolved auth client's allowedScopes — on ANY
//   scope-requesting flow: connect (beginAuth), reconnect, or incremental consent (add_scopes).
// auth_config_unavailable: the resolved auth client's lifecycle status forbids the flow's purpose.
```

Provider HTTP mapping: `401` → refresh-then-retry-once, else `auth_required`; `403` →
refresh-only-if-`refreshableStatuses`, else `provider_error` (or `needs_consent` when the
body indicates insufficient scope); `429` → `provider_rate_limited` (surface `Retry-After`);
`5xx` → `provider_unavailable`; other 4xx → `provider_error`. Mutating requests are **not**
blindly retried after a partial provider success — a `5xx`/timeout *after* a mutating request
is sent returns `provider_unavailable` with `indeterminate: true` and audits `status: 'unknown'`
(§5/§9), since the call may have succeeded.

**Transient retry (idempotency-aware).** The authed HTTP client retries transient failures with
exponential backoff + jitter, honoring `Retry-After` (both delta-seconds **and** the HTTP-date
form), bounded by a `RetryPolicy` (`{ maxRetries, initialDelayMs, maxDelayMs, backoffMultiplier }`;
engine default 3 / 0.5s / 30s / 2, overridable via the runtime `retry` option). The matrix is driven
by the request's `mutating` flag, never replaying a side-effect blindly: **`429` is retried even for
mutating calls** (it means *rejected, not processed*); **`5xx`/network are retried only when not
`indeterminate`** (i.e. non-mutating) — a post-send mutating failure is surfaced, not replayed.
`401`-refresh-retry is a separate, always-safe single retry (above). Non-transient `4xx` and
`needs_reauth` never retry. Two refinements keep it well-behaved: the **backoff is abortable** (it
respects the request's `AbortSignal`, so a cancel doesn't wait out the delay), and when a provider's
`Retry-After` exceeds `maxDelayMs` the client **gives up and surfaces the rate-limit** rather than
clamping-and-burning an attempt on a wait it was told would be long.

---

## 13b. Connection health probe — `testConnection`

`runtime.testConnection(connectionId)` is a cheap "is this still good?" check (the Ri `testRequest`
analog) returning `{ ok, status: 'active' | 'needs_reauth' | 'error', verified, error?, checkedAt }`.
Two signals, in order: **(1)** a forced token refresh — for OAuth a successful refresh *proves the
grant is live* and flips the stored status to `needs_reauth` on a definitive revocation; **(2)** a
minimal authed read — `provider.healthCheck(http, { config })` when declared (authoritative), else
`provider.identify` as a **best-effort** fallback.

The `healthCheck` vs `identify` split is deliberate and load-bearing: `identify` is *connect*
semantics and may need connect-time context that doesn't exist at probe time (e.g. QuickBooks's
`realmId` arrives on the OAuth callback). So a non-auth `identify` failure does **not** fail the
probe for an OAuth connection — the refresh already proved liveness; the result is `active` with
`verified: false`. `verified` is the honesty bit: `true` when a real call confirmed it (healthCheck /
identify / a successful OAuth refresh), `false` when `ok` is an inference (a non-OAuth provider with
no probe — secret present but unexercised — or an OAuth probe that couldn't fully run). A provider
whose `identify` needs connect-time data should declare a `healthCheck` (a cheap real read) to get an
authoritative, `verified: true` probe. A flaky/transient failure returns `error` and **leaves the
connection intact** (never tear down a healthy connection on a probe); a healthy probe **heals a
stale `needs_reauth`** back to `active`. Host: `POST /api/connectors/test` + a per-connection "Test"
button (green/red) on the Connections UI.

---

## 13c. Pagination — `collectPages` (authoring primitive)

Most provider "list" endpoints page with an opaque cursor (Slack `next_cursor`, Google
`nextPageToken`, GitHub `Link`, offset/limit). `collectPages(fetchPage, { maxItems, maxPages })`
drives one to completion, **bounded** so an action can't run away or blow the context budget. It is
transport-agnostic — you pass a `fetchPage(cursor)` closure (usually over `ctx.http`), so it composes
with the trust spine (auth, refresh, retry, redaction) for free. Adopting it lets a list action hide
cursor bookkeeping from the agent entirely: the agent asks for up to `limit` items and the action
follows the cursor internally (see `slack.list_channels`). This is the primitive a **sync layer**
(a Ri-style incremental pull) is built ON — the sync layer owns watermark/cursor *persistence*; the
engine owns one bounded sweep. (Adoption across the remaining list actions is incremental.)

---

## 14. First slice — Google: Calendar, then Gmail

One `google` provider (auth-code + PKCE, offline). **Calendar first** as the proving
connector — clean REST, read + write, exercises the whole spine with minimal incidental API
mess. **Gmail second** on the same provider — proves the toolkit split, the shared
connection, and incremental consent on a live connection. Raw REST through `ctx.http` (so the
auth/refresh/redaction boundary owns transport); `googleapis` is *not* used for auth — it
would own token management and bypass the spine.

- `google_calendar`: `list_calendars`, `list_events`, `get_event`, `create_event`,
  `update_event`, `delete_event`
- `gmail`: `search_messages`, `get_message`, `create_draft`, `send_email`, `modify_labels`
- Scopes: minimal per toolkit (`calendar.events`; `gmail.readonly` + `gmail.send` /
  `gmail.modify`), verified against current Google docs at implementation.

**Acceptance — the slice is done when:**
1. Two Google accounts connect; both `accountId`/`email` captured.
2. Agent sends from the correct account via `account`; ambiguity → `needs_account`.
3. A Calendar-only connection asked to send mail → `needs_consent`; re-consent **upgrades the
   same connection** and the send then succeeds — and re-consenting with a *different* Google
   account is refused (`consent_account_mismatch`), mutating nothing.
4. A token expiring mid-session refreshes invisibly; two concurrent calls trigger exactly
   **one** refresh (single-flight).
5. Revoking access → `needs_reauth` and the next call returns `auth_required`.
6. `send_email` (mutating, high-risk) hits the approval gate for agent callers; an app caller
   with an interactive policy is prompted.
7. The same action runs via direct call, AI-SDK tool, and MCP projection — identical auth,
   gating, and outcomes.
8. No token/secret/`Authorization` ever appears in a log, error, tool I/O, audit preview, or
   the UI (sentinel test).
9. **Disconnect** calls Google's `revokeUrl` (best-effort) and removes local state — the refresh
   token no longer works afterward; it doesn't merely delete the local row.

---

## 15. Prior art policy

- **Ri (`@ri/connectors`):** quarry, not skeleton. **Verified: does not compile — 322 TS
  errors across 35 files**, concentrated in its auth layer. Harvest the Gmail/Calendar
  **operation lists / API specifics** and the **encryption approach** as reference; clean-room
  auth and HTTP with tests first; copy no controller or client code.
- **Composio / Nango / Paragon:** optional adapters behind the same ports (they can implement
  `Provider` + `ConnectionStore`), never the core, never required, never holding the user's
  secrets in the local-first mode.
- **n8n:** patterns only (credential-type registry, shared OAuth engine, declarative auth
  injection, `test` probe) — its license forbids using the code; reimplement clean-room.

---

## 16. Deliberately deferred — each a seam, not a build

Sync (cursors/checkpoints), inbound webhooks/triggers, a connector marketplace, workflow
DAGs, a universal normalized data model, dynamic meta-tool routing, refresh-token-less
long-lived API providers' extras, and **multiple auth clients per provider** (BYO-OAuth /
work-personal / per-instance — the additive `AuthConfig` layer, spec'd in
[`connectors-authconfig-spec.md`](./connectors-authconfig-spec.md); `Connection.authConfigId`
is the reserved seam). The model accommodates each (reserved fields / adapter points); v1 builds
none. (Hosted multi-tenant operation is *not* in this list — it's an explicit product direction;
the engine is built to support it. See §20.)

### 16a. Named extension seams — proactive rate limiting & inbound webhooks

Two capabilities a "best-in-class" connector library is expected to grow into. Both are **deferred
deliberately and are additive** — adding either later changes no existing contract and never touches
the outbound trust spine, so deferring them is scope, not debt. The exact extension points:

- **Proactive rate limiting** (pace requests *before* sending, vs. the reactive `429` handling we
  already ship — §13). Today it needs **zero engine change**: the injectable `fetch`
  (`createAuthedHttp`/runtime) means a throttling `fetch` wrapper already *is* a rate limiter. A
  first-class version = a new optional **`RateLimiter` port** (same shape as the `Lock` port for
  single-flight refresh — in-process for local, distributed for hosted) plus an optional
  `rateLimit?` metadata field on `Action`/`Provider` (additive, like `retry`/`deprecated`). It
  *composes* with retry: the limiter gates entry, the retry loop handles `429` overflow.

- **Inbound webhooks / triggers** — a SEPARATE ingress path that never goes through `runAction` or
  the outbound spine. Additive pieces: an optional **`Provider.verifyWebhook(payload, secret)` +
  `normalizeWebhook(payload)`** hook pair; webhook *subscription* is ordinary actions; the
  receiving HTTP endpoint is app-side by nature; webhook **signing secrets** reuse the existing
  `SecretBox`/store machinery (an additive field). Verification = HMAC + `timingSafeEqual`. This is
  the inbound feed a notifier / proactive layer would consume — see
  [`connectors-email-and-notifier-spec.md`](./connectors-email-and-notifier-spec.md).

---

## 17. Testing contract (the spine must be proven)

- **Resolution:** explicit id; 0 → `auth_required`; 1 → use; N + **unique** hit → use; N + hint
  matching 0 **or >1** connections → `needs_account` (never first-match). A `connectionId` from a
  different `ownerId` → `connection_not_found` (existence not leaked). Invalid input →
  `invalid_input` **before** any account state is revealed. Registry rejects duplicate
  provider/toolkit/action ids.
- **Auth:** state required + single-use; PKCE verifier **stored sealed**, consumed once; code
  exchange seals creds; **rotate-or-preserve** refresh token; **proactive** refresh before
  expiry; **single-flight** under concurrency; failed refresh → `needs_reauth` → `auth_required`.
- **Scopes:** per-call requirement = `action.scopes` only (action-level, least privilege —
  `provider.identityScopes` is requested at auth but NOT re-checked per call, since OIDC/identity
  scopes aren't echoed verbatim by providers); `gmail.search` missing `gmail.readonly` →
  `needs_consent`; having only `calendar.events` does not satisfy `gmail.send`; a connection whose
  grant omits/aliases the identity scope (Google `userinfo.email`, Microsoft dropping `openid`)
  still runs an action whose resource scope it holds.
- **Consent:** scope gap → `needs_consent`; re-consent (`intent: add_scopes`) upgrades the
  existing connection's scopes in place; re-consent resolving to a different account →
  `consent_account_mismatch`, no mutation.
- **Gate:** mutating + agent caller + `'ask'` policy → `approval_required`; `'deny'` →
  `denied`; `'allow'` → executes. **Grant digest is stable:** the same logical input with
  reordered keys / re-serialized dates yields the same `inputDigest` (so the retry matches the
  grant and the user isn't re-prompted); a grant is invalidated when the action's schema or risk
  changes.
- **Audit:** `start` fires after valid input; a `finish` with the **same `attemptId`** is
  emitted for *every* terminal outcome — success, `auth_required`, `needs_account`,
  `needs_consent`, `approval_required`, `denied`, `unknown` (post-send mutating timeout), and
  errors; concurrent calls to the same action keep distinct `attemptId`s.
- **Projection:** the injected `account` is routed to resolution and **stripped before
  `execute`**; a non-object action input — and an action that declares its own reserved `account`
  field — is **rejected at registration**; the model-visible tool surface contains no opaque
  `connectionId`.
- **Disconnect:** `disconnectConnection` with `revokeProvider` calls `revokeUrl` (best-effort,
  failure non-blocking) then removes local state.
- **Concurrency/locks:** in-process single-flight holds; the `Lock` port is honored (a fake lock
  asserts mutual exclusion on the refresh) — the cross-process path is exercised against the
  file-lock impl.
- **HTTP:** header injected; query/body encoded; `401` refresh-retry-once; non-refreshable
  `403` does not loop; a post-send mutating `5xx`/timeout → `indeterminate` (not auto-retried);
  sensitive headers redacted.
- **Confinement (sentinel-based):** register a known sentinel as each secret kind — token,
  refresh token, client secret, **PKCE verifier** — exercise every outcome × every sink
  (log/error/tool-I/O/MCP/audit-preview/UI), assert the sentinel never escapes.
- **MCP ingestion:** namespacing applied; ingested tool defaults to approval; secret-redaction
  runs on output (no injection-scanning claim).

---

## 18. Implementation phases (lean path to value)

0. **Workspace boundary (step zero):** add an explicit `packages: ["packages/connectors"]` glob
   to `pnpm-workspace.yaml` (not auto-discovery — preserves the deliberate `/examples` guard),
   scaffold the package. This is what makes "core can't import the host" mechanical from commit one.
1. **Core + spine:** model, registry, runtime pipeline, ports (incl. `Lock`, `Redactor`),
   outcomes, `defineProvider/defineToolkit/httpAction/action`, OAuth2+PKCE, the refresh algorithm
   (single-flight via `Lock`), grant `inputDigest`, `aesGcmSecretBox`, in-memory + file stores
   (atomic writes). Tests target the spine.
2. **Google vertical:** `google` + `google_calendar` then `gmail`; multi-account + incremental
   consent proven against §14.
3. **Surfaces:** `toToolSet` into the chat orchestrator; programmatic app use; connect UI
   (reuse the beamd-connect state machine); `ApprovalPolicy` bridged to existing prompts;
   `onActionRun` into the app's event model.
4. **Durable host:** SQLite store; encrypted secrets; action-run audit table.
5. **Reach:** `serveMcp` (project the runtime to external hosts); harvest Slack/Notion/Linear
   providers. No new spine — just projections and authoring.
6. **Ingestion (breadth):** `ingestMcpServer` with the full trust wrapper — external auth,
   provenance, schema translation, injection handling, conservative approval defaults, error
   mapping. Kept as its own phase so breadth can't destabilize the spine.

---

## 19. Decisions, locked

- **Lives in `packages/connectors`** (repo is already a pnpm workspace) — boundary enforced
  mechanically; spin-out is free.
- **Licensing: deferred** — it's bound up with a separate product decision, to be sorted later.
  The architecture is license-agnostic (the open-core split in §20 is one option, not a
  commitment). Pick a **neutral package name** at init.
- **Raw REST through `ctx.http`**, not provider SDKs for auth (SDKs may serve as request/type
  helpers only, never owning tokens).
- **Zod** schemas throughout; **encrypt secrets from day one**; **`ownerId` on the store from
  day one**; **approval enforced in `runAction`**; **audit emitted, host-stored**.
- **One runtime, all callers** (app / agent / MCP / ingested-MCP) pass the same gates.

**The measure that the abstraction is right:** adding the *second* OAuth2 connector requires a
provider, toolkit(s), actions, an identity lookup, and tests — and **no** new auth route,
refresh code, secret logic, MCP/AI-SDK plumbing, or per-action account handling. Bulletproof
underneath; ten lines on top.

---

## 20. Hosted / multi-tenant mode (the paid offering)

The same engine runs as a paid hosted service. **Hosted is just the biggest host** — it
implements the same ports against production infra. The runtime, model, auth, and gates are
unchanged. This was designed in from day one (ports/adapters, `ownerId` everywhere,
transport-agnostic auth, the `onActionRun` hook as a natural metering seam). What changes is
adapters and operational rigor — and one strategic decision (licensing).

**The honest inversion.** Local-first's pitch is "your tokens never leave your machine." The
hosted version *inverts* that — now we custody every tenant's OAuth tokens, like Composio/Nango
do. That's a coherent dual position (privacy-conscious users **self-host**, tokens stay home;
convenience users **pay us** to host) — but it makes the hosted plane a high-value breach target
(everyone's Gmail tokens), so its secret bar is much higher than the local file store's.

**Already enabled by the architecture (adapter swaps, no core change):**
- `ConnectionStore` / `AuthRequestStore` → Postgres, multi-tenant.
- `AuthConfigRegistry` (the multi-client successor to `OAuthAppRegistry`, §10) → the product's OAuth
  apps (or per-tenant/owner BYO), public fixed callback.
- Auth presentation → 302 redirect + web callback route (the loopback flow is for local only).
- Billing/metering/quotas → tap the existing `onActionRun` audit hook; nothing new in core.

**Hosted hardening — required before charging money (most are adapters; one is the `Lock`):**
1. **Distributed `Lock`** for single-flight refresh (§9) — the one spine change; in-process
   mutex → Postgres advisory lock / Redis. Without it, multi-instance refresh corrupts
   rotating-refresh-token connections.
2. **Tenant isolation at the data layer**, not just the runtime `ownerId` check — row-level
   scoping / per-tenant predicates so a single bug can't leak connections across tenants. This
   includes the **BYO auth-config admin surface**: today `AuthConfigAdmin.list`/`removeConfig`/
   `setDefault` are provider-keyed and NOT owner/tenant-filtered (correct for the single-user local
   store, where every config is owner `'local'`), so hosted must add owner-scoped listing **and**
   per-mutation ownership checks before exposing config management to multiple users.
3. **KMS / envelope `SecretBox`** with per-tenant key isolation and rotation — the
   `aesGcmSecretBox(key-in-.config)` is for local only. This is the highest-stakes adapter.
4. **The service shell** around the runtime: authenticated tenant API, rate limiting, quotas,
   horizontal scaling (the runtime is stateless given the store + distributed lock),
   observability, and per-tenant audit retention.
5. **Provider-side compliance** (ops, not architecture): Google OAuth app verification + CASA
   security assessment for restricted Gmail scopes; shared-OAuth-app quota planning.

**Licensing — deferred.** It's tied to a separate product decision and will be sorted later;
the engine architecture doesn't depend on the outcome. For the record, the shapes on the table
are: **permissive everywhere** (max adoption, competitors can host it), **open-core** (permissive
engine + a separately-licensed hosted control plane — the managed multi-tenant layer is the
moat), and **BSL/fair-source** (self-host free, no competing hosted service until it converts to
OSS after N years). Whichever is chosen, the §3 boundary already does the work: the package is
the embeddable engine; the paid product is the largest, most operationally serious *host* of it,
and the core never needs to know which host it runs in.
