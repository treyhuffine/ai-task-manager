# X integration

X uses its official hosted MCP at `https://api.x.com/mcp`. The canonical provider ID remains `twitter`. Available tool names, input schemas and behavior are discovered from X after sign-in, with no native action aliases.

The former generated REST toolkit, vendored OpenAPI specification, generator scripts and handwritten media-upload helper have been removed. The catalog no longer promises the old 135-action surface or supports the retired native tool allowlist, denylist and tag filters. Tool permissions are managed through the common integration controls.

## Connection setup

1. Create an OAuth 2.0 application in the X developer console with the account permissions you need.
2. Register the exact callback displayed in this app's X integration setup.
3. Supply the application's registered client ID and client secret using the integration's OAuth app configuration.
4. Sign in as the X account the integration should act for and approve access.

The host handles authorization code, S256 PKCE and token refresh directly. No local `xurl` bridge is required. Credentials use the app's encrypted integration secret store. The catalog chooses Basic client authentication, while the upstream metadata supplies authorization endpoints and requested resource scopes, including `offline.access` for refresh.

## What was verified

Public metadata from X returned valid protected-resource and OAuth authorization-server documents. This is newer behavior than the [official MCP guide](https://docs.x.com/tools/mcp), which still describes discovery as unavailable and uses `xurl` as the user-token bridge. The registered-client integration performs the same OAuth and bearer-token role inside this app.

Account sign-in, plan eligibility, actual tool coverage and account operations remain to be validated with an authorized X account. Discovery is not proof that all native posting or media workflows have equivalent remote tools.

See the [fifth-wave evidence](integration-audit/fifth-wave-provider-evidence.md), [public discovery capture](integration-audit/fifth-wave-discovery.json), and [hosted provider definition](../packages/integrations/src/providers/hosted-mcp.ts).
