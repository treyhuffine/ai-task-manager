# Rail: agents first (trial)

**Status:** trial, on by default since 2026-09-30, reworked the same day. Switch back in Settings → General → Agents → "Agents in the rail". The switch only changes how the Agents list is drawn: agents count wherever attention is counted in either style.

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
- A second line in its voice, the way a chat list previews the last message, because what it said is the best answer to "should I go in?". The question it's waiting on, "Thinking…", its new reply, or (quiet) what it last said. An agent that hasn't spoken yet shows its purpose.

**Executions** sit under the agent, one 32px line each, inset so their dots sit under its icon: a status dot, the label, and on the right the pin, where it runs when that's not this machine, and time. No diff stats: in the rail they don't help decide where to go, and they live in the execution's header and the agent's Overview.

**Which executions show:** every live one (needs you, working, unread, pinned, or the one open now), then the three most recent quiet ones. Everything else sits behind one toggle under the agent: the quiet overflow and the executions idle past the inactive threshold (pinned ones included, `docs/inactive-executions.md`) together, "5 more and 44 inactive hidden" with Show on the right. Show lists them in place, inactive ones last and dimmed, and each agent remembers whether it's open. One toggle, not one per kind: two stacked Show buttons under an agent read as two different things to choose between. The execution open right now always stays.

**Hiding executions** is one click on the agent row's hover (the chevrons next to +). Hidden executions fold into one line, like "› 6 executions · 1 needs you · 2 working", so hiding never hides what wants you, and clicking that line shows them again.

**Needs you** (the group at the top, formerly Unread) lists everything that wants you across agents: agents first, then executions, the same order as the tree. The header's Unread and Needs approval pills, the Status tab's buckets and the tablet rail's dots count agents the same way, through `useAgentAttention`, so they always agree with each other and with the agent's own row.

Opening an agent marks its main chat read (`HarnessChat` does on mount), and the rail's cache updates at once (`useMarkSessionRead` patches `mainChats` too), so its "New reply" clears as soon as you look.

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

If it wins: make `AgentRailRow` the only agents row, delete `WorkspaceRow` and `rail-style.ts`, and move the Pinned group to the compact row. If it loses: delete `agent-rail-row.tsx`, `rail-style.ts` and the compact density. Keep `useAgentAttention` either way, since agents counting where attention is counted doesn't depend on the style.
