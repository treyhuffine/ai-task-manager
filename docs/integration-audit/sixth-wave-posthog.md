# PostHog hosted MCP

Checked September 28, 2026 in America/Denver. Public capture timestamps are September 29 UTC.

The [official PostHog documentation](https://posthog.com/docs/model-context-protocol) supports arbitrary compatible MCP clients at `https://mcp.posthog.com/mcp`. The unified OAuth service chooses the user's US or EU region during login. The vendor maintains the available analytics, feature flag, experiment and error tools. Some tools run AI internally and require organization AI processing permission, with possible PostHog AI usage charges. This is visible in our setup guidance.

## Verified public discovery

The [GET-only capture](sixth-wave-discovery.json) records an HTTP 401 challenge pointing to `https://mcp.posthog.com/.well-known/oauth-protected-resource/mcp`. The protected resource uses `https://oauth.posthog.com` as its authorization server. That server advertises `/oauth/authorize/`, `/oauth/token/` and `/oauth/register/`, public-client authentication with `none`, PKCE S256, and authorization-code plus refresh-token grants.

The protected resource advertises the MCP-specific scope set, which is narrower than the authorization server's full scope list. Our SDK uses the resource's advertised set. There is no hardcoded US-only account selection, private API key, third-party wrapper or compatibility alias in this connector. The catalog uses ordinary discovered OAuth and a high mutation-risk floor, consistent with other connectors exposing broad administrative writes.

## Verification and limits

[The SDK protocol test](../../src/lib/integrations/mcp-oauth-posthog.test.ts) consumes the captured metadata and intercepts every request. It verifies dynamic registration, PKCE, resource and scope binding, code exchange, refresh and one registration reused across sessions. Token responses and accounts in the test are synthetic. Catalog, routing, Settings guidance and write-policy tests include PostHog.

No client was registered remotely, no account was connected and no analytics or private data was read. Live sign-in and representative account workflows still require the user's account. Provider-owned tools are discovered after connection, so an app-specific typed task picker is not needed to deliver this connector.
