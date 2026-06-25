# Spec: Workspace-scoped connectors (service-grain)

> **Status:** draft, not built. Revised after a code-verified review. Additive feature
> on top of the connectors engine + MCP ingest (`docs/connectors-mcp-ingest-spec.md`).
>
> **Goal.** Scope which connectors an agent surface may use, at the grain the user
> actually reasons about — a **service** (a *toolkit*: Gmail, Google Calendar, Drive,
> Slack, Linear), optionally pinned to a specific **account**. One mechanism, two
> wins: least privilege (an autonomous execution can't touch surfaces it wasn't given)
> and context curation (it only sees those tools — no junk drawer).

---

## 1. The unifying grain: service = toolkit

A *provider* (Google) contains many *toolkits* (`gmail`, `google_calendar`,
`google_drive`, `google_docs`, `google_sheets`); Microsoft has `outlook_mail` +
`outlook_calendar`. The engine already filters at **toolkit** grain in both
projections (`serveMcp` and `toToolSet` take `options.toolkits` of toolkit ids). So a
toolkit is the natural, already-supported unit of capability. We use it in two places
so the user learns one concept:

1. **Connect time** — pick which services to grant → request only those toolkits'
   scopes (§5).
2. **Workspace allowlist** — pick which services an execution may use, optionally per
   account (§4).

Provider-grain would over-grant (allowing "google" = Gmail + Calendar + Drive + Docs +
Sheets). Toolkit-grain is true least privilege; the UI keeps it clean by grouping
services under their provider with a provider-level "select all" (§7).

## 2. The surface model (unchanged, confirmed)

| Surface | Connectors |
|---|---|
| **Orchestrator** (+ orchestrator-targeted schedules, `workspaceId: null`) | all connected (broad) |
| **Content** (note/task in-document chat) | all connected (broad) — interactive + supervised |
| **Execution** (workspace agent/coding sessions) | **workspace scopes ∩ connected**, default none |

A workspace-less digest is an **orchestrator-targeted schedule** (`targetKind:'orchestrator'`,
`workspaceId` null) — already runs broad in the data root. No synthetic workspace needed.
This spec only governs **workspace-targeted executions**.

## 3. Security baseline: executions fail closed (P1)

Independent of connectors: **execution sessions must set `strictMcpConfig: true`** so
ambient/user/repo-level MCP config can't leak into a worktree agent. The orchestrator
already does this (`orchestratorSessionConfig`); executions currently skip it. Fix that
first — strict MCP with an empty server list when a workspace grants nothing, or with
*only* the scoped connectors server when it does. Without this, every other guarantee
here is bypassable. (`harness-surface.test.ts` already asserts strict + no-MCP blocks
ambient servers; add the equivalent for executions.)

**Capability gate (P1).** `strictMcpConfig` / `mcpServers` are honored only by harnesses that
implement MCP tool-filtering — **Claude Code today; Codex ignores them** (the executor already
warns: "tool filtering / MCP attachment are ignored by this provider"). So scoped connectors
must be **gated on harness capability**: attach the scoped connectors MCP only on a
strict-MCP-enforcing harness. On a non-enforcing harness, an execution gets **no connectors**
(fail-closed) even if the workspace configured scopes — never a half-enforced attachment.
Surface it (UI/logs: "connectors aren't available for &lt;harness&gt; executions"); optionally
fail session creation if a run explicitly requires connectors.

## 4. Data model — JSON column of service scopes

```ts
// src/lib/db/schema.ts — workspaces
connectorScopes: text({ mode: 'json' }).$type<WorkspaceConnectorScope[]>().notNull().default([]),

// src/db/types.ts (or shared)
interface WorkspaceConnectorScope {
  toolkitId: string;              // 'gmail' | 'google_calendar' | 'mcp_linear' | ...
  account?: {                     // pin to one account; omitted = all connected accounts
    accountId: string;            // engine accountId (stable across reconnect)
    authConfigId?: string;        // OAuth client that minted it; undefined = default client
  };
}
```

**Still JSON, not a join table.** Entries reference toolkit ids (engine constants /
ingested-server ids) and an engine `accountId` — neither are rows in the app DB (the
ConnectionStore lives in the connectors home), so there is nothing to foreign-key to. It
is an owned scope list: read/written whole when a session is built, small, no independent
lifecycle, never queried by toolkit across workspaces. Same ownership shape as
`notificationChannels.events: string[]` / `schedules.deliverResultTo: string[]`. A join
table would only earn its keep if scopes grew an independent per-row lifecycle or
cross-workspace queries — not in scope; promoting later is cheap.

