# OpenSEO connector

Added October 13, 2026 through the provider's official hosted MCP service, `https://app.openseo.so/mcp`. It is a built-in connector under Websites & publishing. Its provider and toolkit identity is `openseo`, with discovered actions named `openseo.<tool>`.

## Connection setup

Browser sign-in uses public dynamic client registration, PKCE S256, and the `mcp offline_access` scopes. Ri starts consent explicitly before connecting so the SDK cannot narrow the request to only the protected resource's advertised `mcp` scope. `offline_access` keeps refresh available. Both Ri's web callback and desktop loopback callback are fixture-tested.

Use API key accepts a personal OpenSEO key from OpenSEO Settings > API keys. Ri seals the key and sends it as `Authorization: Bearer <key>`. OAuth and API-key accounts coexist without replacing each other's credentials. The Hosted deployment pins the official endpoint and preserves existing account IDs.

Self-hosted is available in the same OpenSEO setup. Enter the instance base URL or its full `/mcp` URL. Ri appends `/mcp` once and accepts HTTPS, plus HTTP for loopback addresses such as `http://localhost:3000`. The instance is reached from the computer running Ri. Credentials, query parameters and fragments are not accepted in the address.

Choose **No authentication (Docker)** for `AUTH_MODE=local_noauth`, or **Browser sign-in (Cloudflare Access)** for deployments protected by Cloudflare Access Managed OAuth. Enable Managed OAuth in that Access application and allow Ri's web callback and desktop loopback redirect URIs, as documented by OpenSEO. OAuth metadata and scopes come from the instance rather than the hosted OpenSEO profile. Hosted API keys are not offered or accepted for self-hosted instances.

Each saved connection freezes its deployment, normalized URL and authentication method. Hosted, Docker and Cloudflare accounts can coexist. Reconnect retains these settings and credentials. Disconnect and add a connection to change them. Arbitrary self-hosted servers do not inherit the hosted vendor's trusted tool annotations, following the existing instance-server policy.

## Tools and permissions

OpenSEO supplies keyword and SERP research, domain and backlink data, rank tracking, AI visibility, Google Search Console, saved project context and reports. Ri discovers the tools rather than hardcoding a snapshot of the service.

The upstream annotations distinguish free reads, credit-backed research and destructive or sharing operations. For example, `list_projects` is read-only, `research_keywords` is a non-destructive mutation because it consumes credits, and `set_report_sharing` is destructive. Ri retains these annotations under its normal permission and approval gates. Paid research follows the existing standing-intent policy. Sharing retains the higher risk classification. The connector adds no concurrency cap or queue. Existing request deadlines, per-request cancellation, credential checks and recovery remain in place.

## Sources and validation

- [Official MCP setup guide](https://www.openseo.so/docs/mcp) documents the hosted endpoint, browser login and Bearer API keys.
- [Official self-hosting guide](https://www.openseo.so/docs/self-hosting) and [Cloudflare MCP operations](https://github.com/every-app/open-seo/blob/89e5a00717cdf049b7c2b4e29646edb3a7d4995b/docs/SELF_HOSTING_CLOUDFLARE_OPERATIONS.md) document Docker no-auth and Cloudflare Access Managed OAuth.
- [OAuth scopes](https://github.com/every-app/open-seo/blob/89e5a00717cdf049b7c2b4e29646edb3a7d4995b/src/lib/oauth-resource.ts) define `mcp` and `offline_access`.
- [OAuth service configuration](https://github.com/every-app/open-seo/blob/89e5a00717cdf049b7c2b4e29646edb3a7d4995b/src/server/mcp/oauth-provider.ts) defines public registration, resource metadata, authorization and token routes.
- [Keyword research](https://github.com/every-app/open-seo/blob/89e5a00717cdf049b7c2b4e29646edb3a7d4995b/src/server/mcp/tools/research-keywords.ts) and [report sharing](https://github.com/every-app/open-seo/blob/89e5a00717cdf049b7c2b4e29646edb3a7d4995b/src/server/mcp/tools/report-sharing-tools.ts) establish the annotation policy.

The live unauthenticated metadata and MCP probe was blocked by Cloudflare error 1010, `browser_signature_banned`, on October 13. No live account sign-in, registration, paid call or remote project change was performed. Discovery and registration metadata in the tests are source-derived fixtures, not a live capture. No browser-signature spoofing or gateway workaround was added.

`mcp-openseo.test.ts` exercises the real SDK's public OAuth registration, consent, token exchange and refresh for both callbacks, the real Streamable HTTP API-key path, rejected-key handling, catalog presentation and tool approval classifications. `hosted-mcp.test.ts` covers encrypted multi-account setup and API-key rotation beside an existing OAuth account. `hosted-multiaccount-runtime.test.ts` verifies that DataForSEO bursts remain uncapped across discovery refreshes, preserving the user's previously requested policy after a later commit had restored the cap.

Self-hosted validation adds real SDK discovery and tool dispatch against an intercepted Docker fixture, real host stores and instance-driven public OAuth registration and PKCE exchange for web and desktop callbacks. Route, encrypted-store, request-selection and rendered UI tests cover both deployment choices, authentication validation, immutable saved bindings and coexistence with existing hosted credentials. No live self-hosted deployment or Cloudflare account was provisioned or contacted.
