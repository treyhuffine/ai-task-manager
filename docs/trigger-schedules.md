# Schedules

A schedule (a trigger, in code and in the agent tools) sends a message on a
timetable. Each run goes to one of three places: a new chat in an agent, a
new Ri chat, or one existing chat.

There are three ways to make or change one:

- **The Schedules window**, from **Schedules and Triggers** in the rail. Edit
  any schedule in place, or set one up by describing it to the chat beside the
  form.
- **A chat's Schedule button**, the clock in its header. It schedules messages
  into that chat.
- **Any chat or agent**, through the trigger actions (`create_trigger`,
  `update_trigger`, ...) on its tools, or the CLI (`ri trigger create`).

## The Schedules window

The window opens on the list. Selecting a schedule opens it in the window
with every field editable in place: name, description (optional), message,
agent, provider and model, timing, and the advanced rules (time limit, what
happens when the last run is still going, active hours). **Save changes**
sends only what changed. **Discard changes** puts the form back. Run now,
Pause and Delete sit above the form, and its recent runs below.

The window is mounted once in the dashboard and opened through
`src/lib/client/schedules-window.ts`, so a chat's Schedule button can open it
on one schedule. The /triggers pages show the same parts (`TriggerDetail`,
`TriggerForm`) for deep links.

### Setting it up by chat

The chat beside the form is the schedule's builder chat: a focused content
chat (`surfaceKind: "trigger"`), briefed by `src/lib/triggers/builder-brief.ts`
and acting through the same actions the form uses.

- On **New scheduled task**, it's the new-schedule chat (`surfaceRef: "new"`).
  Describe the job in your own words ("every weekday at 7:30, have the ri agent
  summarize what changed in the repo"). The AI creates it with
  `create_trigger`. `create_trigger` then moves that chat onto the schedule
  it made (its `surfaceRef` becomes the schedule's id), and when the turn ends
  the window opens the schedule with the same conversation beside it. The
  next new schedule starts a fresh chat.
- On an existing schedule, it's that schedule's chat (`surfaceRef` is its id).
  Ask for any change. When the turn ends, schedules are refetched and the form
  shows the change.
- A builder chat can't make a chat-target schedule that points at itself:
  `create_trigger` refuses `target_kind: "session"` without a chat id from it.

The form and the chat can change the same schedule at the same time. The form
merges field by field: a field you haven't touched takes the new value, and
one you have keeps your edit (`rebase` in `trigger-form.tsx`). Schedules
compare by what they mean, so a spare value left in a hidden control never
counts as an edit.

### Timing

Frequency offers Manual (Run now only), One time, Hourly, Daily, Weekdays
(Monday to Friday), Weekly, Monthly, Every interval, Webhook and Custom cron.

- **Weekly** takes one or more days as toggles. Several days read as "Mon, Wed
  and Fri at 8:15 AM" and save as one cron (`15 8 * * 1,3,5`).
- **Every interval** takes a number and a unit (minutes, hours or days). An
  interval that isn't whole minutes, which only the API makes, shows seconds.
- **Custom cron** takes five fields: minute, hour, day of month, month and day
  of week. A cron the presets can describe opens as that preset.

The editor validates the expression and timezone, and previews the next three
runs. An existing schedule can switch between manual, one time, interval and
cron (`update_trigger` takes `kind`, and clears the other kinds' fields). A
webhook keeps its kind, since its secret is shown once, at creation. App-managed
schedules keep their identity and behavior locks while their schedule stays
editable.

For a one-time job, select a calendar date, a time and a timezone. Creating or
changing one requires a future time. The preview shows the chosen instant in
that timezone, independent of the browser's timezone. Times skipped by
daylight saving changes are rejected. In a repeated hour, new selections use
Croner's resolved offset, shown in the preview. An unchanged one-time
schedule is never re-sent, so it keeps its original instant, including
seconds and its offset.

Changing a finished one-time job's date or time, or switching a job to one
time, schedules another run. This clears its previous fire marker but keeps
its run history. Saving the same instant again, including an equivalent
timestamp with a different UTC offset, does not re-arm it. Paused jobs stay
paused until resumed. The scheduler checks due jobs on its normal tick, so a
run can start after the selected minute if the home is asleep or busy.

## Scheduling a chat

The clock in a chat's header (agent chats, the main Ri chat and an agent's
main chat) schedules messages into that chat. It opens a small form: how
often (one time, an interval, or a cron preset), the message, and **Start a
new chat each time**.

- **Off, the standard case:** each run sends the message into this chat
  (`target_kind: "session"`), which keeps its history and picks up where it
  left off. The message starts as "Check on progress and keep going. When the
  work is done, pause this schedule." The chat can pause its own schedule,
  since each run's message names it.
- **On:** an ordinary schedule that starts a fresh chat each time, in the
  chat's agent (or a fresh Ri chat for the main chat), on the chat's own
  provider and model.

Once a chat has an active schedule, the clock becomes a chip ("Every hour ·
next 3:00 PM"). It lists the chat's schedules with Pause and an Edit button
that opens the schedule in the Schedules window. The helper that builds the
schedule is `src/lib/triggers/chat-schedule.ts`.

## Sending to an existing chat

A schedule that sends to one chat (`target_kind: "session"`) shows **Sends to**
with a link to that chat in place of the agent and model, since the chat keeps
its own provider and model. Lists say "sends to a chat". A run while the chat
is busy is skipped by default. If the chat is archived or deleted, the next
run pauses the schedule and says why. Agents and the CLI create these too
(`ri trigger create --target session --session <chat id>`).

All saves use the existing tRPC procedures and orchestrator actions.

Verification:

```sh
pnpm test src/lib/scheduler/frequency.test.ts src/lib/orchestrator/registry.triggers.test.ts \
  src/lib/triggers src/app/api/document-chat
RI_REVIEW_CHROMIUM=<chrome-headless-shell> pnpm test src/components/triggers/trigger-schedule.browser.test.ts
pnpm ts
```
