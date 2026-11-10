# Detecting how a custom MCP server authenticates

When someone adds a custom MCP server (Settings, Plugins, MCP servers, Add MCP
server, or Add custom MCP in Apps), Ri works out how the server authenticates
from its URL, so the person doesn't have to choose, and changing its answer is
one click. Official catalog services (`packages/integrations/src/providers/hosted-mcp.ts`)
keep their configured auth and never come through this path.

## What the person sees

The form asks for a name and a URL. Nothing about auth shows until a URL is
typed. Then an Authentication list shows every method, in a fixed order so it
never moves when the probe answers:

| Method | Stored as | Fields it adds |
| --- | --- | --- |
| Sign in with your browser | OAuth | None |
| API key or token | Bearer token | Secret |
| API key in a custom header | Custom header | Header name and secret |
| No sign-in | None | None |

A method's fields open under that method when it is chosen, indented to its
text, so they read as part of the choice and move with it.

While the probe runs (a moment after typing stops), the heading says it is
checking, no method is chosen, and the add waits, unless the person picks one
first. When it answers, it checks the method it found and marks it
**Detected**, with what it saw in place of that method's generic description:

| The server | Detected |
| --- | --- |
| Answers `initialize` normally | No sign-in, naming the server |
| 401 or 403 with OAuth metadata | Sign in with your browser, with a note on registration |
| 401 or 403 with no OAuth metadata | API key or token, or the custom header the refusal named |
| Unreachable, redirects elsewhere, not MCP, or erroring | Nothing. A note above the list says why, and No sign-in stays checked |

The OAuth note says whether the authorization server registers clients
dynamically (RFC 7591, what Ri does during sign-in), accepts client ID metadata
documents (which Ri doesn't offer for custom servers yet), or needs a client
registered by hand (which a custom server can't supply, so the note points at
an API key if the server also takes one). It also says when the server doesn't
offer PKCE S256, which Ri requires. A note that means sign-in may not work is
amber, on the detected method.

Changing the method is a click on another one, and the Detected mark stays
where the probe put it, so what was found and what was chosen both stay in
view. DataForSEO is the known case: it offers OAuth and also takes an API key.
A choice made by hand belongs to that address. Editing the URL starts over with
a fresh verdict and nothing chosen until it arrives, while the name, header and
secret stay as typed. The form submits the detected method unless the person
chose, and the add itself still validates by connecting, as before.

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
  what it advertises. That's why every other method stays one click away.
- **Which key** a bare 401 wants. The probe detects a bearer token, and
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
