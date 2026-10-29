# Rail: agents first (trial)

**Status:** trial, on by default since 2026-09-30, reworked the same day. Switch back in Settings → General → Agents → "Agents in the rail". The same select has a third style, [Agents only](#agents-only-trial), since 2026-10-29. The switch only changes how the Agents list is drawn: agents count wherever attention is counted in either style.

Code: `src/components/workspaces/agent-rail-row.tsx` (the agent row), `src/components/workspaces/agent-attention-row.tsx` (an agent in a list of things that want you), `src/hooks/use-agent-attention.ts` (which agents want you), `src/lib/utils/agent-rail.ts` (the rules), `src/lib/client/rail-style.ts` (the switch). The rail feed's `mainChats` comes from `listAgentMainChats` plus `waitingOn` in `GET /api/sessions/rail`.

## The question the rail answers

A glance at the rail should tell you three things, in order: does anything want me, is it the agent itself or its work, and what does it want. Two kinds of conversation live under an agent, and they send you to different places:

- **The agent itself**, its main chat. It can be waiting on you, have a new reply, be thinking, or be quiet. You go to the agent.
- **Its work**, the executions. Each has the same states. You go to that execution.

So there's one state vocabulary for every conversation, the same colors and shapes everywhere, and **each row shows only its own state**. Nothing is counted twice.

**Attention and activity are different.** Waiting on you and a new reply are about you, so they count wherever "wants you" is counted. Thinking is about work: it shows on the agent's own row, but it doesn't add to the header's Working count, which stays about executions. That's the rule the phone already followed (`executionActivity`).

## What you see

**The agent row** is the agent, which is its main chat, so clicking opens it.

- A dot on its icon: amber and pulsing when it's waiting on you, amber when it has replied since you last looked, green and pulsing while it's thinking.
- Its name, bold when it wants you, regular when it doesn't. That's the email and chat norm for unread.
- A second line in its voice, the way a chat list previews the last message, because what it said is the best answer to "should I go in?". The question it's waiting on, "Thinking…", its new reply, or (quiet) what it last said. An agent that hasn't spoken yet shows its purpose. One with no purpose either shows no second line. It used to say "No messages yet", which is about the agent's own chat but read as the agent having no executions.

**Executions** sit under the agent, one 32px line each, inset so their dots sit under its icon: a status dot, the label, and on the right the pin, where it runs when that's not this machine, and time. On hover those give way to the row's actions, the pin and ⋯ ([rail.md](rail.md)). No diff stats: in the rail they don't help decide where to go, and they live in the execution's header and the agent's Overview.

**Which executions show:** every one with activity in the last week, however many, and nothing else is capped. Executions idle past the inactive threshold (pinned ones included, `docs/inactive-executions.md`) fold behind "N inactive hidden" with Show, the same toggle as every other list. The execution open right now always stays. This replaced a cap of "every live one and the three most recent quiet ones, the rest behind N more": two rules for what hides, one arbitrary, stacked two toggles under an agent and left the "more" ones unexplained. One rule now: untouched for a week means tucked away.

**Hiding executions** is one click on the agent row's hover (the chevrons next to +). Hidden executions fold into one line, like "› 6 executions · 1 needs you · 2 working", so hiding never hides what wants you, and clicking that line shows them again.

When chats are hidden, hovering the agent's header opens its chat chooser beside the rail, using the same full-height flyout as Apps. The header stays at the top while long chat lists scroll beneath it. Selecting a chat opens it without expanding the list. Inactive chats, their Show toggle and each chat's menu work the same as in the expanded list. Right arrow on the agent's name enters the chooser from the keyboard. See [rail.md](rail.md) for timing and dismissal rules.

**Needs you** (the group at the top, formerly Unread) lists everything that wants you across agents: agents first, then executions, the same order as the tree. The header's Unread and Needs approval pills and the collapsed rail's Agents badge count agents the same way, through `useAgentAttention`, so they always agree with each other and with the agent's own row.

Opening an agent marks its main chat read (`HarnessChat` does on mount), and the rail's cache updates at once (`useMarkSessionRead` patches `mainChats` too), so its "New reply" clears as soon as you look.

## Agents only (trial)

**Status:** trial, added 2026-10-29, off by default. Turn it on in Settings → General → Agents → "Agents in the rail" → Agents only. The same select switches back to Agents first or Classic.

The idea: the rail lists agents and nothing else, so the way into work is talking to an agent. It changes only what the rail shows. Every chat's state (working, waiting on you, unread) is tracked exactly as before and shows everywhere else it did.

What changes, all in the client (`railStyle` `agentsOnly`, no schema):

- **No chats under the agents.** No thread rows, no Show chats toggle, no folded "N executions" line. Clicking an agent always opens it.
- **Each agent shows only its own state**, as in agents first: the dot, the bold name and the line in its voice are its main chat's. Its chats' states aren't drawn on it. They show where chats are listed: resting on the agent, the agent's Overview, the header's pills and Board.
- **No Needs you group.** The header's pills count every chat from every view.
- **No Agents | Recent switch, no select-to-archive.** Recent is a list of chats, and there are no chat rows to select. Search chats finds any chat, archived ones included.
- **Pins stay.** Pinned chats sit at the top, above an Agents label with New agent at its right. A pin is the escape hatch for the chats you're hands-on with. Pin one from its header or from the agent's peek.
- **Resting on an agent peeks at its chats** beside the rail (the collapsed-agent chooser, `AgentChatsFlyout`), each with its own dot.
- **An open chat lights its agent**, a shade lighter than the agent itself open, since the chat has no row of its own. That's where you are, not a state.

### Coming back to an agent

Opening an agent reads its main chat (`HarnessChat` marks it read on mount), so a reply you looked at but haven't dealt with stops showing. Two ways to put it back, in every rail style:

- **The chat bar's Mark unread** (`ReadStateButton`, `src/components/chat-ui/read-state-button.tsx`), beside Schedule in the agent's main chat bar, where you are when you decide. Marked, it reads "Unread" in amber, and a click marks it read.
- **Mark as unread / Mark as read** in the agent's ⋯ menu in the rail.

Both set the main chat's own `unread_marker_at`, the one a chat's Mark as unread sets, through the optimistic hooks, so the rail, the header's Unread count and the button agree at once. The agent stays bold with a dot until you open it again. A reply that lands while you're watching still reads it (the running to idle mark in `HarnessChat`).

What to watch:

- Do you talk to the agent more, or go around it through the peek and Search chats?
- With chats' states off the rail, are the header's pills enough to notice work that wants you?
- Does Mark unread get used to come back to an agent, and is the chat bar the place you reach for it?

Not done on purpose: the phone (its own agents list), the desktop app's activity, and the New chat row at the top, which still starts a chat without picking an agent.

## Findings along the way

- **Structured questions haven't reached any chat since mid-August.** The run-everything permission mode starts Claude with `--dangerously-skip-permissions`, and in that mode the question tool isn't available, so agents ask in plain text instead. In prod the last structured question was on 2026-08-12, from a chat in the same mode, so something changed after that, likely the Claude CLI or agentex. It affects executions and main chats alike. For the rail it means an agent's question usually arrives as a new reply, with the question in its preview line, and "waiting on you" comes mostly from permission prompts in the other modes. Worth its own fix.
- **Needs you counts the Heartbeat chats, the header pills don't.** Scheduled runs are Needs Review candidates but not rail sessions. This predates the trial.
- **The desktop app's activity** (`/api/desktop/activity`) still counts executions only. Its click targets open sessions, not agents, so agents there need a contract change.

## What to watch during the trial

- Is the agent's voice line enough to decide whether to go in, or do you still open agents to check?
- Is bold plus a dot the right strength for "the agent wants you", or too quiet?
- Do three quiet executions hide something you reach for often?
- With agents carrying their own state, does the Needs you group earn its space at the top?

## Retiring the switch

If agents only wins: drop the thread rows, the fold line and the chevrons from `AgentRailRow`, and retire `NeedsReviewSection`, `HistoryView` in the rail and the list header's switch and selection. If it loses: delete the `agentsOnly` branches. Mark as read and Mark as unread on the agent stay either way.

If agents first wins: make `AgentRailRow` the only agents row, delete `WorkspaceRow` and `rail-style.ts`, and move the Pinned group to the compact row. If it loses: delete `agent-rail-row.tsx`, `rail-style.ts` and the compact density. Keep `useAgentAttention` either way, since agents counting where attention is counted doesn't depend on the style.

## Board trial

The rail now has one Board destination with Agent Activity and Tasks views. Agent Activity expands the HUD's existing status populations, including agent main chats needing attention, without merging task lifecycle and conversation status. HUD popovers remain available and can expand their bucket into Board. Column visibility is a separate saved presentation preference for each view. See [Board trial](board-trial.md).
