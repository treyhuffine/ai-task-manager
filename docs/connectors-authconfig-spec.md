# Connectors — AuthConfig (multiple clients per provider)

**Status:** Phase 1 (engine layer) IMPLEMENTED — v10 · **Date:** 2026-06-19 · **Extends:** `docs/connectors-module-spec.md`
· **Supersedes:** v1–v9 of this doc

> **Implemented (2026-06-19):** Phase 1 — the additive engine layer — is built and tested in
> `packages/connectors` (127 tests green; engine + host typecheck clean). `AuthConfigRegistry` +
> `staticAuthConfigs` (with `staticOAuthApps` as a back-compat alias), §4a runtime resolution,
> §6 threading (minting-client binding for refresh/revoke/consent/reconnect, `(accountId,
> authConfigId)` dedup, `baseUrl`, status×purpose gating, scope formula), and the now-live §6a
> outcome/error states. **Phases 2 (Case A connect-picker UX) and 3 (Case B BYO `AuthConfigStore`
> + admin service + UI) remain deferred** — see §13.

Lets a provider have **more than one auth setup** — e.g. a *work* Google OAuth app and a
*personal/BYO* one, or a managed vs self-hosted instance — without disturbing the common case
(one per provider) and without a data migration. It promotes the implicit single client into a
first-class, auth-scheme-agnostic **`AuthConfig`** that defaults to invisible.

> **Why now:** one client per provider is the 95% case and stays the default. This exists only
> so we don't box ourselves out of BYO-OAuth, work/personal separation, quota isolation, or
> per-instance clients — especially in **paid hosted mode**, where a client belongs to a
> tenant, not a user. The engine change is small and additive; the rest is product/UX, and only
> for the user-supplied-client variant.

> **v3 changes (boundary precision):** deterministic default resolution (§4a); secret never
> crosses the store boundary (§3, §9); the `scheme`↔`Provider.auth` invariant made explicit
> (§3a); purpose-aware lifecycle table (§8); exact scope formula (§6); `baseUrl` threading +
> per-instance auth URLs scoped out (§6, §14); tenant context resolved as a *resolution input*,
> not a stored connection field (§4); the account-choice tiebreaker lifted into the type (§7).

> **v10 changes (pure hygiene — reviewer found NO P1/architecture issues):** broadened
> `scope_not_allowed` from "beginAuth-only" to any scope-requesting flow (connect/reconnect/consent —
> it was already used in consent since v7); fixed the §5 static example (operator configs are
> `global`; owner/tenant BYO goes through the Case B store, not plaintext env); added one consolidated
> "effective `AuthRequest`" shape so base/extension can't drift; clarified `OAuthAppRegistry` is
> superseded by `AuthConfigRegistry`. Spec-only; no engine changes.
> *(Folded in, same version — two genuine artifact gaps, not a new review cycle: §4a step 6 — the
> "visible but all-inactive → `auth_config_unavailable`" blank cell; and the canonical §20 hosted
> line's stale `OAuthAppRegistry` → `AuthConfigRegistry`. Skipped two non-gaps: the `baseUrl` step is
> already specified as a property, and the intro per-instance wording is style.)*

> **v9 changes (consistency cleanup, two of three from my own v7/v8 edits):** `completeAuth`'s purpose
> is now **derived from `AuthRequest.intent`** (not a fixed `connect`), so a disabled-client
> consent/reconnect callback isn't wrongly rejected (status is gated at *initiation*, §8); moved the
> **cross-store invariants** (delete-blocked-if-live-connections, `setDefault` immutability) off the
> raw `AuthConfigStore` onto an **admin service that holds both stores** (a raw store can't know
> connection references); defined **`explicitScopes` as caller/action scopes *excluding* identity**
> (identity is unioned by §4a), removing the v8 double-count. Spec-only; no engine changes.

> **v8 changes (flow-binding precision; the engine already did all of this — spec just says so now):**
> stated that `runAction`'s auto-auth uses `explicitScopes = identityScopes ∪ action.scopes` (so §4a
> selection + the URL track the *attempted action*, not config defaults); made **reconnect**'s binding
> explicit — it's the `add_scopes` flow (same accountId+authConfigId verification, refuses a
> wrong-account reauth), **declining** a redundant `intent: 'reconnect'`; made `needs_consent`'s
> `connectionId`/`authorizationUrl` explicitly host-out-of-band (model sees only the prompt); fixed a
> test bullet that wrongly claimed `beginAuth` returns `requestedScopes`. **No engine changes** —
> verified the runtime already does all three correctly (94 tests).

