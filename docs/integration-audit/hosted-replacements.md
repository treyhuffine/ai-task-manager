# Hosted connector replacements

Verified on 2026-09-28. This is a follow-up to the historical connector audit, whose inventory and recommendations describe the earlier implementation.

The user explicitly chose to replace Linear, Notion, Calendly, and Resend with their official hosted MCP services. They do not use these native connectors and waived backward compatibility. Their native adapters and action aliases are therefore retired, without a tool-by-tool parity requirement. Existing credentials do not substitute for consent to the hosted MCP service. The canonical provider IDs remain stable.

## Verification boundary

The installed MCP SDK's `discoverOAuthServerInfo` was run against each endpoint with a fetch wrapper that permits only GET. These requests read public protected-resource and authorization-server metadata. No remote client registration, sign-in, token exchange, or account tool call occurred.

The [offline SDK fixtures](../../src/lib/integrations/mcp-oauth-discovery.test.ts) exercise the real SDK and our OAuth provider against intercepted responses. They verify dynamic registration metadata, scopes, resource selection, PKCE, and persisted callback state. Live consent, account permissions, and remote tool behavior still require the user's eventual connection.

## Replacement profiles

All four advertise dynamic client registration, the authorization-code flow, S256 PKCE, and public-client token authentication (`none`). None requires an additional product-specific HTTP header for the documented OAuth connection.

| Provider | Official Streamable HTTP endpoint | Protected-resource scopes | Authorization server | Default write classification |
| --- | --- | --- | --- | --- |
| Linear | `https://mcp.linear.app/mcp` | `read write` | `https://mcp.linear.app` | Trusted annotations, conservative fallback |
| Notion | `https://mcp.notion.com/mcp` | `default` | `https://mcp.notion.com` | Trusted annotations, conservative fallback |
| Calendly | `https://mcp.calendly.com` | `mcp:scheduling:read mcp:scheduling:write` | `https://calendly.com/` | High for mutations |
| Resend | `https://mcp.resend.com/mcp` | Omitted | `https://api.resend.com` | High for mutations |

Linear's official documentation identifies `/mcp` as the read/write endpoint and supports dynamic registration. The separate `/mcp/readonly` endpoint is intentionally not selected for this full connector. Public discovery returned HTTP 200 for [resource metadata](https://mcp.linear.app/.well-known/oauth-protected-resource/mcp) and [authorization metadata](https://mcp.linear.app/.well-known/oauth-authorization-server), with registration at `https://mcp.linear.app/register`. [Official setup](https://linear.app/docs/mcp).

