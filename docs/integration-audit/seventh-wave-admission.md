# Seventh wave: hosted MCP client admission

Checked 2026-09-29 UTC using primary documentation and anonymous GET-only discovery with the installed MCP SDK. No client registration, consent, account requests, or submissions were made. A published registration endpoint establishes protocol support, not permission for an independent application to use the service.

## Decision

None of Ramp, Figma, Canva, or Vercel currently qualifies for an unrestricted account connector in this application. Their official documentation explicitly requires client or redirect approval. This is an upstream admission requirement, not a missing native-action parity check. No documented personal token or ordinary REST OAuth application route was found that removes that requirement for the official hosted MCP service.

| Service | Official endpoint | Current admission requirement | Decision |
| --- | --- | --- | --- |
| Ramp | `https://mcp.ramp.com/mcp`, demo `https://demo-mcp.ramp.com/mcp` | Custom clients must have their exact redirect URI allowlisted first | Obtain approval before adding account connection |
| Figma | `https://mcp.figma.com/mcp` | Only clients in Figma's MCP Catalog can connect, new clients join a waitlist | Wait for client admission |
| Canva | `https://mcp.canva.com/mcp` | Developer Portal self-service is explicitly not yet available, current access goes through a waitlist | Wait for access or released self-service |
| Vercel | `https://mcp.vercel.com` | Only reviewed and approved AI clients | Obtain client/redirect approval |
| Square, supplemental documentation check | `https://mcp.squareup.com/mcp` | Explicit MCP client allowlist | Obtain client admission |

