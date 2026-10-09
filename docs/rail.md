# The rail and the header

The desktop shell has two pieces of chrome, and each has one job:

- **The header (top HUD)** shows what's happening, from every view: work by status (the Needs approval, Unread, Working and Waiting pills), the harness rate limits on hover beside them, the way out of an execution or agent (or back into the latest one, ⌘E), the next calendar event, and the budget warning.
- **The rail (left)** holds the things you start and the places you go: home, New chat, Search chats, Apps, Task Board, Calendar, Schedules and Triggers, the list of work, and Settings.

Reworked 2026-10-05 from a rail that listed every execution even when collapsed, and a header that mixed status with buttons (Inbox, Board, Settings). Reworked again 2026-10-08 so everything above the list is one kind of row and the list has one header (see "What went away").

## Wide rail, top to bottom

| Part | What it does | Scrolls? |
|---|---|---|
| Home row | The orchestrator by name, the way home. Collapse toggle (⌘\) at its right. | Fixed |
| New chat, Search chats | Rows in the same style as the places, first under the home row, the way New chat and Search sit at the top of a chat app's sidebar. New chat opens the launcher with no agent picked. Search chats opens chat search (every transcript). A hairline separates them from the places. The UI says chat for what the code calls an execution (`AGENTS.md`). | Fixed |
| Places | On a Home with local apps on (`docs/local-apps.md`), **Apps** comes first, with a chevron: clicking it opens the library, resting on it peeks your apps beside the rail (below). An app whose action waits on you puts an amber count on the row. Next come Task Board (full screen), Calendar (full screen, `CalendarModal`), and Schedules and Triggers (with the live run count). Pointing at Calendar prefetches the week. | Scroll away with the list |
| The list header | One row: Agents and Recent as labels in the group-label grammar (the same as Pinned and Needs you under it), the one in force bright and the other quiet, so the switch is the list's title rather than a second row of buttons. On Agents, select-to-archive and New agent sit at its right. While selecting, the toolbar (count, Archive, Cancel) takes the row. | Sticky |
| Agents, Recent | Agents is the agent tree with each agent's executions. Recent is every execution newest first, archived included, with an agent filter. | Scrolls |
| The list | Pinned, then the chosen tab's list. Every row carries the same status dot (`chat-status.tsx`: needs input, working, unread, background), unread titles are bold, and no row shows diff stats (they don't help decide where to go, they live in the execution's header). In Recent the dot sits on the agent's avatar, which tells agents apart in a mixed list, and an active execution reads the rail's live record rather than the once-a-minute history feed. | Scrolls |
| Footer | Settings, then Connect accounts (Settings, Plugins, Integrations). It says accounts, since Apps above are the local apps you open and a connection is one signed-in account. | Fixed |

The places are visited now and then, so they give their room back once you scroll into the list. The list header is the list's own control, so it stays with it. The archive-selection toolbar is that same header in its selecting state, so nothing else needs pinning.

Neither verb takes the brand color: the chat composer is the main input on every screen. New chat keeps its priority by position and its plus, not by a filled button.

**Your apps** peek beside the rail from the Apps row, the same flyout the collapsed strip's Agents button uses (`RailFlyout`, `rail-flyout.tsx`), on hover only: rest on the row for 150ms and it shows, move off the row and the flyout and it hides, and a click on the row opens the library instead of holding it. It runs the rail's full height beside it, as the Agents flyout does, and has the same shape: a header (APPS, with New app at its right as the Agents header has New agent), then All apps (the library) and each installed app by name with its lettered tile, an amber dot when it waits on you (`src/components/local-apps/apps-rail-list.tsx`). The rail stays the same height at any number of apps, and nothing persists that could leave it stuck in an apps state. ⌘K has Open apps and one Open <app> per installed app.

**Collapsed agent chats** peek beside the rail when you rest on an agent's header for 150ms, in either agent row style. The chooser runs the rail's full height, just like Apps, with its header at the top and a scrolling chat list underneath. It lists chats in the same order and with the same status as the expanded list, and keeps inactive chats behind the same Show toggle. Choosing a chat opens it without unfolding the agent. The header has New chat. Leaving both the header and the chooser closes the peek after 200ms, and navigation, Esc or a click outside dismisses it. A chat's menu is a nested layer. Chat previews stay off inside this chooser. Empty agents, dragging and bulk archive selection do not open it. The chooser also works inside the collapsed strip's Agents flyout, anchored beside that flyout's edge and matching its full height. Right arrow on an agent's name opens the chooser with focus inside, and Esc returns focus to the name. Clicking the name keeps its existing behavior. All rail flyouts share this full-height layout. The older row-sized, rounded variant has been removed.

## Collapsed rail

44px of icons in the same order as the wide rail: home, expand, New chat, Search chats, Apps (an amber dot while an app waits on you), Task Board, Calendar, Schedules (a dot while runs are active), then **one Agents button**, and Settings at the foot. Connect accounts needs its words, so the collapsed rail leaves it to Settings.

