# Heartbeat

The heartbeat is a regular check-in. On a schedule you set, an agent goes over your tasks, notes, and chats in the background and does what your instructions say. It's on or off. There are no modes: your instructions decide what it does, inside a few hard limits the app always adds.

You don't read check-ins. When one finds something worth telling you, your main agent sends you a message, in your main chat and on your phone. Most check-ins end with nothing to say.

Design and decisions: `docs/heartbeat-spec.md`. How other tools do this, and what we took from them: `docs/paperclip-work-model.md`.

## Using it

Open **Settings > Heartbeat**. When it needs you (never set up, paused, or failed), a **Heartbeat** chip also appears in the deck's Today status row, and tapping it opens the same settings. While it's running fine, the deck doesn't mention it.

| Setting | What it does | Default |
|---|---|---|
| Heartbeat | On or off | Off |
| Every | A number and a unit: minutes, hours, or days. At least 5 minutes | 30 minutes |
| Hours | 24/7, or only between two times in your timezone | 24/7 |
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
- Don't message the user or their main agent directly. The check-in's final reply is how anything reaches them.
- If nothing needs to reach them, reply `HEARTBEAT_OK` and nothing else. That should be the usual outcome.
- Otherwise, reply with a private note for the main agent, in up to two sections: **Now** (what can't wait until the next check-in) and **Later** (what needs them but can wait), each line followed by its task, note, or execution chip on its own line, with ids copied exactly from tool results.

These rules are prompt-level. The agent is told to follow them, but the app doesn't block the underlying actions. What protects you is that every change is listed and can be undone (below). Outward actions on integrations (sending email, posting to Slack) still ask for approval under the integration write policy, whoever calls them.

## What you see after a check-in

Every finished check-in archives its own chat, so none of them wait for you in Unread.

- **Something can't wait.** The check-in passes a note to your main agent. It takes a normal turn and writes to you in its own words, in your main chat, and the message is pushed to your notification channels. A small "From a check-in at 2:48 PM" line above the message opens the check-in that prompted it. Replying just continues the conversation, because the message is in your main agent's own history.
- **Something can wait.** Questions, offers, and decisions are saved. The first check-in after 09:00 each day hands your main agent what built up, along with what check-ins changed, and it sends you one message. If nothing built up, there's no message.
- **Nothing needed.** Nothing happens, apart from a line in the history.
- **Failed.** A failed check-in stays in Unread, the deck chip says **failed**, and Settings shows the error.

Your main agent can decide a note isn't worth sending, for example if you already talked about it. It then replies `NO_REPLY`, nothing is pushed, and you only see the "From a check-in" line. If its turn fails, the note itself is pushed instead, so something urgent still arrives. A note waits while your main agent is busy, including while you're talking to it.

The new message puts an amber dot on your main agent in the rail until you've read it. Pushing it is on by default for every channel, and **Message from your main agent** in Settings > Notifications turns it off per channel.

Check-ins don't repeat themselves. Each one is told what check-ins raised in the last 3 days and not to raise it again unless something changed. After that, something still unresolved can come up again.

To check its work, **Recent check-ins** in Settings > Heartbeat lists the last few:

- Each row says what that check-in did and opens its chat.
- **Changes (N)** opens the run page, which lists every task, note, and agent the check-in changed, by title. This list is recorded by the app as each action runs, not taken from what the agent says, so nothing can be left out.
- Open a task or note to see its history and undo a change, including a change of area.
- **History** opens the heartbeat's page on the Triggers screen, with every past check-in.

You can also ask your main agent what the heartbeat has been doing.

## How it runs

- It's the fifth app-managed trigger (`00000000-0000-0000-0000-000000000005`), listed on the Triggers screen as **Managed**. It's created at startup, turned off. It can be turned off but not deleted.
- Your instructions are the trigger's prompt. The ground rules above are added in code at dispatch (`src/lib/heartbeat/prompt.ts`), so the transcript's first message shows exactly what the agent received.
- The scheduler fires it like any interval trigger. If you limit the hours, slots outside them are skipped. When you turn it on or change its schedule, the first check-in is one interval out, moved into your hours. If you turn it on before your hours start, it's the window opening, if that comes sooner.
- Check-ins never overlap. If one is still running when the next is due, the next is skipped. A check-in that runs longer than 30 minutes is stopped and marked failed.
- When you edit the schedule, the hours follow your timezone from Settings > General.
- Each check-in is one session on the provider you picked. Every 30 minutes, 24/7, is 48 sessions a day, and quiet ones are short. Your main agent only takes a turn when there's something to say. Cost is recorded per run, and the monthly budget applies. If the budget runs out, the app turns the heartbeat off and Settings says why. Turning it back on clears that.

## For agents and the CLI

| Action | Use |
|---|---|
| `get_heartbeat` | Read its settings, next check-in, and last check-in |
| `update_heartbeat` | Change any of: `enabled`, `instructions`, `resetInstructions`, `intervalSeconds`, `activeHoursStart`, `activeHoursEnd`, `timezone`, `provider`, `model`, `effort` |
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
- **Replying from your phone.** A pushed message opens your main chat. Telegram only sends for now. The Slack connection is two-way, but the heartbeat doesn't use it yet.
- **A cap on how much unreviewed agent work can pile up.** That matters once it starts work on its own.
- **More than one heartbeat** (per area or per agent).
- **Assigning or tagging tasks to agents.** This is the strongest idea from `docs/paperclip-work-model.md` §7. It would give the heartbeat a clean rule: only work what you've handed over.
- **Nudging stalled executions automatically.** It reports them instead.