> **v7 changes (contract-coverage — more real gaps before build):** defined the **no-visible-config**
> state — `runAction` returns `error: provider_not_configured`, `beginAuth` throws it (new canonical
> code, also fixes the *built* engine's vague `internal_error` for an unconfigured provider — 94 tests);
> the **`add_scopes` consent URL is now bounded by the config's `allowedScopes`** (a client-limited BYO
> config → `scope_not_allowed`, no doomed URL); reconciled the **`beginAuth` signature** — one
> opts-based shape across both specs (`authConfigId?`/`tenantId?` reserved on canonical opts; no
> separate positional `ctx`); made `AuthConfigStore` **raw** (no `ctx` — visibility filtering is the
> registry's job, like `ConnectionStore` vs the runtime); added the **`defaultScopes ⊆ allowedScopes`
> registration invariant** that §4a's no-explicit-scopes path assumed.

> **v6 changes (registry seams — two real P1 fixes before build):** the registry is now a pure
> **visibility-scoped data source**, with §4a **selection moved into the runtime** (where the scope
> inputs live — fixes the circular dependency where `resolveForConnect` couldn't see the requested
> scopes it had to filter on). Four single-purpose methods: `listForConnect(ctx)` (visible configs,
> secret-free), `getConfigForConnection(id)` (connection-bound, **secret-free** — for consent/reconnect
> URL building), `openConfigForConnection(id)` (connection-bound, **the only secret-opener** — exchange/
> refresh/revoke only), `listForProvider(ctx)` (UI). This also fixes the secret-too-early bug:
> `add_scopes`/`reconnect` build URLs with the secret-free resolver. Plus: `isDefault` uniqueness is
> per **exact** visibility key (global | tenantId | ownerId — BYO works); `auth_config_required`
> `label` is **required** (+ engine type); canonical `needs_account` choices carry `authConfigLabel?`;
> non-OAuth "never consults authConfigId" narrowed to "…for OAuth exchange/refresh/revoke."

> **v5 changes (resolution precision + honest reservation):** `beginAuth` keeps its
> `{authorizationUrl, requestId}` return and **throws** `auth_config_required` — only `runAction`
> *returns* that outcome (§6/§6a); explicit selection resolves in distinct stages
> visibility→status→scope (`none` vs `auth_config_unavailable` vs `scope_not_allowed`, §4a);
> implicit selection **scope-filters candidates before defaulting** so an owner default that can't
> grant the request doesn't dead-end (§4a); `resolveForConnect` is now **secret-free** — only
> `resolveForConnection` opens the secret (§4); non-OAuth configs are consulted for `baseUrl`/context
> but never an OAuth client (§3b); `resolveForConnection(undefined)` → the frozen legacy default, no
> precedence (§5/§6); `auth_config_required` is model-safe (labels only, §6a). **Also closed a
> spec-vs-code gap:** the reserved `auth_config_required` outcome + the three error codes are now
> declared in the *engine* types (dormant), with a model-safe projection case — so "reserved from
> day one, forward-stable" is true in code, not just the spec (93 engine tests green).

> **v5.1 (polish, no design change):** dropped `'none'` from `AuthScheme` (dangling — no canonical
> no-auth strategy); narrowed the stale `ResolvedAuthConfig` comment to `resolveForConnection` only;
> defined "`allowedScopes` covers" formally (direct membership OR `Provider.scopeSatisfies`); made
> `AuthConfig.label` required when a provider has >1 config (every pickable config is nameable, so
> the model-safe picker never falls back to an id); stated `AuthConfig.id` is globally unique.

> **v4 changes (API-contract precision):** registry split into two trust paths —
> `resolveForConnect` (visibility-checked) vs `resolveForConnection` (by stamped id, no ctx), so a
> missing context can't silently bypass connect-time visibility (§4); a runtime-facing
> `ResolvedAuthConfig` that actually carries the opened secret (§3/§4); auth-config-selection
> failures made first-class and **reserved in the canonical `ActionOutcome`/`ConnectorErrorCode`
> now, dormant until enabled** (§6a); one visible config is the implicit default — picker only when
> `>1 && no default` (§4a); host policy filter runs before precedence (§4a); the §8 status×purpose
> table is *enforced* at resolution, not just documented (§6); hosted tenant isolation upgraded
> from a soft "may" to a hard host contract (§4).

---

## 1. Principles (must not violate)

1. **The single-config case stays invisible.** One `AuthConfig` ⇒ no picker, no terminology,
   no required field. `beginAuth('google')` works exactly as today.
2. **Additive, zero-migration.** `authConfigId` is optional; `undefined` resolves to the
   provider's **default**. Existing connections keep refreshing against the original client with
   no backfill. The runtime pipeline (resolution, gates, redaction, connectors) is untouched.
3. **Client ownership ≠ user ownership.** A *connection* has an `ownerId` (the user). An
   *AuthConfig* has its own visibility scope (global / tenant / owner). Conflating them is what
   breaks hosted mode — they are kept separate (§4).
4. **The store never sees a plaintext secret.** Same rule as `ConnectionStore`: the runtime
   seals before persisting; the store holds an opaque blob (§3, §9).

---

## 2. The model

```
Provider "google" (1)
   ├─ AuthConfig "google" (default, scope: global)   OAuth client A   ← the existing single client
   └─ AuthConfig "google-personal" (scope: owner)    OAuth client B   ← added later; BYO / work-personal
         └─ Connection(s)   carry authConfigId → refreshed with their MINTING client
```

- **`AuthConfig`** = the app-level setup for connecting to a provider via one scheme. **1..N per
  provider**, exactly one **default** per visibility resolution (§4a). Auth-scheme-agnostic: the
  OAuth client identity (`clientId`/`redirectUri`) is one *payload* inside it; the config also
  carries scopes, instance/base-url metadata, visibility, and lifecycle. (Nango *Integration* /
  Composio *Auth Config*.) The **client secret is not part of this record** — it is sealed and
  travels separately (§3, §9).
- **`Connection.authConfigId`** records which config minted it. `undefined` ⇒ provider default
  (legacy only — see §5).
- Still a tree, not many-to-many: **Provider 1 → AuthConfig 1..N → Connection N.** A connection
  belongs to exactly one provider and one config.

**The load-bearing rule:** an OAuth token is **refreshed and revoked only with the client that
minted it.** `getValidCredentials`, `disconnect`, *and re-consent* resolve the client via
`connection.authConfigId` (falling back to the provider default) — never via "the provider's
client." Get this wrong and refresh silently breaks the moment a second client exists.

---

## 3. Types

```ts
type AuthScheme = 'oauth2' | 'api_key' | 'bearer' | 'basic';
// Mirrors the canonical engine's CredentialType exactly (§3a invariant). No 'none': the canonical
// provider model has no no-auth strategy, so a 'none' scheme could never satisfy the invariant. If a
// truly-public (no-auth) provider ever appears, add a `noneAuth()` strategy to the canonical model
// and the matching scheme together — don't leave a dangling enum value.

// The first-class record. SAFE METADATA ONLY — flows freely, persists as-is, NEVER a secret.
// (Generalizes the engine's current OAuthAppConfig; the clientSecret moves OUT, see below.)
interface AuthConfig {
  id: string;                 // stable, GLOBALLY UNIQUE (the store + dedup key look it up by id alone,
                              //   not (providerId,id)); convention: provider-prefixed — 'google', 'google-personal'.
  providerId: string;
  scheme: AuthScheme;         // MUST equal the provider's auth strategy kind in v1 (§3a)
  label?: string;             // UI ("Work", "Personal"). REQUIRED whenever a provider has >1 config
                              //   (validated at registration) — every pickable config must be nameable;
                              //   optional for the single-config case (no picker ever shown).
  isDefault?: boolean;        // at most one default per (provider × EXACT visibility key: 'global' |
                              //   a specific tenantId | a specific ownerId) — §4a. So owner A and owner B
                              //   each get their own owner-default (BYO works); not one owner-default for all.

  // ── visibility / ownership — SEPARATE from a connection's ownerId (§4) ──
  scope: 'global' | 'tenant' | 'owner';
  tenantId?: string;          // when scope = 'tenant'
  ownerId?: string;           // when scope = 'owner' (a single user's BYO client)

  // ── scopes ──
  defaultScopes?: string[];   // fallback requested when the host doesn't pass explicit scopes (§6)
  allowedScopes?: string[];   // optional max / validation boundary (BYO / restricted clients).
                              //   "covers" is formal: a requested scope is allowed iff it is DIRECTLY in
                              //   allowedScopes OR implied by one via the canonical Provider.scopeSatisfies
                              //   hierarchy (so allowing `calendar` covers a requested `calendar.events`).

  // ── OAuth client identity — NON-SECRET parts only (present iff scheme === 'oauth2') ──
  oauth?: { clientId: string; redirectUri: string };
  //         ↑ clientSecret is NOT here. It is sealed and passed/stored alongside (§9), exactly
  //           like a Connection's credential blob. Public/PKCE clients have no secret at all.

  // ── per-instance metadata (optional) ──
  baseUrl?: string;           // API base override for a self-hosted instance — threaded in §6

  status: 'active' | 'disabled' | 'archived';
}

// Safe to expose to UI / connect-time pickers — NEVER carries secrets. `label` is optional in the
// type but GUARANTEED PRESENT whenever a picker is shown: a picker only happens with >1 config, and
// labels are required in that case (above). So the model-safe `auth_config_required` view (§6a) never
// has to fall back to the opaque id — there is always a human label to show.
interface AuthConfigSummary {
  id: string; providerId: string; scheme: AuthScheme; label?: string; isDefault: boolean; status: AuthConfig['status'];
}

// RUNTIME-FACING resolution result — the ONLY shape that carries the opened secret. Returned ONLY by
// `openConfigForConnection` (§4) for code-exchange / refresh / revoke; the URL-building resolvers
// (`listForConnect`, `getConfigForConnection`) and `listForProvider` are secret-free. The secret is
// opened from the sealed store (Case B) or read from env (Case A) and immediately Redactor-registered.
// NEVER flows to UI, logs, or AuthConfig(Summary).
interface ResolvedAuthConfig { config: AuthConfig; clientSecret?: string }

// Two optional fields added to existing engine types:
interface Connection  { /* … */ authConfigId?: string }   // see §5 + §3b for the `undefined` semantics
interface AuthRequest { /* … */ authConfigId?: string }

// EFFECTIVE AuthRequest (base canonical §9 + this layer's one field) — the full record completeAuth
// reads, in one place so base/extension don't drift:
//   { state; ownerId; providerId; scopes; redirectUri;
//     intent: 'new_connection' | 'add_scopes';      // drives completeAuth's purpose (§6 step 2)
//     existingConnectionId?;                          // present for add_scopes (consent AND reconnect)
//     authConfigId?;                                  // THIS layer: the stamped minting client (resolved at beginAuth)
//     label?; sealedVerifier?; expiresAt; createdAt }
// completeAuth keys on `intent` (+ `existingConnectionId`) for purpose/binding, and on `authConfigId`
// for which client opens the secret. No 'reconnect' intent — reconnect is add_scopes (§6 step 6).
```

### 3a. `scheme` must agree with the provider's strategy (v1 invariant)

The engine's `Provider` has a **single** `auth: AuthStrategy` (`packages/connectors/src/core/types.ts`).
So in v1 an `AuthConfig.scheme` **must equal that provider's strategy kind**, validated at
registration (mismatch → registration error). `scheme` is on `AuthConfig` for self-documentation
and for the optional-for-API-key rule below — it does **not** mean a provider can mix schemes
across its configs.

*Future seam (not built):* true multi-scheme-per-provider (e.g. GitHub OAuth-app **or** PAT)
would promote `Provider.auth` to `Provider.authStrategies: Record<AuthScheme, AuthStrategy>`.
That's a later change; flagged in §14 non-goals so the door stays open without speculative code.

**Second registration invariant — `defaultScopes` ⊆ `allowedScopes`** *(P2/P3 fix)*: if a config
sets `allowedScopes`, then `identityScopes ∪ defaultScopes` **must be covered** by it (direct or
`Provider.scopeSatisfies`), validated at registration/update (else error). This is the invariant
§4a's implicit selection relies on when it skips scope-filtering for the no-explicit-scopes case
("defaults are within `allowedScopes` by construction") — make it true by enforcement, not assumption.

### 3b. `authConfigId: undefined` — meaning is provider-scheme-dependent (and that's fine)

`undefined` reads two ways, disambiguated **by the provider's scheme**, so no tri-state is needed:

- **OAuth provider** → `undefined` means "use the provider default" (legacy / pre-feature
  connection; see §5). Refresh resolves the default client.
- **Non-OAuth provider** (api_key / bearer / basic) → the connection is self-credentialed (the
  key *is* the credential), so `authConfigId` is **never consulted for an OAuth client** — there
  is no client to refresh, revoke, or exchange with. An `AuthConfig` appears for non-OAuth only
  when there's real app-level setup (a self-hosted `baseUrl`, an `allowedScopes` cap,
  managed-vs-BYO). **When one *is* present, the runtime still consults it for `baseUrl`/metadata**
  in `identify()` and `ctx.http` (§6) — it just never uses it for token refresh/revoke (there is
  none). Precisely: `authConfigId` is consulted for *connection context*, never for an *OAuth
  client*.

