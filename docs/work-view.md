# The work view

The calendar can show what you and your agents did, next to what's booked: each agent's stretches of work as blocks in the week and day grids, a list of what shipped each day, and what it adds up to. Built 2026-10-05 as a trial, stored in a file rather than a table so nothing needs a migration until it proves itself.

The point is leverage: how much work comes out of your time, with numbers that are measured rather than invented.

## What you see

Open the calendar (the rail's Calendar). With **Work** on (the default, one click off, remembered per browser):

- **Summary**, at the top, for the week or day in view:
  - About 2,398 person-hours of work: a team of 60 for a week, or 1.2 people for a year.
  - You were hands-on 41h 31m. Agents ran 124h 1m. Each hour of yours became 58 hours of work.
  - 42h 18m while you were away · 9 at once at the peak, Mon 3:47 PM · 256 commits across 13 agents
  - Agents wrote 452k words, about the length of The Lord of the Rings. Typing that at 40 words a minute would take 188 hours.
  - On code, agents worked about 23× faster than a person would.

  (Sep 28 to Oct 4, 2026, from real data.) While today is in view, a Today box shows today's numbers live.
- **Report**: three lines (what shipped, where agent time went, the leverage), with Copy and Save as note. The note adds the numbers, a line per agent, a line per day and every commit subject by agent.
- **Grid** (Week or Day): each agent's work as blocks in its color, packed beside meetings into the same columns ("+N" past three). Solid where you were hands-on, dashed where the agent worked on its own. Click one for its chats (click to open) and commits, each commit with its size in hours.
- **List** (Week): each day's calendar first (meetings by time, all-day events, deadlines), then its numbers, then by agent what it committed and which chats ran without a commit, then finished executions and completed tasks. Past days read as a record, coming days as the plan. Grid/List picks the layout and Work adds the layer, so both layouts keep the calendar.

Without a calendar connected the grid still shows work, over empty days, and "Connect your calendar" becomes a small link in the header.

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
- One muted line in the morning deck: yesterday's leverage.
- A table instead of the file, if the trial sticks.

## Files

- `src/lib/work/model.ts`, `equivalents.ts`, `types.ts`: the algorithm and the wording, pure.
- `src/lib/work/ledger.ts`, `commits.ts`, `service.ts`: the file, git, and the range.
- `src/lib/db/queries.ts` (Work view section): the reads.
- `src/components/calendar/work/`: the summary, the list, the span block and the colors.
- `src/lib/client/calendar-work.ts`: the Work toggle.
