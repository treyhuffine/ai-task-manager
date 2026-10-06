# Fifth wave: registered OAuth connector replacements

Verified September 28, 2026 local time, September 29 UTC. This wave replaces native X, Slack, Asana, HubSpot, Box, Zoom and Dropbox with their official hosted MCP services. Provider IDs remain stable, while tools come directly from each service. Native aliases, the X OpenAPI generator and its media helper are retired. The catalog now has 56 providers: 46 external MCP and 10 native.

## Verification boundary

The [discovery script](discover-fifth-wave.mjs) permits only unauthenticated public GET requests. Its [captured results](fifth-wave-discovery.json) contain the exact protected-resource and authorization-server metadata returned by all seven services. No OAuth client was registered, no account was authorized, and no private data or MCP tools were accessed. Public discovery plus documented custom-client registration establishes an implementation path, not account acceptance or tool parity.

## Connection profiles

All seven support authorization code, refresh tokens and S256 PKCE. All seven catalog entries select pre-registered client credentials. This app does not attempt dynamic registration for them, including Dropbox, whose registration endpoint is reserved for approved clients.

| Provider | Official MCP endpoint | Selected client authentication | Resource scopes from discovery |
| --- | --- | --- | --- |
| X | `https://api.x.com/mcp` | `client_secret_basic` | 17, including `offline.access` |
| Slack | `https://mcp.slack.com/mcp` | `client_secret_post` | 30 user scopes |
| Asana | `https://mcp.asana.com/v2/mcp` | `client_secret_post` | `default` |
| HubSpot | `https://mcp.hubspot.com/` | `client_secret_post` | Empty, consent determines access |
| Box | `https://mcp.box.com/` | `client_secret_post` | Omitted, configured integration scopes apply |
| Zoom | `https://mcp.zoom.us/mcp/zoom/streamable` | `client_secret_basic` | 19 product scopes |
| Dropbox | `https://mcp.dropbox.com/mcp` | `client_secret_post` | 9 account/file/sharing scopes |

Dropbox additionally requires the trusted authorization parameter `token_access_type=offline` for refresh tokens. This is a catalog profile, not user-supplied OAuth URL mutation. All mutations default to high risk except ordinary Asana task/project operations, which retain the standard conservative medium fallback. Trusted upstream read-only annotations still classify reads as reads.

## X

