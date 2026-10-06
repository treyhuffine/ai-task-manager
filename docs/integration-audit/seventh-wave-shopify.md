# Shopify merchant integration qualification

Reviewed 2026-09-28. Public discovery only. No store account was connected, no client was registered, and no authenticated merchant operation ran.

## Decision

Shopify now has a real hosted merchant Admin MCP at `https://setup.shopify.com/mcp`, the endpoint recorded in the [Claude marketplace snapshot](directory-facts.json). The previous assumption that Shopify offered only developer and shopping MCP servers is outdated.

Prefer this hosted service if Shopify supplies a client registration for our application. **Custom-client enrollment is not established**, so the endpoint must not be advertised as a ready, self-service connection yet. Its OAuth server has no advertised dynamic registration endpoint. Shopify's public [AI authorization guide](https://help.shopify.com/en/manual/ai-powered-tools/connecting-ai-tools/authorizing-access) explains approved integrations for ChatGPT, Claude and Perplexity, and the local CLI connector, without documenting how another hosted client enrolls. An ordinary Admin API app is not established as an accepted client for this separate OAuth issuer.

## What the hosted service actually exposes

Anonymous JSON-RPC `initialize` and `tools/list` both returned HTTP 200. The initialization response identifies `shopify-mcp-server` and describes merchant store management, including general Admin GraphQL access. The tool list contained 30 tools on the review date:

| Capability | Observed tool names |
| --- | --- |
| Store context | `get-shop-info`, `switch-shop` |
| Products | `search_products`, `get-product`, `create-product`, `update-product`, `bulk-update-product-status` |
| Collections | `search_collections`, `get-collection`, `create-collection`, `update-collection`, `add-to-collection` |
| Orders and customers | `list-orders`, `get-order`, `list-customers` |
| Inventory | `get-inventory-levels`, `set-inventory` |
| Promotions and analytics | `create-discount`, `run-analytics-query` |
| General Admin API | `graphql_schema`, `graphql_query`, `graphql_mutation`, `validate_graphql_codeblocks` |
| Documentation | `search_docs_chunks` |
| Store setup and samples | `find-mock-shop-catalogs`, `import-mock-shop-catalog`, `get-storefront-generation`, `claim-storefront-preview`, `generate-domain-names`, `generate-business-names` |

The same general capabilities are documented in Shopify's [Claude connector guide](https://help.shopify.com/en/manual/ai-powered-tools/connecting-ai-tools/shopify-connector-for-claude). Its merchant connection is materially different from buyer-facing shopping. The guide also documents blocked financial and store administration operations, including refunds, paid-order changes, gift-card adjustments, live-theme changes and core store settings. Treat those as vendor restrictions, not missing native tools to circumvent.

## Observed OAuth contract

| Field | Public value |
| --- | --- |
| MCP transport | Streamable HTTP, `https://setup.shopify.com/mcp` |
| Protected resource metadata | `https://setup.shopify.com/.well-known/oauth-protected-resource` |
| Resource | `https://setup.shopify.com/mcp` |
| Issuer | `https://setup.shopify.com/auth` |
| Authorization metadata | `https://setup.shopify.com/.well-known/oauth-authorization-server/auth` |
| Authorization endpoint | `https://setup.shopify.com/oauth/authorize` |
| Token endpoint | `https://setup.shopify.com/oauth/token` |
| Advertised grants | `authorization_code` only |
| Client authentication | `none` |
| PKCE | `S256` |
| Dynamic registration | No `registration_endpoint` in metadata |
| Client metadata documents | No advertised support |

