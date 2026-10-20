# Connected MCP apps

Connected MCP interfaces use the same account and integration engine as their tools. There is no second installation, copied account, synthetic Ri package, or separate demo server. Settings → Plugins retains its existing UI.

## Security

Every rule below was re-derived on October 20, 2026 from three facts, and kept only where it names a realistic attacker, what they would get, and why it is the simplest thing that stops them.

- A connected app's screen is that app's own code, from a server the person chose to connect. Its server already has everything it produced, and the screen can pass anything it holds back to that server through its own tool calls. Ri doesn't protect an app's data from the app.
- Ri protects everything the app wasn't given: Ri itself (its page, storage, tokens, other chats and apps), input meant for Ri, files and context the person didn't hand this app, and actions they didn't intend.
- Ri's server runs on one thread. Nothing it receives from a remote server may be able to stall it.

| Rule | Attacker | What they'd gain | Decision | Reason |
| --- | --- | --- | --- | --- |
| A screen runs in an opaque, sandboxed frame (a relay frame holding the view) | The screen | Ri's page, storage, tokens and other chats | Kept | It is the isolation. Nothing the screen runs inside it reaches Ri. |
| Network only to the domains a screen declares (connect, resource, frame, base) | The screen | Requests to the person's own computer and local network | Kept | Ri's session cookie is `SameSite=Lax`, so a screen's requests to Ri carry no credentials. What an open network would expose is unauthenticated local services. The declared domains are listed on the connection page. |
| A remote app's screen never reaches the person's local network, even if it declares an address there | A remote app's screen | Requests to the person's localhost and LAN services | Kept | A remote app has no business there, and it is where unauthenticated services live. Localhost, loopback, `.local`, private and link-local IPv4, and the IPv6 loopback, unique-local and link-local ranges are dropped from its policy, and the connection page lists them as not allowed because they're on the local network. An app whose server runs on this computer (a catalog command or a loopback URL, the rule files use) keeps them. To reverse it, set `KEEP_REMOTE_APPS_OFF_THE_LOCAL_NETWORK` to false in `packages/mcp-apps-host/src/csp.ts`. A public name that resolves to a private address isn't caught here and is left to the browser. |
| Declared domains are kept to real origins | The app's server | A wider policy for its own screen (a bare `*`, a keyword, an extra directive) | Kept | One parse, so a declaration can only name sites (`cspSource`). |
| Refusing screens that declare network | None | Nothing | Removed | The declared domains are enforced by the frame's CSP. |
| Script hashes, the server-side HTML scan, nesting and tag caps | None | Nothing outside the frame | Removed | Inline scripts and `eval` reach nothing outside the frame, and parsing let a server stall the Home. Ri no longer parses an interface. |
| 12 MiB interface cap | The app's server | The Home's memory | Kept | The simplest bound on what Ri holds and relays. |
| WebRTC constructors removed, desktop app's WebRTC proxy policy | The screen | Sending its own data to a host it didn't declare | Removed | WebRTC can't make HTTP requests to local services, and what it can send is the app's own. A chat's Preview of the person's own WebRTC app works in the desktop app again. |
| Form submissions cancelled inside the frame | None | Nothing | Kept, as function | It keeps a submitted frame off an error page. `form-action 'none'` blocks the request anyway. |
| Requested permissions (camera, microphone, geolocation, clipboard write) are not granted | The screen | The person's devices | Kept | Granting nothing is the default, and Ri has no place to ask. |
| External links open only as `https:` | The screen | Ri's page opening a `javascript:` or `file:` URL | Kept | Ri's own page opens the link. |
| Focus guard (Chromium and Firefox) | The screen | Keystrokes meant for Ri's composer | Kept | Measured on October 20: Chromium and Firefox 153 let a cross-origin frame take focus without user activation. WebKit (Safari) blocks it itself. Only the relay can tell a real click from a steal. |
| An app's message always becomes a draft the person sends | The screen | Words sent in the person's name, which an agent with the person's full access would act on | Kept | The person reads every word before it reaches an agent. `send` is not read. |
| The activation stamp, 5-second send spacing, 30 sends per view, the window after focus leaves, sentByApp and its From chip | None | Nothing | Removed | No app sends anything, so nothing needs authorizing. |
| A new chat an app asks for reuses an empty one and never ends a working one (`forApp`) | The screen, with no click needed | Churning the person's chats, or ending a running turn and the sends queued in it | Kept | A chat nobody has written in is already new, and a working one gets the draft instead. An execution reuses its newest empty chat. |
| A view's uploads capped at 64 MiB | The screen | Filling the Home's disk with draft attachments | Kept | The simplest bound. |
| A screen's messages capped at 16 MiB plus 64 KiB, 100 a second and 24 MiB a second, in the relay | The screen | Freezing Ri's tab | Kept | One place, the relay, which is the only thing that posts as a view. |
| Source markers (`[[source:…]]`) broken in what an app writes into a draft | The screen | Binding the person's accounts through a draft they send | Kept | Only the person chooses sources. It covers connected and local apps. |
| Thumbnails and images from a screen shown only as `data:` images | The screen | Ri's page, which has no CSP, fetching any URL for it | Kept | Otherwise a screen would reach past its declared domains. |
| The approval card lies over the screen and arms after 500 ms | The screen | A click it asked for (on a button of its own) landing on Allow once | Kept | The app chooses when the card appears, so it can make it appear under a click it expects. |
| An app's tool calls go through the approval policy, as the app audience | The screen | Actions the person didn't approve | Kept | The person's approval settings apply to apps as to the agent. |
| A result acts only on the account it came from | An account swapped in after the result | Acting on an account it didn't come from | Kept | The only part of the old authority binding that protected anything (connection and source match). |
| Each operation checks the chat may use the account (agent scopes) | An agent's chat | Using an account its agent wasn't given | Kept | The person scoped agents to accounts. Global context goes only to chats that may use it, and frozen context is checked again at dispatch and when a device takes a queued send. |
| Authority revision digest (account, server, tools, scopes) | None | Nothing the access checks don't stop | Removed | Every operation checks current access, and every tool call goes through the current tool settings and approvals. A credential or capability refresh no longer closes an open view. |
| A result's page is fetched from the app's server on every open, never stored | None | Nothing | Kept, as function | The page always comes through the live access checks. If the server can't be reached or the account is disconnected, the view says so with Try again, and the reply text stays. |
| 2000-operation refusal, 512 MiB lifetime delivery cap | None | Nothing | Removed | They existed for a 30-minute life. Receipts now roll, and the per-call caps bound memory. |
| Per-call caps: 24 MiB result, 512 KiB and 8 MiB kept, 64 KiB input | The app's server | The Home's memory | Kept | The simplest bound per operation. |
| Result data in its own table, never with transcript pages | Another viewer reading the transcript | The app's widget-only data | Kept | The transcript event keeps only the result id. The data (server and connection, tool, input, output with the view's `_meta`, resource URI) loads only when a view opens, for as long as its chat exists. The 30-minute expiry is gone. |
| A remote MCP response is capped at 64 MiB per message | A remote server | Exhausting the Home's memory with an endless body | Kept | One thread, one bound. |
| Checks read the current integration build and refresh it in the background | An unreachable server | Every status poll and send waiting on reconnects | Kept | One thread. Only opening, reading, calling and launching wait for a fresh build. |
| Ri's own checks of form answers (required, types, bounds, patterns) | The app's server | A catastrophic pattern stalling the Home or the tab, otherwise nothing | Removed | The server validates its own form. Ri sends what the person entered. When the same call asks the same fields again, the form comes back with what the person entered and the server's message as the reason. Settings never run a server's `pattern` either. |
| Settings tool calls run as the person's own actions | None | Nothing | Kept | Opening the section, a change or a click is the intent, on the app's own tools. A tool turned off stays off. The `readOnlyHint` and Ask-first gates added on October 19 are gone. |
| @ search needs a read-only tool, and skips one set to Ask first | None | A card per keystroke | Kept, as function | A search runs on every keystroke, and approvals ask about writes. |
| An app's context and @ items reach the agent as untrusted data that grants nothing, @ items capped at 32 KiB each and 96 KiB a message | The app | Steering the agent into using the person's permissions, or flooding its context | Kept | The agent reads them as the app's words, labeled with the app (`<connected-app-data>`, `<ri-mentioned-resources>`). |
| A form goes only to whoever caused the call | Another chat or person | Seeing or answering a form meant for someone else | Kept | A form Ri can't place is refused. |
| Person-added form files only for a server on this computer | A remote server | Paths that mean nothing to it and describe this computer's folders | Kept | A `file://` URI is only meaningful here. |
| A file screen gets an opaque URI for the one file the person opened | The screen | Other files | Kept | It holds a handle, never a path. |
| `.git` refused, in any letter case | The app | Code run through `.git/config` or hooks | Kept | One check. macOS folders ignore case. |
| Each file operation resolves the path once with `realpath`, inside the folder | A symlink in the folder | An outside file or `.git` | Kept | The simplest check, and it judges a link by where it lands. |
| A file a server on this computer names stays outside Ri's home and agents' `.git` | A local server | Ri's database or tokens shown in its own view | Kept | The same `realpath`, on every use. |
| No symlink anywhere in a path, folder descriptors, hard-link refusal, verified-descriptor reads and saves | Someone swapping folders mid-read or mid-save | Redirecting a read or save | Removed | That person already has write access to the folder. |
| Saves write a temp file and rename it, honoring `ifMatch` | None | Nothing | Kept, as function | A crash or full disk never leaves half a file, and a save never overwrites someone else's change. |
| 32 MiB reads and 12 MiB saves | The screen or its server | The Home's memory | Kept | 12 MiB is what one relay message carries. |
| File errors reach the screen without paths | A remote app | The person's username and folder layout | Kept | Ri never gives a remote server this computer's paths. |
| Attachments are read only | The screen | Rewriting a message's history | Kept | An attachment belongs to a message. |
| `openai/files/open` only from a server on this computer | A remote server | Naming paths on this computer | Kept | A path only means something here. |

