# Smartsheet hosted MCP qualification

Checked September 28, 2026 in America/Denver, September 29 UTC. The named connector uses Smartsheet's official hosted MCP with an API token and an explicit regional selection.

| Region | Endpoint |
| --- | --- |
| United States | `https://mcp.smartsheet.com` |
| Europe | `https://mcp.smartsheet.eu` |
| Australia | `https://mcp.smartsheet.au` |

The [installation guide](https://developers.smartsheet.com/ai-mcp/smartsheet/install-the-smartsheet-mcp-server) lists these regions and requires Business, Enterprise or Advanced Work Management. The [manual client guide](https://developers.smartsheet.com/ai-mcp/smartsheet/install-the-smartsheet-mcp-server/manually-configure-the-mcp-server) explicitly supports custom MCP clients using `Authorization: Bearer` with an API token. Its multi-region example uses a separate token for each region. This is the supported custom-client path used here, even though some directory integrations use OAuth.

The [GET-only discovery capture](seventh-wave-discovery.json) records 401 responses from all three endpoints and successful protected-resource and authorization metadata. The metadata points to the corresponding regional Smartsheet authorization and token servers but advertises no dynamic registration endpoint. This connector does not guess an OAuth client identity or attempt registration.

## Connection behavior

The user chooses the region without an implicit default and supplies its API token. The existing encrypted MCP credential store saves the token and endpoint separately for each labeled connection. Reconnect uses the saved region. An attempted region change is rejected before replacing a token, and ambiguous requests cannot choose an arbitrary existing account. A different region can be added as another account.

Smartsheet's [tool reference](https://developers.smartsheet.com/ai-mcp/smartsheet/mcp-server-tools) covers sheets, rows, reports, workspaces, sharing and automation. Actual tool names and schemas come from discovery. Broad writes use a high mutation-risk floor and the existing approval policy. This addition does not create a typed task-picker consumer.

## Validation and limits

Catalog-derived token and policy tests include Smartsheet. New regressions in [hosted storage tests](../../src/lib/connectors/hosted-mcp.test.ts), [API route tests](../../src/app/api/connectors/hosted-routes.test.ts) and [Settings tests](../../src/components/settings/sections/connectors/provider-detail.test.ts) verify region requirements, encrypted US/EU/AU credentials, separate account identities, immutable reconnect endpoints, token-replacement rejection and setup guidance. The agent-requested connection page also requires a region explicitly.

Public checks used metadata requests only. No real token was supplied, account data read, or sheet modified. Tests use synthetic credentials and intercepted transports. Real account permissions and plan eligibility remain acceptance checks when the user connects.
