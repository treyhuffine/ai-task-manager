# Rail: agents first (trial)

**Status:** trial, on by default from 2026-09-30 (reworked the same day) until 2026-10-29, when [Agents only](#agents-only-trial) became the default. Choose it in Settings → General → Agents → "Agents in the rail". The switch only changes how the Agents list is drawn: agents count wherever attention is counted in either style.

Code: `src/components/workspaces/agent-rail-row.tsx` (the agent row), `src/components/workspaces/agent-attention-row.tsx` (an agent in a list of things that want you), `src/hooks/use-agent-attention.ts` (which agents want you), `src/lib/utils/agent-rail.ts` (the rules), `src/lib/client/rail-style.ts` (the switch), `src/hooks/use-open-chat-agent.ts` (which agent you're in). The rail feed's `mainChats` comes from `listAgentMainChats` plus `waitingOn` in `GET /api/sessions/rail`.

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
- No tooltip on hover, in every rail style and in Needs you. The icon used to name the dot's state and the name used to show a cut-off line whole, and a tooltip opening on every agent the pointer crossed was distracting. The dot's state stays in the icon's accessible name ("Ri: New reply"), and a line too long for the rail reads in full in the agent. The buttons that appear on hover keep theirs (New chat, Show or Hide chats, and Classic's ↗ that opens the agent). `rail-agents-only.browser.test.ts` checks both.

**Executions** sit under the agent, one 32px line each, inset so their dots sit under its icon: a status dot, the label, and on the right the pin, where it runs when that's not this machine, and time. On hover those give way to the row's actions, the pin and ⋯ ([rail.md](rail.md)). No diff stats: in the rail they don't help decide where to go, and they live in the execution's header and the agent's Overview.

**Which executions show:** every one with activity in the last week, however many, and nothing else is capped. Executions idle past the inactive threshold (pinned ones included, `docs/inactive-executions.md`) fold behind "N inactive hidden" with Show, the same toggle as every other list. The execution open right now always stays. This replaced a cap of "every live one and the three most recent quiet ones, the rest behind N more": two rules for what hides, one arbitrary, stacked two toggles under an agent and left the "more" ones unexplained. One rule now: untouched for a week means tucked away.

**Hiding executions** is one click on the agent row's hover (the chevrons next to +). Hidden executions fold into one line, like "› 6 executions · 1 needs you · 2 working", so hiding never hides what wants you, and clicking that line shows them again.

When chats are hidden, hovering the agent's header opens its chat chooser beside the rail, using the same full-height flyout as Apps. The header stays at the top while long chat lists scroll beneath it. Selecting a chat opens it without expanding the list. Inactive chats, their Show toggle and each chat's menu work the same as in the expanded list. Right arrow on the agent's name enters the chooser from the keyboard. See [rail.md](rail.md) for timing and dismissal rules.

**Needs you** (the group at the top, formerly Unread) lists everything that wants you across agents: agents first, then executions, the same order as the tree. The header's Unread and Needs approval pills and the collapsed rail's Agents badge count agents the same way, through `useAgentAttention`, so they always agree with each other and with the agent's own row.

Opening an agent marks its main chat read (`HarnessChat` does on mount), and the rail's cache updates at once (`useMarkSessionRead` patches `mainChats` too), so its "New reply" clears as soon as you look.

## Agents only (trial)

**Status:** trial, added 2026-10-29 and the default the same day. Settings → General → Agents → "Agents in the rail" switches back to Agents first or Classic. A browser where someone already chose a style keeps that choice.

The idea: the Agents list has agents and no chats, so the way into work is talking to an agent. It changes only what the rail shows. Every chat's state (working, waiting on you, unread) is tracked exactly as before and shows everywhere else it did.

What changes, all in the client (`railStyle` `agentsOnly`, no schema):

- **No chats under the agents.** No thread rows, no Show chats toggle, no folded "N executions" line. Clicking an agent always opens it.
- **Each agent's dot, bold name and line are its own**, as in agents first: its main chat's state.
- **Its chats count at the row's end** (added 2026-10-31): amber for the ones that need you (waiting on you or unread, pulsing while one is blocked on you), green for the ones working, in the header's colors. The header's pills count every chat. These say which agent's, which a glance at a row of agents couldn't. Inactive chats don't count. The counts give way to the row's actions on hover and open no tooltip (rows open none, 0afe117d). Screen readers get them as words ("2 chats need you, 1 working").
- **Unread under the pins** (since 2026-11-03), chats only: the chats waiting on you, one click away, the Needs you group with the agents' own rows left out (they say what they want on their own rows). Each row shows its chat's status line when its agent set one: what it needs and how long your part takes ([chat-status-lines.md](chat-status-lines.md)). A chat whose line waits on you stays here after a look, until you answer it or mark it read.
- **Agents | Recent stays** (back 2026-10-31, after a day without it showed coming back to Ri meant staring at the agents with no idea what was worked on lately). Recent lists every chat touched within the inactive threshold, whatever its status, archived included, newest first. Older ones fold behind "N inactive hidden" · Show, the one rule every list hides by. This applies in every rail style.
- **Selecting chats to archive happens on Recent** (back 2026-11-02, after the rail lost bulk archive along with its chat rows). The list header's Select chats to archive shows in every rail style, on both lists, and turns the list into Recent's active chats with checkboxes. See [rail.md](rail.md#selecting-chats-to-archive).
- **Pins stay**, under the switch as in the other styles. A pin is the escape hatch for the chats you're hands-on with. Pin one from its header or from its row in Recent.
- **Resting on an agent opens nothing** (since 2026-11-03, a trial). The chooser that slid its chats out beside the rail (`AgentChatsFlyout`) opened whenever the pointer rested on an agent, put the chats and its New chat a long way from the pointer, and couldn't show a chat's recent messages without a third layer. In its place, the row's hover actions carry **Show chats**, which opens Recent narrowed to that agent (`recent-filter-store.ts`, the same filter as Recent's agent pills, with Clear to widen it). There a chat shows its recent messages on hover, as every wide-rail row does. New chat stays among the row's hover actions. Agents first and Classic keep the chooser for collapsed agents.
- **An open chat marks its agent**, since the chat has no row of its own. See [Which agent you're in](#which-agent-youre-in).

### Coming back to an agent

Opening an agent reads its main chat (`HarnessChat` marks it read on mount), so a reply you looked at but haven't dealt with stops showing. Two ways to put it back, in every rail style:

- **The chat bar's Mark unread** (`ReadStateButton`, `src/components/chat-ui/read-state-button.tsx`), beside Schedule in the agent's main chat bar, where you are when you decide. Marked, it reads "Unread" in amber, and a click marks it read.
- **Mark as unread / Mark as read** in the agent's ⋯ menu in the rail.

Both set the main chat's own `unread_marker_at`, the one a chat's Mark as unread sets, through the optimistic hooks, so the rail, the header's Unread count and the button agree at once. The agent stays bold with a dot until you open it again. A reply that lands while you're watching still reads it (the running to idle mark in `HarnessChat`).

What to watch:

- Do you talk to the agent more, or go around it through Show chats, Recent and Search chats?
- Without the chooser, is a chat still quick enough to reach, and is a glance at what it holds still easy?
- Do the counts tell you which agent to open, and does Recent answer "what was going on" when you come back?
- Does Mark unread get used to come back to an agent, and is the chat bar the place you reach for it?

Not done on purpose: the phone (its own agents list), the desktop app's activity, and the New chat row at the top, which still starts a chat without picking an agent.

## Which agent you're in

**Status:** added 2026-11-02, in every rail style.

With an agent or one of its chats on screen, the rail marks that agent, so a glance says which agent you're in. It used to light an open chat's agent a shade lighter than the agent itself open (`bg-secondary/60`), which was too faint to notice.

- **One look for both.** The agent looks selected, the same fill as when its own page is open. The page already says whether you're on the agent or one of its chats, so the rail only answers "which agent". The agent's dot, bold name and line stay its own, since they're its main chat's state, not where you are.
- **Only where the chat has no row showing.** In agents only that's always. In Agents first and Classic the open chat's row is the selection while it shows, so the agent is marked only when its chats are hidden, the chat is folded with the inactive ones (Classic), or the chat is archived and never listed. Two rows never look selected at once.
- **Every chat counts.** A chat the rail lists marks its agent, a later chat of the same execution included (through `activeExecutionId`). One it doesn't list, like an archived chat opened from Recent or search, marks its agent from the chat's own row, which the chat view loads anyway (`useOpenChatAgentId`, `src/hooks/use-open-chat-agent.ts`).
- **Screen readers hear it.** The agent's open buttons carry `aria-current`: `page` when its own page is open, `true` ("current") when one of its chats is.
- **The collapsed rail's Agents flyout** draws the same rows, so it shows the same mark. A list too long for the flyout opens scrolled to the marked agent, centered. The flyout gets its height from Radix a moment after it opens, so the scroll waits for that, and it stops for good once it has scrolled or you scroll the list yourself.

Not done: the collapsed strip itself. Its Agents button shows as active on any agent or chat page but doesn't say which agent. The smallest signal would be that button drawing the agent's own icon in place of `Bot` while you're in one (the strip's buttons already take a `mark`), with its label saying "Agents, in Website". No new section and no per-agent icons.

`rail-agents-only.browser.test.ts` checks the mark in each style, that it matches the selected look, that it moves as you go, and the flyout's scroll.

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

If agents only wins: drop the thread rows, the fold line and the chevrons from `AgentRailRow`, and retire `NeedsReviewSection` and the tree's part of the archive selection (`SessionRow`'s checkbox, the agent rows' `selecting` guards). Recent, the switch and selecting chats to archive on Recent stay. If it loses: delete the `agentsOnly` branches. Mark as read and Mark as unread on the agent stay either way.

If agents first wins: make `AgentRailRow` the only agents row, delete `WorkspaceRow` and `rail-style.ts`, and move the Pinned group to the compact row. If it loses: delete `agent-rail-row.tsx`, `rail-style.ts` and the compact density. Keep `useAgentAttention` either way, since agents counting where attention is counted doesn't depend on the style.

## Board trial

The rail now has one Board destination with Agent Activity and Tasks views. Agent Activity expands the HUD's existing status populations, including agent main chats needing attention, without merging task lifecycle and conversation status. HUD popovers remain available and can expand their bucket into Board. Column visibility is a separate saved presentation preference for each view. See [Board trial](board-trial.md).
