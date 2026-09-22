# Heartbeat

> Status: Spec, 2026-09-22. Not built yet.
> Related: `docs/paperclip-work-model.md` (reference study), `docs/async-agents-v1.md` §10 and `docs/scheduled-async-agents-spec.md` §3.4 (the earlier heartbeat plans this replaces), `docs/deck-morning-trigger-spec.md` (the app-managed trigger pattern this reuses).

## 1. In plain English

The heartbeat is a regular check-in. On a schedule you set, an agent looks over your tasks, notes, and agent runs, following instructions you write in the app. It tidies up what it safely can, and it tells you what needs you.

- **Tidy up and ask** (default): it makes changes that can be undone and asks before starting any real agent work.
- **Suggest only**: it changes nothing and tells you what it would do.

A check-in with nothing to report leaves no trace. A check-in that did or found something leaves one short report in Unread. Each change links to the task or note, where you can see what changed and undo it.

You configure it in Settings > Heartbeat, or from a chip on the deck.

## 2. Goals and non-goals

**Goals**

- Work keeps moving without you prompting each step, starting with upkeep of your system.
- Everything is editable in the app: instructions, how often, which hours, which program, model, effort, mode.
- It's easy to audit: every change is listed and undoable, and quiet check-ins cost you no attention.
- No new tables and no new engine. It is an app-managed trigger.

**Non-goals (for now)**

- The heartbeat starting or steering agent work on its own. It offers, and you start.
- Internal events (run finished, task moved) as wake sources.
- Tracking which suggestions you accept, and promoting it to more autonomy based on that.
- A cap on unreviewed agent output. It only matters once the heartbeat starts work itself.
- Several heartbeats (per area or per workspace). One heartbeat first.
- Assigning tasks to agents. This is a strong candidate (see `docs/paperclip-work-model.md` §7) and would give the heartbeat a clean "only work what you've handed over" rule. It's separate work.

## 3. Decisions

| Decision | Why |
|---|---|
| The heartbeat is a trigger row, the fifth app-managed ("reserved") trigger. | A trigger already has every setting needed: prompt, interval, active hours, timezone, program, model, effort, no-overlap policy, and result delivery. The Triggers screen and run history already work with it. |
| Its instructions live in the trigger's `prompt`. The ground rules live in code. | You edit plain instructions and can't accidentally delete the guardrails. The ground rules can improve with the app. |
| Mode is stored in one new nullable column, `user_state.heartbeatMode`. | Mode is a preference. Per the column-defaults rule it has no DB default and is resolved at read time (`?? 'tidy'`). |
| A quiet check-in is detected by a fixed reply, `HEARTBEAT_OK`, and its chat is archived. | Archived chats never reach Unread. A check-in that changed anything is never treated as quiet, even if it replies `HEARTBEAT_OK`. |
| Suggest only is enforced by hiding write tools, not only by asking. | The `mutating` flag already exists on actions. It's a guardrail against mistakes, not a sandbox (§5.5). |
| It never deletes, never sends anything outside Ri, and never completes a task. | Deletes can't be undone. Outward sends leave your control. Completing a task is your acceptance, per the task lifecycle rule that a finished agent run never completes a task. |

## 4. Data model

### 4.1 The trigger row

A new sentinel id in `src/lib/triggers/reserved.ts`:

```ts
heartbeat: '00000000-0000-0000-0000-000000000005',
```

Seeded create-if-absent at boot by `ensureHeartbeatTrigger()` (new, in `src/lib/heartbeat/trigger.ts`), called from `instrumentation.ts` next to `ensureMorningDeckTrigger()` and `ensureStreamTriageTriggers()`. It never flips `enabled` on an existing row, so turning it off survives restarts.