Both linked [resource metadata](https://setup.shopify.com/.well-known/oauth-protected-resource) and [authorization metadata](https://setup.shopify.com/.well-known/oauth-authorization-server/auth) returned HTTP 200. The path-specific resource URL ending in `/mcp` returned 404, so SDK fallback to the root metadata matters.

An anonymous call to the read-only `get-shop-info` tool returned HTTP 401, no store data, and a standard `WWW-Authenticate` Bearer challenge pointing to the resource metadata. This is transport-level OAuth, not an HTTP-200 tool error that only carries an MCP `_meta` challenge. No account, token or shop identifier was supplied to that probe.

The discovery documents advertise 35 scopes covering reports and broad merchant writes. Individual tools also describe their required OAuth scopes in `securitySchemes`. Do not invent a static scope set or assume that absent refresh support means issued credentials last indefinitely. A registered-client SDK fixture could verify the supported authorization-code flow once the enrollment route is established, but synthetic success would not establish vendor admission.

## Host implementation implications

The existing registered-client flow fits this profile with `tokenEndpointAuthMethod: 'none'`, `grantTypes: ['authorization_code']`, and `authorizeBeforeConnect: true`. Authorization must start before relying on successful initialization or tool discovery because both are public. A high mutation risk floor is appropriate for the general GraphQL mutation surface.

Two integration details need explicit treatment before release:

1. `get-storefront-generation` and `claim-storefront-preview` advertise `_meta.ui.visibility: ['app']`. They are widget helpers, and must not appear as ordinary model tools. The current MCP tool projection does not preserve this metadata.
2. Shopify's [access guide](https://help.shopify.com/en/manual/ai-powered-tools/connecting-ai-tools/authorizing-access) describes one connected store at a time for its approved integrations. The server's `switch-shop` tool revokes the current token to request another store. Independent host account rows do not prove simultaneous vendor-side store access. Verify this during account testing before claiming multiple-store support.

The server also offers interactive widgets. Its structured merchant data is useful without reproducing those widgets, but the application should not promise the same visual experience as Claude.

## Other Shopify surfaces are separate products

- [Storefront Catalog MCP](https://shopify.dev/docs/agents/catalog/storefront-catalog) helps buyers discover products from a merchant. It is not merchant Admin access.
- [Order MCP](https://shopify.dev/docs/agents/orders/order-mcp) reads orders originated by that shopping agent, not arbitrary store orders or cross-channel history.
- [Shopify AI Toolkit](https://shopify.dev/docs/apps/build/ai-toolkit) includes a local developer MCP and authenticated store workflows through Shopify CLI. This is a vendor-maintained route for local coding agents, but is not a drop-in hosted connection in this marketplace.

## Native fallback, if merchant demand warrants it

A native connector remains technically implementable through the [GraphQL Admin API](https://shopify.dev/docs/api/admin-graphql/latest). Pin the current stable API version, `2026-07`, and send requests to `https://{shop}.myshopify.com/admin/api/2026-07/graphql.json` with `X-Shopify-Access-Token`. Restrict the shop input to validated Shopify shop names rather than accepting arbitrary request hosts.

For an own-store integration, use Shopify's [client credentials grant](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant). The app must be installed and belong to the same organization as the store. Store the client ID and secret securely, acquire the 24-hour access token programmatically, and renew it before expiration. A merchant owning a store is not enough if the app and store belong to different organizations. Pasting an expiring token is not a complete authentication implementation.

For stores outside that organization, use [standalone-app authorization code OAuth](https://shopify.dev/docs/apps/build/authentication-authorization/authenticate-standalone-apps). [Custom distribution](https://shopify.dev/docs/apps/launch/distribution) supports a single store or qualifying Plus organization without App Store review. A publicly distributed application requires Shopify approval. Existing admin-created permanent-token apps still work, but that old app type cannot be created anew.

The practical first native scope would be products, collections, recent orders, inventory and customers, with explicit typed actions and paginated output. Add product edits, collection membership, tags and inventory changes only with their corresponding write scopes and approval policies. Customer and order fields must account for [protected customer data](https://shopify.dev/docs/apps/launch/protected-customer-data), including redacted fields and GraphQL errors carried in HTTP-200 responses. Public customer-data access can require additional review. Do not interpret a partial response as complete data.

Existing native provider patterns help but do not remove this work: Zendesk demonstrates per-account host rewriting and sealed custom credentials, while the direct-auth strategies explicitly have no refresh seam. A proper Shopify implementation must therefore add or use a renewable OAuth credential path instead of copying a permanent-token provider.

## Next concrete step

Ask Shopify for a supported registration process for this application's client and callback against the hosted merchant issuer. With that confirmed, use the hosted integration and test the actual consent, tool invocation and store-switch behavior. If the hosted service is restricted to approved partners and a user needs store administration sooner, build the native OAuth integration against the same documented Admin API. The investigation does not justify presenting a storefront MCP as a replacement for merchant access.
