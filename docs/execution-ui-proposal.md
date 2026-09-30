# Execution UI proposal

Status: design proposal, September 23, 2026. No application behavior has been changed.

## Recommendation

Make the conversation the default working surface beneath one thin execution header. A labeled Tools button on the far right opens a compact menu, with Preview first. Once a result panel is open, Preview, Changes, and Files are directly accessible as tabs inside that panel. Put Terminal in an independent drawer spanning the execution content. Keep chat tabs exclusively for chats.

The layout should answer three questions in order: What am I working on? Does it need me? Where can I see or intervene in the work?

Visible tools should earn their space through the user's current action. Availability alone does not justify an open panel. A readable document, running app, and useful conversation deserve space. An empty file viewer does not.

## Why the current arrangement feels cramped

The current default allocates 40% of the execution width to chat, 18% to the file tree, and 42% to the viewer and terminal. The viewer takes 70% of that last column's height. This dedicates most of the available space to tools before the user asks for them. Mobile drops the tools and renders the conversation only.

The problem is structural, rather than a need for smaller controls. Collapsing just the file tree would still leave a large empty viewer, a constrained terminal, and preview subordinate to file browsing.

From the supplied screenshots, keep Cursor's labeled destinations, Claude's generous opened document surface, and the contained grouping of Codex's environment controls. Avoid Conductor's mixed file and chat tabs. These are observations about the attached examples, not a survey of current product capabilities.

## Desktop arrangement

1. **Execution header:** one row, approximately 48 px tall, with the execution title and quiet inline status. Put **Tools** and **More** at the far right. Tools opens a right-aligned menu with labeled Preview, Changes, Files, and Terminal actions, followed by Notes & Tasks and Scratchpad. There is no permanent tools toolbar, stacked breadcrumb, or separate status row. Agent and folder details live in the rail, Tools menu, and Details. The Changes count describes the execution's current Git scope, not files attributable to the selected chat. Keep app-wide activity in the rail rather than an additional top strip.
2. **Chat tabs:** stay inside the conversation column, directly above the transcript. Each shows its own activity, unread, or needs-input indication. Keep new chat, close, and history. A file can never enter this row.
3. **Conversation:** owns the available content width when other tools are closed. Center readable text at roughly 720 to 840 px, letting code and tables use more width when needed. Wider space does not mean unlimited prose line length.
4. **Optional result panel:** Preview, Changes, Files, Notes & Tasks, or Scratchpad. Only one is visible at a time. Its compact header provides direct Preview, Changes, and Files tabs, plus access to additional views, Terminal, expand, and close. Navigation appears where the content lives, so switching tools does not require repeatedly reopening the menu. Notes & Tasks and Scratchpad show a clear surface title. The panel has no footprint when closed.
5. **Optional terminal drawer:** below the conversation and result panel, spanning both. Opening it never opens Files. It defaults to approximately 35% of available height with a usable minimum of 240 px, can be resized, and can expand to the content area. On short windows it uses the full content area rather than crushing the composer.

Preview initially receives about 58% of the content width. Protect approximately 400 px for chat and 480 px for the result before padding. These are starting design targets to verify with real content, not fixed device breakpoints. If there is insufficient room, temporarily collapse navigation when the user opens a tool. If the pair still cannot fit, show one surface at a time with a visible **Back to chat** action. Restore the user's previous rail preference afterward. Do not silently squeeze the text smaller.

Expanding a result leaves the execution header and a **Back to chat** action visible. A question arriving while chat is hidden adds a compact **Needs your input · Answer** strip. It does not force navigation.

## Predictable interactions

| User intent | Result |
| --- | --- |
| Open a new execution | Conversation only. No shell or preview process starts just to render the page. |
| Revisit an execution | Restore that device's chosen panel and sizes. Opening an execution does not invent a new layout based on its latest activity. |
| Click Tools | Open a compact menu anchored at the right edge of the thin header. The conversation keeps its width. |
| Select Preview | Open the result panel at a useful width. Selecting the current tab keeps it open. Close uses the explicit close control. |
| Click Files or Changes | Replace the visible result surface, retaining each surface's selection and state. |
| Switch result tabs while expanded | Preserve the expanded layout. Switching views is navigation, not a request to resize the panel. |
| Click a file in chat | Open that file directly in the result panel. Do not require the file tree. |
| Switch chat tabs | Change conversation, draft, activity, pending input, and chat-specific scratchpad. Keep the execution's preview, files, and terminal unchanged. |
| Close a tool | Hide the view. Do not stop its process, discard edits, or forget its selection. |
| Agent generates a result | Show a relevant result link in the conversation. Do not steal focus or open a panel automatically. |
| Preview becomes ready or crashes | Update a quiet indicator or show a relevant error with an explicit action. Keep layout and scroll position stable. |

