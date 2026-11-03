# Slack and Buzz conversations

Status: implemented, developed in `feature/slack-conversations` against main at `879da5eb`, including native team AI. No production server was restarted and no live Slack or Buzz account was connected during implementation.

Ri owns the conversation, identity checks, tools and work. Slack and Buzz provide another place to talk to the same agent. This keeps the orchestrator powerful without creating a second agent runtime or a second permission system.

## Scope and decisions

Slack account tools already search, read and write through the existing Connector. This change adds an agent people can mention or message. The account Connector and agent appear together in setup, but keep their distinct credentials and permissions. A bot identity does not grant access to a person's private messages.

Each connection has a name and a fixed destination: the personal orchestrator, a personal agent, or a selected team agent. Distinct Slack mentions require distinct Slack apps, for example Ri Personal and Ri Team. A message's sender cannot change the connection's destination. Buzz uses its own named identity and runs `ri acp` through `buzz-acp` or a custom desktop harness.

Each external thread has one ordinary Ri chat. Inputs are saved before dispatch and delivery acknowledgments. Replies and pending questions are saved to an outbox independently of the model turn. Ri keeps its existing harness, tools, permissions, team capabilities and member attribution. Reply delivery retries never repeat the model's work. Replies written from the Ri chat also reach its external thread.

Slack DMs address Ri directly. A channel mention starts a conversation, and messages from linked participants in that thread continue it without another mention. Ordinary channel messages do not start work. Edits, deletions, bot messages and echoes do not execute instructions. Slack conversations use their thread root, including native agent sessions in DMs. Reply in the thread to continue. A new top-level DM starts a separate chat.

Personal access is explicitly linked to the owner. Team users link their own Slack identity from their signed-in Ri session. Membership and the sign-in are checked again at dispatch and delivery. Team channels must be explicitly designated team-visible. Private team DMs are refused because team chat history is shared. Both Slack Stop and a text `stop` stop the corresponding work. Runtime permission approvals stay in Ri's existing human controls.

Buzz's ACP host supplies conversation context and enforces its author gate. The adapter runs with an explicitly configured Ri connection, accepts only configured Buzz channels, and never treats quoted author names as authenticated Ri members. Team Buzz connections are tied to the member who authorizes that bridge and must use Buzz's owner-only gate. ACP does not expose arbitrary local file, terminal or MCP server execution to the client. The configured Ri agent retains its own tools. Buzz replies are posted through its CLI, since Buzz does not publish ACP text chunks as channel messages.

## Checklist

- [x] Shared persistent connection, identity, thread, inbox and outbox queries and forward migrations.
- [x] Personal and native team dispatch, member attribution, replay safety and restart outcomes.
- [x] Slack Socket Mode, mentions, DMs, threaded follow-ups, native agent status, Stop and returned questions/results.
- [x] Buzz ACP adapter, stable routing, actual Buzz reply delivery and cancellation.
- [x] Setup UI for named connections, destinations, identity linking and connection status.
- [x] Integration tests for complete conversations, team access, duplicate delivery, failure/restart and ACP protocol.
- [x] Typecheck, lint, relevant regressions and operator setup documentation.
- [x] Guided Slack setup with token locations, an existing-app path, identity linking and desktop/mobile verification.
- [x] Persistent save confirmation at the setup location, detected identity links and a guided two-way test.
- [x] External conversation reply instructions and Slack delivery formatting with readable entity names.

## Connect Slack

Open **Settings > Conversations** in your personal Ri or the team's settings and choose **Slack**. Team AI must already be configured and enabled. A team administrator with sign-in management capability creates the connection. The screen shows the following steps, with every step visible so you can continue directly with tokens if the Slack app already exists.

