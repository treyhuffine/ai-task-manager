# Rail: agents first (trial)

**Status:** trial, on by default since 2026-09-30. Switch back in Settings → General → Agents → "Agents in the rail". Code: `src/lib/client/rail-style.ts` (the switch), `src/components/workspaces/agent-rail-row.tsx` (the row), `src/lib/utils/agent-rail.ts` (its rules).

## Why

The rail was built when a workspace was a folder of executions. Its row was a one-line group header that also folded, dragged and opened, while each execution under it took two lines. So the children outweighed the parent, and the row said nothing about the agent itself.

Since the agent view (`docs/agents-view-spec.md`), an agent is someone you work with: it has a main chat that manages its work, and clicking it opens that conversation. The rail should read as a list of your agents, each saying what it's up to, with its executions as its threads.

## What changes

**The agent row** is two lines and leads:

- its icon, with a presence dot for its main chat: green and pulsing while it's thinking, amber and pulsing when it's waiting on you, amber when it has replied since you last looked
- its name
- a line in words: the main chat first ("Waiting on you", "New reply", "Thinking"), then its work ("1 needs you", "2 working"). With nothing going on, its purpose, else how many executions it holds, else "No work yet".

Clicking opens the agent's view (or folds, if "Clicking an agent" says so). The whole row still drags. New execution and a menu (new execution, hide executions, agent setup) appear on hover. The fold chevron and the redundant open arrow are gone. Hiding an agent's threads is a quiet menu item, not a control on every row.

**Executions** hang off the agent on one line each, under a thread line from its icon: a status dot, the label, and on the right the pin, where it runs when that's not this machine, diff stats and time. The kebab takes the right side on hover.

**Which executions show:** every live one (needs you, working, unread, pinned, or the one open now), then the three most recent quiet ones. The rest is a count ("4 more") that opens the agent's Overview, which lists everything.

The main chat's state comes with the rail feed (`GET /api/sessions/rail` → `mainChats`, from `listAgentMainChats`), so it refreshes with the execution rows. Thinking and waiting come from the same live sets the execution dots use.

**Unchanged:** the Pinned and Unread groups at the top, the Status and History tabs, the collapsed rail, the tablet rail and phones.

## What to watch during the trial

- Do the three quiet threads hide something you reach for often? If so, the cap should grow, or recency should count differently.
- Does the summary line tell you enough to skip opening an agent? Is "New reply" a useful nudge or noise?
- With agents carrying their own state, is the Unread group at the top still earning its space, or is it a duplicate now?
- The Pinned and Unread groups still use two-line rows. If agents-first sticks, they should probably match.

## Retiring the switch

If it wins: make `AgentRailRow` the only agents row, delete `WorkspaceRow` and `rail-style.ts`, and drop the `regular` density from `SessionRow` once the top groups move over. If it loses: delete `agent-rail-row.tsx`, `agent-rail.ts` and `rail-style.ts`, drop the compact density and `mainChats` from the rail feed.
