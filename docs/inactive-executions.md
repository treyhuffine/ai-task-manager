# Inactive executions

Executions nobody has touched for a while fold out of the way without being
archived. Decided 2026-09-28 and 2026-09-30 (the "Ri launch blockers" task).

## The rule

An execution is **inactive** when its most recent activity is older than the
threshold. "Most recent activity" is the rail's hotness key
(`sessionHotnessKey`): the latest of `lastActivityAt`, `unreadMarkerAt` and
`startedAt`. What bumps `lastActivityAt` is the existing policy in
`src/lib/sessions/activity.ts`: agent output, messages, tool calls, git,
terminal input. Viewing never counts, so opening an old execution doesn't
revive it. Sending it a message does.

- Every state can go inactive: unread, awaiting input, pinned. Pins fold like
  everything else (decided 2026-09-30, after first keeping them in place).
- The one exception is work that is literally running: a live turn or a
  background task. Those are never inactive.
- Nothing is stored per execution. Inactive is derived on read, so changing
  the threshold re-sorts every list at once, and new activity brings an
  execution straight back.

The logic lives in one place, `src/lib/sessions/inactive.ts`
(`isSessionInactive`, `partitionInactive`, `resolveInactiveAfterDays`), and
the client applies it through `useInactivity()` (`src/hooks/use-inactivity.ts`),
which also ticks once a minute so rows cross the line while the app is open.

## The setting

One global preference, `user_state.execution_inactive_after_days`
(migration `0003`):

| Stored | Meaning |
|---|---|
| `null` | The product default, 7 days. Picking the default stores null, so a later change of default applies. |
| `0` | Never. Nothing folds. |
| `1` to `3650` | That many days with no activity. |

`PATCH /api/user-state` rejects anything else with a 400. The pickers offer
1 day, 3 days, 1 week, 2 weeks, 30 days and Never, plus a custom stored value
if one was set through the API. It changes in two places, optimistically:

- The timer button at the end of any inactive toggle (on hover on desktop,
  always shown on touch).
- Settings, General, "Inactive executions".

It is an app setting, so `update_user_state` does not write it (that action
only takes working context). `get_user_state` returns it.

## Where it applies

Each list folds its own inactive rows behind a toggle at its foot:
**"4 inactive hidden"** on the left and **Show** on the right (**"4 inactive
shown"** and **Hide** once open, `FoldRow` in
`src/components/workspaces/fold-row.tsx`). The rows expand in place. Each
section remembers its own choice in localStorage (`ri.rail.fold.inactive:<section>`,
`src/lib/client/rail-fold.ts`). Shown inactive rows are dimmed and carry a
moon before their age.

Under an agent in the agents-first rail, inactive work shares the one toggle
that already holds the quiet overflow past its first three threads: "5 more
and 44 inactive hidden" with Show, inactive rows last when shown. Two stacked
toggles there read as two different things to choose between.

| Surface | Section ids |
|---|---|
| Rail: Pinned | `pinned` |
| Rail, Agents tab: Needs you (executions) | `unread` |
| Rail, Agents tab: each agent's list (classic) | `agent:<workspaceId>` |
| Rail, Agents tab: each agent's threads (agents-first) | one toggle with the quiet overflow, `hidden:agent:<workspaceId>` |
| Rail, Status tab: each bucket | `status:<bucket>` |
| Skinny rail: a moon button at the foot | `skinny` |
| Agent view Overview: Pinned, Needs you, Recent | `overview:<workspaceId>:pinned`, `:needs`, `:recent` |
| Mobile Agents: Needs review, each agent | `unread`, `agent:<workspaceId>` |

A section holding only inactive rows still shows, with just its fold.

**Pins fold too.** An inactive pin leaves the Pinned group (and its agent,
its status bucket, the skinny strip) for the same "N inactive hidden" toggle.
Shown, it is dimmed with a moon and offers Unpin and Archive on hover, so a
stale pin is one click from gone. In the agents-first rail the execution open
right now stays among its agent's threads, marked, whatever its age.

**Counts are active work only.**

**History** doesn't fold. It is the look-back view, where old work is the
point.

**Attention counts leave inactive work out**, so they keep matching the lists:
the top bar's status pills, each agent's header dots in the rail, the agent
view header, the mobile Agents tab badge and each mobile agent's count, and the
tablet rail's dots.

## Agents

`list_executions` returns `inactive` on each row, by the same rule and the
same running/background exemption. Both briefs (the app's main chat and an
agent's main chat) say to leave inactive executions out of "what needs my
attention" unless the user asks about older work.