The right-side entry point and result navigation remain stable for the lifetime of the execution. Capabilities determine which tools exist, not moment-to-moment activity. A non-Git execution has no Changes destination. A folder without a configured preview still offers Preview with setup and manual URL options. If no host can serve files or terminals, explain that limitation at the destination.

Never replace the user's selected result because another chat produced output. Remember state by execution and device. Scratchpads and composer drafts remain keyed by chat. New layout preferences should not blindly reuse the old three-column percentages.

## Preview

Preview is first-class because evaluating the work is often the user's next step. Its importance comes from its position, explicit label, useful default size, and direct links from results, rather than an always-open blank box.

The panel opens directly to the running app. Controls are local: preview target when there are multiple, readable address, refresh, open in browser, expand, and close. Server state is plain text. Start, Stop, and Restart are explicit actions. Logs are a local disclosure. The general terminal remains separate.

Closing Preview hides it but leaves the server running. Stopping the server requires **Stop preview**. Preserve the preview's route and form state while switching surfaces when feasible. Visibility must not own the process lifetime.

States must be concrete: not configured, stopped, starting, running, failed, host offline, and unreachable from this device. Starting explains what is happening. Failure offers logs and retry. A blocked embed offers **Open in browser**. No state ends at a spinner or blank frame.

On another device, use an address that is reachable from that client. Never treat the phone's localhost as the execution host. When remote access is unavailable, show the reason and **Set up remote preview** or an existing reachable link. Opening Preview alone does not authorize installing or reconfiguring infrastructure.

Documents and images linked from chat open directly as rendered content in the result panel. Keep the Preview destination specifically for the running app, so it does not unpredictably alternate between a web app and a generated file.

## Files and Changes

Files is a deliberate browsing destination. On first open, show recent files and a file finder with **Browse folders**. Selecting a file opens its content immediately. Keep folder browsing as a collapsible navigator inside this surface. At narrow widths it becomes a list/detail transition. Once a file is selected, do not allocate a permanent tree column unless the user explicitly leaves it open.

Preserve editing, diffs, history, copy path, reference in chat, and existing file operations. Put them next to the selected file or inside the Files menu. Replacing or closing the surface must preserve the editor draft and selection. Essential actions remain available without hover.

Changes opens an overview and file diff at usable width. Display branch and comparison scope clearly. It owns Commit, Push, Create/Open PR, Merge, Pull base, Link PR, and conflict resolution. Offer the action supported by actual Git/PR state without labeling uncertain checks as ready. Rename any action that sends an agent prompt, such as **Ask agent to resolve conflicts**, so it does not imply an immediate deterministic operation.

Uncommitted changes are normal working state. Use a neutral count rather than an amber warning. Conflicts and failed operations deserve attention. Git totals describe the folder or worktree, potentially including changes from other chats or humans, especially in shared-folder mode. Do not label all of them as this chat's work.

Accepting output, completing a task, merging code, and archiving an execution stay distinct operations. Keep the existing review disposition functionality with the output. Acceptance alone never silently completes linked tasks or merges a branch.

## HUD decisions

| Existing element | Proposed placement and treatment |
| --- | --- |
| Agent breadcrumb and execution title | Keep the execution title in the single-row header. Agent context lives in the rail and Details. Rename is an explicit menu action. |
| Working, needs input, setup, background activity | Quiet inline status beside the title. Pair actionable exceptions with a separately styled button when needed. Other chats retain their own indicators. |
| LIVE | Replace with **Shared folder · branch-name** in Tools and Details. This means editing the agent's folder directly. It is neither activity nor preview state. |
| Notes & Tasks | Keep in More and the composer's Add context picker. Linked task/note chips open the same result surface directly. |
| Scratchpad | Keep in More as a chat-specific writing surface, preserving Send to chat and promotion. Show **Scratchpad · chat-name** to clarify scope. |
| Transcript density | Move to More under Conversation display. Preserve the preference. |
| Commit and push / PR state | Move to Changes. A conflict or failed operation may additionally expose an explicit header action. |
| Tasks being worked | Keep linked context near the conversation and in Notes & Tasks, without adding another permanent header row. |
| Stop, model, effort, permissions, attachment, voice | Keep with the composer. Stop targets the selected chat, never the preview or terminal. |
| Background tasks | Compact summary near the composer, expandable for details. Say when work continues after the foreground turn ends. |
| Pending questions and permissions | Prominent above the composer. When chat is hidden, a small Answer affordance returns to the right chat and prompt. |
| Setup failure, takeover, handoff, reconnect | Contextual message with a specific recovery action. Avoid overlapping generic status banners. |
| Pin, read/unread, archive, restart, resync | More menu, grouped by purpose. Restart and resync are recovery actions. |
| Branch, base SHA, IDs, path, resume command | Details within More. Copy remains available. |
| Open in editor, reveal folder, takeover | More, with availability based on where the client and execution host actually are. |
| Duplicate Close execution controls | Keep one navigation action to return to the previous app surface. Preserve its keyboard shortcut. |
| Global status counters | One labeled **Activity** entry with a count of work needing attention. Its popover retains all current buckets. Running/waiting totals live inside it. |
| Calendar | Keep the day accessible through global navigation. Surface the next relevant event while working, rather than a permanent “nothing scheduled” chip. |
| Search, settings, capture, Create, schedules | App navigation. Keep quick capture reachable and its shortcut intact. Avoid spending execution-header space on global configuration. |
| Inbox placeholder | Remove the execution-level distraction until it performs useful work. |

