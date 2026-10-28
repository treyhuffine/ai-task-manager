# Editing schedules

Open **Schedules and Triggers** in the rail and select a job. Its **Schedule**
section shows the cadence, timezone and next run. Choose **Edit schedule**, make
the change, then **Save schedule**. Cancel discards the edit. Saving preserves
the prompt, harness, model, run history and paused state.

Recurring cron jobs support Hourly, Daily, Weekly, Monthly and Custom cron.
Custom cron takes five fields: minute, hour, day of month, month and day of week.
The editor validates the expression and timezone, and previews the next three
runs. Existing interval jobs expose their interval in seconds. Editing keeps
the job's trigger kind. App-managed jobs keep their identity and behavior locks
while their schedule remains editable.

To create a one-time job, choose **New scheduled task**, then **One time** under
Frequency. Select a calendar date, a time and a timezone. Both creation and editing
require a future time. The preview shows the chosen instant in that timezone,
independent of the browser's timezone. Times skipped by daylight saving changes
are rejected. In a repeated hour, new selections use Croner's resolved offset,
shown in the preview. An unchanged existing selection preserves its original
instant, including seconds and its offset.

Changing a finished one-time job's date or time schedules another run. This clears
its previous fire marker but retains its run history. Saving the same instant
again, including an equivalent timestamp with a different UTC offset, does not
re-arm it. Paused jobs stay paused until resumed. The scheduler checks due jobs
on its normal tick, so execution can start after the selected minute if the home
is asleep or busy.

A job can also send to one existing chat instead of starting a chat on each
run. Agents and the CLI create these (`target_kind: "session"`, or
`ri trigger create --target session --session <chat id>`), often for a chat's
own check-ins. Its detail page shows **Sends to** with a link to that chat in
place of **Runs on**, since the chat keeps its own provider and model. Lists say
"sends to a chat". If that chat is archived or deleted, the next run pauses the
job and says why.

Schedule controls are shared by the creation form and detail editor. All saves
use the existing tRPC procedures and orchestrator actions. No migration is needed.

Verification:

```sh
pnpm test src/lib/scheduler/frequency.test.ts src/lib/orchestrator/registry.triggers.test.ts src/components/triggers/trigger-schedule.browser.test.ts
pnpm ts
```