Not guarded, by decision: focus moving straight from one screen into another, and a screen taking focus back within a few seconds after the person clicked it with the pointer still on it.

## User experience

Chat is where a connected service is used. Only real application UI makes it an app you open: a screen that opens on its own.

- A connection whose server offers an interface, a standalone screen or a tool whose result renders, appears once in the Apps library. It can be found under Apps or Connectors. Tools-only connections retain their current management and chat paths.
- Only a service with a standalone screen (below) gets rows in the rail's Apps flyout and Open <name> commands in ⌘K, while one of its accounts can open it, beside installed apps (`docs/rail.md`). Each standalone screen is its own row, titled and marked as OpenAI's spec renders an entrypoint: the tool's `title`, then `annotations.title`, then `name`, and the tool's icon, else the server's (`serverInfo.icons`), else the catalog logo or a generic mark. ⌘K also finds a screen by its service's name. On the service's page, its first row is the one lit. A service whose interface only comes back as a tool result, such as Todoist's task list, has neither. It is used from chat with `@` and stays in the library and Connectors.
- `/apps/~connected/<server-id>` shows the service and exact account, connection management, Try in chat, and the recent results it can reopen. It has no tool forms, since the agent chooses tools and inputs in chat. Try in chat opens the main chat with the service's chip and a starter prompt written after it, ready to send, as ChatGPT's Try fills "@Todoist What's on my list today". Official catalog entries may carry a curated prompt (`starterPrompt` in `integration-meta.ts`). Anything else gets "What can you do with <name>?". Nothing is sent and no access changes.
- Open app appears only for a standalone screen. It calls that entrypoint with `{}` through the ordinary approval gate, with no input form, and the returned view fills the app page full screen. Choosing the app in the rail's Apps flyout or ⌘K (`?open=<entrypoint>`) opens the screen the same way. Once open, the URL names the screen (`?screen=<capture>`), so a refresh reopens it without calling the entrypoint again. Opening a screen that is already open returns to it (see Instances), and Reload in its header starts it over with a new call. An entrypoint that rejects `{}` shows its error plainly, with Try again as a new request. Leaving while it opens cancels it.
- A completed, authorized model tool call can add an interactive result to its chat. It reopens for as long as the chat exists, with its page fetched from the app's server each time. Expanding it beside the conversation moves the live iframe with `moveBefore` where supported, retaining the guest's state and the chat draft. Older browsers fall back to remounting the captured result. Opening, refreshing, or expanding never reruns the original model tool call.
- UI operations use the existing approval system. Allow once retries the same invocation, while Decline does not execute it. Closing a view or leaving a workflow cancels its pending requests and unused approval grants, including approval responses that arrive late. An operation already admitted to execution may finish. App approvals do not wake the agent to repeat the operation.
- The most recently updated live view can attach its acknowledged model context to the next human send in that exact chat, and the composer shows what it attached. A source mention identifies the account separately from selected view data. Context remains untrusted app data and confers no permissions.
- A source chip's Open <service> opens its latest live result beside that chat, or the account's Apps page when no result exists.
- An app's connection page lists the network domains its screens declared ("Network access", `connectedApps.network`), read once per capability revision, or says it declared none.