1. **Choose your Ri destination.** Enter a name such as **Ri Personal** or **Ri Team** and choose its destination. Personal Ri can target the orchestrator or one of its agents. A team connection targets a selected team agent.
2. **Create or open your Slack app.** Click **Copy Slack app manifest**, then **Open Slack apps**. In Slack, choose **Create New App > From a manifest**, select the workspace and paste it. The manifest configures the native agent view, Socket Mode, scopes and subscriptions. If you already finished this, open the app's settings and go straight to step 3.
3. **Get your app-level token.** Slack opens **Basic Information** after creating the app. On that page, open **App-Level Tokens > Generate Token and Scopes**. Name it, for example **Ri Socket Mode**, add `connections:write`, and click **Generate**. Copy the `xapp-` token into Ri's **App-level token** field. Confirm **Socket Mode > Enable Socket Mode** is on. Socket Mode connects outward from Ri, so this setup needs no public Slack webhook.
4. **Get your bot token.** Next, open **OAuth & Permissions**. If the app is not installed, click **Install to Workspace** and approve it. Copy **Bot User OAuth Token**, beginning with `xoxb-`, and paste it into Ri's **Bot token** field. An already installed app's token is on this same page.
5. **Choose conversations and connect.** In Slack's channel details, copy each **Channel ID**, add this app to the channel and enter the IDs in Ri. Leave the list empty only for personal DMs alone. Team channels must be appropriate for the whole Ri team to read. Click **Connect**. Ri clears the tokens and replaces the form with the saved connection and a persistent **Slack app saved** confirmation naming its Ri destination. It focuses and scrolls to that card inside settings. This confirms the credentials were saved, not that a conversation has been tested. **Add another connection** reopens setup.
6. **Link your Slack identity.** Each participant opens Ri with their own sign-in and clicks **Link my Slack identity**. For a connected channel, type `@`, select the Slack app, and paste the generated `link …` command after its mention. Send it as one message. A personal connection also accepts the command in a DM with the Slack app. Slack replies **Your identity is linked. Send your message again to begin.** Ri checks every two seconds while the code is valid and shows **Slack identity linked** when the server detects the link. **Check link** also refreshes that status. Codes are single-use and expire after ten minutes. **Generate new link code** replaces an expired command.
7. **Test a two-way conversation.** Send a new message to the Slack app: **Hello. Can you hear me?** Include its mention in a connected channel, or use a personal DM. Wait for Ri's reply in Slack, then reply in that same thread: **What did I just ask?** An answer using the prior message verifies both directions and conversation context. Linking alone does not start model work. The same chat appears in Ri and can be continued there. Use Slack's Stop control or send `stop` to interrupt work.

**Update Slack tokens** includes the same token-location directions for an existing connection. It verifies the same Slack bot and workspace and keeps the saved chats and delivery progress.

Slack's **Create AI agent** wizard is an alternative to importing the manifest. Select **Starter agent**, enter the name and workspace, and finish the review and installation flow. Use that app's bot and app-level tokens in Ri. Check its scopes and event subscriptions against Ri's generated manifest. Ri supplies the runtime, so there is no need to run Slack's sample model application.

The manifest is a way to preconfigure the app, not another integration. Slack requires an `agent_description` inside `features.agent_view`, not an `enabled` flag:

```json
"agent_view": {
  "agent_description": "Talk to your Ri orchestrator or team agent."
}
```

If an earlier copied manifest reports **Invalid property 'enabled'**, replace that `agent_view` block with the one above. The corrected generator also enables writable DMs, limits Slack app names to 35 characters and converts the bot username to Slack's allowed characters. The app's display name remains the name you chose.

Agent View also expects `app_home_opened` in `settings.event_subscriptions.bot_events`. The generator includes it alongside mention, message and Stop events. If Slack warns about that subscription on a previously copied manifest, add `"app_home_opened"` to the bot events array. Opening the agent view does not itself start model work.

Create separate Slack apps and Ri connections for separately mentionable identities. A Ri connection's name alone cannot create another Slack user. For example, **Ri Personal** can point to your personal orchestrator while **Ri Team** points to the team's product agent. Each connection has a fixed destination.

If a token expires or rotates, use **Update Slack tokens** on the existing connection. Ri verifies that the new credentials belong to the same bot and Slack workspace. Saved chats and unsent reply parts are preserved. **Retry delivery** retries failed replies after a channel or credential issue is fixed. **Pause** keeps history and pending delivery. **Disconnect** removes the transport binding and credentials while leaving the Ri chat history.

### Slack says sending messages is turned off

