# Heartbeat

> Status: Built, 2026-09-22. User-facing doc: `docs/heartbeat.md`. Where the build differs from the original text below, the section says so and §14 lists why. Reports in Unread were replaced on 2026-11-03 (§15), and the default instructions and daily message on 2026-11-04 (§16).
> Related: `docs/paperclip-work-model.md` (reference study), `docs/async-agents-v1.md` §10 and `docs/scheduled-async-agents-spec.md` §3.4 (the earlier heartbeat plans this replaces), `docs/deck-morning-trigger-spec.md` (the app-managed trigger pattern this reuses).

## 1. In plain English

The heartbeat is a regular check-in. On a schedule you set, an agent goes over your tasks, notes, and agent runs and does what your instructions say. It's either on or off. There are no modes: what it does is set entirely by your instructions, inside a few hard limits.

~~A check-in with nothing to report leaves no trace. A check-in that did or found something leaves one short report in Unread.~~ Replaced: what a check-in finds reaches you as a message from your main agent (§15). Each line of the report links to the task or note it's about, where you can see what changed and undo it.

You configure it in Settings > Heartbeat, or from the deck's heartbeat chip when it needs you.

## 2. Goals and non-goals

**Goals**

- Work keeps moving without you prompting each step.
- Everything is editable in the app: instructions, how often, which hours, program, model, and effort.
- It's easy to check: every change is listed and can be undone, and quiet check-ins cost you no attention.
- No new tables, no new columns, no new engine. It's an app-managed trigger.

**Non-goals (for now)**

- Modes, including a read-only one. It runs or it doesn't. If the reports show a need for a read-only mode, the `mutating` flag on actions makes one straightforward to enforce later.
- Internal events (run finished, task moved) as wake sources.
- Tracking which of its changes you keep or undo, and adjusting based on that.
- A cap on unreviewed agent output.
- More than one heartbeat (per area or per workspace).
- Assigning tasks to agents. It's a strong candidate (see `docs/paperclip-work-model.md` §7) but separate work.

## 3. Decisions

| Decision | Why |
|---|---|
| The heartbeat is a trigger row, the fifth app-managed ("reserved") trigger. | A trigger already has every setting needed: prompt, interval, active hours, timezone, program, model, effort, a no-overlap policy, and result delivery. The Triggers screen and run history already work with it. No schema changes. |
| Your instructions go in the trigger's `prompt`. The ground rules live in code. | You edit plain instructions and can't accidentally delete the limits. The ground rules can improve with the app. |
| No modes. | Choosing a mode is a decision that buys nothing. Your instructions already say what it should do. |
| Hard limits: it never deletes, never sends anything outside Ri, and never completes a task. | Deletes can't be undone. Outward sends leave your control, and integration sends already ask first under the write policy. Completing a task is your acceptance, per the lifecycle rule that a finished agent run never completes a task. |
| A quiet check-in is detected by a fixed reply, `HEARTBEAT_OK`, and its chat is archived. | Archived chats never reach Unread. A check-in that changed anything is never treated as quiet, even if it replies `HEARTBEAT_OK`. |

## 4. Configuration and data

### 4.1 The trigger row

A new sentinel id in `src/lib/triggers/reserved.ts`:

```ts
heartbeat: '00000000-0000-0000-0000-000000000005',
```

It's seeded at boot, only if missing, by `ensureHeartbeatTrigger()` (new, in `src/lib/heartbeat/trigger.ts`). That's called from `instrumentation.ts` next to `ensureMorningDeckTrigger()` and `ensureStreamTriageTriggers()`. It never flips `enabled` on an existing row, so turning it off survives restarts.

