# DataForSEO hosted MCP qualification

Checked October 8, 2026. Use the official endpoint `https://mcp.dataforseo.com/v3/mcp` with discovered public-client OAuth and the `api` scope.

The vendor's [server source and README](https://github.com/dataforseo/mcp-server-typescript) (version 3.1.3, commit `1fc6d19`) name `/v3/mcp` as the public remote server, as does the [product page](https://dataforseo.com/seo-mcp-server). Their [OAuth guide](https://dataforseo.com/help-center/connecting-the-remote-dataforseo-mcp-server-using-oauth) still shows `/mcp`. Both answer, but only `/v3/mcp` returns the current challenge with `scope="api"`, so the catalog pins `/v3/mcp`. The README calls OAuth the default for HTTP clients, discovered through protected-resource metadata.

## Public protocol evidence

The [capture](eighth-wave-discovery.json) records SDK discovery with GET requests and one anonymous initialization POST. The [reproduction script](discover-eighth-wave.mjs) does the same.

| Field | Value |
| --- | --- |
| Anonymous GET | 405, no challenge |
| Anonymous initialization POST | 401, `resource_metadata` at the origin root, `scope="api"` |
| Resource | `https://mcp.dataforseo.com` (root metadata only, the path-specific URL returns 404) |
| Issuer | `https://data.dataforseo.com` |
| Authorization, token and registration | `/oauth/authorize`, `/oauth/token`, `/oauth/clients/register` on the issuer |
| Supported client authentication | `none` |
| Grants | `authorization_code`, `refresh_token` |
| PKCE | S256 |
| Advertised scopes | Server: `api`, `profile`. Resource metadata: none |

The ordinary transport path takes `api` from the challenge. Resource metadata names no scopes, so the catalog also sets `api` as the client scope fallback. That keeps registration and consent scoped when the SDK authorizes without a challenge. The vendor's source declares `api` as the scope "required to call the DataForSEO API with an OAuth access token" and its newer metadata adds `scopes_supported: ["api"]`, so the fallback matches both deployments.

The SDK sends the bare-origin resource as `https://mcp.dataforseo.com/`, with a trailing slash. Claude Desktop and Cursor, which the vendor documents as working, use the same SDK normalization.

## Tools, cost and approval

The server exposes four tools. `docs_index`, `docs_list_sections` and `docs_search` read the API documentation and are annotated read-only. `api_request` calls any DataForSEO API path and is annotated `readOnlyHint: false, destructiveHint: false`. Every data request, including keyword volumes and search results, goes through `api_request` and spends the account's prepaid balance at [standard API prices](https://dataforseo.com/pricing). The connection itself is free.

The catalog sets no write floor. `api_request` therefore lands at medium risk and runs on standing intent, as paid research reads do for Tavily, Exa and Firecrawl. Gating it would stop an agent before every lookup. The user can turn on Ask first for `api_request` in Settings to approve each request. The policy is pinned in [hosted-provider-policy.test.ts](../../src/lib/integrations/hosted-provider-policy.test.ts).

DataForSEO also accepts `Authorization: Basic` with the API login and password. The catalog uses browser OAuth only. Bearer token auth sends `Bearer`, and Basic credentials would need a new credential kind for one provider. Add it if OAuth proves unworkable.

## Validation and limits

[Real-SDK fixtures](../../src/lib/integrations/mcp-oauth-dataforseo.test.ts) use the captured metadata with intercepted registration and token responses, for web and desktop callbacks. They verify the 404 fallback to root resource metadata, public DCR with `api`, PKCE, the normalized resource, saved callback reuse and refresh.

A live check in the dev app went through the real connect page to DataForSEO. Dynamic registration issued a client for the web callback. The authorization endpoint accepted `scope=api`, PKCE and the trailing-slash resource, opened a consent request naming the client Ri with scope `api`, and redirected to the account sign-in page. The pending dev connection was then disconnected.

No DataForSEO account was signed in and no data requests were made. Consent approval, token exchange and a real tool call remain to be accepted on an account.
