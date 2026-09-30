# Fourth wave: regional and instance endpoints

Verified on 2026-09-28 America/Denver (2026-09-29 UTC). Research used official documentation, public source, and GET-only OAuth discovery. It did not register clients, authorize accounts, or call account tools.

## Intercom

| Selection | Exact endpoint | Default auth profile |
| --- | --- | --- |
| United States (`us`) | `https://mcp.intercom.com/mcp` | OAuth, public client, authorization code and refresh |
| Europe (`eu`) | `https://mcp.eu.intercom.com/mcp` | OAuth, public client, authorization code and refresh |

The current [official MCP guide](https://developers.intercom.com/docs/guides/mcp) explicitly supports US and EU hosted workspaces. Australian workspaces are unsupported. Workspace URLs identify the region: `app.intercom.com` is US and `app.eu.intercom.com` is EU. The EU transport processes requests in the EU. Older search-index descriptions saying US-only are stale.

The guide supports OAuth and bearer API tokens, with OAuth appropriate for the built-in connector. The consent covers contact/company reads, conversation reads and internal notes, and Help Center article reads/writes. User authorization is still required. The catalog asks for a region instead of assuming one.

[Captured discovery](fourth-wave-discovery.json) verifies both endpoints. Each advertises `/authorize`, `/token`, and `/register` on its own origin, authorization-code and refresh grants, `none` alongside confidential client methods, and S256. Both return a normal 401 without credentials. Reproduce with [the GET-only SDK script](discover-fourth-wave.mjs). These results establish protocol readiness, not successful account authorization.

## n8n

| Input | Derived transport | Default auth profile |
| --- | --- | --- |
| User's instance base URL | `<instance-base>/mcp-server/http` | OAuth, public client, authorization code and refresh |

The [official setup guide](https://docs.n8n.io/connect/connect-to-n8n-mcp-server) covers Cloud and self-hosted instances. An instance owner or admin enables MCP in Settings. Users authorize access in the browser. Copy the address from **Settings > Instance-level MCP > Connect a client** if the deployment uses a separate MCP host. The connector accepts the base address or the full instance MCP endpoint. Workflow-level MCP Server Trigger URLs belong in custom MCP setup.

Workflow access follows user permissions and exposure settings. Search can return previews of other workflows visible to that user. Full access and execution require workflow exposure. Newer versions support workflow creation/editing. Admin callback restrictions can prevent authorization. The connector therefore makes no promise of unrestricted account access.

[Client examples](https://docs.n8n.io/connect/connect-to-n8n-mcp-server/mcp-client-examples) document manual generic-client configuration and the `/mcp-server/http` endpoint. The alternative API key is a user-bound MCP bearer token, not an n8n REST API key. This addition chooses the documented OAuth flow.

The [official OAuth controller source](https://github.com/n8n-io/n8n/blob/master/packages/cli/src/modules/oauth-server/oauth.controller.ts) confirms unauthenticated dynamic client registration and current metadata:

| Field | Value relative to the instance issuer |
| --- | --- |
| Authorization | `/mcp-oauth/authorize` |
| Token | `/mcp-oauth/token` |
| Registration | `/mcp-oauth/register` |
| Grants | `authorization_code`, `refresh_token` |
| Token auth | `none`, `client_secret_post`, `client_secret_basic` |
| PKCE | `S256` |

The scope set is provided by the instance at discovery. No particular user's instance was contacted. Older installations or disabled MCP require the user to update or enable their installation before connecting.

## Implemented endpoint contract

- [x] Catalog declares either an explicit regional allowlist or an instance path rule.
- [x] Region selection has no default. Instance input excludes credentials, query parameters, and fragments.
- [x] Settings and conversation reauthorization use the same setup fields.
- [x] Saved choices remain visible and immutable until disconnect. Pending first-time setup can be cancelled from Settings.
- [x] Reconnect uses saved authority, even if the form contains an old draft. Conversation URL parameters cannot select an endpoint.
- [x] An instance-selected host does not inherit trusted upstream annotations from the named provider.
- [x] Existing fixed-endpoint providers keep their current request shapes.

Backend endpoint validation remains authoritative. Public HTTPS is supported, with HTTP limited to loopback by the existing local MCP policy. Regional URLs are selected exclusively from the catalog. The UI sends `endpointId` or `instanceUrl`, never a replacement fixed-provider URL. Lifecycle handling pins OAuth consent, tool execution, and deletion to the persisted entry.

Verification: 109 focused UI, connection-request, and endpoint-selection tests passed, with changed-file lint clean. Full app typecheck still reports missing Electron and tar dependencies, with no errors in these changes. Parent integration checks cover authoritative URL validation, races, runtime policy, and route handling.
