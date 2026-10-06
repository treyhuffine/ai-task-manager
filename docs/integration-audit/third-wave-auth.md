# GitLab and Stripe hosted OAuth verification

Verified 2026-09-28. Public discovery used the installed MCP SDK's `discoverOAuthServerInfo` with a fetch wrapper restricted to GET. Both metadata requests for each provider returned 200. An unauthenticated GET to each MCP endpoint returned 401 with an OAuth discovery challenge. No remote registration, authorization, token exchange, account access, or tool execution was performed.

Both providers fit the existing hosted OAuth path. Their native adapters and tests are retired, without action aliases, following the user's decision to use vendor tool surfaces directly. Existing saved connections must reconnect through the hosted service. The GitLab built-in remains GitLab.com only, matching the retired adapter's actual support.

| Provider | MCP URL | Trusted OAuth profile | Mutation floor |
| --- | --- | --- | --- |
| GitLab | `https://gitlab.com/api/v4/mcp` | Public `none`, `authorization_code`, S256 | High |
| Stripe | `https://mcp.stripe.com` | Public `none`, `authorization_code` and `refresh_token`, S256 | High |

## GitLab

Public metadata observed:

- [Protected resource](https://gitlab.com/.well-known/oauth-protected-resource/api/v4/mcp): resource `https://gitlab.com/api/v4/mcp`, authorization server `https://gitlab.com`, supported scope `mcp`.
- [Authorization server](https://gitlab.com/.well-known/oauth-authorization-server): authorize `/oauth/authorize`, token `/oauth/token`, registration `/oauth/register`, S256, authorization-code and refresh grants. It advertises `client_secret_basic` and `client_secret_post`, but omits `none`.
- The unauthenticated transport challenge also declares `scope="mcp"` and the protected-resource metadata URL above.

The metadata mismatch does **not** require a confidential client. GitLab's [official DCR controller](https://gitlab.com/gitlab-org/gitlab/-/raw/master/app/controllers/oauth/dynamic_registrations_controller.rb) creates a non-confidential dynamic application. Its response has `token_endpoint_auth_method: "none"`, `grant_types: ["authorization_code"]`, `require_pkce: true`, and no client secret. It limits registrations to an MCP scope and defaults to `mcp`. The catalog explicitly requests this public, code-only profile. The SDK selects secretless authentication when the registered client has no secret, even though the general authorization metadata omits `none`.

The SDK obtains `mcp` from resource discovery rather than requesting the authorization server's broader API scopes. Optional refresh handling is compatible if a token response includes a refresh token. Public verification did not establish whether every GitLab dynamic session receives one.

[GitLab's client documentation](https://docs.gitlab.com/user/model_context_protocol/mcp_server/) explicitly supports generic HTTP MCP clients and automatic registration. GitLab.com requires MCP access to be allowed for the top-level group. Self-managed and Dedicated instances have separate instance controls, and administrators can disable DCR. DCR has a documented per-IP registration limit. No additional headers are required for the default toolsets. This built-in does not imply self-managed instance selection.

High mutation risk is appropriate because the [published tools](https://docs.gitlab.com/user/model_context_protocol/mcp_server_tools/) include repository commits, merge-request changes and CI operations. Read-only annotations still identify reads.

## Stripe

Public metadata observed:

- [Protected resource](https://mcp.stripe.com/.well-known/oauth-protected-resource): resource `https://mcp.stripe.com`, authorization server `https://access.stripe.com/mcp`, no `scopes_supported` field.
- [Authorization server](https://access.stripe.com/.well-known/oauth-authorization-server/mcp): issuer `https://access.stripe.com/mcp`, endpoints `/mcp/oauth2/authorize`, `/mcp/oauth2/token`, `/mcp/oauth2/register`, public `none`, S256, code and refresh grants, supported scope `mcp`.
- The unauthenticated transport challenge supplies resource metadata without a scope.

The SDK discovers the authorization server's path-qualified metadata correctly. With no resource or challenge scope, it leaves scope omitted during registration and authorization. This matches Stripe's URL-only generic-client setup instructions. Acceptance of that omitted scope is inferred from those instructions, not a live consent test. No custom scope or header is added.

[Stripe's official MCP documentation](https://docs.stripe.com/mcp) recommends OAuth for interactive generic clients. Consent selects live accounts or sandboxes and their permissions. Administrators can disable access per environment. OAuth does not support acting as a Stripe Connect connected account through a `Stripe-Account` header. That is a separate API-key workflow, outside this built-in profile. Broad API-write tools include financial changes, so mutation risk defaults to high. Provider-side confirmation required by some sensitive operations remains additional to local approval.

## Offline verification

`src/lib/integrations/mcp-oauth-third-wave.test.ts` runs the actual installed SDK against intercepted responses, tied to the production catalog profiles. It covers discovery paths, DCR metadata, PKCE challenge/verifier correspondence, callback code exchange, persisted state, and optional refresh. Both token exchanges assert `client_id` is present and neither a client secret nor Basic authorization is sent.

The GitLab fixture reproduces the official controller's public response against secret-only authorization metadata. The Stripe fixture preserves the missing resource scope. Synthetic DCR/token responses prove client interoperability and local state handling, not service-side consent or account eligibility.

Validation: both third-wave SDK tests pass, all 396 connector-engine tests pass, package typecheck and scoped ESLint pass. Native smoke coverage asserts GitLab and Stripe are no longer statically registered.
