# PayPal hosted MCP qualification

Reviewed 2026-09-28. This records public discovery and the app's fixture validation, not a connected merchant account or a successful live transaction.

## Decision

Use PayPal's hosted MCP with an explicit **PayPal environment** selector. Keep production and sandbox as separate, immutable account endpoints. Use public OAuth discovery and dynamic client registration with PKCE. No native PayPal tool implementation, shared client ID, compatibility aliases, or database migration is needed.

| Environment | Live Streamable HTTP endpoint | Resource metadata |
| --- | --- | --- |
| Production | `https://mcp.paypal.com/mcp` | [Production metadata](https://mcp.paypal.com/.well-known/oauth-protected-resource/mcp) |
| Sandbox | `https://mcp.sandbox.paypal.com/mcp` | [Sandbox metadata](https://mcp.sandbox.paypal.com/.well-known/oauth-protected-resource/mcp) |

PayPal's [quickstart](https://developer.paypal.com/ai-tools/mcp-server) explicitly supports a customer's preferred MCP client and describes interactive login and consent without a client admission step. It also documents an alternative token-based setup, which this named connector does not require.

## Documentation discrepancy and live evidence

The quickstart currently specifies `/http` for Streamable HTTP. On the review date, both production and sandbox returned `404 Not Found` for GET and anonymous JSON-RPC `initialize` POST at that path. Adding a trailing slash did not fix production.

Both `/mcp` endpoints returned HTTP 401 to anonymous `initialize` POST. Their `WWW-Authenticate` headers advertised the path-specific resource metadata linked above. Those documents returned HTTP 200 and identified the corresponding `/mcp` resource. These responses come directly from PayPal's hosts, which is the basis for using `/mcp` despite the stale quickstart example. The documented production `/sse` endpoint also returned an OAuth challenge, but no transport fallback is needed in this integration.

## OAuth profile

Both environments expose the same profile through [production authorization metadata](https://mcp.paypal.com/.well-known/oauth-authorization-server) and [sandbox authorization metadata](https://mcp.sandbox.paypal.com/.well-known/oauth-authorization-server). Each profile uses its own origin throughout.

| Field | Observed value |
| --- | --- |
| Issuer | MCP origin for the chosen environment |
| Authorization endpoint | Origin plus `/authorize` |
| Token endpoint | Origin plus `/token` |
| Dynamic registration | Origin plus `/register` |
| Grants | `authorization_code`, `refresh_token` |
| Response type and mode | `code`, `query` |
| Supported client authentication | `client_secret_basic`, `client_secret_post`, `none` |
| Selected client authentication | `none` |
| PKCE | `S256` |
| Resource scopes | `openid email profile` |
| Client metadata document support | `false` |

The resource supplies the scopes. The app should not invent merchant API scopes or request a broader static scope list. Discovery, registration, consent, code exchange and refresh must remain tied to the selected environment.

The public documentation and metadata establish a supported custom-client integration path. No real dynamic client was registered during this audit, so current registration acceptance, merchant eligibility and actual issued token grants still require an account smoke test. A published registration endpoint alone is not evidence of successful live authorization.

## Capabilities and risk

PayPal's [agent tools reference](https://developer.paypal.com/ai-tools/agent-tools/) describes invoices, orders, refunds, subscriptions, disputes, products, shipment tracking and merchant reporting. Actual tools and schemas are discovered from the connected server rather than copied from that table. Keep the high mutation risk floor because writes include payment capture and refunds. Existing approval rules remain in effect.

The reference separately describes optional commerce tools enabled by an extra feature header. This connector uses the standard merchant server profile and does not silently add that header.

## Verification

[`mcp-oauth-paypal.test.ts`](../../src/lib/integrations/mcp-oauth-paypal.test.ts) runs the installed MCP SDK against intercepted fixtures reproducing both observed discovery profiles. It verifies environment isolation, explicit environment selection, public registration metadata, discovered scopes, PKCE and state, exact resource binding, code exchange, secretless refresh, and registration reuse. Registration and token responses are synthetic. No test contacts PayPal.

The public checks performed only metadata GETs, an SSE authentication challenge, and anonymous initialization. They did not log in, register a client, list private merchant data, create invoices, capture payments, issue refunds, or carry out any other business action.
