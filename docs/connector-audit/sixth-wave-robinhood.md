# Robinhood hosted MCP qualification

Checked 2026-09-28 America/Denver, 2026-09-29 UTC. Public documentation and GET-only requests qualify the hosted connector's authentication profile. No remote client registration, consent, account creation, account access, tool discovery or trades were performed.

## Supported connection and onboarding

[Robinhood's official guide](https://robinhood.com/us/en/support/articles/agentic-trading-overview/) explicitly supports custom MCP clients at `https://agent.robinhood.com/mcp/trading`. It also documents Claude, ChatGPT, Codex, Cursor and Grok setup. The connector therefore uses ordinary discovered public-client OAuth, with no pre-registered application requirement or provider-specific authorization flags identified.

The same guide says authentication prompts the user to open a dedicated Agentic account. This requires an existing primary individual investing account in good standing and desktop onboarding. Read access covers Robinhood accounts, balances, positions, transactions and watchlists. Trading is restricted to the dedicated Agentic account. This qualification did not open that account or accept its agreements.

## Observed public metadata

The installed MCP SDK's `discoverOAuthServerInfo` made exactly these two GET requests, both returning 200:

1. [Protected resource](https://agent.robinhood.com/.well-known/oauth-protected-resource/mcp/trading)
2. [Authorization server](https://agent.robinhood.com/.well-known/oauth-authorization-server/mcp/trading)

Protected-resource response:

```json
{
  "authorization_servers": ["https://agent.robinhood.com/mcp/trading"],
  "bearer_methods_supported": ["header"],
  "resource": "https://agent.robinhood.com/mcp/trading",
  "scopes_supported": ["internal"]
}
```

Authorization-server response:

```json
{
  "authorization_endpoint": "https://robinhood.com/oauth",
  "code_challenge_methods_supported": ["S256"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "issuer": "https://agent.robinhood.com/mcp/trading",
  "registration_endpoint": "https://agent.robinhood.com/oauth/trading/register",
  "response_types_supported": ["code"],
  "scopes_supported": ["internal"],
  "token_endpoint": "https://api.robinhood.com/oauth2/token/",
  "token_endpoint_auth_methods_supported": ["none"]
}
```

The transport URL's anonymous GET returned 405 with `Allow: POST`, without an OAuth challenge. This does not establish account access or invalidate its Streamable HTTP endpoint. Direct discovery succeeds using the path-qualified well-known metadata. The SDK retains the path-qualified issuer and resource indicator while using different Robinhood hosts for consent and token exchange.

## Local implementation contract

| Property | Value |
| --- | --- |
| Canonical provider | `robinhood` |
| Endpoint | `https://agent.robinhood.com/mcp/trading` |
| Client registration | Dynamic, discovered |
| Client authentication | Public client, `none` |
| Grants | `authorization_code`, `refresh_token` |
| PKCE | S256 |
| Scopes | Discovered `internal` |
| Default mutation risk | High |

The high mutation floor accounts for financial writes. Tool names and schemas come from authenticated upstream discovery, with the shared approval system handling discovered actions. No static trading wrappers or compatibility aliases are added.

## Validation and limits

[`mcp-oauth-robinhood.test.ts`](../../src/lib/connectors/mcp-oauth-robinhood.test.ts) uses the captured metadata and synthetic registration/token responses through the actual MCP SDK and app OAuth provider. It exercises web and desktop callbacks, path-qualified discovery, public dynamic registration, scope selection, state, S256 PKCE, code exchange, token refresh, resource binding, and preservation of the registered callback after the app URL changes. It also checks the catalog endpoint and high mutation floor.

All fixture requests are intercepted. These tests establish local protocol compatibility, not successful live consent, onboarding eligibility, account permissions or the live trading tool contract. No authenticated tool count is claimed.

Validation: all three Robinhood OAuth tests pass. Settings acceptance verifies that the account form shows the Agentic onboarding requirements and official setup guide. Scoped ESLint passes.
