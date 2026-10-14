# Integration approvals in chat

An integration action set to **Ask first** (outward sends and irreversible actions by default, see
`src/lib/integrations/write-policy.ts`, or any action the user switched on) pauses when an agent calls
it. The tool returns `approval_required`, and the chat that asked shows an approval card with the
buttons. Before this, nothing in the UI could approve, so a paused agent stayed stuck until the user
turned Ask first off in Settings.

## Custom MCP permissions

Settings > Plugins > MCP servers has a global default and an **Apply to all servers**
button. Each server also has a permission selector and individual tool exceptions:

The **Global MCP default** is above server search and uses a distinct tinted
section. A server's detail instead names its scope, **Permissions for <server>**.
Each dropdown and its bulk Apply action share one control group, inline when
there is room and stacked together on phones. Dropdown changes save immediately.
The controls use the app's standard Select with a padded chevron. Escape closes
an open dropdown before returning from a server detail to its catalog.

- **Ask before writes** is the code default. Tools advertising `readOnlyHint: true` run freely.
  Writes and tools without a read-only annotation require approval.
- **Always allow** runs the server's enabled tools without the Ri approval prompt.
- **Ask every time** prompts for reads as well as writes.

Precedence is an explicit tool choice, then the server's choice, then the global default. A server
can inherit the global default, and a tool's reset button returns it to the server setting.
Changing a server's selector applies it to every tool and clears its permission exceptions.
**Apply to all tools** reapplies the selected policy when exceptions have been added.
**Apply to all servers** clears custom servers' own policies and tool permission exceptions so
they inherit the global default. Disabled servers and tools stay off. Newly discovered tools
inherit the same policy. Built-in providers keep their existing write policy.

Permission changes take effect at the next tool call, including in a running chat. They do not
reconnect the MCP server or change whether the tool mutates data. Tool enable/disable changes still
refresh discovery and revoke stale cached transports.

Configuration lives in `<config-dir>/integrations/mcp-servers.json`, with atomic writes under the
shared cross-process file lock. The file now holds `{ servers, defaultApprovalPolicy? }`, and reads
also accept the earlier server array. Reading never upgrades the file. The first authorized write
does so, preserving credentials, OAuth state, health and capability snapshots. Defaults are resolved
in `mcp-approval-policy.ts`, and new records store no permission choice until the user makes one.
Each execution reads the server preferences and global default from the same atomic snapshot.
No SQLite schema or migration changes are involved.

Tool change notices are informational and never gate tool access. The same JSON
file stores each server's `capabilities.current` and `capabilities.reviewed`
snapshots. Discovery compares the new inventory with the last acknowledged one.
**Dismiss notice** copies the current snapshot to the acknowledged snapshot and
clears the displayed changes. It does not change tool access or approval settings.

Per-tool approval uses `toolOverrides[tool].approvalMode: 'auto' | 'ask'`, independently of mutation
facts. Legacy `toolOverrides[tool].mutating` is interpreted only as the saved approval choice
(`false` means auto, `true` means ask), never as a read/write reclassification. Updating that
permission replaces the legacy field. **Always allow** on a chat approval card writes the same
per-tool preference without reconnecting. The engine still reports uncertain write failures as
`indeterminate`, even when approval is automatic.

Built-in MCP-backed providers also preserve legacy tool choices. Their provider-wide action
preference takes priority, and changing it clears older account-level permission exceptions.

The UI uses typed tRPC `integrations.mcpApprovalPolicyPatch` and `integrations.mcpServersPatch`.
The REST adapters are `PATCH /api/integrations/mcp-servers { defaultPolicy, applyToAll? }` and
`PATCH /api/integrations/mcp-servers/:id { approvalPolicy?, resetToolApprovals?, toolOverrides? }`.
Null restores inheritance, per-tool patches merge under the store lock, and only viewer credentials
can change permission preferences. Session and worker credentials cannot approve themselves.

## The flow

1. **Gate.** `appApprovalPolicy` (`integrations/approval.ts`) registers a pending approval, one per
   exact call (grant key) per asking chat, and returns `'ask'`. The integrations MCP config carries
   the session's signed credential (`integrationsMcpServer(..., { sessionId })`). The MCP route
   verifies it and stamps the call `{ type: 'mcp', id: 'session:<chatId>' }`, so the gate knows
   which chat asked.
