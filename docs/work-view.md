# The work view

The calendar can show what you and your agents did, next to what's booked: a ribbon of work beside each day's meetings, lanes per agent in a day, a list of what shipped each day, and what it adds up to in a row of numbers. Built 2026-10-05 as a trial, stored in a file rather than a table so nothing needs a migration until it proves itself.

The point is leverage: how much work comes out of your time, with numbers that are measured rather than invented.

## What you see

Open the calendar (the rail's Calendar, or the header's work pill). With **Work** on (the default, one click off, remembered per browser):

- **Stat tiles**, at the top, for the week or day in view. One number each, the context under it, no prose (Sep 28 to Oct 4, 2026, real data):

  | Tile | Value | Under it |
  | --- | --- | --- |
  | Person-hours of work | 2,398 | A team of 60 for a week, or 1.2 people for a year |
  | Your leverage | 58× | From 41h 31m hands-on |
  | Agents at once | 9 | At the peak, Mon 3:47 PM |
  | While you were away | 42h 18m | Agents kept working |
  | Commits | 256 | Across 13 agents |

  A tile with nothing to say drops out: no commits, a peak under two, under half an hour away. Under the tiles, a legend keys the colors: each agent with its time, one "Other" for everyone past the palette (hover it for the names), and the thin line that is you.