| Field | Value | Editable |
|---|---|---|
| `name` | `Heartbeat` | locked |
| `description` | `Checks in on your work on a schedule.` | locked |
| `enabled` | `false` | yes |
| `targetKind` | `orchestrator` | locked |
| `agentId` | `getOrCreateTriggerAgent('orchestrator')` | yes, through the provider switch |
| `kind` | `every` | locked |
| `intervalSeconds` | `3600` | yes: 1800, 3600, 7200, 14400, 86400 |
| `activeHoursStart` / `activeHoursEnd` | `09:00` / `21:00` | yes, and can be cleared for all day |
| `timezone` | the server's local timezone, as the stream triggers do | yes |
| `prompt` | the default instructions (§8) | yes |
| `model` / `effort` | `null` (use the program's defaults) | yes |
| `concurrencyPolicy` | `skip_if_running` | locked |
| `catchUpPolicy` / `maxCatchUpRuns` | same as the other app-managed triggers | locked |
| `timeoutSeconds` | `1800` | locked |
| `deliverResultTo` | `[]` | yes |

The 30-minute timeout is deliberate. A check-in that runs that long is stuck, and nothing else should wait on it.

### 4.2 Per-trigger locked fields

Today `RESERVED_LOCKED_FIELDS` is one list for every app-managed trigger, and it locks `prompt` and `agentId`. That list becomes a map by id:

```ts
export const RESERVED_LOCKED_FIELDS: Record<ReservedTriggerId, readonly LockableField[]> = {
  [morningDeck]: ['name', 'description', 'prompt', 'targetKind', 'agentId', 'kind'],
  // ...the three stream triggers, unchanged...
  [heartbeat]: ['name', 'description', 'targetKind', 'kind', 'concurrencyPolicy', 'timeoutSeconds'],
};
```

The existing four keep exactly what they lock today. `update_trigger` (`src/lib/orchestrator/registry.ts`, the reserved check near line 2067) reads the map for the given id. The trigger detail page's "managed" notice names that trigger's own locked fields and links to the right settings section (`?settings=heartbeat` for the heartbeat).

`reserved.ts` notes that past a handful of managed triggers it should switch to a `managed_kind` column. Five is still a handful. Revisit at the sixth.

### 4.3 Mode

```ts
// user_state
heartbeatMode: text({ enum: ['tidy', 'suggest'] }),  // nullable, no default
```

Resolved at read time as `userState.heartbeatMode ?? 'tidy'`. `HeartbeatMode` is derived from the schema in `src/db/types.ts`.

**Migration:** one additive nullable column. Unlike the `heartbeat_days` drop, this has to be migrated before the code ships, because selecting a column that doesn't exist is an error. If the pending migration (the `heartbeat_days` drop plus the `agents` table removal) hasn't run by then, generate one migration that covers all of it.

### 4.4 Quiet runs

A quiet check-in completes with `runs.statusReason = 'heartbeat_quiet'` and `runs.summary = 'Nothing needed'`. Its chat is archived. No new columns.

## 5. Runtime

### 5.1 Firing

The existing scheduler tick fires it like any `every` trigger, honoring active hours (`isWithinActiveHours`, `src/lib/scheduler/runner.ts:201`). With `skip_if_running`, a check-in never overlaps the previous one. Each fire creates a fresh orchestration chat, as orchestrator triggers already do (`resolveTarget`, `src/lib/runs/dispatch.ts`).

### 5.2 Prompt composition

In `src/lib/runs/dispatch.ts`, when `trigger.id === RESERVED_TRIGGER_IDS.heartbeat`, the prompt sent to the agent is:

```
<ground rules for the current mode, §5.3>

## Your instructions

<trigger.prompt>
```

Build it with `composeHeartbeatPrompt(mode, instructions)` in `src/lib/heartbeat/prompt.ts`, used at the dispatch site that calls `composePromptWithPayload`. The composed prompt is what gets persisted as the chat's first user event, so the transcript shows exactly what the agent received, even if the instructions change later.

### 5.3 Ground rules

Both modes start with:

> This is a scheduled heartbeat check-in, not a conversation. The user is not watching. Work through the instructions below using the Ri tools. Do only what the instructions ask. Do not invent new chores.
>
> If nothing needs attention and you changed nothing, reply with exactly `HEARTBEAT_OK` and nothing else.

**Tidy up and ask** adds:

> You may make changes that can be undone: edit tasks and notes, add notes, set a task's area, snooze a task, and move tasks between Consider, Todo, and Archived.
>
> Never delete anything. Never send, post, or share anything outside Ri. Never complete a task. Do not start or message agent executions. Offer that work in your report instead.
>
> End with a short report, most important first, under 15 lines, no preamble:
>
> **Did**: one line per change, each with its `[[task:ID]]` or `[[note:ID]]` marker.
> **Needs you**: one line per question or offer, each with its marker.
>
> Leave out a section that would be empty.

**Suggest only** adds:

> Change nothing. You only have read tools.
>
> End with a short report, most important first, under 15 lines, no preamble:
>
> **Would do**: one line per change you would make, each with its marker.
> **Needs you**: one line per question or offer, each with its marker.

The chat already renders `[[task:ID]]` and `[[note:ID]]` markers as chips, so every line in the report links to the item.

### 5.4 Quiet detection

In the run's terminal handling (`src/lib/runs/event-hooks.ts`, where `summary` and `artifactRefs` are finalized), for heartbeat runs:

- If the final assistant message, trimmed, is exactly `HEARTBEAT_OK` **and** `artifactRefs` is empty: the run is quiet. Set `statusReason = 'heartbeat_quiet'`, set the summary to `Nothing needed`, and archive the chat.
- Otherwise it's a normal completed run, and its chat reaches Unread through the existing `lastOutcomeEventAt` path.

Quiet runs also skip `deliverResultTo`. A Telegram ping that says "HEARTBEAT_OK" every hour is noise.

### 5.5 Enforcing suggest only

When a heartbeat session starts in suggest mode:

1. **MCP.** `orchestratorMcpServer` and `connectorsMcpServer` (`src/lib/orchestrator/harness-surface.ts`) take a `scope: 'read'` option that adds an `x-ri-tool-scope: read` header. The orchestrator MCP route builds a second handler over `actions.filter((a) => !a.mutating)` and uses it when that header is present. The connectors MCP applies the same filter to connector actions.
2. **CLI.** The session gets `RI_TOOL_SCOPE=read` in its env (use the app env prefix helper, not a hardcoded `RI_`). `runAction` rejects a mutating action with `ActionError('unsupported', ...)` when that variable is set. This covers harnesses that reach Ri through the CLI rather than MCP. Codex ignores the MCP config today.
3. **Choosing the scope.** The adapter picks the scope when it builds the session config. It walks the session to the run that created it (`chatSessions.createdByRunId`), and if that run's `triggerId` is the heartbeat and the mode is `suggest`, the scope is `read`.

**Limits:** the session still has a shell. A determined agent could get around this. It prevents mistakes, not misuse. `docs/heartbeat.md` must say so.

### 5.6 Keeping the mutating flag honest

41 of 74 actions set `mutating: true`, and nothing checks the rest are really reads. Add a test that pins the exact set of non-mutating action names. A new action then fails the test until someone classifies it on purpose.

## 6. API and agent surface

Two new orchestrator actions in `registry.ts`, so the app, the CLI, and agents all use one path. An agent can then handle "check in every two hours" from chat.

| Action | Params | Returns |
|---|---|---|
| `get_heartbeat` | none | `HeartbeatConfig` |
| `update_heartbeat` (mutating) | any of: `enabled`, `mode`, `instructions`, `interval_seconds`, `active_hours_start`, `active_hours_end`, `timezone`, `provider`, `model`, `effort`, `deliver_result_to` | `HeartbeatConfig` |

```ts
interface HeartbeatConfig {
  enabled: boolean;
  mode: 'tidy' | 'suggest';
  instructions: string;
  intervalSeconds: number;
  activeHoursStart: string | null;
  activeHoursEnd: string | null;
  timezone: string | null;
  provider: HarnessId | null;
  model: string | null;
  effort: Effort | null;
  deliverResultTo: string[];
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

`update_heartbeat` writes trigger fields through `updateTrigger` (reusing the provider-switch logic, which resets model and effort when the program changes) and the mode through `updateUserState`. Validation matches `update_trigger` (interval from the allowed set, `HH:MM` hours, model fits provider). It's safe to retry.

"Check in now" uses the existing `run_trigger` with the heartbeat id. No separate action.

REST: `GET` and `PUT /api/heartbeat`, both calling `runAction` with `remote: false`, like `/api/triggers`. Client hooks: `useHeartbeat()` and `useUpdateHeartbeat()` in `src/hooks/use-heartbeat.ts`, following `use-morning-deck.ts`.

## 7. UI

All copy follows the repo rule: no em dashes, no semicolons.

### 7.1 Settings > Heartbeat

A new `SectionId` `'heartbeat'` in `src/components/settings/settings-sections.ts` (label "Heartbeat", icon `HeartPulse`, description "A regular check-in on your work."). The content is `<HeartbeatSettings />` in `src/components/settings/sections/heartbeat-section.tsx`.

```
Heartbeat
Checks in on your work on a schedule. Keeps things tidy and tells you what it did.

  Check in regularly                                        [ on ]
  Every  [ 1 hour ▾ ]   from [ 09:00 ]  to [ 21:00 ]
  Runs on [ Claude Code ▾ ]  Model [ Default ▾ ]  Effort [ Default ▾ ]

  On its own
  ● Tidy up and ask     Makes changes you can undo. Asks before starting work.
  ○ Suggest only        Changes nothing. Tells you what it would do.

  Instructions
  ┌────────────────────────────────────────────────────────────┐
  │ (the instructions, plain text, autosizing)                  │
  └────────────────────────────────────────────────────────────┘
  [ Reset to default ]

  Last check-in 2:00 PM · changed 2, 1 for you   [ Report ] [ Changes ]
  Next check-in 3:00 PM                                  [ Check in now ]
```

- The frequency choices are 30 minutes, 1 hour, 2 hours, 4 hours, and once a day. The hours row can be switched to "Any time".
- The program, model, and effort pickers reuse the existing trigger form's controls.
- When it's off, only the switch and a one-line description show, with the rest collapsed.
- Instructions save on blur, with the same save feedback as other settings text fields.
- **Report** opens the check-in's chat. **Changes** opens `/runs/[id]`, which already lists what the run changed (`artifactRefs`). That gives an audit path that doesn't depend on the report being complete.
- The mode control reuses the "Capture triage" mode-list styling in General.

### 7.2 Deck chip

The chip goes in `DeckDayBar`, which both deck layouts share, on the right side.

| State | Chip |
|---|---|
| Off | `Heartbeat off` (muted) |
| On, last check-in quiet or read | `Heartbeat · 2:00 PM` |
| On, last report unread | `Heartbeat · 1 for you` (accent dot) |
| Last check-in failed | `Heartbeat · failed` |

Tapping the chip opens a sheet with `<HeartbeatSettings compact />`: the same component as Settings, with the instructions box collapsed behind "Edit instructions". It's one component in two places, so they can't drift apart. In the "1 for you" state, the sheet puts the report link at the top. The sheet uses `@container` queries, not viewport breakpoints, because it renders inside panels.

### 7.3 Triggers screen

The heartbeat shows up in the list as Managed, like the morning deck. Its detail page keeps run history and "Run now", and its managed notice says "Edit it in Settings > Heartbeat" with a deep link.

## 8. Default instructions

Seeded into `prompt` and restored by "Reset to default":

```
Each check-in, look for:

- Todo or In progress tasks nobody has touched in 14 days. Ask me whether to do, snooze, or archive each one.
- Tasks with no area. Set the most likely area.
- Agent runs that failed or stopped without finishing that I haven't looked at.
- Tasks too vague for anyone to start. Ask me the one question that would make each one clear.
- Tasks an agent could finish end to end without my judgment. Offer to start them.

Keep each check-in to the five most important items.
```

## 9. Cost

Each check-in is one orchestrator session on the default subscription harness. Hourly between 09:00 and 21:00 is 12 sessions a day, and quiet ones are short. Runs record cost like any trigger run, and the existing monthly budget applies.

## 10. Tests

- **Seeding:** creates the row once, is idempotent across boots, and never re-enables a disabled row.
- **Locks:** the heartbeat accepts edits to prompt, program, model, effort, interval, and hours, and rejects name, kind, and target. The four existing managed triggers lock exactly what they locked before.
- **Prompt:** the composed prompt has the right ground rules per mode, your instructions follow verbatim, and the persisted first chat event equals the composed prompt.
- **Quiet detection:** `HEARTBEAT_OK` with no changes is quiet (statusReason set, chat archived, not in Unread, no delivery). `HEARTBEAT_OK` with changes is not quiet. A normal report reaches Unread.
- **Scope:** a read-scoped orchestrator MCP lists no mutating tools. `runAction` with `RI_TOOL_SCOPE=read` rejects a mutating action. Tidy mode gets the full tool set.
- **Mutating flag:** the pinned set of non-mutating action names.
- **Actions:** `get_heartbeat` and `update_heartbeat` round-trip, a provider switch resets model and effort, invalid intervals and hours are rejected, and retries are safe.
- **UI:** the settings section renders both states and the deck chip renders all four states.

## 11. Verification before calling it done

1. `pnpm ts`, `pnpm lint`, and the relevant `vitest` suites pass.
2. In dev (port 42241, dev data): turn it on, then "Check in now" in both modes against dev data. Check that:
   - a quiet check-in leaves no Unread row and the chip shows the time
   - a check-in with findings reaches Unread with chips that link to the right tasks
   - tidy changes appear on the run page and can be undone from each task's history
   - suggest mode can't write (try it by giving it instructions that ask for a change)
3. Screenshots of the settings section, the deck chip states, and the sheet.
4. Write `docs/heartbeat.md` (user-facing: what it does, the settings, what suggest only does and doesn't guarantee, and what's deliberately not built). Mark the heartbeat parts of `docs/scheduled-async-agents-spec.md` §3.4 and `docs/async-agents-v1.md` §10 as replaced by it.

## 12. Build order

1. Runtime: the sentinel, seeding, per-trigger locks, prompt composition, quiet detection, and delivery suppression.
2. Suggest-only scope (MCP and CLI) and the mutating-flag test.
3. `get_heartbeat` and `update_heartbeat` actions, the REST route, and hooks.
4. Settings section.
5. Deck chip and sheet.
6. Docs and end-to-end verification.

Steps 1 to 3 can land and be tested without any UI, through `ri agent get_heartbeat` / `update_heartbeat` and "Run now" on the Triggers screen.

## 13. Open questions

1. **Program picker and the `agents` table.** The picker uses today's provider switch, which points the trigger at an `agents` row. The planned removal of that table will change it along with the other four managed triggers.
2. **Nudging stalled executions.** Paperclip automatically re-wakes runs that stopped at a plan. Should tidy mode be allowed to send one nudge message to a stalled execution? v1 says no and reports it instead.
3. **Default on for new installs?** v1 ships off. After a few weeks of your own use, decide whether new installs should start on.
