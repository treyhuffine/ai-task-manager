# Docusign hosted MCP qualification

Verified 2026-09-29 UTC (2026-09-28 local). Public documentation and OAuth metadata were read without credentials. Two anonymous MCP `initialize` requests were also made. No app was registered, consent granted, token exchanged, account read, agreement created, or tool called. The protocol exchanges in the test file are offline fixtures.

## Recommended built-in profile

Use one canonical `docusign` provider with an explicit, immutable environment choice for each connection:

| Choice | Streamable HTTP endpoint | OAuth authorization and token origin |
| --- | --- | --- |
| Production | `https://mcp.docusign.com/mcp` | `https://account.docusign.com` |
| Developer demo | `https://mcp-d.docusign.com/mcp` | `https://account-d.docusign.com` |

The [official MCP overview](https://developers.docusign.com/platform/mcp-server/) documents both endpoints and confidential authorization-code access. The [official Claude setup guide](https://developers.docusign.com/platform/mcp-server/anthropic-claude/) explicitly supports custom connectors in both environments, using an Integration Key, Secret Key, and registered callback URI. It does not restrict the protocol to Claude. The published setup requires no account-ID header or account-ID query parameter. Our transport can use the OAuth bearer token normally. Account context and product availability must still be verified from the authenticated server's tools and results.

```ts
auth: {
  kind: 'oauth',
  registration: 'registered',
  tokenEndpointAuthMethod: 'client_secret_basic',
  authorizeBeforeConnect: true,
}
defaultMutationRisk: 'high'
```

Use the existing encrypted OAuth app registry for a user's own Integration Key and Secret Key. Register the exact stable callback URL shown by this app. Never reuse another client's application credentials. The application must be enabled in the selected environment. The [Developer Console description](https://www.docusign.com/blog/developers/momentum-26-agentic-agreement-workflows) covers creating integration keys and promoting integrations to production. The MCP setup guide states the beta has no separate intake form or additional approval. That does not supply an OAuth application or guarantee the user's product entitlements.

## OAuth findings

The [confidential authorization-code guide](https://developers.docusign.com/platform/auth/confidential-authcode-get-token/) specifies HTTP Basic authentication with the Integration Key and Secret Key for code exchange and refresh. PKCE is supported. Current MCP metadata advertises `S256`, `authorization_code`, and `refresh_token`. It does not advertise a registration endpoint or token authentication methods, so Basic is selected from the first-party authentication guide rather than guessed from metadata.

The current protected-resource documents advertise these six scopes:

```text
adm_store_unified_repo_read aow_manage cors signature spring_read spring_write
```

Let the SDK obtain these from discovery. No extra scope override is required. The general authentication guide documents optional `extended` scope for refresh tokens with a renewed lifetime. Refresh tokens work without it, retaining the original expiration horizon. Since `extended` is absent from the MCP metadata, this profile does not add it. A successful fixture refresh proves protocol compatibility, not indefinite sign-in or real account eligibility.

For each environment, the resource document's `authorization_servers` points to the MCP origin. Its authorization-server metadata then identifies the matching `account` origin as `issuer` and provides `/oauth/auth` and `/oauth/token`. The installed SDK accepts this topology. No discovery override is needed.

## Public checks and required host behavior

| Request, in both environments | Result |
| --- | --- |
| GET `/mcp` | 403, `RBAC: access denied`, no `WWW-Authenticate` |
| POST `/mcp`, anonymous `initialize` | 403, same body, no `WWW-Authenticate` |
| GET `/.well-known/oauth-protected-resource/mcp` | 403 |
| GET `/.well-known/oauth-protected-resource` | 200 JSON |
| GET `/.well-known/oauth-authorization-server` on the MCP origin | 200 JSON |

The anonymous initialization used protocol version `2025-06-18` and accepted JSON and event streams. Both requests were rejected before a session was established.

The SDK's standard discovery falls back from the path-specific resource document to the root document successfully. However, a transport-first connection does not treat a bare 403 as an OAuth challenge. This provider therefore needs explicit SDK authorization before opening the transport during interactive sign-in. The catalog's `authorizeBeforeConnect` flag and exported `beginMcpOAuth` helper support that behavior. Arbitrary 403 responses remain errors. Callback code exchange and background use retain their existing flow.

A separate public probe with a deliberately invalid placeholder bearer token returned HTTP 401 and an `invalid_token` OAuth challenge in both environments. This supports using the ordinary SDK refresh path after initial sign-in. It does not establish a successful refresh with real credentials.

Discovery captures are in [sixth-wave-discovery.json](./sixth-wave-discovery.json), which contains public GET evidence only. The anonymous initialization observation is recorded above separately.

## Capability policy and validation

The official MCP overview includes sending or voiding envelopes, changing recipients, sending reminders, and starting or canceling workflows. Use the high mutation-risk floor. Trusted read-only annotations can identify reads, while mutations continue through approval. Demo and production expose different capabilities, so discover each selected account's live tool list rather than promising a fixed count or copying a directory catalog.

[mcp-oauth-docusign.test.ts](../../src/lib/integrations/mcp-oauth-docusign.test.ts) exercises the actual installed SDK against fixtures for both environments. It checks the catalog profile, root metadata fallback, consent scopes and resource binding, PKCE, persisted discovery across a fresh callback transport, Basic code exchange, refresh, absence of dynamic registration, static-secret exclusion from saved MCP state, and preservation of a transport 403 as an error. All five tests pass. Engine tests also cover the explicit-auth helper returning `AUTHORIZED` or `REDIRECT` without opening a transport and preserving failures.

No live authenticated verification was performed. Account licensing, a real Integration Key's configuration, and tool discovery after consent remain environment-specific checks when the user connects.