Status is readable text with a dot or icon. Buttons have consistent borders, surfaces, focus rings, and hover treatment. A count inside a button is acceptable when the whole control has one clear destination. A passive status label should never imitate the same button chrome. Color supplements words rather than carrying the only meaning.

## Mobile and narrow windows

Mobile is a supervision and feedback surface: read, answer, redirect, inspect, and capture. It should support those actions completely.

- Compact single-row header: execution title, a status dot, and right-side Tools and More controls. The chat switcher includes the readable status. Critical exceptions retain their explicit message and action.
- Preserve all chat sessions through a labeled **Chats 3** switcher listing names, states, and new chat. Do not compress the desktop strip into tiny truncated tabs.
- Use a stable bottom row: **Chat**, **Preview**, **Tools**. Tools opens a sheet with Changes, Files, Notes & Tasks, Scratchpad, and Terminal where available. Place the composer immediately above navigation and respect keyboard and safe-area insets.
- Show one full-width surface at a time. Back returns to the exact chat and scroll position. Reading a file, reviewing changes, and answering a permission must not depend on a desktop layout.
- Inside an open result, replace desktop tool tabs with a labeled view selector. Preview, Changes, Files, Notes & Tasks, and Scratchpad remain one selection away without overflowing a phone header.
- Keep Terminal available for deliberate troubleshooting through Tools, in a full-screen view. It is not an always-visible mobile tab. Show the host and folder so the destination of a command is explicit.
- If input is needed while previewing, show **Needs your input · Answer** without taking over the screen. The action selects the relevant chat and prompt.
- When the host is offline, retain readable history, clearly mark stale state, and preserve drafts. Do not claim a message was delivered or a command ran without confirmation.
- Use approximately 44 px touch targets. Do not rely on hover, drag-only resizing, or desktop shortcuts. Keep speech and attachment capture accessible.

Layout choices stay device-local. Closing a phone sheet must not change the desktop layout or stop a shared process.

## Implementation boundary and verification

Reuse the existing transcript, composer, tab strip, preview, terminal, file viewer, references, scratchpad, and Git action logic. Most of this is a layout and state-ownership refactor around `ExecutionView`, `ExecutionHeader`, `ViewerArea`, and `useExecutionLayoutSizes`, rather than a new application architecture. Hidden views must not accidentally terminate sessions, and a single active composer avoids duplicate focus and keyboard handling.

Before implementation is considered complete, exercise these journeys:

1. New execution opens with readable chat and no empty tool panels or automatically created shell.
2. Open Preview, switch chats, write a draft, open a document, and return. Preserve preview route, chat drafts, and result selections.
3. Open Terminal with Files closed, resize, hide, and reopen. Preserve its process, tabs, output, and execution scope.
4. Open an unsaved file or scratchpad, change surfaces, and change chats. No text is lost or assigned to another chat.
5. Receive pending input while chat is hidden. Reach the correct request without stealing focus or losing the result position.
6. Review work with multiple chats and shared-folder changes. Git scope remains honest. Accept, complete, merge, and archive have distinct effects.
7. On a 390 px phone, switch chats, answer a question, inspect a running preview, open a file, and return to the preserved conversation.
8. Exercise stopped, failed, blocked-embed, unreachable-preview, and offline-host states. Every state has truthful text and a useful action.
9. Verify at 320, 390, 768, 1024, and 1440 px, light and dark themes, keyboard-only navigation, long chat names, and an open software keyboard.
10. Verify the resting desktop execution header is a single row with no tools toolbar. Open the right-side Tools menu, navigate through result tabs, and close the panel. Preserve chat drafts, selected files, and expanded state during navigation. At phone widths, verify the result selector provides the same destinations.

Validate the design with concrete tasks: finding a result, returning to a chat, identifying which items are clickable, and answering a request on a phone. The size targets and hierarchy are design hypotheses. They are not claims of completed usability research.
