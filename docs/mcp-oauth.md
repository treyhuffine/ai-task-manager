# MCP sign-in and views

ChatGPT, Claude and other MCP apps connect to Ri the way they connect to Todoist: you give the app Ri's MCP address, it finds Ri's sign-in on its own, and you choose Allow in Ri. Nobody makes an app or copies a key. The app gets the same content tools a key from Connect your agent gives ([external-ai.md](external-ai.md)), and apps that draw MCP Apps views can show today's deck and task lists you act on in place.

Built October 31, 2026. Code: `src/lib/oauth/`, `src/app/oauth/authorize/`, `src/app/api/oauth/`, `src/app/.well-known/`, and the views in `src/lib/external-ai/views/`.

## Connecting

Cloud apps reach Ri from the internet, so Ri needs a remote address first (Settings → Devices, Use Beamd URL or your own HTTPS address). The MCP address is that address with `/api/orchestrator/mcp`.

**ChatGPT.** Plugins → + → Add custom MCP server. Name it Ri, paste the MCP address as its server URL, choose OAuth under Authentication and leave any client ID or secret empty. Accept the warning and choose Create as a plugin. ChatGPT opens Ri's sign-in page in your browser. Choose Allow. Settings → Connect your agent → ChatGPT has the same steps with your address filled in, and lists each connection with when it was last used and Disconnect. OpenAI's steps: [Connect and test](https://developers.openai.com/plugins/deploy/connect-chatgpt).

**Claude** (claude.ai, the desktop app, the phone). Settings → Connectors → Add custom connector, paste the MCP address, and sign in to Ri when it asks. The Claude app item in Connect your agent says so beside its local bridge, which needs no remote address.

**Agents on a computer.** Any client that supports MCP authorization can sign in instead of holding a key: `claude mcp add --transport http ri <address>` with no header, then `/mcp` in Claude Code to authenticate. VS Code, Cursor and others do the same from their MCP settings. Connect your agent's Set up still writes a key for agents on the computer running Ri, which needs no browser at all.

## The sign-in page

`/oauth/authorize` is the page the app opens.

- **Not signed in to Ri in this browser:** a browser that already holds Ri's token (from pairing) gets its cookie and the page reloads. Otherwise it asks for a code from Settings → Devices → Add device on any signed-in device, the same code `/pair` takes. Either way the app's request stays on the page. `isSignInPage` keeps Ri's usual redirect to `/pair` away from it.
- **Signed in:** it names the app, where it's from, what it can and can't do, and where what it reads goes ("What ChatGPT reads is sent to OpenAI."), with Cancel and Allow. Allow takes a click only after the page has been visible for half a second and is never focused for you. It posts to `/api/oauth/authorize`, which checks the whole request again and sends the browser back to the app with a code. Cancel sends `access_denied`.
- **Something wrong with the app itself** (unknown client, a redirect it never registered): the page says what, and sends nothing anywhere.
- **Something wrong with the request** (no PKCE, another response type, another resource): the page says what, with a link back to the app carrying the error. It never sends the browser there unasked.

A team's Ri answers that ChatGPT signs in to a personal Ri. Team AI clients keep their members' keys (homes-spec.md §9.8).

## Protocol

What Ri implements, and the specs it follows: the [MCP authorization spec](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization), [OpenAI's Apps SDK authentication](https://developers.openai.com/apps-sdk/build/auth), OAuth 2.1 with PKCE.

| Step | Ri |
| --- | --- |
| Discovery | A request to `/api/orchestrator/mcp` without a working key gets 401 with `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/api/orchestrator/mcp", scope="content"` (and `error="invalid_token"` when a key was sent). Only that endpoint challenges. |
| Resource metadata (RFC 9728) | `/.well-known/oauth-protected-resource`, also suffixed with the endpoint's path. The resource is the MCP address. |
| Server metadata (RFC 8414) | `/.well-known/oauth-authorization-server`: S256 only, `authorization_response_iss_parameter_supported`, `client_id_metadata_document_supported`, a registration endpoint, `none`, `client_secret_basic` and `client_secret_post` at the token endpoint, revocation. No OIDC scopes, so ChatGPT asks for none. |
| Clients | A client ID metadata document (ChatGPT's is `https://chatgpt.com/oauth/client.json`), or dynamic registration (RFC 7591). |
| Authorization | Code flow with PKCE S256, required. `resource` (RFC 8707) must be the MCP address when sent. Every answer, errors included, carries `iss` (RFC 9207), which is why ChatGPT uses its stable redirect, `https://chatgpt.com/connector_platform_oauth_redirect`. |
| Token | The code becomes an outside-assistant key (`api_keys.role = ai_client`), named after the app and filed under it (`chatgpt`, `claude_desktop`, else `other`). `{ access_token, token_type: "Bearer", scope: "content" }`. |
| Revocation (RFC 7009) | `/api/oauth/revoke` ends the key a token names. Holding the token is the authority. |

**One issuer per address.** A Home answers on its remote address and on its local one, and a client checks that the issuer and resource match the address it used, exactly. `issuerFor` picks the Home address the request reached (a loopback name on the local port counts as local) and never a host it doesn't know, so no request can make Ri's metadata name another site.

**Codes** live five minutes in the server's memory (`processState`), are used once, and are bound to the client, redirect, PKCE challenge, resource and issuer. A wrong verifier spends the code. A restart between Allow and the app's exchange loses it, and the app asks you to connect again.

**Keys from a sign-in don't expire and there is no refresh token**, like every other Ri key (browser sign-ins last a year, Connect your agent keys until disconnected). A connection ends with Disconnect in Settings, the app's own revocation, or the key's expiry if one is ever set. Short-lived tokens with rotating refresh would bound a token leaked in transit to an hour, at the cost of a grant table and rotation edge cases (a lost refresh response ends the connection). Revisit if Ri's keys get lifetimes generally.

## Security

Each rule names who it stops and what they'd get.

| Rule | Attacker | What they'd gain | Decision |
| --- | --- | --- | --- |
| Registration stores nothing: the client ID is the registration, base64url JSON, and a confidential client's secret is an HMAC of it under the Home's local token | Anyone on the internet calling the open registration endpoint | Filling the Home's disk | Kept. Signing the ID would add nothing, since anyone can register any redirect. |
| A metadata document is fetched only for a signed-in owner, over HTTPS, without redirects, within 5 seconds and 64 KiB, and kept ten minutes. Its address is checked after DNS, where the socket connects (`publicLookup`), so a public name that resolves or rebinds to this computer or its network is refused like a literal one | Anyone who can make the Home's sign-in page load | Making the Home fetch URLs on its own network for them | Kept. Before sign-in the page names the app from its ID alone (`clientLabel`). |
| An app's logo, company and Connect your agent item come only from the host that proved it: the document's host, or the host its code goes back to (`kindFor`) | An app that registers itself as "ChatGPT" | OpenAI's logo and wording on the consent page | Kept. Its own name still shows, beside "Returns you to evil.example". |
| Redirects must be registered exactly. HTTP only to loopback, an app's own scheme allowed, never `javascript:`, `data:` or `file:`, never a fragment. A loopback IP listener may pick its port (RFC 8252 §7.3) | A link that sends the owner's code elsewhere | The owner's connection | Kept. A redirect that doesn't match is a page error, never a redirect. |
| A request error is shown on the page with a link back, never redirected unasked (RFC 9700 §4.11.2) | Anyone, since registration is open: a client of their own with their own redirect and a malformed request | Ri's own address as a link that lands on their site | Kept. Errors after the owner's Allow or Cancel still redirect, since the owner chose. |
| PKCE S256 required, codes single-use and bound, and redeemed only at the address that approved them | Someone who sees a code | A key | Kept. |
| `iss` on every authorization answer | A mix-up between two authorization servers in one app | A code sent to the wrong server | Kept. ChatGPT and the MCP SDK check it. |
| Allow posts with the browser's `SameSite=Lax` cookie, and the proxy refuses a cookie POST from another origin | Another site's form | Approving an app for the owner | Kept. |
| The page can't be framed (`frame-ancestors 'none'`, `X-Frame-Options: DENY`), isn't cached and sends no referrer to other sites (`same-origin`) | A site that frames Ri's page under its own button | The owner's click on Allow | Kept. Not `no-referrer`: under it the form's POST carries `Origin: null`, which the proxy refuses. |
| Allow is never focused and takes a click only after the page has been visible for 500 ms, as Ri's approval cards arm | A site that opens the page in a new window under a click or key it asked for | The owner's Allow | Kept. |
| A sign-in key reaches only `/api/orchestrator/mcp` and the content tools | An app, or a stolen token | Chats, the Stream, files, settings, starting agents | Kept, as for every outside-assistant key (`HOME_CONTENT_ACTIONS`). |

## Views

Apps that draw [MCP Apps](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx) views (ChatGPT, Claude, and Ri itself) get two render tools. The model still reads with `get_deck` and `list_tasks`, and calls these when the person should see and act on the result.

- `show_deck`: today's deck as Ri draws it ([deck-layout.md](deck-layout.md)): hard deadlines due this week pinned on top (each task once, so one already in the stack shows its deadline there), the deck's framing, the ranked stack with each card's reasoning as a one-line glimpse, and how many tasks are in progress. It never makes a deck, which runs the AI pipeline. With none, it says so. An earlier day's deck says whose day it is.
- `show_tasks`: named tasks in the order given (ones the model just created, found or changed), all of them up to 50, or a filter like `list_tasks` (20 unless it asks for up to 50), saying when more match.

In both, a check finishes a task (and reopens a finished one), Start starts one, and the title opens it in Ri at the remote address. Each change calls `complete_task` or `transition_task` through the host with the `statusChangedCount` the view drew, so a view that's out of date is refused rather than undoing newer work. The row says the task changed in Ri, and the view redraws from Ri after every change. The row stays busy until that redraw lands, so a quick second tap never sends the count from before the first. It also tells the model what the person did (`ui/update-model-context`), so the next turn knows.

The page (`ui://ri/tasks.html`, `text/html;profile=mcp-app`) reaches nothing on the network: its CSP declares no domains, and everything goes through the host. It follows the host's theme and its standard style variables, with Ri's neutral palette as the fallback, and sets no `color-scheme`, since Chromium paints an opaque canvas under a frame whose scheme differs from its host's. The bridge is about a hundred lines of MCP Apps JSON-RPC, so the page is 14 KiB with no SDK. Tools carry both `_meta.ui.resourceUri` and ChatGPT's `openai/outputTemplate`, and the tools the view calls carry `openai/widgetAccessible`.

Every content tool carries MCP hints from its action's `mutating` flag: reads are `readOnlyHint`, writes are not destructive (there is no delete, and archive is undone with restore), and none reaches beyond Ri (`openWorldHint: false`). ChatGPT and Claude use them to decide what to confirm.

**Building the page.** The source is `src/lib/external-ai/views/client/` (TypeScript and CSS). `pnpm mcp-views:build` bundles it into `tasks-view.html.ts`, which is committed so the server, CLI and desktop runtime serve it with no build step or file read. `views.test.ts` fails when the committed page differs from a fresh build.

## Not built

- **Listing Ri in ChatGPT's plugin directory.** A listed plugin has one address for everyone, and every Ri lives on its own computer. It needs a hosted front door that sends each person's sign-in to their own Home, `_meta.ui.domain` for the view, and OpenAI's review. Personal use above needs none of it.
- **Team sign-in.** A team's Ri connects AI clients with its members' keys.
- **Secure MCP Tunnel.** OpenAI's private alternative to a public address needs an OpenAI Platform organization, an API key and its `tunnel-client` running. Beamd already gives Ri a public address.
- **Approving from another device.** Today a browser that isn't signed in pastes a code from Add device. Approving on a device that's already signed in, with no code, is the next step for the Ri task "Make sure we have super easy device auth and not passing around API keys".

## Tests

- `src/lib/oauth/oauth.test.ts`: the official MCP client's own OAuth through the real proxy and routes, with dynamic registration, with a metadata document, and as ChatGPT's published client document describes it, then revocation. Refusals: a code used twice, a wrong verifier, another client's code, a code from another address, Cancel, an unregistered redirect, a request error, a choice from another origin or without a sign-in, `Origin: null`, and unsafe redirects.
- `src/lib/oauth/clients.test.ts`: redirects, registration and secrets, metadata documents and their refusals (private hosts, names that resolve to private addresses, another client's ID, no usable redirect, too large, redirects), proven identity, and issuer choice.
- `src/lib/team/mcp/team-mcp.test.ts`: a team makes no key for an agent that signs in.
- `src/lib/external-ai/views/views.test.ts`: the committed page is current, Ri's own MCP Apps host accepts it, it reaches no network, and an outside assistant lists, reads and calls the views with real data, including a stale change refused.
- `src/lib/external-ai/views/tasks-view.browser.test.ts`: the page in Chromium inside the MCP Apps reference host (`AppBridge`), in an opaque sandboxed frame, light and dark: the deck's layout, finishing a task with the right call, a refused change, and opening Ri through the host.