Connected views are enabled by default. `RI_MCP_APPS=0` disables them independently of `RI_LOCAL_APPS`.

## Supported interfaces

Ri supports standard `_meta.ui.resourceUri` (and `ui/resourceUri`), `text/html;profile=mcp-app`, tool visibility, authenticated `resources/read`, ordinary MCP results, `tools/call`, model-context updates, chat messages, HTTPS links, height changes, and inline and full-screen display. An interface may load what it needs from the domains it declares in `_meta.ui.csp` (`connectDomains`, `resourceDomains`, `frameDomains`, `baseUriDomains`) or OpenAI's `_meta["openai/widgetCSP"]` (`connect_domains`, `resource_domains`, `frame_domains`), joined (`declaredCsp` in `packages/mcp-apps-host/src/csp.ts`). Excalidraw loads its code from esm.sh, and Bits & Bolts' remote build loads model files from its own origin.

A standalone screen is a global entrypoint: a tool whose `_meta["openai/ui"].entrypoints` includes `{ "type": "global" }`, as in OpenAI's [MCP extensions spec](https://github.com/openai/mcp-extensions/blob/0d606217/docs/spec.md#global-entrypoint): ChatGPT lists it in the sidebar and opens it full screen, the server must accept `{}` as its arguments, and `ui.visibility` is ignored when it opens. Thread entrypoints open as a tab beside a chat and file entrypoints open a file (see Entrypoints and instances, and Files).

The compatibility adapter recognizes `openai/outputTemplate`, `text/html+skybridge`, `openai/widgetAccessible`, and `openai/ui` entrypoints. It supplies `window.openai` tool input, output, private tool-response metadata, theme, widget state, tool calls, draft suggestions, display requests, and external links through the same bridge.

