# MCP sign-in and views

ChatGPT, Claude and other MCP apps connect to Ri the way they connect to Todoist: you give the app Ri's MCP address, it finds Ri's sign-in on its own, and you choose Allow in Ri. Nobody makes an app or copies a key. The app gets the same content tools a key from Connect your agent gives ([external-ai.md](external-ai.md)), and apps that draw MCP Apps views can show today's deck and task lists you act on in place.

Built October 31, 2026. Code: `src/lib/oauth/`, `src/app/oauth/authorize/`, `src/app/api/oauth/`, `src/app/.well-known/`, and the views in `src/lib/external-ai/views/`.

## Connecting

Cloud apps reach Ri from the internet, so Ri needs a remote address first (Settings → Devices, Use Beamd URL or your own HTTPS address). The MCP address is that address with `/api/orchestrator/mcp`.

**ChatGPT.** Plugins → + → Add custom MCP server. Name it Ri, paste the MCP address as its server URL and choose OAuth under Authentication. ChatGPT finds Ri's sign-in on its own and picks its metadata document (CIMD), so there's no client to set up. Accept the warning and choose Create as a plugin. ChatGPT opens Ri's sign-in page in your browser. Choose Allow. Settings → Connect your agent → ChatGPT has the same steps with your address filled in, and lists each connection with when it was last used and Disconnect. OpenAI's steps: [Connect and test](https://developers.openai.com/plugins/deploy/connect-chatgpt).

**Claude** (claude.ai, the desktop app, the phone). Settings → Connectors → Add custom connector, paste the MCP address, and sign in to Ri when it asks. The Claude app item in Connect your agent says so beside its local bridge, which needs no remote address.

**Agents on a computer.** Any client that supports MCP authorization can sign in instead of holding a key: `claude mcp add --transport http ri <address>` with no header, then `/mcp` in Claude Code to authenticate. VS Code, Cursor and others do the same from their MCP settings. Connect your agent's Set up still writes a key for agents on the computer running Ri, which needs no browser at all.

## The sign-in page

`/oauth/authorize` is the page the app opens.

- **Not signed in to Ri in this browser:** a browser that already holds Ri's token (from pairing) gets its cookie and the page reloads. Otherwise it asks for the token from Settings → Devices → Add device on any signed-in device, the same token `/pair` takes. That token is the new device's full key, not a one-time code, so the browser stays signed in to Ri as a device. Either way the app's request stays on the page. `isSignInPage` keeps Ri's usual redirect to `/pair` away from it.
- **Signed in:** it names the app, where it's from and where Allow sends the code, what it can and can't do, and where what it reads goes ("What ChatGPT reads is sent to OpenAI."), with Cancel and Allow. Allow takes a click only after the page has been visible for half a second and is never focused for you. It posts to `/api/oauth/authorize`, which checks the whole request again and sends the browser back to the app with a code. Cancel sends `access_denied`.
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
| Each registration holds a random value, so the same details register as a new ID and secret | Someone who reads a client's ID and registers its details again | That client's secret | Kept. They'd still need a code and its verifier, but the fix is one field. |
| A metadata document is fetched only for a signed-in owner, over HTTPS, without redirects, within 5 seconds and 64 KiB, and kept ten minutes. Its address is checked after DNS, where the socket connects (`publicLookup`), so a public name that resolves or rebinds to this computer or its network is refused like a literal one | Anyone who can make the Home's sign-in page load | Making the Home fetch URLs on its own network for them | Kept. Before sign-in the page names the app from its ID alone (`clientLabel`). |
| The page always names where Allow sends the code, beside the host that serves the app's details when they differ, and the form submits that same place | An app whose details sit on a trusted-looking host and whose callback is its own | A key from an owner who saw only the trusted name | Kept. It's the only defense against a link that gets the owner to approve someone else's app. |
| An app's logo, company and Connect your agent item come only from the host that proved it: the document's host, or the host its code goes back to (`kindFor`) | An app that registers itself as "ChatGPT" | OpenAI's logo and wording on the consent page | Kept. Its own name still shows, beside "Returns you to evil.example". |
| Redirects must be registered exactly. HTTP only to loopback, an app's own scheme allowed, never `javascript:`, `data:` or `file:`, never a fragment. A listener on this computer, `localhost` included, may pick its port (RFC 8252 §7.3, and what Claude Code does) | A link that sends the owner's code elsewhere | The owner's connection | Kept. A redirect that doesn't match is a page error, never a redirect. |
| A request error is shown on the page with a link back, never redirected unasked (RFC 9700 §4.11.2) | Anyone, since registration is open: a client of their own with their own redirect and a malformed request | Ri's own address as a link that lands on their site | Kept. Errors after the owner's Allow or Cancel still redirect, since the owner chose. |
| PKCE S256 required, codes single-use and bound, and redeemed only at the address that approved them | Someone who sees a code | A key | Kept. |
| `iss` on every authorization answer | A mix-up between two authorization servers in one app | A code sent to the wrong server | Kept. ChatGPT and the MCP SDK check it. |
| Allow posts with the browser's `SameSite=Lax` cookie, and the proxy refuses a cookie POST from another origin | Another site's form | Approving an app for the owner | Kept. |
| The page can't be framed (`frame-ancestors 'none'`, `X-Frame-Options: DENY`), isn't cached and sends no referrer to other sites (`same-origin`) | A site that frames Ri's page under its own button | The owner's click on Allow | Kept. Not `no-referrer`: under it the form's POST carries `Origin: null`, which the proxy refuses. |
| Allow is never focused and takes a click only after the page has been visible for 500 ms, as Ri's approval cards arm | A site that opens the page in a new window under a click or key it asked for | The owner's Allow | Kept. |
| A sign-in key reaches only `/api/orchestrator/mcp` and the content tools | An app, or a stolen token | Chats, files, settings, starting agents | Kept, as for every outside-assistant key (`HOME_CONTENT_ACTIONS`). |
| The model can add to the Stream but not read it, and reads neither the Stream nor the scratchpad | An app's model | The person's raw captures and working memory in its context | Kept. Ri's view shows them to the person through `load_view`, which hosts that follow MCP Apps keep from their model. The app's company still receives them, which the consent page says. |

## Views

Apps that draw [MCP Apps](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx) views (ChatGPT, Claude, and Ri itself) get three tools that draw it. The model still reads with `get_deck` and `list_tasks`, and calls the first two when the person should see and act on the result. The app's other screens read through two more that only the view calls (see The app).

- `show_deck`: today's deck as Ri draws it ([deck-layout.md](deck-layout.md)): hard deadlines due this week pinned on top (each task once, so one already in the stack shows its deadline there), the deck's framing, the ranked stack with each card's reasoning as a one-line glimpse, and how many tasks are in progress. It never makes a deck, which runs the AI pipeline. With none, it says so. An earlier day's deck says whose day it is.
- `show_tasks`: named tasks in the order given (ones the model just created, found or changed), all of them up to 50, or a filter like `list_tasks` (20 unless it asks for up to 50), saying when more match.

- `open_ri`: the app itself, listed as Ri in ChatGPT's sidebar and plugin page (OpenAI's [global entrypoint](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#global-entrypoint), which it calls sidebar apps). It takes no arguments, as the spec requires. It stays visible to the model even though people open it: the spec says an entrypoint ignores `ui.visibility`, but ChatGPT refuses to draw the view of a tool hidden from the model ("These private tools can't render their widgets", seen 2026-11-09). Its result carries `app: true`, so the page draws the app whatever display mode the host reports for the tab beside a chat.

The page is a card in a chat: today's deck or a task list. A task's title opens it in full inside the card, with Back. Opened from `open_ri`, or with a card made full screen, it's the app.

**The app.** Tabs for Today, Tasks, Board, Calendar, Notes, Stream and Scratchpad, scrolling sideways at panel width, and one search across tasks and notes under them (Ri's hybrid search, never the Stream). Any task or note opens in full, with Back through everything opened since the tab.

- **Today and Tasks** keep an add field above the list. Text being typed survives a change landing, and the cursor stays in the field for the next one.
- **A task in full**: its status and the commands Ri's lifecycle allows from it (Start, Move to Todo, Return to Todo, Move to Consider, Archive, Restore, with the check for done and reopen), Done when, the body drawn from markdown, its parent, subtasks with an add field, and its notes. Edit changes the title, Done when and body, sending only what changed, the body with the revision the view drew. If Ri's text moved on meanwhile, the save is refused, the person's words stay in the field, and the view says so: Save anyway replaces Ri's version knowingly, Cancel shows it. A draft outlives leaving the screen, so a stray tap loses nothing.
- **A note in full**: title, kind, area, the task it's about, the body, Edit the same way, Archive and Restore. Notes lists the 50 touched last and New note writes one, which then opens.
- **Board**: Consider, Todo and In progress, as Ri's board starts. A card moves by its arrows or by dragging, each move one of the lifecycle's own commands, and only to a column that has one (In progress goes back through Todo). A finished card stays ticked where it was until the tab changes.
- **Calendar**: a week of days from today, Ri's own List tab at panel width: each day's meetings from the connected calendars (with Join for a call), then its Todo and In progress deadlines. Consider stays off it, as on Ri's calendar. With no calendar connected it shows the deadlines and says so.
- **Stream**: a field to capture a thought (`create_stream_item`, which Rye sorts later), and what's waiting for triage, newest first, with any suggestion Rye has made noted. Triage itself stays with Rye.
- **Scratchpad**: the same page as in Ri, saved as the person writes (`save_scratchpad`, after a pause, on leaving the field or the tab, and before the host removes the view). Each save sends the text the view last had from Ri, so a line another device wrote meanwhile is merged in rather than lost, as Ri's own scratchpad does.

Bodies are drawn by a small markdown renderer that builds DOM nodes and never HTML, so nothing in a body runs or becomes markup. It covers what Ri's editor writes: headings, lists and task lists, quotes, code, tables, emphasis and links. Only web and mail links are links, and they open through the host. `[[task:id]]` and `[[note:id]]` show their titles and open in the view. Images can't load (the page reaches no network), so they show as their description.

**What the model learns.** The screens read through `load_view`, and the scratchpad saves through `save_scratchpad`. Both are hidden from the model (`ui.visibility: ['app']`) and return nothing for it to read, so the view shows the Stream, scratchpad and calendar to the person without putting them in the conversation. On each screen the view tells the model which one is open (`ui/update-model-context`), naming the Stream and scratchpad but never their contents. Opening a task or note tells it the title and ID, so "help me with this" beside a chat means that item. The person brings anything else into the chat with Add to message: a task, a note, a thought from the Stream (its words, since the model can't read the Stream), or the scratchpad, or just the part of it selected. A host that doesn't follow MCP Apps may list the two view tools to its model. The consent page names this reach.

**Beside a chat.** `open_ri` is also a thread entrypoint, so ChatGPT can open Ri as a tab beside any conversation. It's the same app at panel width: the tabs scroll and the board's columns scroll inside it.

**The message box.** Two ways in, both from OpenAI's [MCP extensions](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md):

- **@ in the message box** (composer at-mentions). An outside app's connection advertises `openai/mentions` with `search_mentions`, a read-only tool only the host's app layer sees (`ui.visibility: ['app']`). With nothing typed it offers today's deck and the notes touched last, then keyword matches as the person types (full-text, since it runs on every keystroke), never the Stream and nothing archived. Each item is a link (`ri://task/<id>`, `ri://note/<id>`) the host reads with `resources/read` when the message is sent, as markdown with the ID the model needs to act on it, up to 32 KiB. OpenAI lists it for desktop and web, not the phone apps.
- **Add to message** on a row puts the task in the message being written, as a labeled item the person can remove, and sends nothing (`ui/message` with `target: "active", send: false`). A plain `ui/message` sends as the person, so the view offers this only where the host says it honors that (`openai/message` in its capabilities, as ChatGPT and Ri do).

Everywhere, a check finishes a task (and reopens a finished one), Start starts one, the title opens it in full, and Open in Ri there opens it at the remote address. Each change calls `complete_task` or `transition_task` through the host with the `statusChangedCount` the view drew, so a view that's out of date is refused rather than undoing newer work. A list of current tasks no longer includes one just finished, so the view keeps that row in place, ticked and reopenable, until the list changes. The row says the task changed in Ri, and the view redraws from Ri after every change. The row stays busy until that redraw lands, so a quick second tap never sends the count from before the first. If the redraw fails, the row keeps what Ri answered to the change, so the next change still works, and the view says it may be out of date with Try again.

Finishing a repeating task returns it to `todo` with its next date, which would look like the click didn't stick and invite finishing it again. So until that date the view draws it as done with "Next Thu, Nov 12" and nothing to press, the same rule Ri uses for what's ready (`src/lib/deck/client-ready.ts`). It also tells the model what the person did (`ui/update-model-context`), so the next turn knows.

The page (`ui://ri/tasks.html`, `text/html;profile=mcp-app`) reaches nothing on the network: its CSP declares no domains, and everything goes through the host. It follows the host's theme and its standard style variables, with Ri's neutral palette as the fallback, and sets no `color-scheme`, since Chromium paints an opaque canvas under a frame whose scheme differs from its host's. The bridge is about a hundred and fifty lines of MCP Apps JSON-RPC, so the whole app is about 55 KiB with no SDK. It answers the host's `ui/resource-teardown` once a scratchpad save on its way has landed, or after two seconds. Tools carry both `_meta.ui.resourceUri` and ChatGPT's `openai/outputTemplate`, and the tools the view calls carry `openai/widgetAccessible`.

Every content tool carries MCP hints from its action's `mutating` flag: reads are `readOnlyHint`, writes are not destructive (there is no delete, and archive is undone with restore), and none reaches beyond Ri (`openWorldHint: false`). ChatGPT and Claude use them to decide what to confirm.

**Building the page.** The source is `src/lib/external-ai/views/client/` (TypeScript and CSS). `pnpm mcp-views:build` bundles it into `tasks-view.html.ts`, which is committed so the server, CLI and desktop runtime serve it with no build step or file read. `views.test.ts` fails when the committed page differs from a fresh build.

## Not built

- **Listing Ri in ChatGPT's plugin directory.** A listed plugin has one address for everyone, and every Ri lives on its own computer. It needs a hosted front door that sends each person's sign-in to their own Home, `_meta.ui.domain` for the view, and OpenAI's review. Personal use above needs none of it.
- **Team sign-in.** A team's Ri connects AI clients with its members' keys.
- **Secure MCP Tunnel.** OpenAI's private alternative to a public address needs an OpenAI Platform organization, an API key and its `tunnel-client` running. Beamd already gives Ri a public address.
- **Browser JavaScript clients.** The discovery and token endpoints allow other origins, but the MCP endpoint doesn't: a preflight gets a 401. ChatGPT and Claude connect from their own servers, so nothing we target needs it, and that endpoint also accepts the browser's sign-in cookie, so opening it needs its own thought. Add it when a real browser client is wanted.
- **Approving from another device.** Today a browser that isn't signed in pastes a token from Add device. Approving on a device that's already signed in, with no code, is the next step for the Ri task "Make sure we have super easy device auth and not passing around API keys".

## Tests

- `src/lib/oauth/oauth.test.ts`: the official MCP client's own OAuth through the real proxy and routes, with dynamic registration, with a metadata document, and as ChatGPT's published client document describes it, then revocation. Refusals: a code used twice, a wrong verifier, another client's code, a code from another address, Cancel, the page naming the real destination, an unregistered redirect, a request error, a choice from another origin or without a sign-in, `Origin: null`, and unsafe redirects.
- `src/lib/oauth/clients.test.ts`: redirects, registration and secrets (the same details never get the same secret), metadata documents and their refusals (private hosts, names that resolve to private addresses, another client's ID, no usable redirect, too large, redirects), proven identity, and issuer choice.
- `src/lib/team/mcp/team-mcp.test.ts`: a team makes no key for an agent that signs in.
- `src/lib/external-ai/views/views.test.ts`: the committed page is current, Ri's own MCP Apps host accepts it, it reaches no network, and an outside assistant lists, reads and calls the views with real data, including a stale change refused. Each screen over MCP with a real Home: the board and a move, a task in full with links, subtasks and notes, an edit refused against a stale revision, notes made, edited and archived, search that never returns the Stream, a week of deadlines with no calendar connected, Stream capture with the Stream still unreadable to the model's tools, and a scratchpad save merged with another device's line.
- `src/lib/external-ai/views/client/markdown.test.ts`: the body renderer, including HTML, `javascript:` links and images staying words.
- `src/lib/external-ai/views/tasks-view.browser.test.ts`: the page in Chromium inside the MCP Apps reference host (`AppBridge`), in an opaque sandboxed frame, light and dark: the deck's layout, finishing a task with the right call, a refused change, a task opened and edited (a conflict kept, then saved knowingly), the board by arrow and by drag, the calendar's week and Join, a new note, Stream capture with nothing of it told to the model, the scratchpad's merge and save on leaving, search, the app at panel width, and opening Ri through the host.
