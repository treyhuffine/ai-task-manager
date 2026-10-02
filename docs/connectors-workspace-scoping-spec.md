# Spec: Workspace-scoped connectors (service-grain)

> **Status:** draft, not built. Revised after a code-verified review. Additive feature
> on top of the connectors engine + MCP ingest (`docs/connectors-mcp-ingest-spec.md`).
>
> **Update 2026-09-28: multi-account subsets shipped.** A service can now be limited to any set of
> connected accounts (e.g. 2 of 3 Gmail accounts), not just "all" or "one". The stored shape is
> `accounts?: AccountPin[]` (§4), enforced by an engine "allowed connection set" on `runAction`
> (§6a), picked with a multiselect (§7). The sections below describe the shipped behavior.
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

// src/lib/db/schema.ts (re-exported from src/db/types.ts)
interface WorkspaceConnectorScopeAccount {  // an "account pin"
  accountId: string;              // engine accountId (stable across reconnect)
  authConfigId?: string;          // OAuth client that minted it; undefined = default client
}
interface WorkspaceConnectorScope {
  toolkitId: string;              // 'gmail' | 'google_calendar' | 'mcp_linear' | ...
  accounts?: WorkspaceConnectorScopeAccount[];
  /** @deprecated legacy single pin: read (normalized into `accounts`), never written */
  account?: WorkspaceConnectorScopeAccount;
}
```

What `accounts` means:

| `accounts` | Meaning | Enforcement (§6a) |
|---|---|---|
| omitted / `[]` | every connected account, **including ones connected later** | no constraint, the model may name any account |
| one pin | that account only | hard pin: the `account` tool param is hidden, the run is forced to the connection |
| two or more pins | exactly that set | the `account` param stays, lists only the set, and `runAction` rejects anything outside it |

Picking every currently connected account one by one stores that **explicit set**, which does NOT
include an account connected later. Only "All accounts" (no pins) grows with new connections. That
is the least-privilege reading of a user who picked specific accounts, and the picker (§7) shows the
two as different states ("All accounts" vs "3 of 3 accounts").

**Legacy rows.** Rows written before multi-account scopes carry the single `account` pin. The column
is JSON, so there is no SQL migration: the query layer (`getWorkspace`, `listWorkspaces`, and the
rows `createWorkspace` / `updateWorkspace` / `archiveWorkspace` return) normalizes every read through
`normalizeConnectorScopes` (`src/lib/connectors/scope-pins.ts`), folding `account` into `accounts`.
The row itself is rewritten into the new shape on the next scope save
(`setWorkspaceConnectorScopes` only writes `accounts`). Anything that reads a raw scope goes through
`scopePins(scope)`, which understands both fields. A stored scope whose declared pins are all
malformed is dropped on read (fail closed), never widened to all accounts.

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
client (pre-feature / self-credentialed). The route resolves each pin → a live connection id at
session build (§6a/§6b), requiring **exactly one** match per pin (a pin that matches zero or several
contributes nothing); the dedicated PUT also validates this at write time for currently-connected
providers so an ambiguous pin is rejected up front, not silently dropped later. Enforcement is by the
resolved connection ids while storage stays stable.

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

### 6a. `serveMcp`: toolkit filter, per-toolkit pin, per-toolkit allowed set
`serveMcp` filters by `options.toolkits` and takes two account constraints, both keyed by toolkit
id and computed by the host from the stored pins (§6b), so enforcement is by server-resolved
connection ids while the stored refs stay stable across reconnect (§4):

- `connectionPins?: Record<toolkitId, connectionId>`: a pinned toolkit's handlers pass that
  `connectionId` to `runAction` (a hard pin) and the `account` param is not exposed at all.
- `allowedAccounts?: Record<toolkitId, AccountChoice[]>`: a toolkit limited to a SET of accounts.
  The `account` param stays, and its description lists exactly the allowed accounts (the
  `accountDisplay` tokens, e.g. `"work@gmail.com"`, `"me@gmail.com (Work)"`). Every run passes
  `allowedConnectionIds` plus the model's `account` hint to `runAction`. A one-entry set behaves as a
  pin, an empty set hides the toolkit (fail closed), and a pin for the same toolkit wins.

The engine constraint lives in `runAction` (`RunActionOptions.allowedConnectionIds`), so it holds
for any projection, not just MCP. Resolution considers only the owner's connections in the set:

- a hint that matches one allowed account → that connection;
- a hint or a `connectionId` naming a connection OUTSIDE the set → `error` with code
  `account_not_allowed` and a message listing the allowed accounts (never silently rerouted, and a
  raw connection id is never echoed);
- no hint, or a hint that is ambiguous or names nothing: one allowed connection → it; more →
  `needs_account` whose choices are only the allowed accounts (the existing multi-account
  behavior, restricted to the subset);
- nothing in the set is live (or the set is empty) → `connection_not_found`. A constrained run never
  starts a connect flow, since the set was fixed by the host, not the model.

The model-facing view of `account_not_allowed` is the usual model-safe `error` outcome. Shared
projection logic (`accountBinding`, `allowedAccountDescription`, `bindingRunOptions`) lives in
`packages/connectors/src/core/projection-shared.ts` so MCP and the AI SDK behave identically.

### 6b. Connectors MCP endpoint is workspace-aware; the boundary is the confined session
`connectorsMcpServer(port, { workspaceId })` appends `?ws=<id>`. The serve route, per
request (mcp-handler's init callback has no request access, so build the handler in the
route from `req.url`):
- **no `ws`** → toolkits = connected (orchestrator/content broad).
- **`ws` present** → validate the workspace id, load its `connectorScopes`, compute
  `toolkits = connected ∩ scoped`, `connectionPins` and `allowedAccounts` server-side
  (`resolveConnectorFilter`, `src/lib/connectors/workspace-filter.ts`), pass to `serveMcp`. Each
  pinned account is **resolved + validated** here (exists, owned, matches the toolkit's provider);
  a pin that doesn't resolve to exactly one connection contributes nothing. One live pin → a
  `connectionPins` entry, two or more → an `allowedAccounts` set. If a scope declared pins and
  none resolve, the toolkit is **not exposed** (fail-closed) rather than widened to every account
  or offered as a tool that can only error (P2).

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
`getConnectorTools(ownerId, opts?: Partial<WorkspaceConnectorFilter>)` takes the same optional
filters (`toolkits`, `connectionPins`, `allowedAccounts`) for any workspace-bound SDK chat, and
`toToolSet` applies them exactly like `serveMcp`. Harness execution (6a–6c) is the primary path.

### 6e. Queries + validation (P2, fixed)
`getWorkspace`/list include `connectorScopes`; add `setWorkspaceConnectorScopes(id, scopes)`:
- **Reject (don't silently drop) toolkit ids that don't exist** in the registry — return
  them to the caller as an error.
- **Preserve known-but-currently-disconnected** toolkit ids and pinned accounts as
  **dormant** (they resolve to nothing until reconnected; never silently removed). That covers a
  whole provider being disconnected AND one account of a still-connected provider: a pin already
  stored on the workspace is kept even when it matches no live connection. A NEW pin for a
  connected provider must match exactly one connection. Because a pin is an `accountId` (§4),
  reconnecting the same account re-resolves it automatically, no re-pin. A truly unknown toolkit id
  is rejected; a disconnected-but-known one is kept.
- **Account identifiers.** A write payload (`POST /workspaces`, `PUT /workspaces/:id/connector-scopes`)
  may name each account as an exact pin `{ accountId, authConfigId? }` (what the UI and
  `get_workspace` carry) or as a string: an email, label, account id, or the "email (Client)"
  display form. Strings resolve case-insensitively against the owner's live connections for that
  toolkit's provider and are stored as pins. No match, or more than one, is a 400 with a readable
  message listing the connected accounts (or the ambiguous candidates). A string that names a stored
  dormant pin's account id round-trips. The legacy single `account` (pin or string) is still
  accepted and folded into `accounts`.
- **Malformed accounts reject the payload** (400) rather than being dropped. Dropping one used to
  turn a scope into "all accounts", the opposite of what the caller asked for (this is how
  `update_workspace`'s string `account` was silently ignored before).
- Pins are deduped per scope, scopes are deduped by toolkit (last wins), and only the current shape
  is written.

`update_workspace` (orchestrator action, local CLI only) takes `connectorScopes: [{ toolkitId,
accounts?: (string | { accountId, authConfigId? })[], account?: string | null }]`, folds the legacy
`account` into `accounts`, and forwards to the PUT above, so the same resolution and errors apply
(a 400 comes back as `invalid_params`).

### 6f. Live policy changes recycle sessions (P2)
On `setWorkspaceConnectorScopes`, recycle that workspace's **active execution sessions**
(`invalidateAgentSession`) so a removed service takes effect immediately, not next session.
Tightening (removing) must apply now; the harness caches tool lists otherwise.

## 7. UI

- **Connect panel (§5):** the provider's services as checkboxes, all-on by default, with a
  provider-level select-all. Only the box list when one service; grouped when many.
- **Workspace settings:** a "Connectors" section listing **connected** services grouped under
  their provider (provider-level select-all + per-service toggles). When a checked service has
  **>1 connected account** (or already has pins), an account multiselect sits at the right of the
  row (`AccountMultiSelect` in `connector-scope-picker.tsx`, a `DropdownMenu` of
  `DropdownMenuCheckboxItem`s, the app's multi-choice filter pattern):
  - Collapsed, it summarizes the choice: "All accounts", the one email when a single account is
    picked, or "2 of 3 accounts". An amber alert icon (with a tooltip) marks chosen accounts that
    are no longer connected. The trigger caps at 55% of the row in a narrow panel and 200px from
    the `@sm` container size up (the picker root is an `@container`).
  - Open, it lists "All accounts" (subtitle "Includes accounts you connect later"), a separator,
    then one checkbox per connected account. The menu stays open while toggling.
  - "All accounts" and the individual accounts are exclusive. With "All accounts" checked (the
    default), no account shows a check. Checking an account from there narrows the service to just
    that account and clears "All accounts". Checking "All accounts" clears the pins. Clicking
    "All accounts" while it is already checked does nothing (like a radio), because turning it off
    would leave no accounts. In an explicit set a footnote says accounts connected later stay off
    until added.
  - The last remaining account can't be unchecked (disabled). To remove the service, uncheck it.
  - Pinned accounts that are no longer connected appear under "Not connected (kept, inactive)",
    checked, and unchecking one removes it.

  Writes `accounts: [{ accountId, authConfigId }]` (both pulled from the chosen connection so the
  same account through two clients stays distinct). **Dormant** services (stored but whose provider
  is disconnected) render in an amber list with a remove affordance and a pin summary, so stored
  intent is always visible. The settings section's change detection compares each service's
  sorted pin set. Sticky, set once per workspace.

## 8. Defaults, migration, back-compat

- New column defaults `[]`. Existing + new workspaces → `[]` → executions get nothing, exactly
  as today. Zero behavior change on migration; opt-in per workspace.
- Orchestrator stays broad (absorbs the "just works" case), so default-empty workspaces aren't
  a dead end.

## 9. Out of scope (future seams)

- **Connectors on non-strict harnesses** (e.g. Codex executions). Blocked until that harness
  enforces MCP tool-filtering (§3 capability gate); revisit when agentex adds it.
- **Per-execution override** (one-off "this run may also use X"). Workspace + orchestrator cover
  the cases; deferred to avoid per-run decision friction.
- **Content scoping** to the focused entity's workspace; content stays broad for now.

## 10. Testing

- Schema/queries: `setWorkspaceConnectorScopes` round-trips; rejects unknown toolkit ids;
  preserves dormant (disconnected) ids.
- Endpoint: `?ws` → toolkits = scoped ∩ connected; a single pin resolves to its live
  connection id and forces it; 2+ live pins become an allowed set; pins that resolve to nothing
  fail closed (toolkit not exposed); no `ws` = connected (broad); empty scopes + `ws` = nothing.
  (`src/lib/connectors/workspace-filter.test.ts`)
- Allowed set (engine, `packages/connectors/src/__tests__/allowed-connections.test.ts`, `mcp.test.ts`,
  `projection.test.ts`): an account inside the set runs; one outside (by hint or connectionId) is
  `account_not_allowed` listing the allowed accounts with no ids leaked; no hint → `needs_account`
  with only the allowed choices; an empty or dead set → `connection_not_found` with no connect flow;
  a one-account set is a pin; a pin wins over a set; unconstrained resolution is unchanged.
- Write path (`scopes.test.ts`, `connector-scopes/route.test.ts`, `registry.agents.test.ts`):
  identifiers resolve to pins; ambiguous or unknown identifiers are readable 400s; malformed accounts
  reject; legacy `account` is folded into `accounts`; stored dormant accounts are kept.
- Legacy rows (`queries.workspace-scope.test.ts`, `scope-pins.test.ts`): a single-`account` row
  reads back as `accounts`, and the next save writes the new shape.
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
