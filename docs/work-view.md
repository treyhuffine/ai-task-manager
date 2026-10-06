# The work view

The calendar can show what you and your agents did, next to what's booked: what it adds up to in a row of numbers, a ribbon of work beside each day's meetings, lanes per agent in a day, and a Report tab of what shipped. Built 2026-10-05 as a trial, stored in a file rather than a table so nothing needs a migration until it proves itself.

The point is leverage: how much work comes out of your time, with numbers that are measured rather than invented.

## What you see

Open the calendar (the rail's Calendar, or the header's work pill). Its header has three controls that each answer one question:

- **Week | Day**: how much time.
- **Calendar | List | Report**: how to show it. Calendar is the hour grid, List is the week's days as stacked agendas (Week only), Report is what got done (only with agent work on). The choice is remembered, and holds while a tab isn't there, so turning agent work back on returns to Report.
- **Agent work**, a switch (on to start, remembered per browser): whether Ri shows what you and your agents did. Off, the calendar is just a calendar: no numbers, no ribbon, no Report tab, and no pill in the header.

With agent work on, every tab starts with **the numbers** (see "The numbers"). Then:

- **Calendar, Week**: meetings keep the left two thirds of each day, and the day's work is a ribbon in the right third (see "The ribbon"). A legend under the numbers keys the colors. Under each date, the day's worth in the chain's grammar: "30h agents → 676 person-hours".
- **Calendar, Day**: meetings take the left third, and the rest is lanes, one for you and one per agent (see "Day lanes").
- **List**: the week's agendas (meetings, all-day events, deadlines), each day with the same worth line. The breakdown of work moved to Report, so List is only ever the calendar.
- **Report**: the summary in sentences, each agent's time beside what a person would need, and the days (see "Report").
- **Header**: today's person-hours in a pill (see "Header").

Without a calendar connected, work still shows over empty days, free time is left out, and "Connect your calendar" becomes a small link in the header.

## The numbers

`WorkStats` (`src/components/calendar/work/work-stats.tsx`), with the wording in `equivalents.ts` (`leverageChain`, `workTiles`). For the week or day in view, the same on every tab. Real data, Sep 28 to Oct 4, 2026:

**The chain**, the widest card, is the whole model in one line:

> You, hands-on **42h** → 3× → Agents ran **124h** → 19× → A person would need **2,398h**
> (42h while you were away) (58× your time)

Your time sets agents going, and their work is worth what a person would need for it. The multiplier over each arrow is that step: agents ran 3 hours for each hour you were hands-on, and a person would need 19 hours for each hour agents ran. The two multiply out to your leverage, 58×. This is where agent hours and person-hours sit side by side, and the same grammar comes back smaller wherever a day or an agent has a total ("30h agents → 676 person-hours" under a date, "11h → 161h" beside an agent in Report).

**The tiles** beside it each read top to bottom as a sentence:

| Label | Value | Under it |
| --- | --- | --- |
| Like a team of | 60 | for a week, or 1.2 people for a year |
| Like writing | The Lord of the Rings | 452k words, 188 hours to type |
| Agents at once | 9 | At the peak, Mon 3:47 PM |
| Commits | 256 | Across 13 agents |

A tile with nothing to say drops out: under 1.5 people, under 10k words, a peak under two, no commits. A long book title steps down a size rather than wrap. While the next range loads, the last range's numbers hold, dimmed.

These replaced a row of five tiles and a paragraph of prose (and a Report popover holding more prose). The rule now: numbers at the top, sentences only in Report.

## Why not blocks

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

## Report

`src/components/calendar/work/work-report.tsx`, the third tab.

- **Summary**: the three-line report (what shipped, where agent time went, the leverage), with Copy and Save as note. Copy adds the numbers as sentences, since pasted text has no tiles above it. The note adds the numbers, a line per agent, a line per day and every commit subject by agent.
- **By agent**: every agent by name (so "Other" splits back out), its agent time, a bar of what a person would need on one scale, largest first, and its commits. A table, so it's also the readable twin of the colors.
- **By day**: each day with work, its worth line and commits, then by agent what it committed (six, then "Show all"), which chats ran without a commit, and finished executions and completed tasks.

## Header

`src/components/calendar/work/work-hud-pill.tsx`, in the top HUD beside the next meeting. "32 person-hours today", and on hover what it's made of (the team phrase, your hands-on time, agent time and the leverage). Click to open today in the calendar's Day view.

- Follows the Agent work switch, so turning it off in the calendar hides the pill too.
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
- `src/components/calendar/work/`: the numbers and legend (`work-stats`), the worth line (`work-worth`), the ribbon, the day lanes, a span's details, the Report tab (`work-report`), the header pill and the colors (`work-style`).
- `src/components/calendar/week-grid.tsx`, `day-view.tsx`, `week-view.tsx`: where the ribbon, the lanes and the worth line sit beside meetings.
- `src/components/calendar/calendar-modal.tsx`: the tabs and the switch.
- `src/lib/client/calendar-work.ts`: the Agent work switch.
