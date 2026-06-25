# Spec: External MCP servers as connectors (ingest)

> **Status:** draft, not built. Tight lifecycle spec. Three decisions are left
> **OPEN** at the end for Trey to ponder; everything else is a proposed default.
> Revised after a code-verified review (the connection-upsert assumption was
> wrong — see §2; Q2's premise was wrong — see §10).
>
> **Goal.** Let a user point at a remote MCP server (a URL + optional auth) and
> have its tools become first-class connector actions, behind the same trust
> spine as native connectors. The long-tail breadth strategy: stop hand-rolling a
> provider per service.
>
> **Companion docs:** `connectors-module-spec.md` (engine). The serve side already
> lives in `src/app/api/connectors/[transport]/route.ts`.

---

## 1. Where MCP already sits (context)

Two opposite directions; only one is built end-to-end.

- **SERVE (built).** `serveMcp` projects our connector actions as MCP tools.
  `src/app/api/connectors/[transport]/route.ts` (`createMcpHandler` + `serveMcp`)
  is registered into the Claude Code harness by `connectorsMcpServer()` in
  `src/lib/orchestrator/harness-surface.ts`. The in-app SDK chat gets the same
  actions via `getConnectorTools()` → `toToolSet` (`src/lib/connectors/runtime.ts`).
- **INGEST (engine-only, this spec).** `ingestMcpServer` + `connectMcpClient` exist
  in `packages/connectors/src/mcp/` and are tested, but nothing in the host calls
  them. No store, no routes, no UI, no boot wiring.

The property we build on: an ingested tool becomes an ordinary **registry
action**, so it rides the existing `runAction` → `toToolSet`/`serveMcp`
projections (approval gate, redaction, audit) for free. We add no parallel tool
path; we add one new *connect type* and the durability around it.

## 2. Verified engine constraints (these drive the design)

Read from the engine, confirmed during review:

1. **Ingest persists a *connection*, not a *provider definition*.**
   `ingestMcpServer` adds the provider to the in-memory registry and does
   `store.save(connection)` with `providerId = mcp_<slug>`. Native providers are
   re-registered each boot via `registerAllProviders`; an ingested one is **not**.
   → Without host-owned persistence + **re-ingest on every boot**, the saved
   connection dangles (points at an unknown provider).
2. **The registry is append-only and throws on duplicates.**
   `createRegistry().addBundle` throws `duplicate provider id` / `duplicate action
   id`; there is no `unregister`/`replace`. → A server can be ingested once per
   registry lifetime. Editing/refreshing/removing at runtime means **rebuilding
   the registry** (the runtime singleton), not mutating it.
3. **Ingest is async; the runtime singleton is sync.**
   `getConnectorRuntime()` returns a synchronously-built `cached` singleton
   (`runtime.ts:196`). `connectMcpClient` + `listTools` are network calls. → Boot
   wiring needs an async seam (see Q1).
4. **CONFIRMED BUG — `store.save` upserts by `connection.id`, not by natural key.**
   `fileStore.save` does `findIndex((e) => e.connection.id === connection.id)`
   (`store/file.ts`); `ingestMcpServer` sets `id: newId()` on every call
   (`ingest.ts:104`). So re-ingest on each boot writes a **new** connection row →
   `runAction` resolves >1 connection for `mcp_<slug>` → `needs_account`. The
   natural-key dedup other connectors rely on lives in the *runtime*
   (`completeAuth`/`connectDirect` reuse an existing id before save), **not** in
   the store — so we must NOT change `store.save`'s by-id contract.
   **Fix (engine, additive):** make ingest's connection id **deterministic** from
   `(ownerId, providerId, accountId)` (or accept an explicit `connectionId` in
   `IngestMcpOptions`). `accountId` is already stable (`opts.name`), so only the id
   needs fixing. Then re-ingest is idempotent: same row every boot.

None of these are bad decisions — they are the deliberate "engine is an in-memory
runtime primitive; the host owns durability" seam. They make ingest a *boot
lifecycle*, plus the one real engine fix in §2.4.

## 3. The unifying design: a rebuildable runtime

Make the runtime singleton **rebuildable**, and have its construction re-ingest
all enabled MCP servers before it is used. This one move resolves four wrinkles:

- async init → construction awaits ingest,
- idempotent re-ingest → fresh registry each rebuild, no duplicate-id throw,
- dangling connections → providers re-registered before any connection is read,
- client lifecycle on edit/remove → a rebuild discards old `ConnectedMcpClient`s.

The runtime is effectively stateless (durable state is on disk: ConnectionStore,
AuthConfigStore, and the new MCP-server store), so a rebuild is cheap: re-run
`registerAllProviders`, then re-ingest. "Edit / disable / remove a server" =
persist the change, **invalidate `cached`**, next access rebuilds. `cached` holds
the open MCP clients + a **generation counter** so a slow in-flight build can't
overwrite newer config and so invalidation can `close()` the old clients.

## 4. Data model — host MCP-server store

New host store, mirroring `authConfigFileStore`: `.config/connectors/mcp-servers.json`
(precious, never synced). Non-secret fields plain; the auth secret sealed via the
existing `SecretBox` (same pattern as connection creds / client secrets).

```ts
interface McpServerEntry {
  id: string;            // uuidv7 (store row id)
  slug: string;          // IMMUTABLE; sanitized [A-Za-z0-9_]; drives mcp_<slug> + mcp.<slug>.<tool>
  displayName: string;   // editable UI label; never touches ids
  url: string;           // Streamable HTTP endpoint (validated, see §8)
  enabled: boolean;
  auth: { kind: 'none' } | { kind: 'bearer' } | { kind: 'header'; header: string };
  // secret (bearer token / header value) sealed separately, not in this JSON
  createdAt: string;
  updatedAt: string;
  // cached health for the UI (best-effort, refreshed on add + boot):
  lastStatus?: 'ok' | 'unreachable' | 'error';
  lastError?: string;
  lastToolCount?: number;
  lastCheckedAt?: string;
}
```

`slug` is **immutable** and is the single source of truth for the engine's
`mcp_<slug>` provider id and `mcp.<slug>.<tool>` action ids. Renaming would be a
destructive id migration (it would orphan the engine connection + any grants/audit
keyed on those ids), so PATCH may edit `displayName`/`url`/`auth`/`enabled` but
**never `slug`**. `slug` must be unique (reject collisions at the route). The
engine `Connection` that ingest writes is derived state, recreated from this entry
each boot with the deterministic id from §2.4; this store is the source of truth
for `url` + auth.

## 5. Lifecycle

**Add** (`POST /mcp-servers`):
1. Validate `slug` (unique, sanitized), `url` (§8), `auth`.
2. `connectMcpClient(url, headers)` → `listTools()` as live validation (the
   identity-on-connect pattern). On failure return the error; do not persist.
3. Persist the entry (seal the secret); record `lastToolCount` + `lastStatus:'ok'`.
4. Invalidate `cached` so the next runtime access ingests it (§3).
   Return `{ entry, toolCount, toolNames }` for a confident UI confirmation.

**Boot / runtime construction** (async, per Q1):
1. Build registry, `registerAllProviders`.
2. For each **enabled** entry: `connectMcpClient` → `ingestMcpServer` (with the
   deterministic connection id). On failure, **skip + record `lastStatus`**; never
   throw (one down server must not take out the whole connectors runtime).
3. Construct the runtime over the augmented registry; stash open clients +
   generation on `cached` for later `close()`.

**Edit / disable / remove:** persist change → invalidate `cached` (closing its
clients) → next access rebuilds. No live registry mutation (engine can't, §2.2).
Remove also deletes the engine connection for `mcp_<slug>`.

**Failure isolation & health:** an unreachable server at boot is skipped and shown
as `unreachable` with a re-test action. Tools are re-listed every boot, so a
server's tool set staying current is automatic.

## 6. How tools surface

Ingested tools are registry actions, so they surface on both paths with no extra
code:
- **In-app SDK chat:** `getConnectorTools()` → `toToolSet`. An enabled server has a
  live connection, so its tools flow in (subject to the connected-provider filter).
- **Harness:** `serveMcp` re-projects them. Action `mcp.<slug>.<tool>` projects to
  the harness tool `mcp__connectors__mcp__<slug>__<tool>` (each `.` → `__`).
  Server-side registration is already **per request** (`mcp-handler` builds a fresh
  `McpServer` + runs our `initializeServer` callback per POST), so newly-ingested
  and connected-filtered tools are available immediately on the wire. The only lag
  is the harness **client** caching its tool list for the session (see Q2).

## 7. Safety (non-negotiable, inherited from the engine)

- Ingested tools default to `mutating: true, risk: 'high'` → **approval-gated**.
- Namespaced + provenance-tagged (`mcp.<slug>.<tool>`, results carry `server`);
  cannot impersonate a native connector.
- **Redaction of the remote secret (do this).** The real bearer/header goes to
  `connectMcpClient`, but ingest currently seals only a vestigial `'mcp-session'`,
  so the runtime redactor never learns the real secret and couldn't scrub it if a
  remote echoes it back or surfaces it in an error. Fix: seal the **real** token as
  the connection credential and reuse it as the client's auth header (one secret,
  known to the redactor). Defense-in-depth, low-but-nonzero leak path.
- Auth secret sealed at rest; never sent to the model.
- No prompt-injection *scanning* claim — the structural defense is the approval
  gate in front of every side effect. Surface a one-line "these run behind your
  approval" note in the UI.

## 8. Validation & limits (host-side, on add + boot)

- **URL allowlist:** require `https://` (allow `http://localhost`/loopback for dev
  only). **SSRF note:** the server fetches a user-supplied URL — in a hosted/multi-
  tenant deployment this must also block private/link-local ranges + metadata IPs.
- **Header-name validation** for `auth.kind:'header'` (token-charset, no CRLF).
- **Timeouts** on connect + `listTools` + each `callTool` (don't hang the runtime).
- **Caps:** max tools per server, max description/schema size, max servers per user.
- **Collision rejection:** unique `slug`; also reject if the projected provider id
  `mcp_<slug>` collides with an existing provider.

## 9. Routes

- `GET  /api/connectors/mcp-servers` → list entries (+ cached health).
- `POST /api/connectors/mcp-servers` → add (validate-by-connect, §5).
- `PATCH /api/connectors/mcp-servers/[id]` → enable/disable, edit displayName/url/
  auth (never slug).
- `DELETE /api/connectors/mcp-servers/[id]` → remove (also drop the engine
  connection for `mcp_<slug>`).

## 10. UI

A dedicated **"MCP servers"** section in the Connectors pane (the aisuite
Integrations layout), below the provider catalog:
- list each server: displayName, url, tool count, status pill, enable toggle,
  Re-test, Remove;
- an **"Add MCP server"** form: name (→ slug), url, auth (none / bearer / custom
  header + secret), with the live tool-count confirmation on success;
- the "runs behind your approval" safety note, and (for Q2-B) honest copy like
  "Restart the current agent session to use newly added MCP tools."

Ingested servers are **not** in `PROVIDER_CATALOG` (user data), hence a separate
section rather than catalog rows.

## 11. DECISIONS (resolved 2026-06-24: Q1=A, Q2=A+B, Q3=A)

### Q1 — Init model: async runtime vs lazy-ingest + filter
- **A. Make `getConnectorRuntime()` async** and await ingest in construction.
  *Correct and simple to reason about. Verified blast radius: 15 call sites, all
  already in async route handlers / async adapters, so the refactor is mechanical.*
- **B. Keep the singleton sync; ingest lazily** behind `ensureMcpReady()` and
  filter unresolved `mcp_*` connections from listing surfaces until ready.
  *Localized, but creates a permanent "remember to await/filter" seam across tools,
  routes, status, connections, and every future caller.*
- ✅ **Decision: A** (async runtime). The verified caller analysis makes the
  refactor cheap, and B's filter seam is a lasting footgun.

### Q2 — Harness live-pickup of newly added servers
Corrected premise: the serve route is **already per-request** (`mcp-handler` builds
a fresh server per POST), so server-side dynamic + connected-filtered registration
is free. The real constraint is the harness **client** caching its tool list.
- **A. Per-request, connected-filtered `serveMcp` now** — live + also fixes the
  existing tool-crowding (all-toolkits) limitation. Low cost.
- **B. Accept reconnect for live sessions** — new tools appear after the harness
  reconnects/re-lists; honest UI copy ("restart the agent session"). SDK chat is
  live regardless.
- **C. Emit `notifications/tools/list_changed`** so the harness re-lists in place.
  *Principled; most work; depends on `mcp-handler` support.*
- ✅ **Decision: A + B** for v1 (per-request connected-filtered serve now, reconnect
  for already-running sessions with honest UI copy); defer C (`list_changed`).

### Q3 — Change → rebuild granularity
Editing/removing needs the registry rebuilt (§2.2, append-only).
- **A. Full runtime rebuild on any MCP change** — invalidate `cached`, reopen
  clients. Cheap (runtime is stateless). Add a **build promise + generation
  counter + best-effort client close** so a stale in-flight build can't overwrite
  newer config. Watch: an in-process refresh `Lock` held across a rebuild (edge).
- **B. Add an engine `unregister`/`replace`** for surgical hot-swap of one provider.
  *No native churn, but an engine change to the append-only contract + tests.*
- ✅ **Decision: A** (full rebuild + build promise + generation counter + best-effort
  client close) for v1; revisit B only if churn or the lock edge proves real.

## 12. Deferred items — status (updated 2026-06-24)

**Implemented (this pass):**
- ✅ **#2 Input-schema passthrough.** `jsonSchemaToZodObject` (`mcp/json-schema.ts`)
  converts each MCP tool's JSON Schema → Zod, so the ingested action carries a real
  schema; both projections (serveMcp `.shape`, toToolSet `a.input`) surface it to
  the model. Faithful where understood, permissive (`z.unknown()` / passthrough)
  for exotic nodes — the remote server stays the authoritative validator.
- ✅ **#4 Long-running tools.** `connectMcpClient.callTool` passes
  `{ timeout: 120s, resetTimeoutOnProgress: true, maxTotalTimeout: 600s }` so a tool
  emitting progress isn't killed, while a silent stall still caps.
- ✅ **#3 Per-tool reclassification.** `IngestMcpOptions.toolOverrides`
  (`{enabled?, mutating?}` per tool); the store persists the advertised tool list +
  overrides; the pane shows per-tool On + Approval toggles. Disabled → not ingested;
  non-mutating → reads through the gate.

- ✅ **#1 OAuth-to-MCP.** Built **SDK-native** (more robust than the engine-reuse the map
  first sketched): the transport's `authProvider` drives the whole flow — protected-resource
  + authorization-server metadata discovery, dynamic client registration (RFC 7591), the
  auth-code + PKCE exchange, and token refresh on 401. Our `OAuthClientProvider`
  (`src/lib/connectors/mcp-oauth.ts`) only persists the SDK's state (client registration +
  tokens + PKCE verifier) **sealed** via the MCP-server store. So OAuth lives entirely at the
  transport layer and the engine ingest stays auth-agnostic — **no engine OAuth/AuthConfig/
  `beginAuth` changes**. Flow: add a server with auth `oauth` → `connectMcpClient({ authProvider })`
  triggers discovery + DCR + `redirectToAuthorization` (captured) then throws `UnauthorizedError`
  → the route returns the authorization URL → the browser consents → `GET /api/connectors/mcp-oauth/<sid>`
  (public path) → `finishMcpOAuth(code)` exchanges + saves tokens → the runtime rebuilds and
  ingests the now-authorized server's tools. A long-lived ingested client refreshes its token
  transparently; a per-server **Authorize** button re-runs an abandoned/expired flow. Engine
  additions: `connectMcpClient` gained an `authProvider` option + new `finishMcpOAuth`.
  **Live-validated** end-to-end against Sentry's production MCP server (forced 401 → discovery →
  DCR with a real `client_id` → PKCE → authorization URL), short of the human consent click
  (which drives the same SDK exchange).

All four deferred items are now implemented.

## 13. Testing

- Engine ingest/client already covered (`packages/connectors/src/__tests__/mcp.test.ts`).
- Engine fix: deterministic ingest connection id → re-ingest is idempotent (two
  boots, one connection row; directly exercises §2.4).
- Host: store CRUD + seal/unseal; boot re-ingest idempotent; a down server is
  skipped not fatal; add/remove invalidates `cached`; slug immutability enforced;
  URL/SSRF + caps validation; an ingested mutating tool hits the approval gate
  (confinement); the remote secret is redacted from an echoed result (§7). A fake
  `McpClientLike` drives these without a network.

## 14. Build order

1. **Engine fix (§2.4):** deterministic/explicit ingest connection id + (optional)
   carry the real secret for redaction (§7). Small, additive, unblocks idempotency.
2. Host MCP-server store (+ seal) with slug/displayName split.
3. Rebuildable runtime: async construction (Q1=A) + generation counter + client
   tracking + `close()` on invalidate.
4. Validation & limits (§8).
5. Routes (add validates by connecting).
6. UI section.
7. Harness pickup (Q2): per-request connected-filtered serve + reconnect copy.
8. Tests throughout.
