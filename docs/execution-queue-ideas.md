# Execution Queue — ideas (parking lot)

Status: **future / not scheduled.** Captured 2026-06-18 from a brainstorm. This is
intentionally *not* part of the proactive-deck work (`docs/deck-proactive-spec.md`)
— it's the next thing to reach for once that settles. Nothing here is committed.

## The decision

The deck stays the **human's** surface — your attention and flow. AI *execution*
does **not** go in the deck. Instead, a **separate Execution Queue** holds the AI's
work: what it's proposing to take on, what it's running, and what it finished that
needs your review.

Why separate: the deck is sacred (your work, minimal decisions, get into flow).
Mixing the AI's to-do list into it rebuilds the inbox we're trying to kill. Keep
them apart — but bridge them (see #1 below), because a separate surface you have to
*remember* to check will rot.

## Core mental model

- **Deck** = the human's attention ("what needs *me* today").
- **Execution engine** = the AI doing work. *Already exists* — executions /
  workspaces / orchestrator (agent sessions, worktrees, PRs, takeover).
- **Execution Queue** = the pipeline that engine **reports to you** through. Your
  job is two gates; everything between runs itself:

  ```
  Proposed ──[you approve]──▶ Queued ──▶ Running ──▶ Needs Review ──[you review]──▶ Done
  ```

- Human quick-add and AI suggestion feed the **same** queue — "source: you / AI" is
  just metadata, same approve → run → review pipeline. One mechanism, not two.

## What makes it good (priority order)

1. **The bridge is make-or-break.** A standalone queue dies if nothing summons you
   to it. Surface one calm line in the deck's morning brief — *"4 to review, 2
   awaiting approval"* — driven by the change-router already built for the deck
   (AI-work events are just another source on those rails). Separate surface; the
   deck (your daily ritual) pulls your attention to it at the right moment. **Build
   nothing else without this.**

2. **Cron *proposes*, it doesn't execute.** Scheduled jobs drop items into the
   *Proposed* lane, not silent runs — until you've granted that class of work
   autonomy. Keeps autonomy earned, not assumed; a 4 AM cron can't surprise you with
   6 PRs.

3. **Cheap approve-gate via provenance.** Each suggestion carries *why now · what it
   touches · how reversible · rough cost (time/tokens/blast radius)*. That's the
   "suitability determination" surfaced. Rejecting or heavily editing a suggestion
   teaches the bar, so proposals improve and the gate gets lighter.

4. **Two gates, not a board.** Your whole job is *approve* and *review* — resist it
   becoming project management. Review items carry the artifact (diff / PR / output)
   inline with accept / request-changes / reject, and are **batched** (clearing a
   teammate's PRs, not 10 new cards).

5. **It's also your control room, bounded.** The *Running* lane lets you peek at a
   live agent, intervene, or stop it (orchestrator oversight already supports
   list/read/send). Cap concurrent work (N at a time, queue the rest) and tie spend
   to the existing monthly budget so it stays legible.

## Suitability determination (you / AI / collaborate)

Routing each candidate, transparent and correctable ("actually I'll take that" / "no
you can't handle this"), learned over time:

- **AI-suitable**: clear acceptance criteria, mechanical / research / draft work,
  reversible, low blast radius, no taste / relationships / authority needed.
- **Human-only**: needs judgment, involves people, high-stakes / irreversible, or
  ambiguous (you still have to define "done").
- **Collaborative**: AI drafts → you decide.

Start **propose-before**, earn **review-after** for trusted classes (the trust
ladder).

## Reuse — closer than it looks

The queue is mostly *a view + a Proposed lane + the bridge*, not a new engine:

- Executions / workspaces — the executor (running agents, PRs, takeover).
- Scheduler + `schedules`/`runs` — cron + scheduled runs (same engine the deck's
  morning cron uses).
- `listNeedsReviewSessionCandidates` — the "needs review" set already exists.
- Orchestrator oversight (list/read/send to executions) — the control-room plumbing.
- `user_state.monthlyBudgetUsd` — spend cap already there.
- The deck's `change-router` (`src/lib/deck/change-router.ts`) — the bridge's
  absorb/digest/interrupt policy, source-agnostic by design.

## Open question to sit with

**What's the first class of work you'd trust review-after instead of
approve-before?** That's the first rung of the trust ladder — it tells you which
suggestions can skip gate #1 early, which is what turns this from "another inbox"
into actual leverage.

## When picking this up

Likely first slice: the **Needs-Review lane + the deck bridge** (highest value, most
plumbing already exists), then the **Proposed lane + approve gate**, then
**cron-proposes**, then the **control room / WIP cap**, then **review-after trust
graduation**.