Apps and Agents both open a flyout (`RailFlyout`). Agents peeks on hover and holds on click. Apps peeks on hover, and a click opens the library.

Executions aren't listed in the strip. The Agents button carries an amber count of what needs you (approvals and unread, agents included, the same rows the header's pills count) and opens the wide rail's list as a **flyout** that floats over the page from the rail's edge, top to bottom, so it never takes width or pushes the page:

- **Peek:** rest the pointer on Agents for 150ms. It closes 200ms after the pointer leaves the button and the flyout.
- **Hold:** click Agents, or press anything inside a peek (a row's menu, a drag, New agent). It stays until Esc, a click outside, a second click on Agents, or navigating anywhere.
- Keyboard: Enter or Space on Agents opens it with focus inside, and Esc returns focus to the button.
- Rows show names and status only. The chat preview the wide rail shows on hover is off in the flyout (`SessionHoverProvider disabled`).

The rules are a pure function, `nextFlyoutState` in `src/lib/client/rail-flyout.ts`, with tests. The flyout is a Radix Popover anchored to the rail, so a menu or dialog opened from inside it is a nested layer: Esc and clicks there close that first and leave the flyout open.

The execution view starts with the rail collapsed (`executionRailOpen`, separate from the global `railCollapsed`), so the flyout is how you switch executions while working.

## Tablet

768 to 1024px uses the same collapsed rail with no expand toggle (`PowerRail fixed`): the window can't spare 256px. Tap Agents for the flyout. Task Board and Calendar open full screen, as on a desktop.

## What went away

- **Inbox.** A "coming soon" sheet. A button that leads nowhere teaches people the header has dead ends, and the status pills already do its job for agent attention. Removed from the phone's top bar too.
- **The Status tab.** The same four buckets, with the same counts, as the header's pills, which show from every view. `bucketSessions` (`src/lib/sessions/classification.ts`) is now the one reading of them, shared by the pills and the Agents badge. A stored `status` tab reads as Agents.
- **History** is now **Recent**: the word people know for "everything, newest first". Code keeps `history` (`HistoryView`, the `ri.rail.tab` value).
- **The pencil on the home row** and its dialog. The name and look are edited in Settings, Profile.
- **Board and Settings in the header** moved to the rail. The board is now labeled Task Board, and ⌘K has "Open Task Board" and "Settings".

## Apps, and the mode switch that went away

- **The Create | Search button row and the AGENTS | RECENT tab row** (2026-10-08). Two rows of twin pills, one filled and bordered, one text, read as a 2 by 2 grid of the same control done two ways, and "Agents" appeared three times in a row (tab, group label, the rows). The verbs became rows at the top and the tabs became the list's header. Underline tabs were tried on the way and dropped.
- **Three ways of putting apps in the rail** (2026-10-08). The first local-apps build put an **Agents | Apps** switch under Create and Search, with its own list in place of the agents list: a third switcher, and a mode you could leave the rail stuck in. Then every installed app as an always-visible place row: a directory at twenty apps. Then an accordion where opening Apps replaced everything below it: not a pattern anyone knows. The Apps row's flyout is what stayed.

## Open question

New chat and Search chats each exist twice. The rail's are the agent side (a new execution, chat search). The header's are the human side (CREATE for quick capture, task, note and area, and ⌘K for tasks, notes and commands). Merging each pair into one is deferred until the agent and human split is thought through.

## Files

- `src/components/dashboard/power-rail.tsx`: the aside, its width, and which collapse state drives it.
- `src/components/workspaces/rail.tsx`: the rail, wide or collapsed, and the wide layout.
- `src/components/workspaces/rail-nav.tsx`: verbs and places, as rows and as icons. `src/components/local-apps/use-app-places.tsx` adds Apps, from the pure `app-places.ts`.
- `src/components/workspaces/rail-list.tsx`: the list header (the switch, the actions, the selection toolbar) and the list, shared by the wide rail and the flyout.
- `src/components/workspaces/rail-flyout.tsx`: the flyout both rails use. `agent-chats-flyout.tsx`: the collapsed agent's chat chooser. `rail-strip.tsx`: the collapsed strip and its Agents flyout.
- `src/components/workspaces/rail-home.tsx`, `rail-footer.tsx`: top and bottom.
- `src/components/dashboard/top-hud.tsx`, `rail-status-pills.tsx`: the header.
- `src/components/dashboard/rate-limits-pill.tsx`: the rate limits icon. Its hover lists each harness account's windows (5-hour, weekly, a model family's weekly), credits and extra usage, each with its own reset. Limits belong to the harness account, so every chat on one harness shares them. They come from the `rate_limits` events this home's chats report (agentex 0.0.43), merged per harness in `src/lib/harness/rate-limits.ts` and saved to `<config>/harness-rate-limits.json`. Nothing is polled: each block says how old it is. Claude Code and Codex report limits. Other harnesses and chats on connected devices don't appear.
- `src/lib/client/rail-tab.ts`, `rail-flyout.ts`: the tab choice and the flyout rules.