The [official MCP guide](https://docs.x.com/tools/mcp) documents the hosted API server and a local `xurl` OAuth bridge. The bridge acquires user tokens and sends them as bearer authorization to the same hosted endpoint. The app now performs that registered OAuth flow itself and lets the hosted service define its tools.

The guide's claim that native OAuth discovery is absent is contradicted by the public GET capture. Both [resource metadata](https://api.x.com/.well-known/oauth-protected-resource/mcp) and [authorization metadata](https://api.x.com/.well-known/oauth-authorization-server) returned 200. Issuer is `https://api.x.com`, authorization uses `https://x.com/i/oauth2/authorize`, token exchange uses `https://api.x.com/2/oauth2/token`, and Basic client authentication is supported. No registration endpoint is advertised.

Configure an OAuth 2.0 developer app and register the exact callback shown by this app. Account plan, enabled permissions and production enrollment still control access. The remote tools are authoritative, so there is no promise of the old 135 generated actions or chunked media helper.

## Slack

The [Slack MCP guide](https://docs.slack.dev/ai/slack-mcp-server/) explicitly supports custom clients backed by a registered internal or published Marketplace app. Unlisted distributed apps are excluded. It uses user authorization at `https://slack.com/oauth/v2_user/authorize`, followed by `https://slack.com/api/oauth.v2.user.access`. The issuer is `https://mcp.slack.com`, with secret-post authentication.

Enable PKCE in the Slack app for local or desktop redirects, register the displayed callback and configure the required user scopes. Workspace app approvals and IP allowlists can restrict access. The [PKCE guide](https://docs.slack.dev/authentication/using-pkce/) documents localhost desktop redirects. Existing native bot tokens do not become MCP user authorization automatically.

## Asana

Create an **MCP app**, not a standard API app, in the [Asana developer console workflow](https://developers.asana.com/docs/integrating-with-asanas-mcp-server). Register the exact callback and permit the user's workspace under distribution settings. Issuer is `https://app.asana.com`, with `/-/oauth_authorize` and `/-/oauth_token`. Discovery advertises scope `default`, which the integration guide permits. The observed resource identifier is `https://mcp.asana.com/v2/mcp`, even though older examples shorten it to `/v2`.

The [official tool reference](https://developers.asana.com/docs/mcp-tools-reference) names `get_my_tasks`, `get_tasks` and `search_tasks`, but directs clients to authenticated `tools/list` for parameter schemas. MCP tokens are workspace-scoped and cannot call REST. Agent tools remain available through discovery. The old deterministic task-picker adapter is removed until actual MCP schemas and output shapes can be validated, avoiding a guessed REST compatibility layer.

## HubSpot

The [custom-client guide](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/integrate-with-the-remote-hubspot-mcp-server) provides an explicit general MCP client path. Create a connector under Development, MCP Connectors and register its callback. Use the generic root endpoint, not the Claude-specific `/anthropic` path. Its issuer is `https://mcp.hubspot.com`, authorization is `/oauth/authorize/user`, and token exchange is `/oauth/v3/token`.

An empty discovered scope set is intentional: HubSpot determines scopes from available tools and user consent. Sensitive Data accounts restrict activity/conversation access. Subscription and user permissions affect the discovered tools. Expanded permissions can require another authorization.

## Box

The [Box setup guide](https://developer.box.com/guides/box-mcp/setup) directs admins to create integration credentials under the Box MCP server in Admin Console and register the client's callback. Issuer is `https://api.box.com`, authorization is `https://account.box.com/api/oauth2/authorize`, and token exchange is `https://api.box.com/oauth2/token`. Both Basic and secret-post are advertised, and this app selects secret-post.

Scopes are omitted in the discovered resource and authorization metadata. We leave them unspecified to retain the integration's configured scopes, as documented in [Box's scope rules](https://github.com/box/developer.box.com/blob/main/content/guides/api-calls/permissions-and-errors/scopes.md). This avoids forcing the Enterprise Advanced-only document-generation permission onto other accounts. Select file, AI and any licensed document-generation permissions in Box's integration setup.

## Zoom

Zoom's [connection guide](https://developers.zoom.us/docs/mcp/servers/connect-to-zoom-mcp-servers/) requires a manually registered General app with product scopes. Dynamic registration and client metadata documents are unsupported. The aggregate endpoint from Claude's directory provides successful OAuth discovery even though its unauthenticated GET returns 405. Issuer is `https://zoom.us`, authorization is `/oauth/authorize`, and token exchange is `/oauth/token` with Basic client authentication.

The [OAuth guide](https://developers.zoom.us/docs/integrations/oauth/) permits numeric loopback redirects for eligible PKCE/native clients and rejects `localhost` for that flow. Register the exact displayed callback and use HTTPS where required by deployment or app eligibility. Product licenses, app approval and permitted scopes remain account prerequisites. The [app setup guide](https://developers.zoom.us/docs/build-flow/basic-info/oauth-info/) describes redirect allowlists and development/production distinctions.

## Dropbox

The [Dropbox MCP guide](https://help.dropbox.com/integrations/connect-dropbox-mcp-server) explicitly documents creating a scoped Full Dropbox app for other MCP clients. Register the callback, enable the permissions requested by the resource metadata, and use the app key and secret. The generic `/mcp` endpoint replaces the Claude-specific `/claude_app_mcp` path. The trusted-client dynamic-registration restriction does not exclude this registered-app path.

Issuer is `https://www.dropbox.com`, authorization is `/oauth2/authorize`, and token exchange is `https://api.dropboxapi.com/oauth2/token`. The [offline-access guide](https://dropbox.tech/developers/using-oauth-2-0-with-offline-access) requires `token_access_type=offline` to return refresh tokens. Team admin policy may prevent app creation or connection. This integration follows discovered resource scopes, which include `files.metadata.write` in addition to the guide's setup list.

## Remaining acceptance

Each migrated service still needs an authorized account test covering callback acceptance, consent, tool discovery, token refresh and a representative operation. Vendor plan restrictions and app admission can prevent a valid implementation from connecting to a particular account. Provider maintenance replaces our API wrappers, but credential management, app approvals and host-side execution policy remain our responsibility.