**Pin by `(accountId, authConfigId)`, not connection id (P2).** The pin carries the **stable
components** of the connection natural key `(ownerId, providerId, accountId, authConfigId)` —
not the connection's `id`, a uuid that does **not** survive disconnect→reconnect (disconnect
deletes the row; reconnect mints a new id), so a pin by it would silently die. `accountId` is
re-derived to the same value on reconnect, so the pin re-attaches with no re-pin. `authConfigId`
(the OAuth client that minted the connection) is part of the pin because `accountId` alone is
**not** unique: the same account connected through two clients yields two connections that share
an `accountId` — without `authConfigId` the pin would resolve to two matches and the toolkit would
silently drop (fail-closed, but confusing). `authConfigId` undefined = the provider's default
client (pre-feature / self-credentialed). The pin is a single optional value, not an array — the
state v1 enforces ("all accounts" or "this one"), so an unenforceable subset can't be
represented. The route resolves the pin → the live connection id at session build (§6a/§6b),
requiring **exactly one** match (else fail-closed); the dedicated PUT also validates this at write
time for currently-connected providers so an ambiguous pin is rejected up front, not silently
dropped later. Enforcement is by the resolved connection id while storage stays stable.

## 5. Connect-time service selection (fixes "blasted all of Google")

Today connect requests `providerScopes(p)` = the **union of every toolkit's scopes**, so
one Google consent grants Gmail + Calendar + Drive + Docs + Sheets. Change:

- The connect panel lists the provider's **toolkits as checkboxes** (default: all, so the
  happy path is unchanged); the connect call requests only the **selected toolkits'
  scopes ∪ identity scopes**.
- Narrow grants are safe to start: the engine's incremental consent (`needs_consent` +
  re-consent that adds scopes to the existing connection) tops up later if a workspace
  enables a service the connection didn't grant. Surface that as a one-click "grant
  Calendar too" when it happens.
- **Provider capability caveat (P3).** This narrows the **credential grant** only where the
  provider has granular OAuth scopes (Google, Microsoft). Single-scope OAuth (Notion) and
  PAT/api-key providers (Airtable, Asana) have nothing to narrow at the credential level —
  there, service selection only controls which toolkits we wire up, and **workspace toolkit
  scoping (§4) is what controls tool exposure**. Word the UI so it doesn't overpromise
  least privilege where the provider can't deliver it.

This is a connect-flow change (UI + the `scopes` already accepted by `/connectors/connect`)
and composes with §4: a connection bounds what's grantable; the workspace allowlist bounds
what an execution may use of it.

## 6. Wiring

### 6a. `serveMcp` gains toolkit filter (have it) + per-toolkit connection pin (new, small)
`serveMcp` already filters by `options.toolkits`. Add `options.connectionPins?:
Record<toolkitId, connectionId>`: a pinned toolkit's handlers pass that `connectionId` to
`runAction` (a hard pin) instead of the model's soft `account` hint. The host computes the
pin by resolving the scope's stored `account` (accountId) to the owner's live connection for
that toolkit's provider — so enforcement is a server-resolved connection id, and the stored
ref stays stable across reconnect (§4). Single-account only (the work/personal case); a
multi-account subset would need an array shape — deferred (§9).

### 6b. Connectors MCP endpoint is workspace-aware; the boundary is the confined session
`connectorsMcpServer(port, { workspaceId })` appends `?ws=<id>`. The serve route, per
request (mcp-handler's init callback has no request access, so build the handler in the
route from `req.url`):
- **no `ws`** → toolkits = connected (orchestrator/content broad).
- **`ws` present** → validate the workspace id, load its `connectorScopes`, compute
  `toolkits = connected ∩ scoped` and `connectionPins` server-side, pass to `serveMcp`. A
  pinned `account` is **resolved + validated** here (exists, owned, matches the toolkit's
  provider); if it resolves to anything other than exactly one connection, the toolkit is
  **not exposed** (fail-closed) rather than offering a tool that can only error (P2).

**`?ws` is routing context, not the security boundary.** The boundary is that an execution
session is **strictly confined** (§3) to the exact MCP URL we configured for it, which
carries `ws`; the model can't reach the no-`ws` broad endpoint because it isn't in the
session config and strict MCP blocks ambient. The route never trusts a client-asserted
scope — it derives everything from the validated workspace id.

### 6c. Executor attaches the scoped endpoint (capability-gated)
For `sessionType === 'execution'`: always `strictMcpConfig: true` (§3). Attach
`connectorsMcpServer(port, { workspaceId })` **only when** (a) the workspace's
`connectorScopes` is non-empty **and** (b) the session's harness enforces strict MCP (§3
capability gate — Claude Code yes, Codex no). On a non-enforcing harness, attach nothing and
surface it. Executions do not get the orchestrator MCP — unchanged.