| Setting | Field | Default | Editable |
|---|---|---|---|
| On or off | `enabled` | `false` | yes |
| How often | `intervalSeconds` | `1800` | yes: any whole number of seconds from 300 up |
| Which hours | `activeHoursStart` / `activeHoursEnd` | both null (24/7) | yes |
| Timezone | `timezone` | your timezone from Settings > General, else the host's | yes |
| Provider | `harness` | `defaultTriggerHarness()` (your default provider) | yes, through the provider switch |
| Model, effort | `model`, `effort` | `null` (the program's defaults) | yes |
| Instructions | `prompt` | the default instructions (§8) | yes |
| Name, description | `name`, `description` | `Heartbeat`, `Checks in on your work on a schedule.` | locked |
| Target | `targetKind` | `orchestrator` | locked |
| Recurrence | `kind` | `every` | locked |
| No overlap | `concurrencyPolicy` | `skip_if_running` | locked |
| Missed slots | `catchUpPolicy` / `maxCatchUpRuns` | same as the other app-managed triggers | locked |
| Time limit | `timeoutSeconds` | `1800` | locked |

The 30-minute limit is deliberate. A check-in that runs that long is stuck, and nothing else should wait on it.

### 4.2 Per-trigger locked fields

`RESERVED_LOCKED_FIELDS` was a single list for every app-managed trigger, and it locked `prompt`. It is now a map by id (`lockedFieldsFor(id)`):

```ts
export const RESERVED_LOCKED_FIELDS: Record<ReservedTriggerId, readonly LockableField[]> = {
  [morningDeck]: ['name', 'description', 'prompt', 'targetKind', 'kind'],
  // ...the three stream triggers, unchanged...
  [heartbeat]: ['name', 'description', 'targetKind', 'kind', 'concurrencyPolicy', 'catchUpPolicy', 'timeoutSeconds'],
};
```

The existing four keep exactly what they locked before. `update_trigger` (`src/lib/orchestrator/registry.ts`) reads the map for the given id. The trigger detail page's "managed" notice names that trigger's own locked fields and links to the right settings section, which is `?settings=heartbeat` for the heartbeat.

`reserved.ts` says that past a handful of managed triggers it should switch to a `managed_kind` column. Five is still a handful. Revisit at the sixth.

### 4.3 Quiet runs

A quiet check-in completes with `runs.statusReason = 'heartbeat_quiet'` and `runs.summary = 'Nothing needed'`, and its chat is archived. No new columns.

### 4.4 Migration

None. The heartbeat uses existing columns only.

## 5. Runtime

### 5.1 Firing

The existing scheduler tick fires it like any `every` trigger and respects active hours (`isWithinActiveHours`, `src/lib/scheduler/runner.ts:201`). With `skip_if_running`, a check-in never overlaps the previous one. Each fire creates a fresh orchestration chat, as orchestrator triggers already do (`resolveTarget`, `src/lib/runs/dispatch.ts`).

### 5.2 Prompt composition

In `src/lib/runs/dispatch.ts`, when `trigger.id === RESERVED_TRIGGER_IDS.heartbeat`, the prompt sent to the agent is:

```
<ground rules, §5.3>

## Your instructions

<trigger.prompt>
```

It's built by `composeHeartbeatPrompt(instructions)` in `src/lib/heartbeat/prompt.ts`, used at the dispatch site that calls `composePromptWithPayload`. The composed prompt is what gets saved as the chat's first user message, so the transcript shows exactly what the agent received, even if the instructions change later.

### 5.3 Ground rules

> This is a scheduled heartbeat check-in, not a conversation. The user is not watching. Work through the instructions below using the Ri tools. Do only what the instructions ask, and don't invent new chores.
>
> Never delete anything. Never send, post, or share anything outside Ri. Never complete a task. Start or message agent executions only when the instructions ask for it.
>
> If nothing needs attention and you changed nothing, reply with exactly `HEARTBEAT_OK` and nothing else.
>
> Otherwise end with a short report, most important first, under 15 lines, no preamble:
>
> **Did**: one line per change, each with its `[[task:ID]]` or `[[note:ID]]` marker.
> **Needs you**: one line per question or offer, each with its marker.
>
> Leave out an empty section.

The chat already renders `[[task:ID]]` and `[[note:ID]]` markers as chips, so every line in the report links to the item.

### 5.4 Quiet detection

When a heartbeat run completes (`finalizeRunSuccessIfPending` in `src/lib/runs/dispatch.ts`, calling `settleHeartbeatRun` in `src/lib/heartbeat/quiet.ts`):

- If the final assistant message, trimmed, is exactly `HEARTBEAT_OK` **and** `artifactRefs` is empty, the run is quiet. Set `statusReason = 'heartbeat_quiet'`, set the summary to `Nothing needed`, and archive the chat.
- Otherwise it's a normal completed run, and its chat reaches Unread the usual way (`lastOutcomeEventAt`).

~~Quiet runs also skip `deliverResultTo`.~~ Built differently: a check-in never notifies. See §15.

## 6. API and agent surface

Two new orchestrator actions in `registry.ts`, so the app, the CLI, and agents all go through one path. That also lets an agent handle a request like "check in every two hours" from chat.

| Action | Params | Returns |
|---|---|---|
| `get_heartbeat` | none | `HeartbeatConfig` |
| `update_heartbeat` (mutating) | any of: `enabled`, `instructions`, `resetInstructions`, `intervalSeconds`, `activeHoursStart`, `activeHoursEnd`, `timezone`, `provider`, `model`, `effort` | `HeartbeatConfig` |

```ts
interface HeartbeatConfig {
  enabled: boolean;
  instructions: string;
  intervalSeconds: number;
  activeHoursStart: string | null;
  activeHoursEnd: string | null;
  timezone: string | null;
  provider: HarnessId | null;
  model: string | null;
  effort: Effort | null;
  nextCheckInAt: string | null;
  lastCheckIn: {
    at: string;
    runId: string;
    status: 'completed' | 'failed' | 'skipped';
    quiet: boolean;
    chatSessionId: string | null;
    unread: boolean;        // the report chat is still unread
    changedCount: number;   // runs.artifactRefs length
  } | null;
}
```

`update_heartbeat` writes through `updateTrigger`. It reuses the provider-switch logic, which resets model and effort when the program changes. Validation matches `update_trigger`: the interval must be at least 5 minutes, hours use `HH:MM`, and the model has to fit the provider. It's safe to retry. "Check in now" uses the existing `run_trigger` with the heartbeat id, so there's no separate action for it.

REST: `GET` and `PUT /api/heartbeat`, both calling `runAction` with `remote: false`, like `/api/triggers`. Client hooks: `useHeartbeat()` and `useUpdateHeartbeat()` in `src/hooks/use-heartbeat.ts`, following `use-morning-deck.ts`.

## 7. UI

All copy follows the repo rule: no em dashes, no semicolons.

### 7.1 Settings > Heartbeat

A new `SectionId` `'heartbeat'` in `src/components/settings/settings-sections.ts` (label "Heartbeat", icon `HeartPulse`, description "A regular check-in on your work."). Its content is `<HeartbeatSettings />` in `src/components/settings/sections/heartbeat-section.tsx`.

```
Heartbeat
Checks in on your work on a schedule and tells you what it did.

  Heartbeat                                                 [ on ]
  Every  [ 30 ] [ minutes ▾ ]
  Hours  [ 24/7 ▾ ]
  Runs on [ Claude Code ▾ ]  Model [ Default ▾ ]  Effort [ Default ▾ ]

  Instructions
  ┌────────────────────────────────────────────────────────────┐
  │ (the instructions, plain text, autosizing)                  │
  └────────────────────────────────────────────────────────────┘
  [ Reset to default ]

  Last check-in 2:00 PM · changed 2, 1 for you   [ Report ] [ Changes ]
  Next check-in 3:00 PM                                  [ Check in now ]
```

- How often is a number and a unit (minutes, hours, days), at least 5 minutes. The hours row is 24/7 unless it's switched to "Between", which starts at 09:00 to 21:00.
- The program, model, and effort pickers reuse the controls from the existing trigger form.
- ~~When it's off, only the switch and a one-line description show.~~ Built: every setting shows whether it's on or off, so you can write instructions and try "Check in now" before turning it on (§14).
- The instructions save on blur, with the same save feedback as the other settings text fields.
- **Report** opens the check-in's chat. **Changes** opens `/runs/[id]`, which already lists what the run changed (`artifactRefs`), so you can check its work without relying on the report being complete.

### 7.2 Deck chip

The deck mentions the heartbeat only when it needs you. A healthy heartbeat is silent there: its home is Settings > Heartbeat. When it does need you, the chip sits in the Today section's status row, next to "in progress" and "to triage". The rule is `heartbeatDeckSignal` (`src/lib/heartbeat/status.ts`), in the same order as `describeHeartbeat` so the chip and its tooltip agree.

| State | Chip |
|---|---|
| Off and never checked in | `Set up heartbeat` (muted) |
| Paused by the app (budget ran out) | `Heartbeat paused` (amber) |
| Last check-in failed | `Heartbeat failed` (destructive) |
| Running, on and fine, quiet, or turned off by you after using it | nothing |

The tooltip is `describeHeartbeat`'s detail. Tapping the chip opens a sheet with `<HeartbeatSettings compact />`. It's the same component as in Settings, with the instructions box collapsed behind "Edit instructions", so the two can't drift apart. In the "1 for you" state the sheet puts the report link at the top. The sheet uses `@container` queries, not viewport breakpoints, because it renders inside panels.

### 7.3 Triggers screen

The heartbeat is listed as Managed, like the morning deck. Its detail page keeps run history and "Run now", and its managed notice says "Edit it in Settings > Heartbeat" with a deep link.

## 8. Default instructions

These are seeded into `prompt` and restored by "Reset to default":

```
Each check-in, look for:

- Todo or In progress tasks nobody has touched in 14 days. Ask me whether to do, snooze, or archive each one.
- Tasks with no area. Set the most likely area.
- Agent runs that failed or stopped without finishing that I haven't looked at.
- Tasks too vague for anyone to start. Ask me the one question that would make each one clear.
- Tasks an agent could finish end to end without my judgment. Offer to start them.

Keep each check-in to the five most important items.
```

To let it start work on its own, change "Offer to start them" to "Start them."

## 9. Cost

Each check-in is one orchestrator session on the default subscription harness. Every 30 minutes, 24/7, is 48 sessions a day, and quiet ones are short. Runs record their cost like any trigger run, and the existing monthly budget applies.

## 10. Tests

- **Seeding:** creates the row once, is idempotent across boots, and never re-enables a row you turned off.
- **Locks:** the heartbeat accepts edits to prompt, program, model, effort, interval, and hours, and rejects edits to name, kind, and target. The four existing managed triggers lock exactly what they locked before.
- **Prompt:** the composed prompt has the ground rules followed by your instructions verbatim, and the saved first chat message matches the composed prompt.
- **Quiet detection:**
  - `HEARTBEAT_OK` with no changes is quiet: statusReason set, chat archived, not in Unread, nothing delivered.
  - `HEARTBEAT_OK` with changes is not quiet.
  - A normal report reaches Unread.
- **Actions:** `get_heartbeat` and `update_heartbeat` round-trip, a provider switch resets model and effort, invalid intervals and hours are rejected, and retries are safe.
- **UI:** the settings section renders both on and off, and the deck chip renders all four states.

## 11. Verification before calling it done

1. `pnpm ts`, `pnpm lint`, and the relevant `vitest` suites pass.
2. In dev (port 42241, dev data), turn it on and "Check in now". Confirm that:
   - a quiet check-in leaves no Unread row and the chip shows the time
   - a check-in with findings reaches Unread with chips that link to the right tasks
   - its changes appear on the run page and can be undone from each task's history
3. Take screenshots of the settings section, the deck chip states, and the sheet.
4. Write `docs/heartbeat.md` (user-facing: what it does, the settings, the hard limits, and what's deliberately not built). Mark the heartbeat parts of `docs/scheduled-async-agents-spec.md` §3.4 and `docs/async-agents-v1.md` §10 as replaced by it.

## 12. Build order

1. Runtime: the sentinel id, seeding, per-trigger locks, prompt composition, quiet detection, and skipping delivery for quiet runs.
2. The `get_heartbeat` and `update_heartbeat` actions, the REST route, and the hooks.
3. The Settings section.
4. The deck chip and sheet.
5. Docs and end-to-end verification.

Steps 1 and 2 can land and be tested without any UI, through `ri agent get_heartbeat` / `update_heartbeat` and "Run now" on the Triggers screen.

## 13. Open questions

1. ~~**The program picker and the `agents` table.**~~ Resolved: Phase 1 of `docs/agents-view-spec.md` landed first, so the heartbeat was built against `trigger.harness` and the `provider` switch directly.
2. **Starting work by default.** The default instructions offer agent work rather than starting it. After some use, decide whether the default should start it.
3. **On by default for new installs?** v1 ships off. Decide after a few weeks of your own use.

## 14. Built: decisions made during implementation

1. **Run change tracking was broken, and is fixed at the action layer.** The spec assumed `runs.artifactRefs` already listed what a run changed. It was empty for every run (0 of 785 since 2026-09-01): the old code read refs back out of the harness's tool-result stream, where MCP tool names arrive prefixed (`mcp__orchestrator__update_task`) and the tool output arrives empty. It now records at `runAction`, which has the real action name, input, and result, and knows the calling chat from its session credential (`src/lib/runs/artifact-refs.ts`). That covers MCP and the CLI alike, for every trigger run, not just the heartbeat. The broken stream path is removed.
2. **The run page lists changes by title.** It used to print raw `kind: id` pairs. "Changes" is the heartbeat's audit path, so it now shows each task and note by title, linked to where its history and undo live.
3. **Settings show everything even when it's off.** A settings page that is only a switch leaves nothing to set up. You can write instructions and try "Check in now" first, then turn it on.
4. **The first check-in is placed inside the active hours.** The scheduler drops slots outside the hours but keeps the cadence anchored to them, so a daily heartbeat turned on at 22:30 would never have fired inside 09:00 to 21:00. Turning it on, or changing when it runs, schedules one interval out, moved into the hours. When it's turned on before the hours start, the window opening wins if it comes sooner. Resending the same schedule never pushes the next check-in back.
5. **Hours follow your timezone.** The row is seeded with your timezone from Settings > General (else the host's). Editing the schedule in the app brings the heartbeat's timezone along with yours. If they ever differ, Settings offers a one-click fix.
6. **`catchUpPolicy` is locked too.** A heartbeat that replays missed slots would fire several check-ins back to back after the host wakes up.
7. **Name collision fallback.** If you already have a trigger named "Heartbeat", the app's row takes "Ri heartbeat" instead and leaves yours alone. The name index is unique per scope.
8. ~~**The deck bar always renders.** It carries the heartbeat chip, so the focused layout's bar no longer hides when nothing is done yet.~~ Superseded by 15.
9. **The quiet reply check tolerates wrapping.** Backticks, bold, quotes, and a trailing period around `HEARTBEAT_OK` still count as quiet. Any other words make it a report.
10. **"Check in now" works while it's off.** It fires the trigger once through `run_trigger`, independent of the schedule.
11. **Provenance on task and note versions is unchanged.** `entity_versions.actorSessionId` is defined as the content chat that made an edit, and pointing it at an orchestrator chat could confuse the in-document diff features. The run's change list is the audit path instead. Linking versions to runs is a candidate follow-up.
12. **Report formatting mirrors the orchestrator brief.** The first real reports showed the agent opening with a preamble, putting references inside bullets (where chips don't render), and once mistyping an id. The ground rules now spell out the same reference rules as the orchestrator brief (`[[task:ID]]`, `[[note:ID]]`, `[[execution:SESSION_ID]]`, each on its own line, ids copied from tool results) and ask for one opening line on what it checked and found fine (the agent wrote one anyway, and it's useful: it says what came back clean), then the sections.
13. **Run summaries drop entity references.** A summary is one plain line for run lists. The raw `[[task:…]]` ids were noise there, and the chat already renders them as chips. This applies to every run's summary, not just the heartbeat's (`summarizeText` in `src/lib/runs/event-hooks.ts`).
14. **Area changes are now part of task and note history.** Setting an area is the one thing the default instructions have the heartbeat do on its own, and history snapshots didn't record `areaId`, so that change couldn't be seen or undone. Snapshots now include it, the history view shows it by area name, and undo restores it. Older snapshots lack the field, which means "not recorded", so the diff skips it and undo leaves the current area alone. Undo also leaves the area alone if the recorded area no longer exists. Verified in the app: an agent's area change appears as "Area: Ri Product → Work", and "Undo this change" puts it back.
15. **The deck shows the heartbeat only when it needs you.** With the chip always on the day bar, the bar rendered as a near-empty row holding one status the user rarely needs, on a surface whose job is today's work. The heartbeat's home is Settings > Heartbeat, so the deck now follows its own rule that a healthy status is silent: the chip appears only when it is never set up, paused, failed, or holding an unread report, and it lives in the Today status row with the other "needs you" chips (2026-10-08). The day bar no longer carries it, so it no longer renders an empty row.
16. **The schedule is free-form and 24/7 by default.** A fixed list of five cadences was one more choice than the number and unit people already think in, so "how often" is now a number and a unit, with a floor of 5 minutes because each check-in is a whole agent session. Hours are off unless someone limits them, since limiting hours is the exception (2026-11-03). Rows that already exist keep the hours they have, because seeding never rewrites a row.

## 15. Check-ins speak through the main agent

Added 2026-11-03, replacing reports in Unread. Pushing a report to Telegram would only deliver a meta update somewhere noisier. What people want is a message from their main agent, only when something is worth saying (the model is ChatGPT Dots). So this separates three things: working, speaking, and reaching the user.

**Working.** A check-in runs in its own background chat and archives it when it finishes, whatever it found. Only a failed one stays in Unread. We don't run check-ins inside the main chat, as OpenClaw does by default: at 30 minutes, 24/7, that's up to 48 turns a day in the user's own conversation, and they'd collide with it. OpenClaw needs machinery for that (hiding prompts and acknowledgments, deferring while busy) and offers isolated sessions to cut the cost.

**Speaking.** A check-in's final reply is `HEARTBEAT_OK` or a note with **Did**, **Now**, and **Later** sections (`parseCheckInNote`). Now goes to the main agent straight away. Did and Later stay in the reply for later check-ins to read. A reply with no headings counts as Later, so a note in the wrong shape never buzzes a phone.

The note reaches the main chat as an ordinary coordination message (`handOffToMainAgent`), created in the transaction that finishes the check-in so a crash can't lose it. It always goes to the person's own main chat (`currentPrivateMainChat`), never one bound to a Slack or Buzz thread, where the reply would be posted. The main agent takes a real turn, so the message is in its own voice, with its context, and in its harness history, and replies continue with no injected context. It can reply `NO_REPLY` to stay silent, and the turn then leaves the chat's unread state as it found it (`settleDeclinedNote`). Other exceptions to normal coordination, all keyed on `payload.checkIn`: a note isn't cancelled because its source chat is archived, and it isn't steered into a running turn, batched with other messages, or supplied as context beside what a person types, because it needs a reply of its own and it tells the agent it may stay silent.

**Reaching the user.** The main agent's reply becomes `agent.message` (`runTerminalNotification`), a matrix event on by default. Channels list their events explicitly, so `backfillAgentMessageEvent` adds it once at boot to channels made before it existed. If the main agent's turn fails, the note itself is pushed. `deliverResultTo` no longer applies to the heartbeat, and it's gone from `update_heartbeat` and the digest list in Settings > Notifications.

**Seeing it.** A small "From a check-in at 2:48 PM" line stands in for the note in the transcript and opens the check-in. The note is for the main agent, and showing it would say everything twice. Hiding it entirely would leave no way to tell why the agent spoke. The main chat is left out of Unread on purpose, so `homeChat` on the rail payload drives an amber dot on the main agent's row, the same dot an agent's row shows for a new reply.

**Not repeating itself.** A fresh chat has no memory, so each prompt starts with what the app knows (`checkInContext`, §16). What check-ins did and raised in the last 3 days is read back from their replies. A note that never reached the main agent doesn't count, so the next check-in tries again. That's the recovery for a restart mid-turn or a failure before the turn starts. Nothing is stored twice: `runs.statusReason` (`heartbeat_told`, `heartbeat_held`, `heartbeat_quiet`) says whether a run has a note, and the note is its reply.

**Trade-off.** A check-in that only changes things no longer tells the user at the time. They hear about it in the morning summary, and the run page lists it straight away. Trust is learned by watching what it does, so if that proves too late, send changes sooner rather than bring reports back.

## 16. One heartbeat, with its rhythm in the prompt

Added 2026-11-04, after reading what the first 12 check-ins did. Email and stuck work are worth checking often. Filing tasks and asking about old ones aren't, and the check-ins spent most of their time crawling chats ($1.88 each, against $0.26 for a deck refresh). Separate schedules for each job would be the wrong thing to give someone getting started: people want to feel something is keeping an eye on things, and what costs them is decisions and interruptions, not timers. Every home already runs several managed schedules that nobody thinks of as crons.

So there's one switch, one timer, and one instruction box, and the instructions say what's due when (§8 is superseded by `DEFAULT_HEARTBEAT_INSTRUCTIONS`). This replaces the app-decided daily message from §15, which is deleted. The morning summary is a Now note the instructions ask for.

The default tidy follows one line: fill gaps and clear clutter on its own, never overrule something the person chose, and never ask about it, because the person shouldn't have to maintain a system. So it archives only what's clearly dead, moves tasks untouched for 6 months to Consider unless they have a deadline or repeat, files a task only when the area is obvious, and leaves anything already set alone, at most 10 changes a night. Archiving only dead tasks wouldn't be enough: on the first real home, 3 of 427 open tasks were blank, while 166 hadn't been touched in 6 months. Stale-task lists for the person to approve were tried in draft and dropped, since that makes them the one maintaining it. The morning summary brings decisions with recommendations, so one word can unblock work, and stalled chats get told to continue when the next step is clear and safe.

What has to stay in code:

- **The hard limits.**
- **What a check-in can't work out for itself** (`checkInContext`): the time, when the last check-in finished, when earlier ones ran today, what they did and raised, how many chats are running or waiting to be read, and chats that finished since the last check-in with their status lines. That's what makes "once each morning" work, and handing over the chats is meant to spare it crawling them.
- **Filing isn't touching** (`isCheckInFiling`): an area-only `update_task` from a check-in keeps `updatedAt`, so "nobody has touched this in 6 months" still finds the task. It's still recorded in the task's history.

What this gives up:

- Timing is the next check-in after the stated time, and "once" and "up to twice" are soft. A rare duplicate or miss is cheap, and easy to see and fix by editing text.
- Skipping check-ins when nothing is new is left out. The app can't read the schedule out of the prompt, so it could skip a tidy or a morning note. Add it only if usage on the narrower prompt calls for it.

Not built: asking people to turn this on at the moment it can first help, such as when they connect email. For now it stays off until they find it.
