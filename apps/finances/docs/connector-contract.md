# Proposed Ri connector broker, version 1

This is a reviewable interface proposal, not an implemented Ri capability. Its executable schemas live in `src/lib/connectors/contracts.ts`, and contract tests use fictional replies. Finance never substitutes a Ri Home bearer token, loads a provider token from Ri files, reads Ri SQLite, or imports Ri packages.

An owner configures an HTTPS broker prefix, or a loopback HTTP prefix, and a plugin-specific credential. For example, `https://<ri-host>/api/plugin-connectors/v1`. The path is deliberately configurable pending Ri review. Finance seals this credential with its own private key and exposes only the configured URL and status to the UI.

`GET <prefix>/capabilities` returns `version: 1`, a principal with `kind: "plugin"`, enumerated allowed operations and selected opaque connections. Each connection has a provider, label, status and scopes. Provider credentials are excluded. Finance rejects responses containing credential fields.

`POST <prefix>/call` accepts `{version: 1, requestId, connectionId, operation, input}`. `requestId` is a UUID, the connection must be active in the capability grant, and the operation must be listed. Success is `{version: 1, ok: true, result}`. Failure is `{version: 1, ok: false, code, message}`. The broker must enforce grants again on every call, with bounded typed inputs and results, idempotency for setup/removal, redaction and revocation. Finance's preflight is not the authorization boundary.

| Operation | Required broker behavior |
| --- | --- |
| `plaid.link.begin` | Authorize developer setup or reconnect, environment, account selection, Transactions history and optional Liabilities, then return a temporary Link token and opaque setup reference |
| `plaid.link.complete` | Exchange the provider's public token server-side, seal the access token and return a new opaque connection reference plus sanitized account records |
| `plaid.transactions.sync` | Resolve the selected Item credential and return added, modified and removed source records with pagination and cursor |
| `plaid.accounts.read` | Return permitted account balances with source freshness |
| `plaid.liabilities.read` | Return permitted statement balances, minimums and due dates, with unsupported gaps explicit |
| `plaid.webhook.key` | Read the Plaid webhook verification key for the bounded key ID |
| `plaid.item.remove` | Explicitly revoke the selected Item with replay-safe behavior |
| `gmail.messages.read` | Permit only bounded read/search/history and selected message or invoice attachment operations, with no send/delete scope |
| `outlook.messages.read` | Permit only bounded read/search/folder delta and selected message or invoice attachment operations |
| `connection.release` | Release this plugin's selected connection binding and stop future access |

The current provider adapters preserve provider response fields within these bounded operations so sync pagination and mailbox evidence parsing stay inside finance. The broker must validate each operation's provider-specific input and restrict selected accounts. It must never expose arbitrary network requests or use an agent-supplied tool name. The remaining provider field schemas can be finalized with Ri implementation review.

Finance consumes its own public webhook URL and verifies signatures before queuing work. No shared webhook router or Bounce extension is required for v1. A future generic event broker can deliver authenticated, deduplicated source events without containing finance records or granting general agent authority.

Later Ri work also includes MCP Apps resource loading, packaged iframe hosting, persistent view navigation, selected account/operation grants, revocation and protected follow-up handoffs. Ri is not responsible for finance migrations, calculations, receipt storage, budget versions or jobs.