Notion returned HTTP 200 for [resource metadata](https://mcp.notion.com/.well-known/oauth-protected-resource/mcp) and [authorization metadata](https://mcp.notion.com/.well-known/oauth-authorization-server), with registration at `https://mcp.notion.com/register`. Its custom-client guide documents PKCE, dynamic registration, refresh, and Streamable HTTP. Tool availability can depend on workspace permissions and plan, so runtime discovery remains authoritative. The SDK handles MCP session headers. [Official custom-client guide](https://developers.notion.com/guides/mcp/build-mcp-client).

Calendly returned HTTP 200 for [resource metadata](https://mcp.calendly.com/.well-known/oauth-protected-resource) and [authorization metadata](https://calendly.com/.well-known/oauth-authorization-server), with registration at `https://calendly.com/oauth/register`. It requires both scheduling scopes for full access. The current SDK selects scopes from protected-resource metadata and sends them in registration and authorization, so provider-specific scope plumbing is unnecessary. Our `none`, code, and refresh client metadata matches the documented format. Calendly documents HTTPS production callbacks and says loopback acceptance can depend on environment policy, which this GET-only check does not verify. Booking and cancellation justify the high mutation risk floor. [Official integration guide](https://developer.calendly.com/docs/mcp/calendly-mcp-server).

Resend's path-specific resource metadata returned 404. The SDK correctly fell back to the [root resource metadata](https://mcp.resend.com/.well-known/oauth-protected-resource), which returned 200, then fetched [authorization metadata](https://api.resend.com/.well-known/oauth-authorization-server), also 200. Registration is `https://api.resend.com/oauth/register`. Resource metadata omits scopes. Resend documents that omitted registration scopes select all supported scopes and omitted authorization scopes use the registered set. This supports the full connector without custom scope configuration. Sending, broadcasts, API keys, and other administration tools justify a high mutation risk floor. [Official MCP setup](https://resend.com/docs/mcp-server), [registration defaults](https://resend.com/docs/api-reference/oauth/register), [authorization defaults](https://resend.com/docs/api-reference/oauth/authorize).

High mutation risk does not turn read-only tools into writes. Trusted `readOnlyHint` tools retain their read classification. Explicit local tool overrides remain the user's policy choice.

## Next-wave public discovery

The same GET-only SDK check also reached these official endpoints. These rows record authentication evidence, not completed account validation.

| Provider | Endpoint | Public discovery result | Integration consideration |
| --- | --- | --- | --- |
| Firecrawl | `https://mcp.firecrawl.dev/v2/mcp-oauth` | Resource and authorization metadata both 200, DCR, S256, public `none` | Resource scope `firecrawl:global`. OAuth endpoint needs no API key or extra headers. |
| Fireflies | `https://api.fireflies.ai/mcp` | Resource and authorization metadata both 200, DCR, S256, `none` supported | Resource scopes `profile email`. These scope names should not be treated as proof that all tools are read-only. |
| Make | `https://mcp.make.com` | Resource and authorization metadata both 200, DCR, S256 | Authorization server advertises only `client_secret_post`. Uses the trusted client-authentication profile described below. |
| Supabase | `https://mcp.supabase.com/mcp` | Resource and authorization metadata both 200, DCR, S256 | Advertises `client_secret_basic` and `client_secret_post`. Uses the trusted secret-post profile. |

Firecrawl resource metadata is at `https://mcp.firecrawl.dev/.well-known/oauth-protected-resource/v2/mcp-oauth`, with issuer `https://www.firecrawl.dev` and registration `https://www.firecrawl.dev/api/oauth/register`. Its authorization server additionally advertises `offline_access`, but protected-resource metadata requests only `firecrawl:global`. No extra refresh scope is inferred from this alone. [Official setup](https://docs.firecrawl.dev/mcp-server), [authorization metadata](https://www.firecrawl.dev/.well-known/oauth-authorization-server).

Fireflies resource metadata is at `https://api.fireflies.ai/.well-known/oauth-protected-resource/mcp`, with issuer `https://api.fireflies.ai/` and registration `https://api.fireflies.ai/register`. The public profile also advertises `client_secret_post`, but accepts `none`. [Official setup](https://guide.fireflies.ai/articles/3039542843-learn-about-fireflies-mcp-server-connect-your-ai-tool), [authorization metadata](https://api.fireflies.ai/.well-known/oauth-authorization-server).

Make resource metadata is at `https://mcp.make.com/.well-known/oauth-protected-resource`. The SDK handles its path-bearing issuer `https://www.make.com/mcp` by requesting `https://www.make.com/.well-known/oauth-authorization-server/mcp`. Registration is `https://www.make.com/oauth/v2/register/mcp`. The consent screen chooses the organization and scopes. Scenario execution can operate across connected apps, so a high mutation risk floor is appropriate. [Official OAuth setup](https://developers.make.com/mcp-server/connect-using-oauth), [authorization metadata](https://www.make.com/.well-known/oauth-authorization-server/mcp).

Supabase's public metadata was captured in the separate [second-wave discovery record](second-wave-discovery.json). The [resource metadata](https://mcp.supabase.com/.well-known/oauth-protected-resource/mcp) points to issuer `https://api.supabase.com`. [Authorization metadata](https://api.supabase.com/.well-known/oauth-authorization-server) specifies registration at `https://api.supabase.com/platform/oauth/apps/register`, authorization at `/v1/oauth/authorize`, and token exchange at `/v1/oauth/token`. Resource scopes cover organization, project, database, analytics, secret, edge-function, environment, and storage operations. Its wide administrative surface warrants a high mutation risk floor.

## Confidential dynamic clients

The trusted hosted catalog can select `tokenEndpointAuthMethod: 'client_secret_post'` for Make and Supabase. Other providers continue to use the public-client default. The host reads this profile only from a catalog entry whose provider ID, endpoint, and authentication kind match the saved server. Remote tool metadata cannot select the profile.

The [confidential OAuth regression](../../src/lib/integrations/mcp-oauth-confidential.test.ts) uses the actual SDK with intercepted registration and token responses, plus the real AES-GCM file store. It verifies registration requests `client_secret_post`, callback and refresh requests carry the dynamically issued secret in the POST body, and the SDK honors this choice even when Basic authentication is also advertised. The secret is absent from the consent URL, public metadata, and plaintext file contents, and is registered for redaction. These tests register no client with a real service.
