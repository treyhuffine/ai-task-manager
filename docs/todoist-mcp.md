# Todoist through the official MCP server

Todoist is a built-in connector backed by Doist's hosted MCP service at
`https://ai.todoist.net/mcp`. Users choose Todoist and sign in through their
browser. The app discovers tool schemas and forwards calls instead of maintaining
its own Todoist REST implementation.

## User flow

Choose Todoist in Settings, select Connect, and complete Todoist's browser consent.
The MCP SDK discovers the authorization server and dynamically registers a public
client, using authorization code with PKCE. No personal API token or manually
configured OAuth client is needed. Desktop uses the existing desktop OAuth callback
flow. Web uses `/api/connectors/mcp-oauth/:serverId`.

After consent, the app discovers the server's tool schemas. Assignments, project
and section moves, comments, completed tasks, and other tools become available
through the same connector permissions as the rest of the app. The available tools
come from the server, rather than a hardcoded list copied from Claude. Discovery
runs whenever the connector runtime is rebuilt, including after connecting or
testing the connection.

The task picker reads `find-tasks`, follows upstream cursors, and normalizes the
structured task results. Existing `todoist:<task-id>` picker keys are unchanged.

## Migration

The built-in provider and toolkit IDs remain `todoist`. Existing personal-token
connections require browser sign-in once. The old token is never sent to the MCP
server. Reconnecting retains the connection ID, account ID, and saved connection
metadata, so agent connector selections and account pins remain valid. This
connector supports one Todoist account. If several legacy connections exist,
disconnect the extra accounts before reconnecting.

Only discovered `todoist.<upstream-tool-name>` actions are exposed. There are no
compatibility aliases or provider-specific action wrappers. Examples include
`todoist.find-tasks`, `todoist.add-tasks`, `todoist.update-tasks`,
`todoist.complete-tasks`, and `todoist.find-projects`. Assignment and container
changes use the upstream `update-tasks` schema.

Approval preferences apply to each exact discovered action ID. The host does not
map preferences between old names and upstream tools. Task-picker normalization
is an internal consumer of `todoist.find-tasks`, rather than an exposed action.

Disconnect removes the authoritative server entry, encrypted OAuth state, and
derived connection. Connecting again requires new browser consent.

## Host responsibilities and extension points

`packages/connectors/src/providers/hosted-mcp.ts` is the catalog of built-in hosted
services. A catalog entry pins the provider ID, display name, and official endpoint.
`src/lib/connectors/hosted-mcp.ts` validates that identity and preserves existing
connection metadata. The connect route, OAuth storage, runtime ingestion, health
checks, and connector UI share this path with the other built-in hosted services.

To add another provider-maintained service, add its pinned hosted catalog entry
and a provider catalog row with `method: 'mcp'`, plus its display metadata. Verify
the service's OAuth behavior and schemas. A new provider needs no per-tool API
wrapper or compatibility aliases. Internal UI consumers may normalize documented
structured results, as the task picker does.

Only catalog-pinned services may use a built-in provider identity or trusted tool
annotations. User-added servers retain the `mcp.<server>.<tool>` namespace and
conservative approval defaults. Hosted tools use the provider's read-only and
destructive annotations, with explicit user overrides taking precedence. Reads
are automatic, destructive operations require approval, and the host's outward
message policy still applies. Development keeps its existing auto-approval mode.

OAuth registration, access tokens, refresh tokens, and PKCE state are encrypted
in the MCP server store. The host registers credentials for output redaction,
including rotated tokens. Tool errors propagate as failed actions. A lost response
to a mutation is marked indeterminate, so callers must check state before retrying.

The host still owns authentication, local encrypted storage, agent connector
scopes, approval policies, and the task picker. Provider-maintained tools reduce
API maintenance but do not remove the need to validate integration behavior.

## Verification

Regression coverage includes migration identity, trusted endpoint validation,
OAuth routing and persistence, discovery pagination, structured outputs, remote
failures, task-picker pagination and priority normalization, absence of old action
aliases, exact-action approval preferences, UI sign-in states, and disconnect
cleanup during concurrent tool discovery.

Run the connector engine and relevant host tests with:

```sh
pnpm --filter @connectors/engine test
pnpm --filter @connectors/engine typecheck
pnpm test src/lib/connectors src/components/settings/sections/connectors/provider-detail.test.ts src/app/api/connectors/hosted-routes.test.ts src/app/api/connectors/test/route.test.ts src/lib/executions/task-rank.test.ts
```

Public Todoist OAuth discovery metadata has been checked against the implemented
flow. A real account consent and live task operation still require browser sign-in.

The connector package typecheck passes. The full app typecheck currently reports
missing installed dependencies for `electron`, `electron-updater`, and `tar`,
with related errors in the existing desktop and service modules.

Implementation checklist:

- [x] Built-in catalog entry, OAuth connect, reconnect, health and disconnect
- [x] Canonical Todoist identity and migration from personal-token connections
- [x] Upstream tool discovery, structured results, errors and permissions
- [x] Task picker with upstream pagination and task normalization
- [x] Discovered upstream actions only, without compatibility aliases
- [x] Final regression suite and lint, typecheck run with the app dependency limitation recorded above, and documentation review

Sources: [Doist MCP](https://github.com/Doist/todoist-mcp),
[Claude's Todoist listing](https://claude.com/connectors/todoist),
[OpenAI MCP integrations](https://developers.openai.com/plugins/build/app-quickstart).