For a personal connection, open [your Slack app settings](https://api.slack.com/apps), choose the app, then open **App Manifest**. Under `features.app_home`, set `messages_tab_enabled` to `true` and `messages_tab_read_only_enabled` to `false`. Save the manifest and reload Slack, then send the link command again. The surrounding `features` settings should stay in place. See [Slack's manifest reference](https://docs.slack.dev/reference/app-manifest/).

Some Slack settings screens also expose this under **App Home > Show Tabs > Messages Tab**, with an **Allow users to send Slash commands and messages from the messages tab** checkbox. The manifest path does not depend on that checkbox being visible.

Ri's generated manifest already contains `features.app_home.messages_tab_enabled: true` and `features.app_home.messages_tab_read_only_enabled: false`. Generating another manifest in Ri does not update an app already installed in Slack. Check the installed app's settings. If the message remains after enabling them and reloading, verify that you changed the same app in the same Slack workspace.

Team connections accept messages in explicitly connected channels. Their private DMs are refused by Ri because team chat history is shared, independently of Slack's message-composer setting.

### Review Slack messages

The existing Slack account Connector is the path for searching and reviewing messages outside the current bot conversation. Use **Connect Slack account tools** in Conversations, authorize the account, and make its tools available to the destination Ri agent through the normal Connector settings. Then ask Ri to review the messages you care about. That request can come from Ri or from a linked Slack conversation.

The agent connection supplies mention and DM delivery and permission to post its replies. It does not grant the agent your account's private conversations, automatically import your Slack inbox, or create a background review schedule. Those remain separate, explicit choices using the account Connector and Ri's existing automation tools.

## Connect Buzz by Block

1. Install the Ri CLI, Buzz CLI and `buzz-acp` on the computer that will run the bridge. Register a named Buzz agent identity on the intended relay, including its registered owner and membership in the channels you select. Keep that identity's existing `BUZZ_PRIVATE_KEY` and any relay authentication configured for Buzz.
2. In **Conversations**, choose **Buzz by Block**, a connection name, the Ri destination, the relay URL and allowed channel UUIDs. Click **Connect**.
3. Save the environment variables Ri displays. The bridge token is shown once and authorizes only this connection. Keep it with the bridge process's secrets. A remote Ri URL must use HTTPS. Localhost HTTP is supported. If the bridge should act as another team member, that person clicks **Authorize my Buzz bridge** from their own Ri sign-in and runs the prepared command on the bridge computer with its token loaded. This consumes a single-use code and changes the bridge's authorizing sign-in without granting connection management rights.
4. With those variables and Buzz's own credentials loaded, run `buzz-acp`. It launches `ri acp`, which forwards work to Ri and posts saved replies through `buzz messages send`.
5. Mention the named Buzz identity in an allowed channel. Its channel thread maps to a saved Ri chat. Buzz direct conversations use a stable DM binding. Follow-ups, questions, cancellation and later results use that binding.

The generated configuration has this shape. Use the actual values returned by your Ri, including its reachable server URL:

```dotenv
RI_CONVERSATION_URL=https://your-ri.example/api/integrations/conversations/acp/<connection-id>
RI_CONVERSATION_TOKEN=<shown-once-token>
BUZZ_ACP_AGENT_COMMAND=ri
BUZZ_ACP_AGENT_ARGS=acp
BUZZ_ACP_RESPOND_TO=owner-only
BUZZ_RELAY_URL=wss://your-buzz-relay.example
```

Ri does not need another model API key for this bridge. It uses the destination agent's existing harness and tools. Buzz still needs its own identity and relay credentials. The configured relay must match the Ri connection. If you lose the bridge token, disconnect and create a new Buzz connection.

For a Buzz Desktop custom ACP harness, use command `ri`, arguments `["acp"]`, and the generated environment. Name the Buzz identity itself as desired. Do not point Buzz at a separate model adapter when you want Ri to own the work.

### Team identity boundary

Slack authenticates each sender through its event transport and an explicit Ri link. Team dispatch uses that member's native team AI authority and records the member on the message.

Buzz's current ACP prompt does not carry an authenticated Ri member identity. The bridge therefore acts as its authorizing Ri member, initially the person who created the connection. A member can self-link through **Authorize my Buzz bridge**, which requires both their signed-in Ri session and possession of that bridge's token. Team bridges require `BUZZ_ACP_RESPOND_TO=owner-only`, and Buzz must register that member as the identity's owner. Other team members need separately authorized bridges. A shared Buzz bot that attributes arbitrary senders to distinct Ri members is not implemented. Quoted `From` names in a prompt cannot authorize that feature.

Team chats are shared team records. Team connections refuse private DMs rather than making private-looking conversations visible in shared history. Participants use explicitly connected channels. The Ri composer displays the external audience before messages are sent.

## Persistence, cancellation and recovery

- Connections store the provider identity, fixed destination and allowed channels. Credentials are encrypted under the home's config directory and never returned in connection lists.
- Identity links bind an external sender to the Ri sign-in that authorized it. Dispatch checks revocation and current team membership. Delivery also requires an active linked participant in that thread. Unlinking a private thread's sole participant prevents further delivery even if another identity remains linked elsewhere.
- Threads bind the provider's channel and thread root to one ordinary Ri chat. The configured agent retains its normal instructions, delegations, tools and execution limits.
- The inbox durably deduplicates provider events before Slack acknowledgment. Ordinary messages wait while their chat is busy. Stop overtakes queued work, cancels earlier queued messages in that thread and aborts the active turn.
- Pending runtime questions are relayed and answers return through Ri's existing question resolver. Permission requests direct the person to Ri's approval controls. External messages do not approve tools.
- The outbox saves final replies, questions, errors and messages written by a person from Ri. Delivery progresses by part and retries separately from model execution. Buzz keeps polling for later results after the initial prompt ends.
- Interrupted work is reported instead of automatically replayed. This avoids repeating side effects when a process restarts after a send was persisted.
- Delivery is at least once across a lost provider acknowledgment. Slack receives stable message IDs and both adapters save part progress, but a crash between remote acceptance and local acknowledgment can duplicate a reply. It does not repeat the model turn.

Current transport support is text, final responses and runtime questions. It does not stream every model token, synchronize message edits or transfer attachments. Existing account tools remain available for broader Slack operations when authorized.

### Response presentation

Each externally connected chat receives a presentation brief on every submitted turn, including resumed turns and work continued from Ri. It overrides Ri's interactive-card reply instructions with readable titles and relevant details, simple lists and ordinary Markdown. The agent keeps its existing tools, instructions and authority. Markers inside saved task and note bodies still create links normally. Slack and Buzz cannot render Ri's interactive cards, tables or custom widgets, so the reply explains when an action needs Ri's UI.

Slack additionally converts reply Markdown to Slack `mrkdwn` before saving it to the delivery outbox. Entity markers become their current titles, so an older chat still emitting `[[task:…]]` sends a readable name. Bold, headings, lists, code and web links use Slack's formatting, while local-file links do not become Slack links. The rendered text is saved once, so retries keep the same text and part boundaries even if a referenced task's title changes. The original Ri transcript is preserved. Buzz keeps its Markdown delivery.

## Migration and implementation map

`0030_external_conversations.sql` adds five tables: `conversation_connections`, `conversation_identities`, `conversation_threads`, `conversation_inputs` and `conversation_outputs`. `0031_conversation_delivery_indexes.sql` adds indexed lookups for connection threads and input events. These are forward migrations and do not rebuild existing chat tables or change chat rowids.

Migrations run through Ri's safe migration runner when the relevant home next starts. CLI agent calls do not apply them. Test on a dev or temporary home. This work did not restart or migrate the production home.

| Area | Code |
| --- | --- |
| Schema and persistent operations | `src/lib/db/schema.ts`, `src/lib/db/conversation-queries.ts`, exports in `queries.ts` |
| Identity, input dispatch and recovery | `src/lib/integrations/conversations/service.ts` |
| Slack manifest, Socket Mode and delivery | `src/lib/integrations/conversations/slack.ts` |
| Buzz stdio protocol and CLI delivery | `src/lib/integrations/conversations/acp.ts`, `src/cli/commands/acp.ts` |
| Connection-scoped Buzz HTTP protocol | `src/app/api/integrations/conversations/acp/[connectionId]/route.ts` |
| Setup API and credential storage | `src/lib/integrations/conversations/router.ts`, `secrets.ts` |
| Personal and team settings | `src/components/settings/sections/conversations-section.tsx` |
| Runtime output and pending questions | `src/lib/executor/apply.ts`, `src/lib/runs/finish.ts` |
| Destination instructions and audience | `src/lib/executor/session-spec.ts`, `src/components/executions/execution-composer.tsx` |

Review alongside `docs/orchestrator-harness.md`, `docs/homes-spec.md`, `docs/team-isolation.md`, `docs/integrations-current.md`, `docs/environments.md` and the current team authority implementation. The earlier Slack proposal is background, not an implementation contract.

## Verification

The tests exercise the real Ri message dispatcher and native team AI pipeline with a scripted harness and mocked provider transport. They cover member attribution and removal, self-linking, channel boundaries, duplicate events, changed retries, native Slack sessions and Stop, pending questions, reply part retries, credential rotation, uncertain restarts, human continuation from Ri, ACP initialization and bridge isolation. The migration test preserves existing chat rowids and full-text search results.

The setup screen has desktop and mobile browser coverage, including named Buzz setup, shown-once credentials and member-only Slack linking. TypeScript, targeted lint and the compiled CLI boot smoke check are part of verification. Live Slack installation, Buzz relay delivery and real model inference require an operator's credentials and are not claimed by these tests.

Initial implementation verification: 615 tests passed across 84 regression test files, plus both setup browser tests. `pnpm ts` and `pnpm cli:build` passed. ESLint reported no errors and two existing unused-variable warnings in `queries.ts`.

The subsequent manifest correction passed 35 focused tests, both setup browser tests, typecheck and lint. The new contract tests cover Slack's required `agent_description`, rejection of the unsupported `enabled` flag, app and bot name constraints and writable DMs. No live Slack API validation is claimed.

The guided setup passed all five browser checks, typecheck and lint. Browser coverage includes copying a manifest, continuing from an existing app, entering both tokens, saving a DM-only connection, moving to identity linking, replacing tokens, required team destinations and channels, mobile layout and the existing Buzz setup.

The save and linking follow-up passed seven browser checks, typecheck and lint. These verify focus and scrolling inside a settings scroll container on desktop and mobile, a persistent named confirmation, immediate rendering before the connection list catches up, disconnecting that confirmed save, automatic link detection, manual link checking, hiding the consumed code and revealing the two-way test. Credentials are still cleared after saving and Buzz's shown-once credentials remain available.

The response presentation follow-up passed 78 focused conversation, formatting and runner checks, all 29 instruction-delivery checks, the notification regressions and seven setup browser checks, plus typecheck and lint. Instruction tests cover fresh, resumed and cached turns across Claude, Codex, Cursor, OpenCode and Antigravity. A failed delivery followed by a task rename verifies that the retry still sends the originally rendered title. The native instruction path is covered, since conversation presentation must be delivered even when the harness already receives other instructions natively.

Run the focused conversation and migration checks with:

```sh
pnpm exec vitest run src/lib/integrations/conversations src/lib/db/conversations-migration.test.ts 'src/app/api/integrations/conversations/acp/[connectionId]/route.test.ts'
pnpm ts
pnpm cli:build
```

For an operator's first live check, link an identity and send one harmless message, answer one returned question, then stop a running request. Confirm the same conversation is visible in Ri and in its originating external thread. Repeat for the selected team agent with a non-owner member to verify attribution. For Buzz teams, perform that check using the member's owner-gated bridge.

## Primary references

- [Slack agent development](https://docs.slack.dev/ai/developing-agents/)
- [Slack Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode/)
- [Slack agent session status](https://docs.slack.dev/reference/methods/agents.sessions.setStatus/)
- [Buzz ACP harness and custom harness configuration](https://github.com/block/buzz/tree/main/crates/buzz-acp)
- [ACP session setup](https://agentclientprotocol.com/protocol/session-setup)

