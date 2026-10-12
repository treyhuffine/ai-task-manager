# Connector transport recovery

Ri distinguishes temporarily unavailable connectors from connections that need new credentials. The behavior is shared by official and custom MCP servers. It requires no database migration.

## Requests already running

Discovery normally refreshes on access after five minutes, or when a provider notifies Ri that its tools changed. Invalidation immediately prevents new work through the old projection. It retires the old MCP clients, allowing already-started tool calls and resource reads to finish before closing their sockets.

The SDK still bounds each operation. Tool calls have a two-minute inactivity timeout, reset by progress, and a ten-minute total cap. Resource reads have a thirty-second timeout. Retirement does not extend those deadlines.

Disabled accounts, changed credentials, tool overrides, changed capability revisions and account removal are still checked before dispatch. Graceful retirement only preserves requests that have already started.

## Temporary outages

When connecting or listing tools fails, Ri records the error and its phase. If the account has a saved connection and a verified capability snapshot, Ri republishes those known tool definitions with an unavailable transport. This avoids turning a network interruption into an unknown-tool error or an empty tool list cached by the harness.

Cached discovery never activates a connection, replaces its sealed credential, changes account identity, or bypasses the normal permissions and approval gates. It cannot send a data request. An attempted call returns `provider_unavailable` with a message that no request was sent. A connection already awaiting authorization continues to return `auth_required`.

A runtime with unavailable discovery retries on its next access after a fifteen-second cooldown. A failure from an established transport retires that runtime so the next access can reconnect. Multiple accesses share one build. There is no continuous background polling, and account scopes and tool overrides still apply to the cached definitions.

Provider-returned tool errors, such as an invalid API request represented by MCP `isError`, remain action errors and do not retire the connection. Transport failures do not erase credentials.

## Authentication rejection

Only typed SDK authentication errors, HTTP 401 transport rejection, or the host's `NeedsReauthError` signal require reauthentication. An error message containing "401" or "Unauthorized" is not sufficient. HTTP 403 alone remains distinct from authentication failure.

A confirmed rejection is recorded separately and the saved connection becomes `needs_reauth`. Ri preserves its known tool definitions so the next call can request authorization, but does not periodically rediscover the rejected credential. This matters for DataForSEO Basic credentials, which its server does not validate during initialization or tool discovery.

Replacing a static credential or receiving a new OAuth access token clears the rejection marker. Successful discovery with the replacement can then activate the connection again.

## Paid and mutating requests

Recovery never automatically replays an action. A failed request that may have crossed the wire retains `indeterminate: true`, including DataForSEO's paid research calls. The caller must inspect the result or provider usage before deciding whether to repeat it. A call rejected by an unavailable cached transport has not crossed the wire and is not indeterminate.

## Diagnostics

The MCP server store retains `lastStatus`, `lastError`, `lastCheckedAt` and `lastFailure`, whose fields distinguish authorization from availability and identify `connect`, `discover`, `publish`, `call` or `resource`. It keeps the last twenty health transitions in `healthHistory`, omitting repeated identical checks. Runtime errors are redacted and capped at two thousand characters before persistence. The last verified tool count survives a failed discovery.

The existing MCP server metadata endpoint exposes this history for diagnosis. No tokens or raw API responses are added to health metadata.

Regression coverage lives in `mcp-client-lifetime.test.ts`, `hosted-multiaccount-runtime.test.ts`, `mcp-servers.test.ts`, and the engine's `mcp-cached-discovery.test.ts` and `mcp-client.test.ts`.
