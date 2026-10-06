# WordPress.com hosted MCP qualification

Reviewed 2026-09-28. This connector uses WordPress.com's hosted MCP with public-client OAuth. It does not implement a native WordPress REST toolkit or require a separate server for each site.

## Decision and account requirements

Use canonical provider ID `wordpress`, display name **WordPress.com**, and fixed Streamable HTTP URL `https://public-api.wordpress.com/wpcom/v2/mcp/v1`.

WordPress.com expressly documents [custom MCP clients](https://developer.wordpress.com/docs/mcp/connect-custom-mcp-client/) and dynamic registration without a manual developer-app setup. The catalog profile uses public authentication with PKCE, authorization-code and refresh grants, and the documented `auth` scope. No vendor client-admission request is needed for this documented flow.

The user's account still needs [MCP access enabled](https://my.wordpress.com/me/preferences/mcp). Eligibility is all paid WordPress.com plans, or the first 30 days of a free site's lifetime. Self-hosted sites connected through Jetpack qualify with Jetpack AI or Jetpack Complete. One account connection can reach that account's eligible sites through the same server. These are vendor account requirements, documented in the [MCP overview](https://developer.wordpress.com/docs/mcp/), not missing connector implementation.

## Public discovery evidence

The [seventh-wave capture](seventh-wave-discovery.json) records the public profile. Independent anonymous initialization also returned HTTP 401 with the following challenge-specific metadata address:

`https://public-api.wordpress.com/.well-known/oauth-protected-resource?resource=wpcom/v2/mcp/v1`

Both that URL and the path-specific `/.well-known/oauth-protected-resource/wpcom/v2/mcp/v1` returned the correct resource `https://public-api.wordpress.com/wpcom/v2/mcp/v1`. Ordinary preauthorization can therefore discover the same resource without first opening an MCP session. Callback state preserves the query-based address when discovery begins from a challenge.

| Field | Observed value |
| --- | --- |
| Issuer | `https://public-api.wordpress.com` |
| Authorization metadata | `https://public-api.wordpress.com/.well-known/oauth-authorization-server` |
| Dynamic registration | `/oauth2-1/register`, no registration authentication |
| Authorization | `/oauth2-1/authorize` |
| Token exchange | `/oauth2-1/token` |
| Revocation | `/oauth2-1/revoke` |
| Public-client token authentication | `none` |
| PKCE | `S256` |
| Advertised grants | Authorization code, refresh token, client credentials |
| Selected grants | Authorization code and refresh token |
| Resource indicators | Supported |

These endpoint paths are relative to the issuer origin. The metadata also supports confidential clients, but they are unnecessary for this integration.

## Scope selection

The live resource metadata advertises 21 broad WordPress API scopes, including `global`, while the custom-client guide's MCP authorization example uses `auth`. The installed SDK prioritizes resource scopes over `clientMetadata.scope`. Merely setting the catalog's fallback scopes would still request the broader list.

The connector therefore starts explicit preauthorization with the trusted catalog scope `auth`, which the SDK applies consistently to registration and consent. This setting does not change discovery scopes for unrelated providers. Code exchange and token renewal continue through the SDK with the issued credentials and the discovered resource binding. The account's MCP settings, site permissions and service eligibility still determine accessible tools.

Background token renewal can continue with the registered client. If SDK recovery would discard a rejected client or restart consent, this profile instead requires an interactive reconnect. It does not automatically register a replacement client using the broader discovery scopes, nor write new consent state or PKCE values in the background. The next interactive connection again requests only `auth`.

## Useful coverage and write policy

The [tool reference](https://developer.wordpress.com/docs/mcp/tools-reference/) covers content authoring, site design context, account administration, site settings and statistics, users, plugins and Jetpack features. Most families share a facade tool with operation discovery and schema inspection. The app should ingest the server's tools and preserve that interface, rather than creating a static duplicate of each operation.

Publishing content and changing site administration justify a high mutation risk floor. The service requires confirmed writes and a `user_confirmed` parameter for relevant operations. The connector must not silently manufacture that confirmation or weaken the normal approval policy. Tool availability varies by site plan, user permissions and account settings. Live `tools/list` and operation descriptions remain authoritative.

## Verification and limits

[`mcp-oauth-wordpress.test.ts`](../../src/lib/integrations/mcp-oauth-wordpress.test.ts) uses the installed SDK with intercepted responses. It exercises the anonymous 401 challenge, query-based resource discovery, public dynamic registration, PKCE and state, fresh callback transport, exact resource binding, secretless token exchange and refresh. A separate explicit-preauthorization flow checks that both registration and consent receive only `auth`, despite the broad public metadata.

Regression cases cover background `invalid_client`, `unauthorized_client` and `invalid_grant` responses. They verify no hidden registration, browser redirect or PKCE state appears, repeated background attempts remain blocked, and a deliberate interactive reconnect restores the narrow scope.

Registration and token responses in the fixtures are synthetic. Public checks did not register an application, sign in, read a user's sites, or publish or change any content. An eligible account with MCP enabled is still needed to verify live consent and its available tool catalog.
