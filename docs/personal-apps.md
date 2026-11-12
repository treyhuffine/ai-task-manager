# Personal apps in Ri

Ri's side of the [shared app kit spec](shared-app-kit-spec.md). A personal app is an ordinary MCP server that runs on its own: a background service on the Mac through the kit's `serve --install`, or Cloudflare. Ri doesn't start, stop or supervise it. Ri connects to it with OAuth like any other connector, shows its screens through the connected app host ([connected MCP apps](connected-mcp-apps.md)), and lends it the person's accounts through the hub.

## What Ri owns

| Piece | Where |
| --- | --- |
| Connecting to an app, one OAuth connection per place | `src/lib/integrations/apps.ts`, `mcp-servers.ts` |
| Showing an app's screens | `packages/mcp-apps-host`, `src/lib/mcp-apps/`, `src/components/mcp-apps/` |
| The hub: apps borrowing the person's accounts and Ri's own services | `src/lib/integrations/hub/` |

## Connecting an app

An app is connected once per **place**: Ri's own chats (its main chat, task and note chats, background work), and each agent the person allows. Each place is its own server entry in the MCP store, so it has its own dynamic client registration, PKCE run and tokens, and the app's consent screen asks what that place may see and whether it may also make changes. The app stores that choice per client and enforces it on every call.

- **Add app** (Apps → Add app) takes the app's name and the MCP address it prints, such as `http://127.0.0.1:4310/mcp`, and connects Ri's own chats. That connection also opens the app's screens in Ri. `http://` is accepted for loopback only, and loopback aliases of an address already added are refused as the same app.
- **Allowing an agent** (the agent's settings → Apps, or the app's page → Who uses it) first says what it means: the agent sees whatever the app shows it, including what the app read from the person's accounts (`allowConsequence` in `src/lib/integrations/app-access-copy.ts`, spec Decision 3). Then the app's consent screen opens for that agent's own connection.
- **OAuth client names** say which place a connection is: `Ri` for Ri's own chats, `Ri · <agent>` for an agent, so the app's consent screen and its connection list name them.
- **Removing** an agent's access drops its scope and Ri forgets its token. Removing the app does that for every place. The app keeps its data, and the person can also disconnect each client in the app's own settings.

How the places stay apart:

| Where | Rule |
| --- | --- |
| The engine | An app is one connector, `app_<slug>`, with one account per place (`place:ri`, `place:agent:<id>`), so tool names are the same in every place (`app_reading_log__list_books`). |
| An agent's chats | `resolveIntegrationFilter` pins the app to the agent's own account, whatever the stored scope says. An agent with no connection of its own gets no app tools. |
| Ri's own chats | `resolveRiIntegrationFilter` pins each app to Ri's own account and leaves out an app Ri isn't connected to. |
| Screens, tabs and @-mentions | `chatAccess` (`src/lib/mcp-apps/service.ts`) and the mentions adapter refuse another place's connection. |
| The scope editor | Never adds, changes or drops an app's scope (`validateIntegrationScopes`). Only allowing or removing the app does. |

Checked on November 12, 2026 against Reading Log built from the kit's branch and run with `serve` in local-owner mode, from an isolated Ri: adding it registered client `Ri`, allowing the Family agent registered a second client named `Ri · Family`, Ri's connection (allowed read-only) was refused `save_book` with the app's own message while Family's (allowed changes) saved a book, and an agent that wasn't allowed had no app tools and couldn't add the app through its scopes.

## Loading app tools in a chat

Being allowed and being loaded are separate (shared spec §2). Dozens of apps' tools would swamp a model, so an allowed app costs a chat one line until it's needed. `src/lib/integrations/app-tools.ts` decides, and Ri's integrations endpoint and turn context carry it, so it works the same with every harness Ri runs.