- **Report**, beside the tiles: the sentences (what shipped, where agent time went, the leverage), then the texture lines (words written, the book they'd fill, speed on code), with Copy and Save as note. The note adds the numbers, a line per agent, a line per day and every commit subject by agent. The punchy lines live here so the calendar itself stays scannable.
- **Week grid**: meetings keep the left two thirds of each day, and the day's work is a ribbon in the right third (see "The ribbon"). Under each date, what the day was worth: "676 person-hours · 75 commits".
- **Day**: meetings take the left third, and the rest is lanes, one for you and one per agent (see "Day lanes").
- **List** (Week): each day's calendar first (meetings by time, all-day events, deadlines), then its numbers, then by agent what it committed and which chats ran without a commit, then finished executions and completed tasks. Past days read as a record, coming days as the plan. Grid/List picks the layout and Work adds the layer, so both layouts keep the calendar.
- **Header**: today's person-hours in a pill (see "Header").

Without a calendar connected the grid still shows work, over empty days, and "Connect your calendar" becomes a small link in the header.

### Why not blocks

The first build drew work like meetings: a block per agent stretch, packed beside meetings into the day's columns, "+N" past three. Two things were wrong with it. Work isn't an appointment. On a real day nine chats run at once across six agents, so the packing either crowded meetings into slivers or hid most agents behind a "+3" that says nothing about who or how much. And what a week view should answer about work is when, how much, and who, all at a glance. Stacked blocks answer none of the three.

So work gets its own encoding, and meetings keep theirs. Meetings stay as blocks in their own strip, untouched. Work becomes a density ribbon in the week (how much, when, who, never hidden) and, once you open a day, lanes (each agent's stretches, side by side with yours).

## The ribbon

`src/lib/work/ribbon.ts` (pure, tested) and `src/components/calendar/work/work-ribbon.tsx`.

- The day is cut into 15-minute windows. Each window is a row of segments, one per agent, in the agent's color, each as wide as that agent's count of chats working in the window. A chat counts in a window when one of its blocks overlaps it.
- The width is on one scale for the whole range (the widest window of the week), so a busy Thursday reads as busier than a quiet Sunday. Segments stack in palette order, Other last, so an agent sits in the same place day to day.
- A 3px line on the left edge is you, hands-on (your sittings).
- 2px gaps between segments and rows, so neighbors stay readable without borders.
- Hover a window for who was working: the time, the count of chats leading, each agent keyed by a line in its color with its count, then whether you were hands-on and how many commits landed. Click to open the day.
- Nothing is cut off and there is no "+N". Nine at once is nine segments wide.

## Day lanes

`src/components/calendar/work/work-lanes.tsx`. You first, as the same thin line, then a lane per agent that worked, in palette order, its spans as bars in its color. A white dot on a bar is a commit. One thin lane of yours beside many of theirs is the leverage, drawn. Click a bar for its chats (click one to open it) and commits, each commit with its size in hours. Lane names sit in a header row above the scrolling track.

## Header

`src/components/calendar/work/work-hud-pill.tsx`, in the top HUD beside the next meeting. "32 person-hours today", and on hover what it's made of (the team phrase, your hands-on time, agent time and the leverage). Click to open today in the calendar's Day view.

- Follows the Work switch, so turning work off in the calendar hides the pill too.
- Shows from one person-hour on. Before that there is nothing worth saying.
- Refreshes every five minutes, a glance rather than a ticker. Each read also asks git.
- Desktop widths only, next to the other header pills.

**Why the header and not the deck.** The deck is triage: what to do next, in what order (see the deck's own rules). A count of work done is a different job, and it's one you want from every view, including an execution you're watching, not only on the board. The header is visible everywhere and costs one pill. A muted "yesterday" line on the morning deck stays open as a follow-up (see "Next").

## Colors

Agents wear the validated categorical palette, `--series-1` to `--series-8` in `globals.css`, its own steps for light and dark. The order is fixed and never cycled: agents take slots 1 to 6 and 8 in the person's agent order, Ri's own chats take slot 7, and every agent past that folds into "Other" (`--series-other`, a neutral gray). No ninth hue is ever generated. Color follows the agent, never its rank in a range, so an agent keeps its color week to week and a filter never repaints the others.

Marks wear the color (ribbon segments, lane bars, legend swatches). Text never does: names and numbers stay in the normal text colors, beside a colored mark.

## The algorithm

Pure, in `src/lib/work/model.ts`, with tests.

1. **Events.** Every chat's work events: your messages, agent replies, tool calls and results, thinking, turn results, approvals, errors. System frames, background-task heartbeats and recaps aren't work. Messages another chat sent don't count as yours.
2. **Blocks.** Per chat, a new block starts after 30 minutes of quiet. A block is at least 5 minutes long.
3. **Agent time.** Inside a block, the time between consecutive events that are no more than 10 minutes apart. Longer gaps are the agent waiting, usually on you. This is real running time, summed across parallel chats.
4. **Your time (hands-on).** Your own messages, cut into sittings the same way (30 minutes of quiet ends one, each at least 5 minutes).
5. **While you were away.** Each block's agent time, minus the share of it that overlaps your sittings.
6. **Spans.** On each day, one agent's blocks merged where they overlap or come within 10 minutes. Nine parallel chats in one agent draw as one span listing all nine.
7. **Commits.** Read from git, per agent repo: your commits (the repo's `user.email`) on local branches, which include every execution worktree's branch. Remote branches are left out, since they carry teammates' work and rebased copies. A commit belongs to the span of an agent on that repo whose window holds it (1 minute before to 5 minutes after), else it's listed loose for its day.
8. **Peak.** The most chats' blocks open at once.

## Person-hours

Agent time is real running time. It does not account for speed. Speed shows up in the person-hours estimate: how long a skilled person would need for the same output.

- **Code.** Each commit is sized the way an engineer sizes a change, in bands, from the lines that took effort: additions plus a quarter of deletions, each file capped at 800, with generated, lock, vendored, data and binary files left out.

  | Effort lines | Person-hours |
  | --- | --- |
  | under 20 | 0.5 |
  | under 100 | 2 |
  | under 400 | 6 |
  | under 1,200 | 14 |
  | 1,200 and up | 24 |

  Bands, not a per-line rate: a per-line rate (25 lines an hour) put last week at 12,600 person-hours, which nobody would believe. The bands put it at about 2,400.
- **Everything else** (research, writing, planning, reviews, chats that committed nothing) counts one for one: an hour of agent time is an hour of a person's. That undercounts, deliberately.

From there: a team for a week is person-hours over 40 (over 8 for a day), people for a year is person-hours over 2,000, shown as months under one person-year. "On code, N× faster" is code person-hours over the agent time of the spans that committed.

It isn't perfect, and doesn't try to be. It's consistent, explainable, and errs low outside code.

## Equivalents and wording

`src/lib/work/equivalents.ts` is the one source for every line, so the calendar, the saved note and the `work_summary` action say the same thing. Books are commonly cited word counts, picked by the closest ratio ("about the length of", "most of", "3 copies of"). UI copy rules hold: no long dashes, no semicolons (tested).

## Storage

`<work dir>/work-ledger.json` (`getWorkDir()`, so `~/ri/.work/` in prod): every chat's blocks, plus the last `chat_events` rowid folded in (`src/lib/work/ledger.ts`). It's derived data. Delete it and it rebuilds. A version bump in the code rebuilds it too.

- **Kept current lazily but incrementally.** Each read first folds in the rows added since the last one, by rowid, so it's a handful of rows between two looks, and an imported transcript's old timestamps aren't missed (a chat that receives older history is rebuilt from all its events).
- **The first build** reads all history in 20,000-row chunks, yielding between them. On prod's history (9.5 GB, 468k work events) it took 14 seconds, and later reads take milliseconds. The calendar says it's adding up the work meanwhile.
- **Size:** about 470 KB for prod's history.
- **Commits aren't stored.** Git is already an index. Each repo is asked for the range, cached a minute.

If the trial sticks, the blocks move to a table written as events arrive. The model doesn't change.

## API

- tRPC `work.range({ start, days })` → `WorkRange` (`src/lib/work/types.ts`). The calendar refetches it every minute while open, so today stays live.
- tRPC `work.saveReport({ start, days })` → the new note.
- Orchestrator action `work_summary({ start?, days? })` (defaults to this week): the report, the summary lines, totals, per agent and per day. Any chat can answer "what did I do this week" or write the weekly report from it, and a Sunday schedule can use it to save one.

## Limits

- Only work in Ri chats counts. Claude Code and Codex sessions count once Ri has imported them.
- Commits count by the repo's `user.email`. A repo without one counts every author on its local branches.
- Agent time counts a chat's events, not the processes it started. A long build that emits nothing for over 10 minutes reads as waiting.
- Non-git agents count one for one, with no code sizing.

## Next

- An agent's Overview: that agent's week.
- One muted line in the morning deck: yesterday's person-hours and leverage, if the header pill isn't enough.
- A table instead of the file, if the trial sticks.

## Files

- `src/lib/work/model.ts`, `equivalents.ts`, `ribbon.ts`, `types.ts`: the algorithm, the wording, the tiles and the ribbon's windows, pure.
- `src/lib/work/ledger.ts`, `commits.ts`, `service.ts`: the file, git, and the range.
- `src/lib/db/queries.ts` (Work view section): the reads.
- `src/components/calendar/work/`: the tiles and legend (`work-stats`), the ribbon, the day lanes, a span's details, the list, the header pill and the colors (`work-style`).
- `src/components/calendar/week-grid.tsx`, `day-view.tsx`: where the ribbon and the lanes sit beside meetings.
- `src/lib/client/calendar-work.ts`: the Work toggle.
