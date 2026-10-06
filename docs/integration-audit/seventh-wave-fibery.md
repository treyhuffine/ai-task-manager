# Fibery hosted MCP qualification

Checked September 28, 2026 in America/Denver, September 29 UTC. Use the official endpoint `https://mcp.fibery.io/mcp` with discovered public-client OAuth.

The [official guide](https://the.fibery.io/@public/User_Guide/Guide/Fibery-MCP-Server-401) explicitly supports MCP clients and describes database queries, documents, entity management and schema changes. The [installation guide](https://the.fibery.io/@public/User_Guide/Guide/Fibery-MCP-Server-Installation-485) supplies generic client configurations and browser authorization. The vendor's [older local server repository](https://github.com/Fibery-inc/fibery-mcp-server) is deprecated in favor of this remote endpoint.

## Public protocol evidence

The [GET-only capture](seventh-wave-discovery.json) records successful SDK discovery:

| Field | Value |
| --- | --- |
| Resource | `https://mcp.fibery.io/mcp` |
| Resource metadata | `https://mcp.fibery.io/.well-known/oauth-protected-resource/mcp` |
| Issuer | `https://mcp.fibery.io/` |
| Authorization, token and registration | `/authorize`, `/token`, `/register` on the issuer |
| Supported client authentication | `client_secret_post`, `none` |
| Selected client authentication | `none` |
| Grants | `authorization_code`, `refresh_token` |
| PKCE | S256 |
| Discovered scopes | `openid offline` |

An anonymous endpoint GET returned 405, while an anonymous MCP initialization POST returned 401 with the path-specific resource metadata challenge above. The ordinary transport OAuth path therefore works without preauthorization or fixed application credentials. No live dynamic client registration or consent was performed.

## Account setup and permissions

The vendor sign-in page asks for the workspace name. Each app connection stores its own OAuth state and credentials, so additional Fibery workspaces use additional labeled accounts without changing the endpoint. The [vendor FAQ](https://the.fibery.io/@public/User_Guide/Guide/Fibery-MCP-Server-FAQ-531) confirms multiple-workspace use and notes that workspace permissions and IP restrictions still apply. Its URL uniqueness workaround for another client's UI is unnecessary in this app's multi-account model.

The catalog has a high mutation-risk floor because tools can modify database schemas, entities and documents. Read annotations and the existing approval policy govern execution. Tools are discovered, with no native wrappers, aliases or deterministic task-picker changes.

## Validation and limits

[Real-SDK fixtures](../../src/lib/integrations/mcp-oauth-fibery.test.ts) use captured metadata and intercepted registration/token responses for web and desktop callbacks. They verify public DCR, `openid offline`, PKCE, resource binding, the trailing-slash issuer, saved callback reuse and refresh. Shared host tests cover setup, account handling and write policy.

No Fibery account or workspace was connected and no business tools were called. Fixture success verifies local protocol behavior, not a particular account's eligibility or live workflows.