| Mode | What the chat's model sees |
| --- | --- |
| Automatic (the default) | `load_app_tools`, whose description has one line per app: its id, name and what it does (its server's description, else its tool names). Calling it returns the app's tools with their input schemas and marks the app loaded in that chat. `call_app_tool` (app, tool, arguments) calls one through the same gated `runAction` as any connector tool, on the chat's own connection. |
| On | The app's tools listed directly, like any connector's. |
| Off | Nothing. The app isn't listed and `call_app_tool` can't reach it. |

An app also loads straight away when a message @-tags it or carries context from its screen beside the chat: that turn gets the app's tools in an `<ri-app-tools>` block (`messageAppToolsContext`). The switch is per chat, in the + menu under App tools, and stored on `chat_sessions.app_tools`. Changing it restarts the chat's harness when idle, since harnesses keep the tool list they started with. A call with no chat behind it (no session credential) sees apps listed directly, since there is nowhere to remember a load. All of this decides what the model sees, never what the app may reach.

Checked on November 12, 2026 with Reading Log, as Ri's main chat on the isolated Ri: automatic listed no Reading Log tools, only the two dispatchers, and loading then calling `list_books` worked through Ri's own connection. On listed its five tools directly with no dispatcher. Off listed nothing and the dispatcher was gone.

## The hub

An app borrows the person's accounts, and Ri's own services, through Ri's integrations endpoint (`/api/integrations/mcp`) with its own OAuth token (shared spec §3). Apps are a separate kind of OAuth client on Ri's authorization server: the same registration, a different resource.

**Connecting.** The app finds the hub with standard discovery: an unauthenticated request to `/api/integrations/mcp` gets a 401 whose `WWW-Authenticate` points at `/.well-known/oauth-protected-resource/api/integrations/mcp`. The hub advertises no scopes. The app registers dynamically and may send `software_id`, `client_uri` and `purpose` (`src/lib/oauth/clients.ts`), then authorizes with `resource` set to the hub. A request for the hub resource gets the hub's consent screen (`src/app/oauth/authorize/hub-consent.tsx`).

**The consent screen** names the app and where it runs, shows its stated purpose as the app's own words that Ri doesn't enforce, and then, separately, what Ri does enforce: a list of the person's live accounts, each with its tools to tick, and Ri's own services. What the app asked for (its OAuth `scope`: tool names, or the kit's capabilities such as `mail.read`) is only pre-ticked. Writes are marked as asking every time. Another personal app is never offered.

**Tokens** (`hub/tokens.ts`, tables `hub_apps` and `hub_tokens`): an access token lasts an hour, its refresh token 30 days. A refresh token is used once and rotates. Presenting a spent one ends every token the app holds. The proxy lets a hub token reach only `/api/integrations/mcp`, as `hub_app` scope, and a viewer key or any other key there gets the harness surface, never an app's.

**What the app sees** (`hub/serve.ts`): exactly its grant, read on every request. Each granted tool is limited to the accounts it was granted on (one account is fixed, several are named with `account`), runs through the same gated `runAction` as every caller, as the app. Ri's own services are tools named `ri__<name>`: `ri__get_task`, `ri__get_note`, `ri__list_tasks`, `ri__list_notes`, `ri__create_task`, `ri__create_note`, `ri__ai_text`, `ri__extract_text`, `ri__read_web_page` (`hub/ri-services.ts`). Creates take an `operationId` so a retry returns the same record.

**Approvals.** Every write an app makes asks the person, whatever the action's own setting and even in development (`approval.ts`, `hubApp` caller). The answer is `{"status":"approval_required",...}`. The approval shows on the app's page in Ri, and as a card in the chat that started the call, if a chat did. Approving licenses the app's identical retry once within five minutes, from its job or any chat.

**What started a call** (`hub/origin.ts`), for the audit log and where an approval shows: a job names itself in the call's `_meta` (`app/job`, `app/jobRun`), as the kit's connector client does. Otherwise, while Ri is calling the app for a chat or for the person on its screen, the app's hub calls are attributed to that chat or person, matched by the app's address. Two callers at once, or none, is the app on its own. None of this is access.

**Audit and controls** (table `hub_calls`, `hub/manage.ts`): every call is logged with the tool, account, outcome and what started it. Apps → What your apps can reach lists every app with its grant, and each app's panel (also on its page when Ri connects to it) shows its grant with Remove for an account or a tool, the writes waiting for the person, its recent calls, and one switch that turns it off. Removing or turning off stops the next call and drops its waiting writes.

**Trust.** Hub tokens limit what goes through the hub. They don't stop an app's code reading files its user can read (shared spec, Trust).

## What was removed

On November 12, 2026, Ri's own app package system was removed, since nobody used it and each thing is now done one way:

- `@ri/app-kit` (`packages/app-kit`), the local app engine (`src/lib/local-apps`), its routes (`/api/local-apps/*`, the `localApps` tRPC router), the catalog and packaging scripts (`apps:catalog`, `apps:dev`, `scripts/local-apps-*`), the builder for app drafts, and its documents.
- The bundled apps: People, Job search, Travel and Bookmarks. Their product specs stay in `docs/` to port later on the kit.
- Finances moved, with its history, to its own repository (`~/dynamism/apps/finances` on the owner's Mac).

Everything is in git history at `3c442810`, the last commit that had it.

Keys made for local apps (`api_keys.role = 'app_client'`) reach nothing now. The proxy refuses them.