A dedicated origin (`ui.domain`, or ChatGPT's `openai/widgetDomain`) is host-specific, so the view renders on Ri's own sandbox origin. Requested permissions (`ui.permissions`) are not granted, and the view renders anyway. Todoist's task list declares ChatGPT's domain, and Microsoft Flint's chart asks for clipboard write.

An inline view is exactly as tall as it reports with `ui/notifications/size-changed`, which the host clamps to 160 to 900 px, and it starts at 420 px until the first report. It is capped at 80% of the window, and the view scrolls inside only past that. `view-size.browser.test.ts` pins the height with the real component and CSS. On an app page, an open result carries Close in its own header row. A full-screen screen titled the same as its app shows no title row. A view may read its own server's resources (`resources/read`) and use the file it was opened for (Files). Downloading a file a view names (`ui/download-file`) is offered to local apps only. There is no picture-in-picture.

Each view's frames (a relay frame Ri owns, holding the view) are opaque and sandboxed (`allow-scripts allow-forms`), under one policy (`viewPolicy`): inline scripts, `eval`, WebAssembly, `data:` and `blob:` images, fonts, media and workers all run, and the network is refused except the declared domains. A remote app's screen is never given an address on the person's computer or local network, even one it declares (`KEEP_REMOTE_APPS_OFF_THE_LOCAL_NETWORK` in `csp.ts`), and the connection page lists those as not allowed. An app whose server runs on this computer keeps them. A public name that resolves to a private address isn't caught here and is left to the browser. Forms run their submit handlers, and a guard Ri puts first in every view cancels a submission the app left alone, so no form navigates the frame (`form-action 'none'` blocks the request anyway). `view-network.browser.test.ts` loads a declared origin and is refused an undeclared one.

## Implementation and authority

- `packages/mcp-apps-host` contains the shared `AppBridge`, opaque relay, CSP (`csp.ts`) and browser lifecycle. `packages/app-kit` re-exports it and inlines it at build time. The connected adapter has no local builder, app-kit, or domain dependency.
- The integration engine's trusted `prepareMcpResult` hook binds the resolved connection, caller, attempt and redacted original input before dispatch. Its observer receives the original MCP result after successful execution and stores it only if it still comes from the same account. Capture failure cannot turn a completed operation into a retryable failure. Private `_meta` is absent from model results and audit previews.
- `lib/mcp-apps/service.ts` binds captures to exact accounts and chats, reads only the declared UI resource on that account, and dispatches UI calls through `runAction` with app audience. Every operation checks current access: the server is on, the connection is active, it is the account the result came from, the chat may use it, and the transport is current. Viewer procedures also recheck the signed-in key before and after work.
- Checks that call nothing on the server (status polls, context, sends, the dispatch recheck, file watches) answer from the current integration build even past its age, while it refreshes in the background. Opening a view, reading a server resource, calling a tool and launching wait for a current build. A check reads runtime, connections and transport from one build.
- A model result's data (the server and connection it came from, the tool, its input and output with the view's `_meta`, the resource URI) is kept in its own table (`mcp_tool_results`), keyed by the result id with its chat. The transcript event (`mcp_app_result`) keeps only the id, so transcript pages never load result data. A view's page is never stored: each open reads it from the app's server through the live access checks, and a server that can't be reached or an account that's disconnected is said plainly, with Try again. Launched screens (global, thread, file, settings, preview) live in the Home's memory, 32 at most, and one that is gone says so and opens again. Operation receipts roll, keeping the latest 2000.
- Native launch preparation creates a server-owned view and invocation before any effect. Retries of an evicted or unknown launch fail instead of creating another invocation. Within a view, identical in-flight deliveries coalesce. Completed or uncertain failures are never replayed. Only a pre-effect approval pause permits a retry of the same input and identity.
- Cancellation is bound to the exact viewer, view and invocation. Cleanup clears only the matching pending approval and unused grant, and also runs when an in-flight request creates an approval after cancellation.
- Limits: 64 KiB input and 12 MiB interfaces. A captured result is at most 512 KiB. An app operation's result may be up to 24 MiB (Bits & Bolts reads model files of about 6 MB). Results of 512 KiB or less are kept, 8 MiB per view, so a duplicate delivery gets the same answer, and a larger one is delivered once. Context is capped at 768 KiB per update and 10 updates per second. A view's messages to the host are each up to 16 MiB plus 64 KiB (a 12 MiB file it saves, as base64), 100 and 24 MiB a second, and one too large or too fast gets an error. The host's messages to a view may be 64 MiB each.
- Ri's MCP endpoints report progress every 20 seconds while a tool call is in flight, when the client gave a `progressToken` (`withProgressKeepalive` in `src/lib/mcp/http-server.ts`), since Claude Code drops a request after 60 seconds without progress. Progress stops when the client cancels.
- Frozen context is stored only on an accepted human message and checked again on dispatch, on recovery, and when a device takes a queued send. A message refused before anything took it is final: the chat says why, and recovery never sends it later.

## Entrypoints and instances

OpenAI's [entrypoints](https://github.com/openai/mcp-extensions/blob/0d606217/docs/spec.md#mcp-app-entrypoints) are tools a person opens rather than the model, declared in `_meta["openai/ui"].entrypoints` on a tool with a UI resource (`viewMetadata` in `lib/mcp-apps/metadata.ts`). Every launch goes through `prepareConnectedLaunch` and the ordinary approval gate, with a kind:

- `global`: a standalone screen, opened full screen on the app's page with `{}` (above).
- `thread`: a tab beside a chat. The composer's app button lists the tabs a chat may open (`connectedApps.chatTabs`), only on accounts that chat's agent may use. A tab opens with `{}` in the pane beside the chat, and Reload in the pane starts it over. Opening or reopening a tab, or declining one, keeps what the pane showed until the new tab is there.
- `file`: the viewer for the extensions it lists (Files, below).
- `settings` and `preview`: an app a settings button or a form option names. These are not OpenAI entrypoints, only the same launch path.

