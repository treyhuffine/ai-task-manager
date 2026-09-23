# Heartbeat

The heartbeat is a regular check-in. On a schedule you set, an agent goes over your tasks, notes, and executions and does what your instructions say. It's on or off. There are no modes: your instructions decide what it does, inside a few hard limits the app always adds.

Design and decisions: `docs/heartbeat-spec.md`. How other tools do this, and what we took from them: `docs/paperclip-work-model.md`.

## Using it

Open **Settings > Heartbeat**, or tap the **Heartbeat** chip on the deck (right side of the bar under the day strip). Both show the same settings.

| Setting | What it does | Default |
|---|---|---|
| Check in regularly | On or off | Off |
| Every | 30 minutes, 1 hour, 2 hours, 4 hours, or once a day | 1 hour |
| Hours | Only check in between two times, or any time | 09:00 to 21:00, in your timezone |
| Runs on | Provider, model, and effort | Your default provider, its default model |
| Instructions | What to look at and what to do each check-in | See below |

**Check in now** runs one check-in right away, whether it's on or off. Use it to try new instructions.

Default instructions:

```
Each check-in, look for:

- Todo or In progress tasks nobody has touched in 14 days. Ask me whether to do, snooze, or archive each one.
- Tasks with no area. Set the most likely area.
- Executions that failed or stopped without finishing that I haven't looked at.
- Tasks too vague for anyone to start. Ask me the one question that would make each one clear.
- Tasks an agent could finish end to end without my judgment. Offer to start them.

Keep each check-in to the five most important items.
```

To let it start agent work on its own, change "Offer to start them" to "Start them." **Reset to default** restores this text.

## What it always follows

The app puts these rules in front of your instructions on every check-in. Editing your instructions can't remove them:

- Never delete anything.
- Never send, post, or share anything outside the app.
- Never complete a task. Completing a task is your call.
- Start or message agent executions only when the instructions say to.
- If nothing needs attention and nothing changed, reply `HEARTBEAT_OK` and nothing else.
- Otherwise, reply with a short report: one line on what it checked and found fine, then **Did** (each change) and **Needs you** (each question or offer), each line followed by its task, note, or execution chip on its own line, with ids copied exactly from tool results.

These rules are prompt-level. The agent is told to follow them, but the app doesn't block the underlying actions. What protects you is that every change is listed and can be undone (below). Outward actions on connectors (sending email, posting to Slack) still ask for approval under the connector write policy, whoever calls them.

## What you see after a check-in

- **Nothing needed.** The check-in leaves no trace. Its chat is archived, it doesn't show up in Unread, and nothing is delivered to your notification channels. The deck chip shows the time it checked in.
- **A report.** The check-in's chat lands in Unread and the deck chip says **1 for you**. Each item is followed by a clickable task, note, or execution chip.
- **Failed.** The chip says **failed**. Settings shows the error.

To check its work:

- **Report** opens the check-in's chat.
- **Changes (N)** opens the run page, which lists every task, note, and agent the check-in changed, by title. This list is recorded by the app as each action runs, not taken from the report, so a change the agent leaves out of its report still appears here.
- Open a task or note to see its history and undo a change, including a change of area.
- **History** opens the heartbeat's page on the Triggers screen, with every past check-in.

A check-in that changed anything is never treated as quiet, even if it replies `HEARTBEAT_OK`.

## How it runs

- It's the fifth app-managed trigger (`00000000-0000-0000-0000-000000000005`), listed on the Triggers screen as **Managed**. It's created at startup, turned off. It can be turned off but not deleted.
- Your instructions are the trigger's prompt. The ground rules above are added in code at dispatch (`src/lib/heartbeat/prompt.ts`), so the transcript's first message shows exactly what the agent received.
- The scheduler fires it like any interval trigger. Slots outside your hours are skipped. When you turn it on or change its schedule, the first check-in is one interval out, moved into your hours. If you turn it on before your hours start, it's the window opening, if that comes sooner.
- Check-ins never overlap. If one is still running when the next is due, the next is skipped. A check-in that runs longer than 30 minutes is stopped and marked failed.
- When you edit the schedule, the hours follow your timezone from Settings > General.
- Each check-in is one session on the provider you picked. Hourly from 09:00 to 21:00 is 12 sessions a day, and quiet ones are short. Cost is recorded per run, and the monthly budget applies. If the budget runs out, the app turns the heartbeat off and Settings says why. Turning it back on clears that.

## For agents and the CLI

| Action | Use |
|---|---|
| `get_heartbeat` | Read its settings, next check-in, and last check-in |
| `update_heartbeat` | Change any of: `enabled`, `instructions`, `resetInstructions`, `intervalSeconds`, `activeHoursStart`, `activeHoursEnd`, `timezone`, `provider`, `model`, `effort`, `deliverResultTo` |
| `run_trigger` with the returned `triggerId` | Check in now |

```sh
ri agent get_heartbeat
ri agent update_heartbeat --input '{"enabled": true, "intervalSeconds": 7200}'
ri agent run_trigger 00000000-0000-0000-0000-000000000005
```

The REST equivalents are `GET` and `PUT /api/heartbeat`. `update_trigger` also works on the heartbeat row for the instructions, schedule, and provider, but it locks the name, description, target, trigger type, overlap rule, missed-run rule, and time limit.

## Not built yet

These are deliberately left out until using the heartbeat shows they're needed:

- **A read-only mode.** It's on or off. If one is ever needed, the `mutating` flag on actions makes it straightforward to enforce.
- **Internal events as wake-ups** (a run finished, a task moved). Chaining happens through the agent doing the work, or the next check-in.
- **Tracking which changes you keep or undo**, and adjusting based on that.
- **A cap on how much unreviewed agent work can pile up.** That matters once it starts work on its own.
- **More than one heartbeat** (per area or per agent).
- **Assigning or tagging tasks to agents.** This is the strongest idea from `docs/paperclip-work-model.md` §7. It would give the heartbeat a clean rule: only work what you've handed over.
- **Nudging stalled executions automatically.** It reports them instead.
