# Airtable and Atlassian hosted OAuth verification

Verified 2026-09-28 using public documentation and the installed MCP SDK's GET-only `discoverOAuthServerInfo`. Both providers' protected-resource and authorization-server metadata returned 200. No clients were registered remotely, and no consent, account access, tokens or tools were exercised live.

| Built-in identity | Transport endpoint | OAuth profile | Mutation floor |
| --- | --- | --- | --- |
| `airtable` | `https://mcp.airtable.com/mcp` | Public `none`, code and refresh grants, S256 | High |
| `atlassian` | `https://mcp.atlassian.com/v2/mcp?tools=all` | Public `none`, code and refresh grants, S256 | High |

The native Airtable, Jira and Confluence adapters and their dedicated tests are retired without action aliases, following the user's direct-replacement decision. Jira and Confluence move to one Atlassian service identity. Their old credentials are not converted into hosted MCP authorization.

## Airtable

[Official generic-client instructions](https://airtable.com/developers/agents/mcp/other) explicitly support any Streamable HTTP client. Dynamic client registration is the default OAuth setup. Consent selects bases, apps and workspaces. A manually registered OAuth application is an optional alternative for organizations that require a shared allowlistable client, not a prerequisite for generic DCR.

Observed metadata:

- [Protected resource](https://mcp.airtable.com/.well-known/oauth-protected-resource/mcp): resource `https://mcp.airtable.com`, issuer `https://airtable.com/oauth2/v1`.
- [Authorization server](https://airtable.com/.well-known/oauth-authorization-server/oauth2/v1): authorize `/oauth2/v1/authorize`, token `/oauth2/v1/token`, registration `/oauth2/v1/register`. Supports `client_secret_basic` and `none`, S256 and client ID metadata documents. No `grant_types_supported` field is returned. The existing public code/refresh client profile is used.
- Both documents advertise the same seven scopes: `data.records:read`, `data.records:write`, `schema.bases:read`, `schema.bases:write`, `data.recordComments:read`, `data.recordComments:write`, `workspacesAndBases:read`.
- An unauthenticated transport GET returned 405 with no OAuth challenge. This is not an account/authentication test. Direct resource discovery succeeds, and the documented transport is Streamable HTTP.

No fixed client credentials, extra headers or custom authorization parameters are needed. The SDK takes scopes from protected-resource metadata. [Airtable's overview](https://airtable.com/developers/agents/mcp/getting-started) describes schema changes and automation management in addition to record writes, supporting a high mutation floor.

[Organization policy](https://support.airtable.com/articles/9897799762-using-the-airtable-mcp-server) can restrict third-party integrations. An admin may need to allow the generated client ID. Access remains limited by the user's permissions and selected resources. This is an organization approval requirement, not evidence of a vendor-wide custom-client ban.

## Atlassian service identity and tools

The [official setup guide](https://developer.atlassian.com/cloud/rovo-mcp/guides/getting-started/) uses one Rovo MCP service across Jira, Confluence and other Atlassian applications. Use a single `atlassian` provider/toolkit/connection, with discovered names such as `atlassian.getJiraIssue` and `atlassian.createConfluencePage`. Product access and sites come from consent and upstream tools, not separate cloned Jira and Confluence sessions.

The [tool documentation](https://developer.atlassian.com/cloud/rovo-mcp/guides/supported-tools/) explains that the normal endpoint lists primary tools, then discovers deferred operations using `discover` and routes them through `executeRead`, `executeWrite` or `executeDestructive`. The `?tools=all` endpoint instead returns the full catalog through ordinary paginated `tools/list`, fitting this app's registry. The existing MCP client follows every cursor. Available tools still depend on granted scopes, enabled permission groups, authentication method and product access. No static full tool count is promised.

## Atlassian OAuth and policy

Observed metadata:

- [Protected resource](https://mcp.atlassian.com/.well-known/oauth-protected-resource/v2/mcp?tools=all): resource `https://mcp.atlassian.com/v2/mcp`. The resource indicator omits the transport's static query parameter.
- [Authorization server](https://auth.atlassian.com/.well-known/oauth-authorization-server/VCeDsk8ZHncYF1g234fKtc4lNipbBhu3): issuer `https://auth.atlassian.com/VCeDsk8ZHncYF1g234fKtc4lNipbBhu3`, authorize `https://auth.atlassian.com/authorize`, token `https://auth.atlassian.com/oauth/token`, registration `https://auth.atlassian.com/VCeDsk8ZHncYF1g234fKtc4lNipbBhu3/dcr/register`.
- Public `none`, secret POST, secret Basic and private-key JWT methods are advertised. Code, refresh and additional non-interactive grants are advertised. We use only public code and refresh with S256.
- An unauthenticated transport GET returned 401 with resource metadata at `https://mcp.atlassian.com/.well-known/oauth-protected-resource/v2/mcp`.

The protected resource currently advertises 38 scopes. The SDK requests those scopes, including `offline_access`, and adds `prompt=consent` for offline access. The exact captured list is in the fourth-wave test fixture. It comprises identity scopes, read/write/search/delete/manage Jira scopes, read/write/search Confluence scopes, Rovo and code search, Teamwork Graph, and read/write scopes for goals, projects, Bitbucket, Loom, talent, Jira Align, teams, artifacts, capacity planning, Focus and Assets. This is broader than just Jira and Confluence, so the connector is named Atlassian and uses a high mutation floor.

[Domain rules](https://support.atlassian.com/security-and-access-policies/docs/available-atlassian-mcp-server-domains/) allow `localhost` and `127.0.0.1` by default alongside supported hosted clients. Organization admins can change these settings and add custom callback domains. A hosted installation may therefore require its callback domain to be approved. [Organization controls](https://support.atlassian.com/security-and-access-policies/docs/control-atlassian-mcp-server-settings/) also apply IP allowlists.

[Atlassian's authentication guide](https://developer.atlassian.com/cloud/rovo-mcp/guides/authentication-and-authorization/) says deletion and management permission groups can require admin enablement. Some Jira Service Management tools require API-token authentication, while some other groups are OAuth-only. This built-in uses the generic DCR OAuth service, not the retired manually configured Jira/Confluence 3LO applications. No API audience parameter from those native integrations is copied into MCP OAuth.

## Offline interoperability coverage

`src/lib/integrations/mcp-oauth-fourth-wave.test.ts` runs actual SDK discovery, DCR, authorization-code exchange and refresh against intercepted HTTP. Tests bind to production catalog profiles and verify scopes, public client authentication, loopback callback, PKCE, saved state and the resource indicator. Atlassian's path-qualified issuer, static `tools=all` query, query-free resource indicator and offline consent prompt are covered.

DCR and token responses are synthetic. These tests establish local protocol behavior, not organization approval, successful live consent or the tools granted to any particular account.

Validation: both fourth-wave SDK tests and scoped ESLint pass. Native smoke coverage asserts Airtable, Jira, Confluence and Atlassian have no statically registered native adapters.