The decisions follow the [Ramp custom-client instructions](https://docs.ramp.com/developer-api/v1/guides/ramp-mcp-remote), [Figma introduction](https://developers.figma.com/docs/figma-mcp-server/), [Canva quickstart](https://www.canva.dev/docs/apps/quickstart/), [Vercel MCP documentation](https://vercel.com/docs/agent-resources/vercel-mcp), and [Square MCP documentation](https://developer.squareup.com/docs/mcp).

## Ramp

The official guide requires exact redirect URI approval for custom clients and third-party gateways. Its accepted URI formats include HTTPS and loopback URLs, but that does not establish an approval exemption for local clients. Technology partners connecting their customers' accounts have a separate partner integration process. Production and demo use different authorization infrastructure. [Ramp guide](https://docs.ramp.com/developer-api/v1/guides/ramp-mcp-remote), [support instructions](https://support.ramp.com/ramp-mcp/).

Public discovery returned:

| Field | Production | Demo |
| --- | --- | --- |
| Initial anonymous endpoint GET | 401 with resource metadata challenge | 401 with resource metadata challenge |
| Protected resource metadata | `https://mcp.ramp.com/.well-known/oauth-protected-resource/mcp` | `https://demo-mcp.ramp.com/.well-known/oauth-protected-resource/mcp` |
| Authorization metadata | `https://mcp.ramp.com/.well-known/oauth-authorization-server` | `https://demo-mcp.ramp.com/.well-known/oauth-authorization-server` |
| Authorization endpoint | `https://mcp.ramp.com/oauth/authorize?auth_level=auto` | `https://demo-mcp.ramp.com/oauth/authorize?auth_level=auto` |
| Token endpoint | `https://api.ramp.com/developer/v1/token/pkce` | `https://demo-api.ramp.com/developer/v1/token/pkce` |
| Registration endpoint | `https://mcp.ramp.com/register` | `https://demo-mcp.ramp.com/register` |

Both advertise public clients (`none`), authorization code plus refresh grants, and S256 PKCE. Protected-resource metadata supplies the financial read/write scopes. After admission this is compatible with the current public DCR profile in principle. Before enabling it, confirm the approved callbacks cover this application's actual web callback and any desktop callback strategy. A stable approved URI may be required. [Production metadata](https://mcp.ramp.com/.well-known/oauth-authorization-server), [demo metadata](https://demo-mcp.ramp.com/.well-known/oauth-authorization-server).

The separate `https://mcp.ramp.com/developer/mcp` is explicitly an unauthenticated public documentation service. It does not expose the user's Ramp account, so it is not a replacement for the account connector. Its documented tools include a feedback submission operation as well as documentation lookup, which still needs normal mutation policy. This review did not initialize that service. [Ramp Developer MCP](https://docs.ramp.com/developer-api/v1/developer-mcp).

## Figma

The current introduction limits connections to clients in the Figma MCP Catalog and links a new-client waitlist. The remote setup guide describes connecting supported clients, not registering an unrestricted application. Ordinary Figma REST OAuth apps are a different integration surface. Figma's custom MCP connector feature connects outside MCP servers into Figma, so it also does not grant this application's client access to Figma's hosted server. [MCP introduction](https://developers.figma.com/docs/figma-mcp-server/), [remote setup](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/), [REST OAuth apps](https://developers.figma.com/docs/rest-api/oauth-apps/), [Figma acting as an MCP client](https://help.figma.com/hc/en-us/articles/38147204302743-Create-and-use-custom-MCP-connectors-in-the-Figma-agent-and-Figma-Make).

Public discovery succeeded despite an initial endpoint GET returning 405:

- Resource metadata: `https://mcp.figma.com/.well-known/oauth-protected-resource/mcp`.
- Authorization metadata and issuer: `https://api.figma.com/.well-known/oauth-authorization-server`, issuer `https://api.figma.com`.
- Authorization: `https://www.figma.com/oauth/mcp`.
- Token: `https://api.figma.com/v1/oauth/token`.
- Registration: `https://api.figma.com/v1/oauth/mcp/register`.
- Scope: `mcp:connect`. Authorization code and refresh grants, S256 PKCE, and required state are advertised.
- Supported client authentication: `client_secret_basic` and `client_secret_post`. Public `none` is not advertised.

After admission, use the issued or approved client contract with Basic or POST authentication. Do not select the default public DCR profile or reuse another client's identity. [Figma metadata](https://api.figma.com/.well-known/oauth-authorization-server).

## Canva

The quickstart describes a planned self-service Developer Portal flow that supplies an MCP client ID and secret, but explicitly marks self-service enablement as unavailable. The current alternative is a waitlist. Clients using a Client ID Metadata Document (CIMD) without a client secret must have their redirect URI allowlisted. The general access page alone can sound self-service, so the quickstart's availability notice is material. [Quickstart](https://www.canva.dev/docs/apps/quickstart/), [MCP access](https://www.canva.dev/docs/apps/mcp/access/).

Canva's REST Connect API rules for private apps or marketplace verification do not establish access to the remote MCP server. MCP verification instructions themselves require an already registered Canva OAuth MCP client. [Platform announcement](https://www.canva.dev/blog/developers/canva-and-coding-agents-platforms/), [MCP verification](https://www.canva.dev/docs/apps/mcp/verify-app/).

Public discovery returned 401 with a resource metadata challenge:

- Resource metadata: `https://mcp.canva.com/.well-known/oauth-protected-resource/mcp`.
- Authorization metadata: `https://mcp.canva.com/.well-known/oauth-authorization-server`.
- Issuer `https://mcp.canva.com`, authorization `/authorize`, token `/token`, registration `/register`.
- Supported authentication: Basic, POST, and `none`. Authorization code and refresh grants, query response mode, S256 PKCE, and CIMD support are advertised.
- Resource scopes cover profiles, design metadata/content, folders, brand templates, comments, assets, brand kits, and help answers, with read/write permissions where applicable.

A future released registered-client flow would fit our existing secret-backed OAuth implementation. Admission limited to CIMD would additionally need a deliberate client metadata URL contract in our provider. Neither DCR metadata nor CIMD metadata proves open admission today. [Canva metadata](https://mcp.canva.com/.well-known/oauth-authorization-server), [resource scopes](https://mcp.canva.com/.well-known/oauth-protected-resource/mcp).

## Vercel

The official guide restricts the service to reviewed and approved AI clients. Vercel's OAuth explanation describes client allowlisting, and current staff responses show redirect approval being handled through the community. A normal Vercel API token or Vercel Connect app was not documented as a general bypass for the hosted MCP approval requirement. [Vercel MCP](https://vercel.com/docs/agent-resources/vercel-mcp), [OAuth explanation](https://vercel.com/i/mcp-server-oauth-authorization), [client admission example](https://community.vercel.com/t/request-allowlist-myclaw-for-vercel-mcp-mcp-vercel-com-oauth/49351).

Public discovery returned 401:

- Resource metadata: `https://mcp.vercel.com/.well-known/oauth-protected-resource`. Resource identifier is `https://mcp.vercel.com/` and resource scope is `openid`.
- Authorization metadata: `https://vercel.com/.well-known/oauth-authorization-server`, issuer `https://vercel.com`.
- Authorization: `https://vercel.com/oauth/authorize`.
- Token: `https://api.vercel.com/login/oauth/token`.
- Registration: `https://api.vercel.com/login/oauth/register`.
- S256 PKCE and authorization code plus refresh grants are advertised, alongside additional grant types. Supported client authentication includes Basic, POST, and JWT methods, but not `none`.
- The only advertised response mode is `web_message.opener`. Our standard callback consumes query code/state, so the approved client onboarding contract must establish whether ordinary redirects are supported for that client or whether a different callback transport is required.

This is a qualification issue to resolve with approval, not evidence that every approved MCP client is broken. Do not add Vercel using public DCR defaults merely because registration metadata exists. [Vercel authorization metadata](https://vercel.com/.well-known/oauth-authorization-server), [resource metadata](https://mcp.vercel.com/.well-known/oauth-protected-resource).

## Square supplemental check

The official remote server is `https://mcp.squareup.com/mcp`. Square explicitly maintains a client allowlist and directs new clients to its developer forum. The official local server supports a user's own access token and sandbox configuration, but that is a separate local transport path, not proof that the hosted endpoint accepts arbitrary clients or those tokens. No Square metadata or account requests were made in this review. [Square MCP guide](https://developer.squareup.com/docs/mcp).

## Release consequence

Keep these account connectors out of the available-to-connect catalog until the specific client has admission or the vendor releases a documented unrestricted flow. Keep their endpoint and profile evidence for that follow-up. No registration fixture can prove vendor admission, so this review adds no synthetic success test that would imply it.
