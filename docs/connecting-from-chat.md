# Connecting accounts from chat

When a request needs an outside account, the chat shows a Connect card and the user connects it
there, without leaving for Settings. Before this, an agent could only say "I can't reach your
calendar" (it only gets tools for accounts already connected), and a connection that stopped working
hit the same dead end as approvals did: the tool said "the app is prompting the user" and nothing did.

Built on the approval card machinery (`docs/connector-approvals.md`): the server writes the card
into the chat that needs it, only a person can answer it, the answer is recorded, and the agent is
woken with a note.

## When a card appears

The chat never decides. It displays whatever card rows the server writes, in three cases:

1. **The agent asks.** It calls `request_connection(service, reason)` on the connectors MCP. The only
   model judgment in the whole flow is making that call. The tool exists in every chat (main chat,
   agent chats, executions), even with nothing connected, because an agent can't ask for what it
   doesn't know is possible.
2. **A connection stopped working.** A connector call returns `authorization_required` or
   `additional_permission_required` and the connectors route's pause hook writes a Reconnect or More
   access card (`recordPausedConnection`). Automatic, no agent involved. This includes a rejected
   API key: the engine used to report that as `provider_not_configured` (it has no sign-in app to
   rebuild), which read as a setup problem in Ri. It now returns `auth_required` with the host's
   connect page for that connection, so the card asks for the key again, and re-entering it updates
   the same connection.
3. **Connected, but not for this agent.** Either path above resolves to "Let this agent use it",
   which changes the agent's connector access (the same setting the Agents view writes).

### When the agent should ask

Stated in the tool description, the connectors MCP's server instructions, and one line of the chat
briefs. Ask only when all three hold:

1. **Need.** Finishing the user's current request needs data or an action in a specific outside
   service, named or clearly implied ("my inbox", "tomorrow's meetings", "the Linear ticket").
2. **No tools.** The agent has no tools for it. Its tool list is the map of what it can use. An
   agent with scoped access can't see what else is connected, so for it the tool description also
   names the services connected to Ri but not available to it yet (`connectedButUnavailable`).
   Without that, "look it up on the Team Calendar" reads like a vague calendar and the agent asks
   which one instead of asking for access.
3. **No substitute.** Nothing it has covers it. Ri's own tasks, notes, deck and stream never need a
   connector, and neither does pasted content.

If more than one service could fit (Google or Outlook calendar), ask the user which first.

### What the server decides

The agent names the service in plain words. `resolveService` (`connection-catalog.ts`) matches it
against the live catalog, most specific first: a service by name ("Gmail", "Google Calendar"), then a
provider ("Google": all its services), then a generic word ("calendar"). MCP servers the user added
match by the name they gave them. Then `requestConnection` answers:

| Situation | Answer to the agent | Card |
|---|---|---|
| Unsupported ("Spotify") | tell the user it isn't supported | none |
| Ambiguous ("calendar") | ask the user which | none |
| Usable here already | it's available (and its tools reload at the end of the turn) | none |
| Connected, not for this agent | card shown, stop and wait | Allow for this agent |
| Not connected | card shown, stop and wait | Connect |
| A card for it is already open in this chat | already asked, wait | none |
| The user said "Not now" earlier in this chat | don't ask again unless they bring it up | none (`user_asked` overrides) |
| No chat to put a card in (background jobs) | ask the user to use Settings | none |

`for_agent` asks on another agent's behalf. The card names that agent, the asking chat learns the
outcome, and that agent's sessions pick up the access.

## The card

A `connection_request` row with a `ConnectionRequestView`. The live provider status decides what
it offers, since setup can happen after the card appeared:

- **One-click sign-in** when the provider has a sign-in app (bundled, env, or saved by the user).
- **One-time setup** when it doesn't: the card links the vendor's developer console, shows the
  redirect URI to register (copyable), and takes the client ID and secret. Saved through the same
  route and encrypted store as Settings, then the sign-in continues.
- **A key field** for API-key services (Todoist, Stripe, Resend…).
- **Reconnect / Allow access** for a connection that stopped working or needs more access.
- **Allow for this agent** when the account is connected but the agent can't use it.

Keys and app secrets go from the card straight to the server. They never pass through the chat or
the agent. The agent's reason is shown attributed ("The agent says: …"), separate from app text,
and the logo and name come from the server's catalog, so a request can't pass itself off as the app.

The answer is a `connection_response` row (connected, allowed, or declined), durable across reloads
and restarts. A sign-in started from a card resolves it when the provider sends the user back
(`begin-connect.ts` hooks the web callback and the desktop flow). If that link is lost to a restart
mid-sign-in, the next click finds the account connected and resolves the card.

## Getting the agent moving

New tools only reach a harness when its process restarts (it lists them once, at spawn). So after
a connection or an allow, the server waits for the asking chat's current turn to end (bounded at
10 minutes), recycles its process (`recycleWhenIdle`, which resumes the same conversation), and
then sends the note: "The user connected Gmail (…). Its tools are available now. Continue." A
decline sends the note without a reload. A connection made for an agent is added to that agent's
connector access, which also recycles that agent's sessions.

## Off switch

Settings, Connectors, "Agents can ask to connect accounts". On by default, stored as
`connectorRequestsEnabled` in the app's `config.json`. Off removes `request_connection` (and its
brief lines) from chats started afterwards, and executions without connector access no longer get
the connectors MCP at all. Reconnect cards still show, since they come from a failed call, not an
agent's ask.

## Security

- Only a person answers a card. The card routes refuse agent session credentials, the proxy keeps
  session tokens to their own MCP servers, and no agent tool reaches them. The residual shared-key
  risk is the same as for approvals (`docs/connector-approvals.md`).
- An agent can only ask. Every completion is a human act: the provider's sign-in page, a key typed
  into the card, or the allow click.
- An agent never writes a sign-in app. It could otherwise choose where sign-in codes and tokens go
  (an app config sets the redirect URI and the API address). Only the user saves one, from the card
  or Settings.

## Measuring it

`scripts/eval-connection-requests.ts` runs about 15 prompts against a real agent on an isolated dev
home: requests that should ask, ones that shouldn't (Ri's own data, pasted content, no outside
service), ones that should ask the user which service first, and a "Not now" that must stick. It
grades each and prints a summary. Rerun it after changing the rule's wording.

```sh
pnpm tsx scripts/eval-connection-requests.ts --base http://localhost:42277 --home <dev home> \
  --mcp-url http://127.0.0.1:42288/mcp --out results.json
```

In real use, the ratio of "Not now" answers (too eager) to agents saying "I can't reach X" (too shy)
says which way to tune.
