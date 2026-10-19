# Detecting how a custom MCP server authenticates

When someone adds a custom MCP server (Settings, Plugins, MCP servers, Add MCP
server, or Add custom MCP in Apps), Ri works out how the server authenticates
from its URL, so the person doesn't have to choose. A quiet control covers the
exceptions. Official catalog services (`packages/integrations/src/providers/hosted-mcp.ts`)
keep their configured auth and never come through this path.

## What the person sees

The form asks for a name and a URL. Nothing about auth shows until a URL is
typed. A moment after typing stops, the form says it is checking, then shows
one verdict in place of the auth picker:

| The server | Verdict | Preselected |
| --- | --- | --- |
| Answers `initialize` normally | No sign-in needed | None |
| 401 or 403 with OAuth metadata | Sign in with your browser, with a note on registration | OAuth |
| 401 or 403 with no OAuth metadata | Needs an API key or token | Bearer token, or a custom header the refusal named |
| Unreachable, redirects elsewhere, not MCP, or erroring | Says so plainly | The full picker stays open |

The OAuth note says whether the authorization server registers clients
dynamically (RFC 7591, what Ri does during sign-in), accepts client ID metadata
documents (which Ri doesn't offer for custom servers yet), or needs a client
registered by hand (which a custom server can't supply, so the note points at
an API key if the server also takes one). It also says when the server doesn't
offer PKCE S256, which Ri requires.

Two quiet controls: **Change** opens the ordinary picker with every method, and
on an OAuth verdict **Use an API key instead** switches to a bearer token in one
click. DataForSEO is the known case: it offers OAuth and also takes an API key.
A choice made by hand belongs to that address. Editing the URL starts over with
a fresh verdict. The form submits the detected method unless the person chose,
and the add itself still validates by connecting, as before.

## How the probe works

`detectMcpAuth` in `src/lib/integrations/mcp-auth-detect.ts`, reached through the
`integrations.mcpServersDetectAuth` procedure (`src/lib/server/operations/integrations/mcp-servers/detect-auth.ts`)
and the `useMcpAuthDetection` hook. The address passes the same rule as a saved
server (`validateMcpUrl`: https, or http for loopback only) before anything is sent.

1. One unauthenticated MCP `initialize` (POST, JSON, accepting JSON or SSE),
   with `redirect: 'manual'`. A redirect on the same origin is followed, up to
   three hops. A redirect to another origin, or to an address the rule refuses,
   stops with a message naming where it points.
2. A 2xx answer is read up to 64 KB, or to the first SSE event carrying data. A
   JSON-RPC result with a `protocolVersion` is the None verdict, with the
   server's title or name. If the server opened a session (`Mcp-Session-Id`),
   a best-effort DELETE lets it go. Anything else is "not an MCP server here".
3. A 401 or 403 runs OAuth discovery through the MCP SDK's own helpers, the
   same path sign-in takes later: `extractWWWAuthenticateParams` reads the
   challenge, `discoverOAuthProtectedResourceMetadata` reads RFC 9728 metadata
   (the challenge's URL, then the path-aware and root well-known paths), and
   `discoverAuthorizationServerMetadata` reads RFC 8414 or OpenID discovery
   from the first authorization server, falling back to the MCP server's own
   origin as the legacy spec did. Metadata documents are read with GET only,
   from addresses that pass the URL rule, at most eight of them, with no
   credentials and no redirects followed.
4. Finding either document means OAuth. Finding neither means a key.
5. Other statuses are reported as they are. Connection errors are translated
   into a short reason (host not found, nothing listening, TLS not trusted,
   timed out).

Budgets: 8 seconds for `initialize`, 5 seconds per metadata document, all
under the request's own cancellation. The probe never sends credentials,
never calls a tool, and never saves anything.

## What the probe can't tell

- **A server that takes both OAuth and a key** reports OAuth, since that is
  what it advertises. That's what the one-click override is for.
- **Which key** a bare 401 wants. The verdict preselects a bearer token, and
  names a custom header only when the refusal mentions a hyphenated one such
  as `X-API-Key` without also mentioning Bearer. HTTP Basic credentials are not
  detected.
- **Whether OAuth sign-in will succeed** when the authorization server
  publishes no metadata. The verdict says the registration is unknown and
  sign-in finds out.
- **Catalog services pasted as custom URLs** are probed like any other address
  and get a generic identity (`mcp_<slug>`), as before.
- **Legacy HTTP+SSE servers** answer POST with 404 or 405 and read as "no MCP
  server here", which matches Ri's client, which speaks Streamable HTTP only.

## Verified against

On October 19, 2026, with `src/lib/integrations/mcp-auth-detect.test.ts`
replaying what each answered unauthenticated:

- Bits & Bolts local store (`http://localhost:3917/mcp`): None.
- Bits & Bolts remote (`http://localhost:3916/bits-and-bolts/mcp`): OAuth, dynamic registration, scope `cad`.
- MagicPath (`https://api.magicpath.ai/mcp`): OAuth, dynamic registration, PKCE S256, both scopes.
- Excalidraw (`https://mcp.excalidraw.com/mcp`): None.
- GitHub (`https://api.githubcopilot.com/mcp/`): OAuth that needs a registered client.
- Wrike (`https://mcp.wrike.com/v2`): a bare 401, so a key.