> **Divergence from review (P2-4):** the reviewer suggested `authConfigId?: string | null`
> (undefined = legacy, null = intentionally none). I'm declining: a null/undefined tri-state is
> a well-known footgun, and the provider scheme already tells you which meaning applies. Document
> it (here), don't encode it.

---

## 4. Visibility & resolution (the hosted-mode fix)

A config's **visibility scope** is distinct from a connection's owner:

- `scope: 'global'` — any caller may connect through it (operator-registered shared client). The
  local-first / single-tenant default.
- `scope: 'tenant'` — usable only within `tenantId` (a workspace/org's client in hosted mode).
- `scope: 'owner'` — usable only by `ownerId` (a single user's BYO client).

The registry takes a **resolution context** so the engine stays agnostic; the host decides what's
visible:

```ts
interface ResolutionContext { ownerId?: string; tenantId?: string }

interface AuthConfigRegistry {           // (renames OAuthAppRegistry)
  // CONNECT data source: the configs VISIBLE in this ctx (visibility enforced HERE, at the data
  // boundary; ctx REQUIRED). Returns ALL visible configs regardless of status — secret-free. The
  // RUNTIME applies §4a selection over these, because selection needs scope inputs
  // (identityScopes / explicitScopes / Provider.scopeSatisfies) the registry doesn't have (P1 fix).
  listForConnect(providerId: string, ctx: ResolutionContext): Promise<AuthConfig[]>;

  // CONNECTION-BOUND, by stamped id, NO ctx (the connection is the capability, already owner-checked).
  // SECRET-FREE — for building consent / reconnect authorization URLs (clientId + redirectUri only).
  getConfigForConnection(providerId: string, authConfigId: string | undefined): Promise<AuthConfig | null>;

  // CONNECTION-BOUND, by stamped id, NO ctx. THE ONLY secret-opening method — for the token endpoint
  // ONLY: code exchange (completeAuth), refresh, revoke. Returns the secret-bearing record.
  openConfigForConnection(providerId: string, authConfigId: string | undefined): Promise<ResolvedAuthConfig | null>;

  // Pickers / management UI — visible summaries, NEVER secrets. ctx REQUIRED (visibility).
  listForProvider(providerId: string, ctx: ResolutionContext): Promise<AuthConfigSummary[]>;
}
```

**Visibility vs connection-bound — `ctx`-required vs no-`ctx`, un-bypassable by omission.** The two
`ctx`-taking methods (`listForConnect`, `listForProvider`) enforce visibility at the data boundary,
so a missing `ctx` can't silently widen what's visible. The two no-`ctx` methods
(`getConfigForConnection`, `openConfigForConnection`) are connection-bound: they resolve by the
*stamped* `authConfigId`, and the connection's existence under its owner (already enforced by
`ConnectionStore`) is the capability — the visibility check happened once, at mint time.

**Resolution policy lives in the runtime, not the registry** *(P1 fix)*: default precedence,
scope-aware filtering, and status×purpose gating (§4a/§8) all need scope inputs the registry doesn't
hold, so the registry is a pure **visibility-scoped data source** (which configs exist, by id, with
or without the secret) and the runtime owns the *selection* — exactly as the dumb `ConnectionStore`
pairs with the runtime's `resolveConnection` (§6).

**The secret has the shortest possible lifetime** *(P2 fix)*: building any authorization URL —
connect (`listForConnect`), consent, or reconnect (`getConfigForConnection`) — is **secret-free**.
**Only `openConfigForConnection`** opens the sealed secret into a `ResolvedAuthConfig`, and only for
the three token-endpoint moments: code exchange in `completeAuth`, refresh, and revoke.

Local-first ignores all of this: every config is `global`, the context is empty, and there's one
default. Hosted filters by scope against `{ ownerId, tenantId }` so a tenant's (or user's BYO)
client is never offered to — or used by — anyone else.