### 6d. SDK parity
`getConnectorTools(ownerId, opts?: { toolkits?: string[]; connectionPins?: Record<string,string> })`
takes the same optional filters, for any workspace-bound SDK chat. Harness execution
(6a–6c) is the primary path.

### 6e. Queries + validation (P2, fixed)
`getWorkspace`/list include `connectorScopes`; add `setWorkspaceConnectorScopes(id, scopes)`:
- **Reject (don't silently drop) toolkit ids that don't exist** in the registry — return
  them to the caller as an error.
- **Preserve known-but-currently-disconnected** toolkit ids and pinned `account`s as
  **dormant** (they resolve to nothing until reconnected; never silently removed). Because a
  pin is an `accountId` (§4), reconnecting the same account re-resolves it automatically — no
  re-pin. A truly unknown toolkit id is rejected; a disconnected-but-known one is kept.

### 6f. Live policy changes recycle sessions (P2)
On `setWorkspaceConnectorScopes`, recycle that workspace's **active execution sessions**
(`invalidateAgentSession`) so a removed service takes effect immediately, not next session.
Tightening (removing) must apply now; the harness caches tool lists otherwise.

## 7. UI

- **Connect panel (§5):** the provider's services as checkboxes, all-on by default, with a
  provider-level select-all. Only the box list when one service; grouped when many.
- **Workspace settings:** a "Connectors" section listing **connected** services grouped under
  their provider (provider-level select-all + per-service toggles). When a service has **>1
  connected account**, an account picker (default "all accounts"); pinning one writes
  `account: { accountId, authConfigId }` (both pulled from the chosen connection so the same
  account through two clients stays distinct). **Dormant** selected services/accounts (stored but currently
  disconnected) render disabled with a reconnect/remove affordance, so stored intent is always
  visible. Sticky — set once per workspace. Copy: "Agents running in this workspace may use
  these services. The orchestrator always has them all."

## 8. Defaults, migration, back-compat

- New column defaults `[]`. Existing + new workspaces → `[]` → executions get nothing, exactly
  as today. Zero behavior change on migration; opt-in per workspace.
- Orchestrator stays broad (absorbs the "just works" case), so default-empty workspaces aren't
  a dead end.

## 9. Out of scope (future seams)

- **Multi-account subsets** (a toolkit scoped to 2 of 3 accounts). v1 is all-accounts or pin-one
  (`account?: { accountId, authConfigId? }`). Seam: widen to `accounts?: AccountPin[]` + a
  `runAction` "allowed connection set" constraint (resolve-set, fail-closed on empty).
- **Connectors on non-strict harnesses** (e.g. Codex executions). Blocked until that harness
  enforces MCP tool-filtering (§3 capability gate); revisit when agentex adds it.
- **Per-execution override** (one-off "this run may also use X"). Workspace + orchestrator cover
  the cases; deferred to avoid per-run decision friction.
- **Content scoping** to the focused entity's workspace; content stays broad for now.

## 10. Testing

- Schema/queries: `setWorkspaceConnectorScopes` round-trips; rejects unknown toolkit ids;
  preserves dormant (disconnected) ids.
- Endpoint: `?ws` → toolkits = scoped ∩ connected; a pinned `account` resolves to its live
  connection id and forces it; an unresolvable/ambiguous pin fails closed (toolkit not exposed);
  no `ws` = connected (broad); empty scopes + `ws` = nothing.
- Pin stability: a scope pinned by `(accountId, authConfigId)` re-resolves after a
  disconnect→reconnect of that account (new connection id, same accountId+authConfigId) without a
  re-pin; the same account connected through a second OAuth client stays a distinct, unambiguous pin.
- Executor: execution session is `strictMcpConfig: true` always; attaches the scoped endpoint
  only with non-empty scopes **and** a strict-enforcing harness (capability gate); a
  non-enforcing harness (Codex) attaches no connectors; orchestrator/content unchanged; an
  orchestrator-targeted schedule stays broad.
- Invalidation: removing a service recycles that workspace's active execution sessions.
- Connect: selecting a subset of services requests only those scopes; incremental consent tops up.

## 11. Build order

1. **§3 fail-closed:** execution sessions set `strictMcpConfig: true` (+ test). Safe on its own.
2. Schema `connectorScopes` + migration; `queries.ts` getter/setter with reject-unknown /
   preserve-dormant.
3. `serveMcp` `connectionPins` + the `?ws` route filter (per-request handler).
4. Executor attaches the scoped connectors MCP for non-empty scopes; invalidation on change.
5. `getConnectorTools` optional filters (SDK parity).
6. Connect-time service selection (UI + scopes payload).
7. Workspace-settings UI (grouped services + account picker).
8. Tests throughout.
