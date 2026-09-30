# Seventh wave: Webflow qualification

Checked 2026-09-29 UTC. Webflow's official hosted server qualifies for an independent client using the existing public OAuth/DCR implementation. Its getting-started guide explicitly permits any MCP-compatible agent and supplies a manual server URL. This is direct documentation of custom-client access, independent of marketplace listings. No account was connected and no live registration, consent, or tool calls were performed. [Official setup](https://developers.webflow.com/mcp/reference/getting-started).

## Recommended catalog profile

| Field | Value |
| --- | --- |
| Provider ID | `webflow` |
| Transport | Streamable HTTP |
| Server URL | `https://mcp.webflow.com/mcp` |
| Registration | Public dynamic client registration |
| Token client authentication | `none` |
| Grants | `authorization_code`, `refresh_token` |
| PKCE | S256 |
| Scopes | No override, neither resource nor authorization metadata advertises scopes |
| Mutation floor | High, because site content changes and publishing can have external consequences |
| Special headers, static OAuth app, tenant URL | None documented for the normal hosted flow |

The SDK selects its normal authorization-code path. Webflow handles site authorization in its consent flow. Do not invent ordinary Data API scopes or require users to register a separate REST API application. The recommendation combines [manual connection instructions](https://developers.webflow.com/mcp/reference/getting-started) with the public metadata below.

## Public discovery evidence

The live capture is in [seventh-wave-discovery.json](./seventh-wave-discovery.json), record `webflow`, checked at `2026-09-29T05:05:00.939Z`. Every captured request was an anonymous GET. The server returned 401 with a `WWW-Authenticate` resource metadata challenge. Both metadata documents returned 200.

| Metadata field | Observed value |
| --- | --- |
| Protected resource metadata | `https://mcp.webflow.com/.well-known/oauth-protected-resource/mcp` |
| Resource | `https://mcp.webflow.com/mcp` |
| Authorization metadata | `https://mcp.webflow.com/.well-known/oauth-authorization-server` |
| Issuer | `https://mcp.webflow.com` |
| Authorization endpoint | `https://mcp.webflow.com/oauth/authorize` |
| Token endpoint | `https://mcp.webflow.com/oauth/token` |
| Registration endpoint | `https://mcp.webflow.com/oauth/register` |
| Response types / modes | `code` / `query` |
| Grants | `authorization_code`, `refresh_token` |
| Token client authentication | `client_secret_basic`, `client_secret_post`, `none` |
| PKCE methods | `plain`, `S256` |
| CIMD support | `false` |

The presence of `none` and S256 supports our public client profile. DCR was exercised only by offline fixtures, not against the live registration endpoint. [Authorization metadata](https://mcp.webflow.com/.well-known/oauth-authorization-server), [resource metadata](https://mcp.webflow.com/.well-known/oauth-protected-resource/mcp).

## Account and Designer limits

Each authorization selects one Webflow workspace. The user must be a site owner or admin to authorize the requested sites. A second workspace therefore needs its own authorization rather than sharing tokens or assuming all workspaces are accessible. The MCP server covers a selected set of APIs, not every Webflow API endpoint. [FAQ](https://developers.webflow.com/mcp/faqs).

The MCP Bridge App is installed during OAuth authorization. Most operations run through the Data API without an open Designer session, including editing elements, components, styles, variables, CMS content, pages, and assets. Visual snapshots and controls tied to the current selection, page, mode, branch, canvas, or breakpoints require the Designer and its connected Bridge App to remain open. The app can be minimized. Webflow enforces the user's roles and reports mode restrictions through tool errors. This is an upstream capability requirement rather than a failed connector login. [How it works](https://developers.webflow.com/mcp/reference/how-it-works).

The server also advertises MCP resources and site agent instructions. Our connector projects discovered tools. This review does not assert resource or skill parity with Webflow's plugins. Tool discovery after actual user authorization remains the source of truth for tools available to that connection. [Resource behavior](https://developers.webflow.com/mcp/reference/how-it-works).

## Verification

[mcp-oauth-webflow.test.ts](../../src/lib/connectors/mcp-oauth-webflow.test.ts) uses the captured metadata with the real installed MCP SDK and our OAuth provider. Synthetic HTTP fixtures cover:

- Catalog profile matches the endpoint and public-client metadata without adding scopes.
- Initial transport 401 triggers metadata discovery and DCR.
- Web and loopback callbacks receive code flow with state, resource binding, and S256 PKCE.
- A fresh callback provider exchanges the code using the saved verifier and discovery state.
- A fresh background provider refreshes with the same registered client and resource, without a client secret, repeated registration, or fabricated scopes.

These are protocol and integration checks. They do not claim a live Webflow account login or successful site edits.