2. **Card.** `approval-events.ts` writes an `approval_request` chat event into that chat. It carries
   a plain-language view: toolkit, account, action ("Delete event"), and a one-line summary of what
   the call touches. For id-only destructive calls it runs the toolkit's sibling read on the same
   connection (`delete_event` → `get_event`) so the card says "Team standup · Wed, Sep 30, 9:00 AM",
   not an event id. One notification goes out per burst, linking to the chat.
3. **Batching.** The transcript folds a burst's requests of one kind (the same action on the same
   account) into one card (`lib/executions/integration-approvals.ts`). A burst is the agent's tool
   activity, and a message, a decision, or the user typing closes it. The card offers
   **Approve all N / Always allow / Deny all N**, plus approve or deny per item.
4. **Decision.** `POST /api/integrations/approve { ids, decision: 'approve' | 'always' | 'deny' }`.
   - `approve`: a single-use grant for that exact call from that chat, valid 5 minutes.
   - `always`: also turns Ask first off through the setting the Integrations screen shows. That is
     the write-policy override, or for an ingested MCP tool its per-tool switch. It stays visible
     there and can be turned back.
   - `deny`: clears the request.
5. **Getting the agent moving.** The server writes an `approval_response` chat event (the durable
   record) and dispatches a short labeled note into the session: retry these exact calls, or do
   not. It lists each call's arguments, so a partial decision is unambiguous.

## Why auto-continue

Clicking Approve is the user's instruction. Making them also type "ok, go" would be the stuck state
again with one more step. The note goes in as an app notice, not as the user's words, and it names
the calls. An approval can't turn into a wider retry, and a denial reaches the agent too. That
keeps it from asking again or thinking the request is still open. The note is not dispatched into
a chat that is archived or an import mirror. The decision is still recorded.

## Card states

Each item's state comes from the recorded decisions (durable) and the live pending ids the session
stream pushes (`integration_approvals` frames, in-memory on the server):

- pending: live, buttons shown
- approved, always allowed, denied: a recorded decision
- ran: the same chat ran the identical call anyway after the policy was flipped in Settings, so the
  request was moot and has been cleared (approving it later would license a duplicate run)
- expired: not live and never decided, typically after a restart. No buttons. If it's the newest
  thing in the chat, it offers "Ask the agent to retry", which sends an ordinary message that asks
  again.

## Security model

- Only the user answers approvals. No orchestrator action or integration tool resolves one. The
  approve route refuses any request carrying an agent session credential. The orchestrator's view
  of a transcript (`get_session_messages`) drops approval ids from these rows.
- A grant matches only the approved chat's retry of the exact call (same input digest and action
  version), once, within 5 minutes.
- Residual risk, unchanged by this feature: the Mac's host key (`<app-root>/.config/config.json`)
  is what the first-run pairing link uses and what every agent's tool connection uses. All keys have
  equal authority, and any key can create more device keys. So a process running as the user,
  including an agent with a shell, could call any API route, this one included.
- The planned fix reuses the device pairing flow. Agents get their own key type. The Mac's browser
  pairs like any other device. Keys record whether a person's device or an agent holds them, and
  human-only routes (approvals, Devices, connecting accounts, Ask first changes) require a person's
  device key. Only a person's device can create device keys, the first one from a one-time code
  shown in the terminal or desktop app. It belongs to the homes build (`docs/homes-spec.md` §6,
  P2.2, P2.6).
- Dev still auto-approves by default. `INTEGRATIONS_AUTO_APPROVE=0` runs the real gate in dev. There
  is no switch that disables the gate in production.

## Testing it locally

Run a dev home with `INTEGRATIONS_AUTO_APPROVE=0` and add any MCP server (ingested tools are Ask first
by default). Then ask the chat to call a tool. The E2E on 2026-09-29 used a throwaway home under
`/tmp` and a local MCP server whose `delete_event` logged each real execution. It checked approve
all, per-item deny plus always allow, turning Ask first back on, and expiry across a restart.
