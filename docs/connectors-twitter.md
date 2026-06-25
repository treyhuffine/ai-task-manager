# X (Twitter) connector

A first-party connector covering the full X API v2 surface, modeled after X's official MCP server
([`xdevplatform/xmcp`](https://github.com/xdevplatform/xmcp)) but built natively on our connectors
engine. Same breadth, no Python sidecar, native OAuth2 with automatic token refresh, and it plugs
into workspace scoping + account pinning like every other connector.

## How it works (spec-driven, like XMCP)

XMCP loads X's OpenAPI spec at runtime and turns every operation into a tool. We do the same, but
distill the spec at build time into committed, reviewable descriptors:

1. **Generator** `scripts/gen-twitter-toolkit.mjs` reads the vendored X OpenAPI spec
   (`packages/connectors/src/providers/twitter/vendor/x-openapi.json`, fetched from
   `https://api.x.com/2/openapi.json`) and emits `operations.generated.ts` — one compact descriptor
   per operation (`id`, `method`, `path`, `description`, `scopes`, `mutating`, `risk`, `pathParams`,
   `bodyParams`, `inputSchema`). It applies the same exclusions XMCP does (Stream + Webhooks tags,
   `/stream` + `/webhooks` paths, `x-twitter-streaming`).
2. **Toolkit builder** `twitter/toolkit.ts` turns each descriptor into an engine `httpAction`,
   reusing the engine's JSON-Schema to Zod converter (shared with MCP ingest) for input schemas. The
   request builder fills `{path}` placeholders, assembles the JSON body from body params, and routes
   the rest to the query string (comma-joining array params, since X uses `explode:false` for
   `*.fields` / `expansions`).
3. **Provider** `twitter/provider.ts` is an OAuth2 user-context provider. Our engine then serves the
   actions as MCP tools (for the orchestrator + scoped executions) and as AI SDK tools automatically.

Result: ~134 generated actions (e.g. `twitter.search_posts_recent`, `twitter.create_posts`,
`twitter.get_users_timeline`, `twitter.like_post`, `twitter.get_users_followers`) plus one
hand-written helper, `twitter.upload_media` (see below). Tool ids derive from the OpenAPI
`operationId` (`createPosts` to `twitter.create_posts`).

## Deliberate divergence from XMCP: OAuth2, not OAuth1

XMCP signs requests with OAuth1.0a. We use the spec's **OAuth2 user-context** scheme instead, because
the engine does OAuth2 + automatic refresh natively and it covers every v2 endpoint. X confidential
clients authenticate to the token endpoint with HTTP Basic and use PKCE. `offline.access` is an
always-requested identity scope, which is what makes X issue a refresh token (access tokens otherwise
expire in about 2 hours with nothing to refresh).

## Setup

1. Create an app in the [X Developer Portal](https://developer.x.com), enable OAuth 2.0, set it to a
   **confidential client** (Web App / Automated App), and register the callback URL
   `http://localhost:4224/api/connectors/callback` (or your deployed equivalent).
2. Provide the client credentials via env (the engine package is `process.env`-free, so the host
   reads these):
   - `CONNECTORS_TWITTER_CLIENT_ID`
   - `CONNECTORS_TWITTER_CLIENT_SECRET`
   - `CONNECTORS_TWITTER_REDIRECT_URI` (optional; defaults to the shared connector callback)
3. Connect from Settings to Connectors. The consent screen requests the union of the toolkit's
   scopes plus `offline.access`. Done.

X requires a paid API tier for most read/search endpoints. Confirm your tier covers the operations
you intend to use.

## Trimming the toolkit (XMCP parity)

The full surface is ~134 tools. We match all three of XMCP's filter env vars (comma-separated):

- `CONNECTORS_TWITTER_TOOL_ALLOWLIST=createPosts,searchPostsRecent` (XMCP `X_API_TOOL_ALLOWLIST`) — operationIds or action ids.
- `CONNECTORS_TWITTER_TOOL_DENYLIST=createComplianceJobs` (XMCP `X_API_TOOL_DENYLIST`).
- `CONNECTORS_TWITTER_TOOL_TAGS=Tweets,Users,Bookmarks` (XMCP `X_API_TOOL_TAGS`) — keep only ops carrying one of these OpenAPI tags.

The denylist is applied after the allowlist. Per-workspace scoping still applies on top (X is one
service/toolkit, scoped as a unit).

## Regenerating when X updates the API

```
node scripts/gen-twitter-toolkit.mjs           # regenerate from the vendored spec
node scripts/gen-twitter-toolkit.mjs --fetch    # re-vendor from api.x.com first, then regenerate
```

Commit the updated `vendor/x-openapi.json` and `operations.generated.ts`. The generator prints
include/exclude counts and the scope union.

## Media upload: `twitter.upload_media`

Posting media is a multi-step flow on X (initialize, append chunks, finalize), and the binary append
step is awkward for a generic JSON tool. We close that with a single hand-written action,
`twitter.upload_media`, which:

- takes `media` (base64-encoded file bytes) + `media_type` (+ optional `media_category`,
  `additional_owners`),
- runs `initialize` to `append` to `finalize`, chunking the bytes at 4 MiB per segment and sending
  each segment as base64 in an `application/json` body (X's append endpoint accepts JSON, so no
  multipart/binary body is needed), and
- returns the finalize payload whose `id` you pass to `create_posts` as `media.media_ids`.

For video, X may still be processing when finalize returns; poll `twitter.get_media_upload_status`.
The raw generated primitives (`initialize_media_upload`, `append_media_upload`, `finalize_media_upload`,
`media_upload`) remain available for advanced use, but `upload_media` is the blessed one-call path —
it does what XMCP's generic generated tool cannot.

## Parity with XMCP (verified 1:1)

`scripts/compare-xmcp.mjs` replicates XMCP's exact spec filter (`should_exclude_operation` in
`examples/xmcp/server.py`) against the same vendored spec and diffs the result against our generated
manifest. Current result: **134 = 134 operations, 0 missing, 0 extra**.

- **Operation coverage**: identical. Same exclusions (Stream + Webhooks tags, `/stream` + `/webhooks`
  paths, `x-twitter-streaming`), case-insensitive tag match like XMCP.
- **Filter surface**: identical (allowlist + denylist + tags).
- **Tool naming**: XMCP names tools by `operationId` (`createPosts`); ours are
  `twitter.<snake_case(operationId)>` (`twitter.create_posts`). Same operations, namespaced ids.

Deliberate divergences (all improvements, not gaps):

- **Auth**: OAuth2 user-context + automatic refresh, vs XMCP's OAuth1.0a (see above). No sidecar.
- **Array query params**: for X's bulk-lookup params the spec leaves `explode` unset
  (`ids`, `tweet_ids`, `user_ids`, `requested_metrics`), XMCP sends them repeated while we comma-join
  them — comma is X's documented format for these, so ours is the correct wire shape. The
  `explode:false` params (`*.fields`, `expansions`) are comma-joined by both.
- **`twitter.upload_media`**: a helper XMCP has no equivalent for (its generic generated append tool
  can't do binary upload).

Re-confirm after an X API update: `node scripts/gen-twitter-toolkit.mjs --fetch && node scripts/compare-xmcp.mjs`.

## Files

```
packages/connectors/src/providers/twitter/
  provider.ts               OAuth2 provider + identify (/2/users/me)
  toolkit.ts                runtime builder: descriptors -> httpActions (+ allow/deny)
  index.ts                  registerTwitter, exports
  operations.generated.ts   AUTO-GENERATED operation descriptors (committed)
  vendor/x-openapi.json     vendored X API v2 OpenAPI spec (committed)
scripts/gen-twitter-toolkit.mjs   the generator
scripts/compare-xmcp.mjs          1:1 parity check vs examples/xmcp
packages/connectors/src/__tests__/twitter.test.ts   tests
src/lib/connectors/live-checks.ts                   read-only live checks for the test page
```

The connectors test page (`/connectors-test`) is registry-driven, so X appears automatically:
connect (or bring your own X app under Advanced), then a one-click **Live checks** button runs the
read-only verifications in `live-checks.ts` against the real account.

Registered in `packages/connectors/src/providers/index.ts` (catalog + `registerAllProviders`); the
host wires the env allow/deny lists in `src/lib/connectors/runtime.ts`. The X logo is generated into
`src/components/connectors/connector-icon-data.ts` via `scripts/gen-connector-icons.mjs`.