Instances. [openai/mcp-extensions issue 54](https://github.com/openai/mcp-extensions/issues/54) asks whether a model's later call should reuse an open entrypoint app. It is unanswered. Ri's reading, pinned in `service.test.ts`:

- An entrypoint keeps one live instance: a thread tab per chat and person, and a global screen per person. Opening it again returns to that instance without calling the tool. `fresh` (Reload) starts over.
- A model's tool call never reuses an entrypoint instance. Its result shows in its chat on its own, as ChatGPT behaves today.
- An instance lives until it is reloaded, pushed out of memory by newer ones, or the Home restarts.

## Deep links

OpenAI's [deep links](https://github.com/openai/mcp-extensions/blob/0d606217/docs/spec.md#deep-links) open a global screen at an app-relative URL. Ri's form of the link is its own app URL: `/apps/~connected/<server-id>?open=<tool>&path=<encoded app-relative URL>`. The path must start with one `/`, carry no fragment and fit in 2 KiB (`normalizeDeepLink`).

- A new screen receives it in `hostContext["openai/deepLink"]` at initialization.
- A screen that is already open is moved in place: Ri sends `ui/notifications/host-context-changed` with the new `openai/deepLink` to the live view and records it, so a remount opens at the same place.
- OpenAI's `codex://` and `chatgpt://` schemes and plugin IDs belong to ChatGPT. Ri reads only its own link.

## Display modes

A UI resource's content item may carry OpenAI's `_meta["openai/ui"].availableDisplayModes` and `preferredDisplayMode` ([Display Modes](https://github.com/openai/mcp-extensions/blob/0d606217/docs/spec.md#display-modes)). Ri shows views inline and full screen, which in a chat means the pane beside it.

- A resource declares its modes only with an `availableDisplayModes` list naming inline or full screen. Any other `openai/ui` reads as omitted, which opens inline unless a supported `preferredDisplayMode` says otherwise.
- A model's result opens the preferred mode, else full screen when both are declared, else inline (`initialDisplayMode`). A full-screen result opens beside its chat when it arrives, if the pane is empty or holds another result that opened there the same way, which goes back into the transcript with its view intact. A tab, or a result the person moved beside the chat, stays, and the new result offers Open beside chat instead (`mayPlaceResult`). Results placed this way are remembered for the tab's session, and freshness is the result's age by the Home's clock. Where the browser can't move a live view (no `moveBefore`, as in Safari), a result never replaces another.
- A resource that declares only inline has no Open beside chat, and one that declares only full screen never shows inline. A view is offered only the modes its place can switch to, and a request for any other is refused.
- Entrypoints always open full screen, as ChatGPT does: a global screen on its page, a tab or a file beside a chat.

## Model context and messages

OpenAI's [model context](https://github.com/openai/mcp-extensions/blob/0d606217/docs/spec.md#uiupdate-model-context-extensions) and [message](https://github.com/openai/mcp-extensions/blob/0d606217/docs/spec.md#uimessage-extensions) extensions are advertised (`openai/modelContext`, `openai/message`) to every connected view that can honor them.

- `ui/update-model-context` replaces what that view attached before and is answered with `_meta["openai/modelContext"].updateId`, renewed only when the content changes. Text, images, resource links, embedded resources and structured content are accepted. Audio is refused, as the spec lists it unsupported.
- The composer shows each app's context as one chip: titled items (`openai/title`), text thumbnails (`openai/thumbnail`), images, links and embedded resources. Blocks marked `annotations.audience: ["assistant"]` are hidden from the person and still sent. Removing the chip drops the whole group, and the view receives `openai/modelContext: null`. A remounted view receives what it still has attached in `hostContext["openai/modelContext"]`.
- A global screen has no chat of its own, so the composer shows and sends its context only in chats that may use its account (`connectedApps.contextAccess`). If access changed by the time it is sent, the Home leaves it off, sends the message, and the response names what was left off (`connectedContextSkipped`).
- The model never sees block `_meta`. Images and embedded binary resources are saved as attachments when a message freezes the context, and the agent gets `[[file:...]]` markers that become paths.
- `ui/message` content becomes a draft. Untitled text becomes draft text. Titled text becomes one chip in the composer. Images and blobs become attachment chips, a resource link becomes its title and URI, and an embedded text resource becomes a titled chip. `_meta["openai/message"].target` is read from the request's own `_meta`, and `send` is not read.
- An app's message always lands as a draft the person sends, since agents act with the person's full access and the person reads every word first. Nothing an app sends is sent for it, and a `[[source:…]]` marker in what it writes is broken so a draft can't bind the person's accounts. A view's uploads are capped at 64 MiB.
- `active` is the view's chat, or the main chat for a view without one. `new` opens a new chat on the same surface with the draft, and nothing is sent (`forApp`): a current chat nobody has written in is reused, a working one is never ended (the draft goes to the active chat instead), and an execution reuses its newest empty chat.
- Focus: an app can call `focus()` on its own elements. Ri puts focus back where it was unless a Tab key in Ri just moved it, and when the pointer is on the view, asks the relay and returns focus to the view only if a real click activated it (`view-focus.browser.test.ts`).

## Forms

A server may ask the person to fill a form while a tool runs: MCP's form elicitation and OpenAI's [extended forms](https://github.com/openai/mcp-extensions/blob/0d606217/docs/spec.md#openai-form-elicitation) (`lib/mcp-apps/elicitation.ts`, `form-schema.ts`, `components/mcp-apps/form/`).

- Every MCP connection Ri opens advertises `elicitation.form` and `extensions["openai/elicitation"].form`. On 2026-07-28, a form arrives as an `input_required` round, with its schema in `_meta["openai/elicitation"].requestedSchema`, and `callTool` answers each round itself. On older connections it arrives as `openai/elicitation/create` or `elicitation/create`.
- A form goes to whoever caused the call. A model's call shows the form as a card in that chat, and an app's own call shows it over that app view. A 2026-07-28 round is matched exactly. A 2025-era request on the call's own HTTP stream is matched through the call's async context. A local process gets the run only while exactly one request is in flight. A form Ri cannot place is refused and never shown to someone else.
- Fields follow OpenAI's SDK shapes: text with suggestions (`x-openai-suggestions`), enums and titled options with descriptions, image grids once any option has `x-openai-thumbnail`, multi-selects, free-form lists, switches, and number boxes. Ri draws the right kind of field and sends what each holds (a number box sends a number), and it never checks the answer itself: required fields, types, bounds and patterns are the server's to judge. When the same call asks the same fields again, the form opens with what the person entered and shows the server's message as the reason. An error a server puts only in its tool's result shows in the chat. A form with any field Ri cannot render is reported as unsupported and never partly shown.
- Resource selection (`x-openai-input`) covers single and multiple choice, explicit and implicit selection, option thumbnails and previews. Implicit selection always lets the person add their own, any file without `userOptions`. A `resource_link` preview reads from the asking server. An `mcp_app_tool` preview opens that app through the approval gate.
- A person may add their own files only for a server on this computer (a catalog command Ri starts, or a URL on the loopback interface). An upload for a form may be any type, and one Ri doesn't know is stored and served as a download.
- A 2025-era form expires after 9 minutes, inside Ri's 10-minute inactivity limit. A 2026-07-28 round may wait 25 minutes. Each place holds four open forms at most, and the Home 32. The transcript records how each form ended (`mcp_form_response`) with the app's name, the outcome and the reason, through a reload or a restart.

## Settings

A server that publishes OpenAI's [structured settings](https://github.com/openai/mcp-extensions/blob/0d606217/docs/spec.md#structured-settings) (`capabilities.extensions["openai/settings"]`, with `readTool` and `updateTool`) gets a Settings section on its connection page, when its recorded capabilities name settings and its account is connected and on.

- The read tool runs with `{}` when the section opens and returns a schema, a value for every setting and an optional layout. Ri draws booleans as switches, string enums as choices, and text and numbers as fields that check `minLength`, `maxLength`, `minimum`, `maximum` and `multipleOf` before anything is sent. A `pattern` is left to the server. Groups appear in the server's order, and settings the layout leaves out follow in Other settings.
- A switch or a choice saves as it changes, and text or a number on blur or Enter. Ri sends only the settings that differ (`{"set": {...}}`). The values the server returns replace the page's. A refused change goes back to the saved value with the server's own message.
- A tool button is titled by the tool. A plain tool runs with `{}` and its text shows beside the button. A tool with an interface opens it in a dialog, launched as a `settings` view through the ordinary approval gate.
- Opening the section, a change and a click are the person's own actions on the app's own tools, so they run without an approval card. These calls carry `mcpSettingsCaller(actionId)`, bound to that one action. A tool turned off in the server's tool list stays off here too.

## @ search

A server can offer its own items in the composer's @ menu, OpenAI's [composer at-mentions](https://github.com/openai/mcp-extensions/blob/0d606217/docs/spec.md#composer-at-mentions): Bits & Bolts offers the parts in its library. It advertises `openai/mentions` with a `searchTool`, or the deprecated `_meta["openai/extensions"]["mentions/search"]` marker.

- Ri asks every such server the chat may use, in parallel, with `{query}` as the app, on the server's exact account. Each server has three seconds, so a slow one only leaves its group out. The mixed picker shows up to five items per app, and `@app:` up to 20.
- A search runs on every keystroke, so it never stops for approval: a search tool that would ask (not marked `readOnlyHint: true`, or set to Ask first) is skipped and says so. So is one turned off or not visible to apps.
- Choosing an item inserts the same chip an account mention uses. When the message is sent, and again on every dispatch, the account is rechecked for that chat, and Ri reads each item through the server's `resources/read` and gives the agent an `<ri-mentioned-resources>` block as untrusted data, 32 KiB per item and 96 KiB per message.

## Files

OpenAI's [file entrypoint](https://github.com/openai/mcp-extensions/blob/0d606217/docs/spec.md#file-extension-entrypoint) makes an app the viewer for the extensions it lists, such as Bits & Bolts' `cad.open` for `.stl`, `.3mf`, `.step` and `.stp`.

- Files come from a chat's attachments, an agent's own folder, and a chat's worktree. A chat attachment with a matching extension shows "Open with <app>" beside its chip and opens beside that chat. A file in an agent's folder shows the same control in the Files tab's viewer header and opens full screen. A chat's worktree file shows it in that chat's Files viewer. Opening calls the entrypoint with OpenAI's `FileInput` through the ordinary approval gate.
- The app never sees a path. Ri gives it an opaque URI (`ri-file:<random id>`) and answers `resources/read`, `resources/subscribe` and `openai/resources/write` for that URI itself (`src/lib/mcp-apps/files.ts`). A view may use only the file it opened.
- Each read, watch and save resolves the file once: the path as written may not contain `..` or `.git` (in any letter case), and its `realpath` must land on a regular file inside the folder and outside `.git`. A symlink is judged by where it lands.
- Reads honor `_meta["openai/resource"].representation` and go up to 32 MiB. Each content item carries a content-hash `etag` and `writable`, true only for a file in an agent's or chat's folder, not archived, with the file and its folder writable on disk. Attachments are read only.
- A save compares `ifMatch` with the current etag (`conflict` with the current one), refuses more than 12 MiB (`too-large`), writes a temp file beside the original with its mode, then renames it over the original. One save per file runs at a time. A file system error reaches the app as a fixed sentence without paths.
- A watch follows the file's folder and reports only a change in content. The view's own save does not echo back to it. The browser long-polls (`connectedApps.files.changes`) and the host relays `notifications/resources/updated`. A watch ends on unsubscribe or when its view closes.
- A file view's tool calls carry `_meta["openai/resource"].path` only for a server on this computer, since a path means nothing elsewhere.
- `openai/files/open` is honored only from a server on this computer, for a regular file outside Ri's own home (attachments aside) and never inside an agent's `.git`, checked on every use. The file opens in the asking app's own viewer when it handles the extension, else Ri's preview (an attachment, or the agent's Files tab).

## OpenAI MCP extensions: compatibility

Every extension in OpenAI's [MCP extensions spec](https://github.com/openai/mcp-extensions/blob/0d606217/docs/spec.md) (commit `0d606217`), as Ri hosts it. The last column names the tests that pin each row.

| Extension | Ri | Where it lives | How it is verified |
| --- | --- | --- | --- |
| Server capabilities (`extensions` on 2026-07-28, `experimental` before) | Supported | `mcpServerProtocol` in `lib/integrations/mcp-servers.ts` | `mcp-servers.test.ts` |
| Entrypoint icons and titles | Supported | `entrypointIcons`, `toolTitle`, Apps flyout, ⌘K, app page | `metadata.test.ts`, `app-places.test.ts` |
| Global entrypoint | Supported | App page full screen, rail and ⌘K rows, `prepareConnectedLaunch` | `service.test.ts`, `page.browser.test.ts` |
| Deep links (`openai/deepLink`) | Supported, Ri's own link form | `?open=<tool>&path=`, `navigateConnectedScreen` | `service.test.ts`, `page.browser.test.ts`, `host.browser.test.ts` |
| Thread entrypoint | Supported | Composer app button, `ConnectedCompanion`, `connectedChatTabs` | `service.test.ts`, `mcp-app-launch.test.ts`, `companion.browser.test.ts` |
| File entrypoint | Supported for attachments, agent folders and chat worktrees | `lib/mcp-apps/files.ts`, `OpenWithApp` | `files.test.ts`, `view-files.browser.test.ts`, `open-with.browser.test.ts` |
| Filesystem access (`_meta["openai/resource"].path` on tool calls) | Supported for servers on this computer | `fileCallMeta` | `files.test.ts` |
| `resources/read` representation | Supported | `readHostResource` | `files.test.ts` |
| Resource subscriptions | Supported | Folder watch and long poll | `files.test.ts`, `view-files.browser.test.ts` |
| Resource writes (`openai/resources/write`) | Supported for agent folders and chat worktrees, atomic, up to 12 MiB | `writeHostResource` | `files.test.ts`, `view-files.browser.test.ts` |
| Structured settings | Supported | Connection page section, `lib/mcp-apps/settings.ts` | `settings*.test.ts`, `mcp-settings.browser.test.ts` |
| Display modes | Supported, inline and full screen | `resourceDisplayModes`, `initialDisplayMode`, `mayPlaceResult` | `metadata.test.ts`, `host.browser.test.ts`, `mcp-app-panel.test.ts`, `companion.browser.test.ts` |
| Network domains (`ui.csp`, `openai/widgetCSP`) | Supported, listed on the connection page | `csp.ts`, `connectedApps.network` | `csp.test.ts`, `view-network.browser.test.ts`, `mcp-app-network.test.ts` |
| Plugin onboarding (`onboardingSkill`) | Not supported | | See below |
| Model context (`openai/modelContext`, update IDs, host state) | Supported | `updateConnectedContext`, `freezeConnectedContext`, composer context strip | `service.test.ts`, `view-extensions.browser.test.ts` |
| Model context titles, thumbnails and assistant-only content | Supported | Context strip, `modelInput` | `service.test.ts`, `view-extensions.browser.test.ts` |
| Message titles, target and send (`openai/message`) | Supported, always as a draft the person sends | `sendMessage`, `app-message.ts`, `forApp` new chats | `app-message.test.ts`, `view-extensions.browser.test.ts`, `view-focus.browser.test.ts` |
| Opening local files (`openai/files/open`) | Supported for servers on this computer | `openFileTarget` | `files.test.ts`, `view-files.browser.test.ts` |
| Composer at-mentions (`openai/mentions`, deprecated marker) | Supported | `lib/mcp-apps/mentions.ts`, @ menu | `mentions.test.ts`, `mentions.browser.test.ts` |
| Form elicitation (MRTR and `openai/elicitation/create`) | Supported | `lib/mcp-apps/elicitation.ts`, form card and view overlay | `elicitation.test.ts`, `mcp-client.test.ts`, `connected-form.browser.test.ts`, `form-outcome.test.ts` |
| Extended string schema, option descriptions, thumbnails, suggestions | Supported, validated by the server | `form-schema.ts`, `form-fields.tsx` | `form-schema.test.ts`, `connected-form.browser.test.ts` |
| Resource selection and previews | Supported. Person-added files only for servers on this computer | `form-schema.ts`, `form-fields.tsx`, `form-preview.tsx` | `form-schema.test.ts`, `elicitation.test.ts`, `connected-form.browser.test.ts` |

Not supported, and why:

- Plugin onboarding and the plugin manifest. `onboardingSkill` runs a skill packaged with a plugin when the plugin is installed. Ri connects an MCP server by URL and installs skills one at a time, and plugin bundles are not built yet (`docs/skills.md`, "Not built yet"), so there is no install moment to run it at.
- Picture-in-picture. Ri has no floating view, so `pip` is dropped from a resource's modes and refused on request.
- ChatGPT's link schemes (`codex://`, `chatgpt://`) and plugin IDs in deep links.
- `quickAction` on a global entrypoint and `preferredModelDisplayMode` on a tool. The spec does not define what a host does with them.
- Host context Ri does not set: `openai/interactionCursor`. An app defaults to the pointer cursor.
- Person-added files and folders for remote servers, writes to attachments, and `openai/files/open` from remote servers, as explained in Forms and Files.

## Bits & Bolts test server

[Bits & Bolts](https://github.com/openai/mcp-extensions/tree/main/plugins/bits-and-bolts) is OpenAI's sample app for its MCP extensions (Apache-2.0): a CAD parts library with a sidebar app, a thread tab, a file viewer, settings, @ search and forms. Ri uses it as the conformance fixture for connected apps. `pnpm bits-and-bolts` runs it as a local MCP server.

```sh
pnpm bits-and-bolts start    # build it if needed, then serve http://localhost:3917/mcp
pnpm bits-and-bolts status   # the URL, and whether it is up
pnpm bits-and-bolts stop     # end the server
```

- The first `start` fetches openai/mcp-extensions at a pinned commit and builds it in `~/.local/share/ri-bits-and-bolts` (`BITS_AND_BOLTS_HOME`), outside this checkout. Later starts reuse the build.
- It serves Bits & Bolts' own local store on `127.0.0.1` only, with no sign-in. One handler speaks MCP 2026-07-28 and 2025-era clients. The launcher is `scripts/bits-and-bolts/launcher.mjs`.
- The parts library, imported parts and settings live in `~/.local/share/ri-bits-and-bolts/library` and survive restarts. The log is `server.log` beside it.
- Nothing starts it at login. `BITS_AND_BOLTS_PORT` changes the port.
- The repository's remote build (`build:remote`) is not part of this command. It signs in over OAuth and its screens load model files from their own origin, which they declare, so they open in Ri too.

To use it in Ri, start the server, then open Settings, Plugins, Add MCP server. Name it "Bits & Bolts", set Server URL to `http://localhost:3917/mcp` and Auth to None, then Add and connect. Ri accepts `http://` only for localhost. Bits & Bolts then appears in Apps, the rail's Apps flyout and ⌘K, and Open app shows its parts library full screen. Its Parts Tray opens beside any chat from the app button by the message box, Open with on an `.stl`, `.3mf`, `.step` or `.stp` file opens its viewer, its settings are on its page in Plugins, its parts show in the @ menu, and asking an agent to pick a part shows its form in the chat.

To turn it off, switch its connection off or remove it in Settings, Plugins, MCP servers, then run `pnpm bits-and-bolts stop`.

## Qualification

Tests use synthetic accounts and independent MCP fixtures, not personal services. Browser tests drive the real host and components with sandboxed guests in Playwright's bundled Chromium, launched with `--disable-features=IsolateSandboxedIframes`, since Playwright loses nested sandboxed frames under load.

```sh
pnpm ts
pnpm exec vitest run src/lib/mcp-apps src/components/mcp-apps src/lib/client src/lib/chat-sources src/components/settings/sections/integrations
pnpm --filter @integrations/engine test
pnpm --filter @ri/app-kit test
```

History: the extensions landed on October 19, 2026, and two independent reviews that day added rules that this section's table re-derived on October 20, removing those that stopped no realistic attacker (git history has each round).

October 20, 2026, after the re-derivation: the root suite passed 7196 tests (one backup test, untouched here, failed under load and passes alone), the integrations engine 450 and app-kit 96, and typecheck and lint were clean. On the dev home:
- Bits & Bolts' local and remote libraries opened full screen. The remote one loaded its parts from the origin it declares (9 requests, none refused), where Ri used to refuse it.
- A real agent turn drew Excalidraw's diagram inline from esm.sh (161 requests, no CSP refusals) and showed Todoist's task list inline.
- The connection pages listed each app's declared domains, or that it declared none.
- The file checks passed: a symlink into `.git` or out of the folder is refused by where it lands, `.GIT` is refused, and a save replaces the file atomically.
- Focus was measured with Playwright's Chromium, Firefox 153 and WebKit: the first two let a cross-origin frame take focus from the composer, and WebKit doesn't.
