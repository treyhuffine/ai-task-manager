# The rail and the header

The desktop shell has two pieces of chrome, and each has one job:

- **The header (top HUD)** shows what's happening, from every view: work by status (the Needs approval, Unread, Working and Waiting pills), the way out of an execution or agent (or back into the latest one, ⌘E), the next calendar event, and the budget warning.
- **The rail (left)** holds the places you go and the things you start: home, Board, Calendar, Schedules and Triggers, Create, Search, the list of work, and Settings.

Reworked 2026-10-05 from a rail that listed every execution even when collapsed, and a header that mixed status with buttons (Inbox, Board, Settings).

## Wide rail, top to bottom

| Part | What it does | Scrolls? |
|---|---|---|
| Home row | The orchestrator by name, the way home. Collapse toggle (⌘\) at its right. | Fixed |
| Places | Board (the task board, full screen), Calendar (the calendar, full screen, `CalendarModal`), Schedules and Triggers (with the live run count). Pointing at Calendar prefetches the week. | Scroll away with the list |
| Create, Search | Create opens the launcher with no agent picked (a new execution anywhere). Search opens chat search (every transcript). | Sticky under the home row |
| Agents, Recent | Agents is the agent tree with each agent's executions. Recent is every execution newest first, archived included, with an agent filter. | Sticky |
| The list | Pinned, then the chosen tab's list. Every row carries the same status dot (`chat-status.tsx`: needs input, working, unread, background), unread titles are bold, and no row shows diff stats (they don't help decide where to go, they live in the execution's header). In Recent the dot sits on the agent's avatar, which tells agents apart in a mixed list, and an active execution reads the rail's live record rather than the once-a-minute history feed. | Scrolls |
| Footer | Settings, then Connect apps (Settings, Plugins, Connectors). | Fixed |

The places are visited now and then, so they give their room back once you scroll into the list. Create, Search and the tabs are the list's own controls, so they stay with it. The list's own sticky toolbar (selecting executions to archive) pins under them through the `--rail-sticky-top` variable the rail sets.

Neither verb takes the brand color: the chat composer is the main input on every screen. Create has a quiet fill, Search a border.

## Collapsed rail

44px of icons in the same order as the wide rail: home, expand, Board, Calendar, Schedules (a dot while runs are active), Create, Search, then **one Agents button**, and Settings at the foot. Connect apps needs its words, so the collapsed rail leaves it to Settings.

Executions aren't listed in the strip. The Agents button carries an amber count of what needs you (approvals and unread, agents included, the same rows the header's pills count) and opens the wide rail's list as a **flyout** that floats over the page from the rail's edge, top to bottom, so it never takes width or pushes the page:

- **Peek:** rest the pointer on Agents for 150ms. It closes 200ms after the pointer leaves the button and the flyout.
- **Hold:** click Agents, or press anything inside a peek (a row's menu, a drag, New agent). It stays until Esc, a click outside, a second click on Agents, or navigating anywhere.
- Keyboard: Enter or Space on Agents opens it with focus inside, and Esc returns focus to the button.
- Rows show names and status only. The chat preview the wide rail shows on hover is off in the flyout (`SessionHoverProvider disabled`).

The rules are a pure function, `nextFlyoutState` in `src/lib/client/rail-flyout.ts`, with tests. The flyout is a Radix Popover anchored to the rail, so a menu or dialog opened from inside it is a nested layer: Esc and clicks there close that first and leave the flyout open.

The execution view starts with the rail collapsed (`executionRailOpen`, separate from the global `railCollapsed`), so the flyout is how you switch executions while working.

## Tablet

768 to 1024px uses the same collapsed rail with no expand toggle (`PowerRail fixed`): the window can't spare 256px. Tap Agents for the flyout. Board and Calendar open full screen, as on a desktop.

## What went away

- **Inbox.** A "coming soon" sheet. A button that leads nowhere teaches people the header has dead ends, and the status pills already do its job for agent attention. Removed from the phone's top bar too.
- **The Status tab.** The same four buckets, with the same counts, as the header's pills, which show from every view. `bucketSessions` (`src/lib/sessions/classification.ts`) is now the one reading of them, shared by the pills and the Agents badge. A stored `status` tab reads as Agents.
- **History** is now **Recent**: the word people know for "everything, newest first". Code keeps `history` (`HistoryView`, the `ri.rail.tab` value).
- **The pencil on the home row** and its dialog. The name and look are edited in Settings, Profile.
- **Board and Settings in the header** moved to the rail. ⌘K still has "Open board" and "Settings".

## Open question

Create and Search each exist twice. The rail's are the agent side (a new execution, chat search). The header's are the human side (CREATE for quick capture, task, note and area, and ⌘K for tasks, notes and commands). Merging each pair into one is deferred until the agent and human split is thought through.

## Files

- `src/components/dashboard/power-rail.tsx`: the aside, its width, and which collapse state drives it.
- `src/components/workspaces/rail.tsx`: the rail, wide or collapsed, and the wide layout.
- `src/components/workspaces/rail-nav.tsx`: places and verbs, as rows and as icons.
- `src/components/workspaces/rail-list.tsx`: the tabs and the list, shared by the wide rail and the flyout.
- `src/components/workspaces/rail-strip.tsx`: the collapsed strip and the Agents flyout.
- `src/components/workspaces/rail-home.tsx`, `rail-footer.tsx`: top and bottom.
- `src/components/dashboard/top-hud.tsx`, `rail-status-pills.tsx`: the header.
- `src/lib/client/rail-tab.ts`, `rail-flyout.ts`: the tab choice and the flyout rules.