**Tenant context lives in the resolution input, not on the connection.** `ownerId` is the
engine's single opaque subject. `tenantId` is a **connect-/list-time** input to the registry
only. Refresh, revoke, and re-consent resolve the client by the connection's **stamped
`authConfigId`** — resolving a *specific* config by id needs no visibility context, because the
connection's existence under its `ownerId` (already enforced by `ConnectionStore`) is itself the
capability; the visibility check happened once, at mint time.

**Hosted contract (hard requirement, not a suggestion — P2 fix).** In paid hosted / multi-tenant
mode the host MUST make cross-tenant access structurally impossible by **one of**: (a) `ownerId` is
tenant-scoped (e.g. `tenant:user`, so the engine's owner check *is* a tenant check), or (b) the
store enforces per-tenant row predicates independently of `ownerId`. v3's soft "may" is upgraded
here: without one of these, a single bug leaks connections across workspaces. Same isolation point
as canonical §20 ("tenant isolation at the data layer").

> **Divergence from review (P1-1):** the reviewer offered two fixes — store `tenantId` on
> `Connection`/`AuthRequest`, *or* define `ownerId` as already tenant-scoped. I take the second.
> Adding `tenantId` to `Connection` drags multi-tenancy into the local-first core for no
> resolution benefit (refresh resolves by stamped id). If a host ever needs `tenantId` for
> metering/partitioning, it rides in the host's own audit/store layer (the `onActionRun` hook and
> the store adapter already carry host context), not on the engine's domain object.

### 4a. Default resolution — deterministic precedence (RUNTIME logic)

The **runtime** performs this over `registry.listForConnect(providerId, ctx)` (the visible
configs); it has the scope inputs the registry lacks — `provider.identityScopes`, the caller's
`explicitScopes`, and `provider.scopeSatisfies`. Resolution forks on **explicit vs implicit**, so
"you chose a bad config" fails loudly while "the system is auto-picking" never dead-ends on a config
a sibling could satisfy. (`requestedScopes = identityScopes ∪ (explicitScopes ?? config.defaultScopes ?? [])`,
where **`explicitScopes` is the caller/action scopes *excluding* identity** — identity is unioned in
here, never passed in already-merged — P3 fix.)

