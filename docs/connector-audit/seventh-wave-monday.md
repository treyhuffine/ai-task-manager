# monday.com hosted MCP qualification

Checked 2026-09-28 America/Denver, 2026-09-29 UTC. Research used official public documentation and anonymous GET requests only. No account, token, remote OAuth client or integration registration was created. No authenticated tools were requested.

## Personal and public availability

The [official integration guide](https://developer.monday.com/api-reference/docs/integrate-with-monday-mcp) recommends Streamable HTTP at `https://mcp.monday.com/mcp`. The retired `/sse` endpoint is unsupported. Tool calls use the platform API and authenticated user's permissions. API version pinning is optional, so no version header is required here.

The [personal API token guide](https://developer.monday.com/api-reference/docs/mcp-api-token) supports personal use, prototypes and testing without app registration. Users obtain their own token from their profile menu, Developers, then My access tokens. The documented transport header is:

```http
Authorization: Bearer <personal API token>
```

This is the selected connection path for the current personal installation. A user's token retains that user's monday.com permissions.

**Public distribution has a separate prerequisite.** The [public integration guide](https://developer.monday.com/api-reference/docs/mcp-dynamic-client-registration) requires monday.com registration and approval before making an integration publicly available, including product features and marketplace listings. Approved public integrations use DCR. The personal-token implementation must not be described as an approved public marketplace integration or as a way around vendor registration. Public rollout remains dependent on that approval.

[An operator's own OAuth app](https://developer.monday.com/api-reference/docs/control-mcp-access-with-oauth-app) is another documented path for internal or organizational use. Its app scopes can limit MCP actions. That path requires a client ID, secret and registered callback, and remains distinct from the vendor-approved public DCR flow. It is not selected for this personal-token connector.

## Live metadata differs from older documented URLs

Anonymous GET `https://mcp.monday.com/mcp` returned 401 and advertised:

```http
WWW-Authenticate: Bearer resource_metadata="https://mcp.monday.com/.well-known/oauth-protected-resource/mcp"
```

GET-only `discoverOAuthServerInfo` from the installed MCP SDK then fetched these two documents successfully:

1. [Protected resource](https://mcp.monday.com/.well-known/oauth-protected-resource/mcp), status 200
2. [Authorization server](https://auth.monday.com/.well-known/oauth-authorization-server/mcp), status 200

The root [protected-resource document](https://mcp.monday.com/.well-known/oauth-protected-resource) also returned 200 with the same resource, issuer and bearer method.

| Metadata field | Observed value |
| --- | --- |
| Resource | `https://mcp.monday.com/mcp` |
| Issuer | `https://auth.monday.com/mcp` |
| Authorization endpoint | `https://auth.monday.com/oauth2/authorize` |
| Token endpoint | `https://auth.monday.com/oauth_ms/oauth/token` |
| Registration endpoint | `https://auth.monday.com/oauth_ms/oauth/register` |
| Token authentication methods | `client_secret_post`, `client_secret_basic` |
| Grants | `authorization_code`, `refresh_token`, `client_credentials` |
| PKCE | `S256` |
| Bearer method | `header` |

The server also advertises revocation at `/oauth_ms/oauth/revoke`, token migration at `/oauth_ms/oauth/migrate`, and an authorization-response issuer parameter. No supported scope list is returned. These observations do not establish registration acceptance or public integration approval. In particular, public-client `none` is not advertised. The older documentation's `mcp.monday.com/register` and related OAuth URLs should not override live discovery.

## Selected implementation and checks

| Property | Value |
| --- | --- |
| Canonical provider | `monday` |
| Display name | `monday.com` |
| Endpoint | `https://mcp.monday.com/mcp` |
| Authentication | Bearer personal API token |
| Credential label | Personal API token |
| Mutation floor | High |
| OAuth app or callback needed | No, for the selected personal-token path |

The existing bearer flow encrypts each user's token, supports separate labeled accounts and token replacement, and discovers upstream tools. No static tool wrappers, compatibility aliases, API version override or native GraphQL adapter are added.

[`mcp-monday.test.ts`](../../src/lib/connectors/mcp-monday.test.ts) binds the catalog profile and exercises the actual MCP SDK with intercepted HTTP. It verifies the exact authorization header for initialization, discovery and a synthetic read call. A rejected token does not trigger OAuth discovery or client registration. Fixture tool schemas and results are deliberately synthetic. These tests establish transport behavior, not live account permissions or the authenticated monday.com tool catalog.

Validation: all three monday.com tests pass. Shared catalog-driven tests cover encrypted bearer storage, token rotation, direct connection and disconnect routes, and high-risk write approvals. The combined focused suite passed 354 tests, with scoped ESLint and whitespace checks clean.