**Explicit `authConfigId`** — resolve in stages so each failure stays distinct *(P1 fix —
"not visible" and "visible but unavailable" must not collapse to the same answer)*:
1. **Visibility:** not in `listForConnect`'s result (wrong owner/tenant, or removed by host policy) → `none`.
2. **Status × purpose (§8):** visible but its lifecycle status forbids this purpose (e.g. connect
   on a `disabled`/`archived` config) → `unavailable` → `auth_config_unavailable`. (Distinct from
   `none` — the user named a real config that just can't be used this way.)
3. **Scope:** `requestedScopes` (its own `defaultScopes` is now known) not **covered** by
   `allowedScopes` → `scope_not_allowed`. The explicit choice is honored to the point of a *loud*
   failure; it is never silently swapped for another config.
4. Otherwise → `resolved`.

**Implicit (no `authConfigId`)** — pick a default from the **candidate set** =
configs `visible` **∩** `connect-eligible (active, §8)`, **and — only when the caller passed
`explicitScopes` —** further `∩ allowedScopes covers (identityScopes ∪ explicitScopes)` *(P1 fix:
scope-filter BEFORE defaulting, so an owner default that can't grant an explicit request doesn't
dead-end when a tenant/global one could)*. **The scope-filter applies only to `explicitScopes`** —
with no explicit request each config would request its own `defaultScopes`, which sit within its own
`allowedScopes` by construction, so there is nothing to filter (and no circularity: we never need a
config's own defaults to decide whether to pick it). Then, in order:
1. **Exactly one candidate** → it is the implicit default. **No `isDefault` flag and no picker
   required** — this keeps the single-config case invisible (Principle 1) even when the operator
   never marked a default, and resolves the apparent §1-vs-§4a tension: a lone candidate is never
   a picker.
2. **More than one** → pick the `isDefault` at the **most specific present level**: **owner**
   (matching `ctx.ownerId`) → **tenant** (matching `ctx.tenantId`) → **global**.
3. **>1, two `isDefault` at the same level** → `auth_config_ambiguous_default` (operator
   misconfig, never a silent pick).
4. **>1, no `isDefault` at any level** → `picker` → `auth_config_required`; the host
   shows `listForProvider` and the user picks, then `beginAuth(providerId, { authConfigId })`.
5. **Candidate set empty *after* scope-filtering, but non-empty before** → `scope_not_allowed`
   (no visible config can grant these scopes — a picker of configs that all can't help is useless).
6. **Visible configs exist, but none are connect-eligible** (all `disabled`/`archived`, so the
   active-filter emptied the set) → `auth_config_unavailable` — the implicit analog of the explicit
   visible-but-disabled case above; distinct from "none configured."
7. **No visible configs at all** → `none` (provider not configured for this caller).

A picker is required **only when `candidates.length > 1` and no default resolves**. Single-config /
local-first collapses to implicit step 1: the one config, invisibly.

**What the runtime does with each result** *(P1 fix — `none` had no defined model-safe state)*:
`resolved` → proceed; `picker` → `runAction` **returns** `auth_config_required`, `beginAuth`
**throws** it (§6a); `unavailable` / `scope_not_allowed` → that error code; **`none` →
`runAction` returns `error: provider_not_configured`, `beginAuth` throws `provider_not_configured`**
(canonical §6/§13). So a hosted tenant with no visible client gets a clean, diagnosable state — never
a vague `internal_error` or an `auth_required` with no URL to build.

---

## 5. Default stability & back-compat (the no-boxing-in guarantee)

- **New connections always stamp the resolved `authConfigId`.** So for an OAuth provider,
  `undefined` means only one thing: a connection created *before* this feature. Provide a
  one-time backfill that sets those to the provider's then-default id. (Moot at first launch —
  there's no legacy data yet — but specified so the contract is honest later.)
- **A default config id is immutable while any `undefined`-`authConfigId` connections exist for
  that provider** — repointing it would silently change which client refreshes those tokens.
  Backfill first, then a default may be repointed. This is the hard rule that makes
  `openConfigForConnection(providerId, undefined)` (§6 step 4) deterministic: `undefined` always
  maps to this one frozen legacy default, never to context-dependent precedence. Enabling *multiple*
  defaults (owner/tenant/global) for a provider therefore **requires backfilling its `undefined`
  connections first**.
- Implicit connect with no id resolves the default per §4a (runtime over `listForConnect`); the
  original client remains the default, so legacy connections keep refreshing untouched (via
  `getConfigForConnection` / `openConfigForConnection` by their stamped or fallback id).
- The host helper accepts both shapes (back-compat). Note `clientSecret` lives in the **config
  input** (env-sourced, ergonomic) but is split out by the runtime before anything persists (§9):
  ```ts
  // legacy single-per-provider → becomes that provider's default (id = providerId, scope: 'global')
  staticAuthConfigs({ google: { clientId, clientSecret, redirectUri } });
  // multi-config, explicit — operator-registered clients are GLOBAL (static env config, Case A §9).
  staticAuthConfigs([
    { id: 'google', providerId: 'google', scheme: 'oauth2', isDefault: true, scope: 'global',
      label: 'Primary', oauth: { clientId: A, redirectUri }, clientSecret: As, status: 'active' },
    { id: 'google-alt', providerId: 'google', scheme: 'oauth2', scope: 'global',
      label: 'Alternate', oauth: { clientId: B, redirectUri }, clientSecret: Bs, status: 'active' },
  ]);
  ```
  (`staticOAuthApps` stays as a thin alias so today's wiring and the test page don't change.)
  **Owner-scoped (BYO) and tenant-scoped configs do NOT come through `staticAuthConfigs`** — a static
  env config is operator-level and `global`. Per-owner/tenant clients carry a sealed secret and are
  registered through the **Case B `AuthConfigStore`** (§9), never as plaintext env config.

---

## 6. Runtime threading

Each touchpoint declares its **purpose** (§8) and resolves through the registry method matching its
trust path (§4): **connect** is visibility-checked against `ctx`; everything that acts on an
**existing** connection / request resolves by the stamped `authConfigId` with no `ctx`. The runtime
**enforces the §8 status×purpose table on the resolved config** (P2 fix — the table is enforced
here, not merely documented; a forbidden combination → `auth_config_unavailable`), and takes the
secret from the returned `ResolvedAuthConfig`.

1. **`beginAuth(providerId, { ownerId?, tenantId?, authConfigId?, scopes?, ... })`** — purpose
   **connect**. One **opts-based** signature, identical to canonical §5 (no separate positional
   `ctx` param — the public API never grew one; that keeps the two specs in lockstep). The runtime
   **assembles the registry `ResolutionContext` = `{ ownerId, tenantId }` from opts**, then runs §4a
   over `registry.listForConnect(providerId, ctx)`. Returns `{ authorizationUrl, requestId }`
   (no union return). The runtime runs §4a →
   `resolved` → build the URL from the **secret-free** `config.oauth.clientId` / `redirectUri` and
   the resolved `requestedScopes`; `picker` → **throw `auth_config_required`**; `unavailable` →
   **throw `auth_config_unavailable`**; `none` → **throw** (provider not configured / not permitted).
   beginAuth THROWS these because it is the **host-driven** entrypoint: the host resolves the config
   first (calls `listForProvider`, shows a picker when >1 and no default), so reaching beginAuth
   without a resolvable config is a host sequencing error, not a normal flow state. **Requested
   scopes** = `provider.identityScopes ∪ (explicitScopes ?? config.defaultScopes ?? [])` — explicit
   host/toolkit scopes **replace** `defaultScopes` (not merge); the scope-vs-`allowedScopes` check
   (covered = direct or `Provider.scopeSatisfies`) already ran in §4a. No secret is opened. Persist
   the **resolved** `authConfigId` onto the `AuthRequest`.
2. **`completeAuth`** — the **shared callback for every flow**, so its purpose is **derived from
   `AuthRequest.intent`, NOT a fixed `connect`** *(P1 fix)*: `new_connection → connect`;
   `add_scopes` (+`existingConnectionId`) → `consent` / `reconnect`. The §8 status gate already ran at
   *initiation* (beginAuth for connect; the runAction needs_consent/needs_reauth branch for
   consent/reconnect), so completeAuth does **not** re-gate as `connect` — doing so would reject a
   valid disabled-client consent/reconnect (§8 allows those on `disabled`). It just runs the
   intent-specific work: `registry.openConfigForConnection(providerId, authRequest.authConfigId)` →
   `ResolvedAuthConfig` → exchange the code with its `clientSecret` (**first secret open**); then for
   `new_connection` stamp `authConfigId` on a new `Connection` (**dedup key = `(ownerId, providerId,
   accountId, authConfigId)`** — same account via two configs is two connections; extends the
   canonical base key `(ownerId, providerId, accountId)`), or for `add_scopes` verify
   accountId+authConfigId and merge/replace on the existing connection (step 3).
3. **`add_scopes` (re-consent)** — purpose **consent** (allowed for `active`|`disabled`, §8).
   This **builds a URL** → use the **secret-free** `registry.getConfigForConnection(providerId,
   conn.authConfigId)` (P1 fix — no secret to build an auth URL); verify the re-auth resolves to
   **both the same `accountId` and the same `authConfigId`** (mismatch → `consent_account_mismatch`).
   The `needs_consent` URL requests **`connection.scopes ∪ missingScopes`** built with that
   `authConfigId` — never the default, never widened by `defaultScopes`. **First validate that union
   is covered by the config's `allowedScopes`** (direct or `Provider.scopeSatisfies`) *(P1 fix)*: if
   the connection's own client can't grant the new scope (a Calendar-limited BYO client asked for
   Gmail), return **`scope_not_allowed`** — connect a different client — rather than minting a doomed
   or policy-violating consent URL. (The eventual code exchange runs through `completeAuth` → step 2,
   which opens the secret.)
4. **`getValidCredentials` (refresh)** — purpose **refresh** (always allowed, §8). Token-endpoint
   call → `registry.openConfigForConnection(providerId, conn.authConfigId)` → refresh with *that*
   `ResolvedAuthConfig.clientSecret`. **(Load-bearing.)** No `ctx`.
   **`openConfigForConnection(providerId, undefined)` (legacy) resolves to the provider's immutable
   legacy default — deterministically, with NO precedence and NO ctx** *(P2 fix)*. It can't run
   owner/tenant/global precedence (it has no ctx, by design), so `undefined` must map to exactly
   one thing: the original provider-level default that existed before multi-client. §5 guarantees
   that default is frozen while any `undefined` connections remain — so this is always well-defined.
5. **`disconnect` (revoke)** — purpose **revoke** (always allowed, §8). Token-endpoint call →
   `openConfigForConnection` the same way.
6. **`reconnect`** (revive a `needs_reauth` connection) — purpose **reconnect** (`active`|`disabled`,
   §8). **Reconnect is the `add_scopes` flow with no new scopes** — re-auth bound to the existing
   connection (`intent: 'add_scopes'`, `existingConnectionId`, scopes = the connection's *current*
   scopes ∪ `identityScopes`), built secret-free via `getConfigForConnection` bound to the existing
   `authConfigId` (not the default). So `completeAuth` runs the **same binding as step 3**: it
   verifies the re-authorized **`accountId` AND `authConfigId` match the connection being revived**,
   and **refuses (`consent_account_mismatch`, mutating nothing) if the user picks a different account
   or client** — that's what stops a reauth from binding the wrong provider account. *(This is what
   the engine already does: needs_reauth → an `auth_required` URL with `intent: 'add_scopes'` +
   `existingConnectionId`.)*

   > **Divergence from review (P1-2):** the reviewer suggested a distinct `intent: 'reconnect'` on
   > `AuthRequest`. I'm declining — reconnect is operationally identical to `add_scopes` (same
   > existing-connection binding, same accountId+authConfigId verification, same status gating; the
   > only difference is "no new scopes," which is just `scopes = current`). A parallel intent would
   > duplicate the verification logic for no behavioral gain. `'reconnect'` stays a §8 *purpose label*
   > (for the status table), implemented by the `add_scopes` intent. The reviewer's actual concern —
   > wrong-account reauth — is already prevented by that binding.

**Scopes when `runAction` auto-initiates auth** *(P1 fix)*: when an action call finds no connection
(canonical §6 → `auth_required` / `provider_not_configured`), the runtime drives §4a/connect with
**`explicitScopes` = the attempted `action.scopes`** — **not** the config's `defaultScopes`.
(`explicitScopes` is the caller/action scopes *excluding* `identityScopes`, which §4a unions in —
P3 fix: it does **not** re-include identity.) So `requestedScopes = identityScopes ∪ action.scopes`,
and both the §4a scope-aware *config selection* and the authorization *URL* are bound to what the
action actually needs. (`defaultScopes` is the fallback only for a bare, action-less connect — e.g.
a user connecting a toolkit from a settings screen.) *(The engine already does this: `runAction`'s
no-connection branch requests `identityScopes ∪ action.scopes`.)*

**Per-instance base URL.** `identify()` and every action's `ctx.http` use
`authConfig.baseUrl ?? provider.baseUrl`, so a self-hosted instance's API base is honored.
*Instance-specific **auth/token** URLs* (e.g. a self-hosted GitLab whose authorize/token
endpoints differ per instance) are **out of scope for v1** — see §14. We support a per-instance
API base, and we say so honestly rather than half-claiming per-instance OAuth endpoints.

The runtime pipeline steps (canonical §5) don't change.

### 6a. Outcome & error contract additions (first-class, reserved in canonical now)

The multi-client layer adds states to the runtime contract. To keep the public `ActionOutcome`
union forward-stable, these are **declared in the canonical spec now and simply never emitted while
a provider has a single config** (same discipline as the `authConfigId` seam). They are recoverable
*structured next steps*, never thrown vagueness — the agent/host always gets somewhere to go.

- **`ActionOutcome` +** `{ ok: false; reason: 'auth_config_required'; providerId; choices: { authConfigId; label: string }[] }`
  — `label` is **required** here (not optional): a picker only appears with >1 config, where labels
  are mandatory (§3), so every choice is guaranteed nameable — the model-safe view never falls back
  to an id. The multi-config analog of `auth_required` when a connect is needed but **>1 candidate is
  visible and none resolves as default** (§4a). **Where it surfaces differs by entrypoint:**
  `runAction` (the agent path, which auto-initiates auth) **returns** it as this outcome;
  `beginAuth` (the host-driven path) **throws** it instead (§6 step 1) — the host is expected to
  call `listForProvider` and show a picker *before* beginAuth. (Single-config never hits either —
  a lone candidate is the implicit default.)
  **Model-safe projection** *(P2 fix — mirror `needs_account`)*: the `choices` carry `authConfigId`
  for the host/UI only; the AI projection shows the model **the config `label`s, never the opaque
  `authConfigId`**, and the host receives the full `choices` out-of-band (the `onPause` channel).
- **`ConnectorErrorCode` +**
  - `auth_config_ambiguous_default` — two `isDefault` candidates at the same visibility level (operator misconfig, §4a step 4).
  - `scope_not_allowed` — requested scopes exceed the resolved config's `allowedScopes` (covered =
    direct or `Provider.scopeSatisfies`) on **any** scope-requesting flow: connect (§6 step 1),
    reconnect, or incremental consent (§6 step 3) — not `beginAuth`-only.
  - `auth_config_unavailable` — the resolved config's lifecycle `status` forbids the flow's purpose (§8).

---

## 7. Account resolution must be a UNIQUE match (+ the config tiebreaker)

With >1 connection an `account` hint can match more than one (the same email reached through two
configs, or an email colliding with another connection's `label`). The resolver requires a
**unique** match: exactly 1 → use it; **0 or >1 → `needs_account`** (never first-match). *(This
is a correctness rule independent of multi-config and is already in the canonical spec §6 +
engine.)*

So a human/agent can disambiguate "same email via two clients," the choice contract carries the
**config label**:

```ts
// engine AccountChoice gains one optional field (lands with Phase 1):
interface AccountChoice { connectionId: string; email?: string; label?: string; authConfigLabel?: string }
```

The projection renders e.g. `me@gmail.com (Work)` vs `me@gmail.com (Personal)` — still never the
opaque `connectionId`.

> **Agrees with review (P2-5):** the tiebreaker belongs in the type, not only the prose.

---

## 8. AuthConfig lifecycle (purpose-aware)

Three statuses, but what each allows depends on the **purpose** of the flow — new-connection
flows are gated, existing-connection maintenance keeps working so you never strand live tokens:

| purpose | `active` | `disabled` | `archived` |
|---|:---:|:---:|:---:|
| **connect** (new connection) | ✓ | ✗ | ✗ |
| **reconnect** (revive a `needs_reauth` connection) | ✓ | ✓ | ✗ |
| **consent** (`add_scopes` on an existing connection) | ✓ | ✓ | ✗ |
| **refresh** | ✓ | ✓ | ✓ |
| **revoke / disconnect** | ✓ | ✓ | ✓ |

- `disabled` = "stop new signups, keep existing users whole" — they still refresh, recover, and
  upgrade scopes.
- `archived` = "wind this client down" — only refresh and revoke remain, so existing connections
  keep working long enough to migrate or disconnect, but no new grants of any kind are minted.
- **Deletion is blocked while live connections reference the config** — orphaning tokens leaves
  un-refreshable, un-revocable connections. Archive instead, or disconnect its connections first
  (which revokes them), then delete.
- **Secret rotation is allowed** (same `clientId`, new sealed `clientSecret`) — refresh keeps
  working.
- **Changing `clientId` is NOT an edit — it's a new `AuthConfig`.** A different client can't
  refresh the old client's tokens (same binding rule as refresh/revoke).

> **Agrees with review (P2-1)**, expressed as a status×purpose table rather than a sprawling
> permission system — it's documentation, not a new subsystem.

---

## 9. Host pieces — split by *who registers the client*

**Case A — operator-configured (env/config). Cheap; almost all engine.**
- Multiple entries in `staticAuthConfigs` (all `scope: 'global'`). No new storage, no secret UI.
  The runtime splits each `clientSecret` out of the config input, holds it in-process, and
  **registers it with the `Redactor`** — it is never persisted and never logged.
- Connect-time UX: if `listForProvider` returns >1, show a small picker; if 1, show nothing.

**Case B — user/tenant brings their own client (BYO). Product-heavy; deferred.**
- **New `AuthConfigStore` that mirrors `ConnectionStore` exactly — the store never receives a
  plaintext secret.** The runtime seals the `clientSecret` (same `SecretBox` as connections) and
  hands the store safe metadata + an opaque blob:
  ```ts
  // RAW, MECHANICAL persistence — NO visibility logic AND NO cross-store invariants. It keys by the
  // config's own fields and knows nothing about ConnectionStore. Each method just does the bytes.
  interface AuthConfigStore {
    create(config: AuthConfig, sealedSecret?: SealedSecret): Promise<void>;       // secret pre-sealed; never plaintext
    get(id: string): Promise<{ config: AuthConfig; sealedSecret?: SealedSecret } | null>;
    listForProvider(providerId: string): Promise<AuthConfig[]>;                   // ALL configs for the provider (raw)
    setDefault(providerId: string, id: string): Promise<void>;                    // flips the flag; the SERVICE pre-checks immutability
    setStatus(id: string, status: AuthConfig['status']): Promise<void>;
    delete(id: string): Promise<void>;                                            // unconditional; the SERVICE pre-checks live connections
  }
  ```
  `sealedSecret` is optional (PKCE/public clients have none). Two layers sit over the store *(P2 fix —
  a raw store can't enforce rules that need other stores)*:
  - **`AuthConfigRegistry`** — the **visibility-scoped read layer**: takes `ResolutionContext`, filters
    the store's raw `listForProvider` output by scope to power `listForConnect(ctx)` /
    `listForProvider(ctx)`, and resolves by-id. **Only `openConfigForConnection`** opens the sealed
    secret via `SecretBox` into a `ResolvedAuthConfig` (§3/§4), only when a token request needs it —
    Redactor-registering it. The URL-building resolvers and `listForProvider` (UI) **never** open one.
  - **An admin/management service** — holds **both** `AuthConfigStore` and `ConnectionStore`, so it is
    the place that enforces the **cross-store invariants** before delegating to the raw store:
    `delete` is **refused while live connections reference the config** (§8); `setDefault` **honors §5
    immutability** (no repoint while `undefined`-`authConfigId` connections exist). The store itself
    can't know either — only the service can.

  **The store, like `ConnectionStore`, sees only opaque bytes** and enforces no policy.
- **Scoping:** BYO configs are `scope: 'owner'` (or `'tenant'`); the **registry** (not the raw store)
  filters by context so secrets and clients never cross owners/tenants.
- **UI:** an "Advanced → use your own OAuth app" form (clientId/secret/redirect + validate),
  hidden by default. This is the real work — and it's product, not engine.

> **Agrees with review (P1-3):** the secret never crosses the store boundary, matching the
> canonical's existing rule for `ConnectionStore`.

---

## 10. UX rules (keep the simple case simple)

- **One config:** the `AuthConfig` concept is invisible end-to-end.
- **Many configs:** choosing a client is a **connect-time** decision only. **Use-time stays
  account-centric** — the agent/user picks an *account*; the client is auto-resolved from that
  connection's `authConfigId`. Nobody picks a client to send an email.
- Surface the config `label` in connect pickers and in `needs_account` choices (the
  `authConfigLabel` tiebreaker when one email is reachable via two configs — §7).

---

## 11. Security

- `clientSecret` is a secret: from env (Case A, in-process + Redactor-registered, never
  persisted) or sealed in `AuthConfigStore` (Case B). It never appears in `AuthConfig`,
  `AuthConfigSummary`, logs, errors, or UI.
- Visibility scope keeps BYO/tenant clients and their secrets from crossing owners/tenants — the
  hosted-mode isolation point. Hard isolation is enforced at the store/data layer (canonical §20),
  not just by the runtime `ownerId` check.

---

## 12. Testing

- Two `oauth2` configs for `google` (clients A, B) with token endpoints distinguishable by
  `client_id` in the request body.
- Connect account-1 via A → `authConfigId = A`; expiry-triggered refresh hits **A**. Connect
  account-2 via B → refresh hits **B**.
- Same account via A and B → **two** connections (dedup by `accountId + authConfigId`).
- **Back-compat:** an OAuth connection with `authConfigId: undefined` refreshes via the
  **default**; a non-OAuth connection never consults `authConfigId` **for OAuth
  exchange/refresh/revoke** (it may still carry one for `baseUrl`/context — §3b).
- **Default precedence (§4a):** explicit id wins; owner default beats tenant beats global; two
  defaults at one level → `auth_config_ambiguous_default`; **exactly one visible candidate (no
  `isDefault`) resolves with no picker** (single-config invisibility); **>1 candidate + no default
  → `auth_config_required`** (picker).
- **No visible config → `provider_not_configured` (§4a/§6, P1):** 0 connections and no resolvable
  client (e.g. a hosted tenant with no visible config) → `runAction` returns
  `error: provider_not_configured`, `beginAuth` throws it — never `internal_error` or an
  `auth_required` with no URL. (Covered in the engine today: `spine.test.ts` exercises 0 connections
  + empty `staticOAuthApps`.)
- **Consent bounded by `allowedScopes` (§6 step 3, P1):** a Calendar-limited config asked to add a
  Gmail scope → `scope_not_allowed` (no doomed consent URL); a config that *can* grant it → the
  `needs_consent` URL is minted.
- **Implicit all-inactive (§4a step 6):** visible configs exist but all are `disabled`/`archived` →
  `auth_config_unavailable` (the implicit analog of the explicit visible-but-disabled case); a
  provider with **no** visible configs → `none` → `provider_not_configured`. The two stay distinct.
- **Auto-auth scopes (§6, P1):** `runAction` on an action with no connection requests
  `identityScopes ∪ action.scopes` (not the config's `defaultScopes`); with multiple configs, a
  Calendar-only config is **not** auto-selected for a Gmail action when a Gmail-capable config exists.
- **Reconnect binding (§6 step 6, P1):** reviving a `needs_reauth` connection (the `add_scopes` path)
  refuses a re-auth that resolves to a different `accountId` or `authConfigId` → `consent_account_mismatch`,
  mutating nothing.
- **Registration invariants (§3a):** a config whose `defaultScopes` (∪ `identityScopes`) exceed its
  `allowedScopes` → registration error; an `AuthConfig.scheme` ≠ the provider strategy → error.
- **Trust-path split (§4):** `listForConnect(ctx)` excludes a config not visible in `ctx` (so the
  runtime resolves it to `none`); `getConfigForConnection` / `openConfigForConnection` resolve that
  **same** id by stamp with no `ctx`, proving connect-visibility and connection-bound resolution are
  distinct.
- **Resolution lives in the runtime (§4a, P1):** scope-aware selection works given
  `listForConnect`'s output + `explicitScopes` + `provider.scopeSatisfies` — the registry alone (no
  scope inputs) could not produce it. The runtime builds the authorization URL with the resolved
  `requestedScopes` and persists them on the `AuthRequest` (beginAuth's return stays
  `{ authorizationUrl, requestId }` — P3 fix).
- **Explicit-stage distinction (§4a, P1):** an explicit `authConfigId` that is visible but
  `disabled` for `connect` → `unavailable` → `auth_config_unavailable` (NOT `none`); a not-visible
  id → `none`; a visible+active id exceeding `allowedScopes` → `scope_not_allowed`. The three stay
  distinct.
- **Scope-aware implicit selection (§4a, P1):** when an owner default's `allowedScopes` can't cover
  the request but a tenant/global config can, implicit selection picks the satisfying config
  (the owner config is filtered out *before* precedence — no dead-end); if **no** visible config
  can grant the request → `scope_not_allowed`, not a useless picker.
- **Secret lifetime (§4, P1/P2):** building **any** auth URL is secret-free — connect
  (`listForConnect`), consent and reconnect (`getConfigForConnection`); **only**
  `openConfigForConnection` opens `clientSecret`, and only for exchange/refresh/revoke. Assert
  `add_scopes`/`reconnect` never call the secret-opener. The secret is Redactor-registered and
  absent from `AuthConfig`, `AuthConfigSummary`, and `listForProvider`.
- **`beginAuth` contract (§6, P1):** with >1 candidate and no default, `beginAuth` **throws**
  `auth_config_required` (not a union return); `runAction` on the same situation **returns** the
  `auth_config_required` outcome.
- **Model-safe picker (§6a, P2):** the projection's view of `auth_config_required` lists config
  `label`s only — the opaque `authConfigId` never reaches the model; the host gets it via `onPause`.
- **Host policy filter (§4a):** a host filter removing `scope:'owner'` configs makes the tenant /
  global default win — precedence never sees the filtered-out candidates.
- **Status×purpose enforcement (§6/§8):** `refresh` and `revoke` resolve on an `archived` config;
  `connect` on a `disabled`/`archived` config is **not** connect-eligible (excluded from §4a
  candidates, or `auth_config_unavailable` if forced by explicit id); `consent`/`reconnect` allowed
  on `disabled`, refused on `archived`.
- `add_scopes` with a *different* `authConfigId` than the existing connection → refused
  (alongside the existing account-mismatch check).
- **Scope formula (§6):** explicit scopes replace `defaultScopes`; result bounded by
  `allowedScopes` (over-ask → `scope_not_allowed`); `needs_consent` requests
  `connection.scopes ∪ missing` and does **not** silently add `defaultScopes`.
- **`allowedScopes` coverage via implication (§3/§6):** `allowedScopes: [calendar]` permits a
  request for `calendar.events` (covered through `Provider.scopeSatisfies`); a scope neither in nor
  implied by `allowedScopes` → `scope_not_allowed`.
- **Label/id invariants (§3):** registering >1 config for a provider where any lacks a `label` →
  registration error (every pickable config is nameable); duplicate `AuthConfig.id` (globally) →
  registration error.
- **Visibility:** `listForProvider` with `ctx = { ownerId: A }` excludes a `scope:'owner'` config
  owned by B; `get` won't resolve it for A.
- **Lifecycle (§8):** delete blocked while connections exist; `disabled` rejects new connects but
  permits refresh / reconnect / add_scopes; `archived` permits only refresh + revoke; rotating
  `clientSecret` keeps refresh working.
- **Secret confinement:** `AuthConfigStore.create` is never called with a plaintext secret (the
  store receives only sealed bytes); `listForProvider`/summaries contain **no secrets**; a
  sentinel client secret never escapes to a log/error/UI (canonical §8 sentinel test, extended
  to client secrets).
- **`baseUrl` threading (§6):** `identify()` and `ctx.http` hit `authConfig.baseUrl` when set —
  **including a non-OAuth (api_key/bearer) connection whose config carries only a `baseUrl`** (P2:
  consulted for context, never for an OAuth client).
- **Resolution:** ambiguous account hit → `needs_account` with `authConfigLabel` in the choices
  (per §7).

---

## 13. Phasing

1. **✅ Engine (IMPLEMENTED 2026-06-19, additive, low-risk):** §3 types (incl. secret-out-of-record +
   `ResolvedAuthConfig`), §3a scheme invariant, `AuthConfigRegistry` (split
   `listForConnect` + `getConfigForConnection` + `openConfigForConnection` + `listForProvider` +
   resolution context, with §4a selection in the runtime), §4a
   default precedence (implicit-default-when-one + host policy filter), §6 threading with
   purpose+status enforcement + scope formula + `baseUrl`, §6a outcome/error additions
   (`auth_config_required` + the three codes + the model-safe projection case — already reserved &
   dormant in the engine types), the
   refresh/revoke/re-consent/reconnect binding, `(accountId, authConfigId)` dedup,
   `staticAuthConfigs` dual-shape, §5 default rules, the `AccountChoice.authConfigLabel` field
   (§7), §12 tests. Unblocks Case A entirely. (Unique-match resolution already shipped + verified
   in the engine — 73 tests green.)
2. **Case A host/UX:** operator multi-config + a connect-time picker (only when >1).
3. **Case B (BYO), deferred:** sealed `AuthConfigStore` + adapter, owner/tenant scoping, the
   add/manage-client UI — built only when a concrete BYO/separation requirement lands.

---

## 14. Non-goals

- Changing the single-config default behavior, or making it visible.
- Building BYO storage/UI now (Phase 3).
- Auto-selecting a different client *per account* — the client is chosen once at connect time and
  then fixed for that connection (so refresh stays correct).
- **Multi-scheme per provider** (e.g. GitHub OAuth-app *or* PAT). v1 holds `AuthConfig.scheme ==`
  the provider's single strategy (§3a). The future seam is `Provider.authStrategies` — not built.
- **Per-instance auth/token endpoints** (self-hosted instances whose OAuth authorize/token URLs
  differ). v1 supports a per-instance API `baseUrl` only (§6).

---

**Net:** one client per provider stays the normal, invisible default. Multiple clients become a
stamped `authConfigId` + a registry keyed by config (with a visibility context and deterministic
default precedence) + a handful of binding rules (refresh/revoke/re-consent use the minting
client; unique-account resolution; clientId-change = new config) + the same secret-never-in-the-
store discipline the engine already holds for connections. It's additive, migration-free, and —
critically — it separates *who owns a connection* from *who owns a client*, which is what keeps
paid hosted mode from getting weird.
