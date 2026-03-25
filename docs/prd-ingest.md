# Eon — Ingestion & Sort Placement

How captured thoughts become sorted tasks, and how the system ensures nothing gets buried without a human touch point.

---

## Core Principle

**Every task gets at least one human touch point before it can leave the working set.** The AI never unilaterally buries a task — regardless of its confidence. If something is on a person's brain enough to capture, it deserves to be seen by them at least once more before it drifts.

The pipeline: **Capture → Stream → Promote → Place in working set → Surface to user → User confirms, adjusts, or defers.** Only after that human confirmation can a task move lower or get boomeranged for later.

---

## The Stream as Gatekeeper

The stream (`status: pending | promoted | dismissed`) is the tracking mechanism for whether a capture has been processed. No additional `triaged_at` or `last_triage_at` fields are needed.

- **`pending`** — captured but not yet turned into an entity. Stays visible in the stream. The AI may marinate it (waiting for more context) or the user may handle it themselves.
- **`promoted`** — the AI (or user) created a task, note, or decision from it. The resulting task enters the active sort.
- **`dismissed`** — the user removed it, or it was transient and self-resolved.

Stream items stay `pending` until the user makes a decision or the AI promotes with confidence (urgent items, batch processing). The stream UI is the real-time surface where the user sees what was captured and what happened to it.

---

## Initial Sort Placement Heuristics

When a stream item is promoted to a task, the AI places it in the active sort. The goal is not perfect positioning — it's getting the task into the right zone so it surfaces naturally. The morning triage refines.

### The baseline rule

**Default to the working set range (top ~30-50).** If the user captured it, it matters enough to be in the working set. The only exception is explicit low-intent language. The AI errs toward surfacing too much rather than burying.

### Heuristic 1: Urgency detection (top of sort)

Deadline language, time-specific language, "ASAP", "before the meeting" → place near the top of the sort. These tasks should appear in the deck immediately.

This is the same urgency detection that triggers immediate stream processing (see PRD Section 8.1). If it's urgent enough to process immediately, it's urgent enough to place at the top.

### Heuristic 2: Reference comparison (3-bucket placement)

For non-urgent tasks, the AI grabs a small reference set — a few representative tasks from different ranges of the sort (one from the top, one from the middle, one from the lower working set). It asks: "Is this new task more or less important than these?"

Three rough buckets:
- **Above the top reference** → place in the upper working set (top ~10)
- **Between top and middle** → place in the mid working set (~10-25)
- **Below middle** → place in the lower working set (~25-50)

This gives the AI anchors without reasoning about the full list. Cheap, fast, and gets the zone right.

### Heuristic 3: Goal alignment

The AI reads the new task against the user's active goals. If the task clearly advances a goal ("write API docs" + goal "Launch Bounce"), it gets placed higher. Goals are one of the strongest non-urgency signals for importance.

### Heuristic 4: Similarity clustering

The AI looks for similar existing tasks (via embeddings or title comparison). "Write auth docs" is similar to "Build auth tests" at position #8 → place the new task nearby. Related work naturally groups together.

This also catches near-duplicates. If a semantically similar task already exists, surface the match for the user to merge or confirm as separate.

### Heuristic 5: Low-intent language (the only case for lower placement)

"Maybe", "someday", "would be nice", "eventually" → place in the lower working set. But still IN the working set — not buried below it. The task still gets a human touch point before it can drift further.

### Heuristic 6: When the AI isn't confident

If the task is ambiguous and the AI can't determine placement → place it in the mid working set and flag it for the next triage moment. Don't guess wildly. Surfacing is always safer than burying.

---

## Surfacing Mechanisms (Three Moments)

Multiple touch points ensure nothing falls through the cracks.

### Moment 1: Stream (real-time)

The stream shows captures as they happen, with what the AI did. The user sees promotions in real-time: "→ task: Fix production bug (placed in your top 10)." This is immediate acknowledgment. Already designed in the core PRD.

### Moment 2: Deck generation (ongoing)

When building the deck, also query for recently created tasks that haven't been through a triage:

```sql
SELECT t.* FROM tasks t
JOIN stream s ON s.id = t.stream_item_id
WHERE t.status = 'active'
  AND s.promoted_at > :last_session_created_at
ORDER BY t.created_at DESC
LIMIT 3;
```

These surface as a lightweight "recently added" section in the deck — not a separate inbox, just additional context. The user can tap to bump something up, snooze it, or leave it where the AI put it.

### Moment 3: Triage (daily + midday + end of day)

Morning triage includes all tasks created since the last triage. The daily brief calls them out:

> "3 tasks added yesterday — here's where I placed them:
> - 'Write auth docs' → near your other auth tasks
> - 'Call accountant' → mid-priority, no deadline
> - 'Research competitor pricing' → lower working set, flagged for your review"

The user confirms or adjusts. This is where precise sorting happens. Multiple triage moments (morning, midday replan, end of day) create more chances for recently added tasks to get properly placed.

---

## Brain Dump Handling

After a brain dump (multiple captures at once), the batch pass processes all items together in a single LLM call. It:

1. Ranks the new items relative to each other
2. Uses the reference comparison (heuristic 2) to place them relative to existing tasks
3. Groups related items (similarity clustering)
4. Catches duplicates

The post-dump summary shows what was created:

> "From your dump: 3 Bounce tasks (placed in your top 15), 1 personal errand (mid working set), 1 flagged for your review."
> [Looks right] [Review each]

Ten seconds. The user confirms or adjusts while the context is fresh.

---

## The Boomerang Flow

When a task surfaces and the user decides "not now, but later":

1. User sees the task (in deck, triage, or stream)
2. User snoozes: "remind me in a month" / "not now" / picks a date
3. `resurface_after` is set on the task
4. Task drops below the working set — it won't surface in the deck or triage until the date arrives
5. When the date hits, the task re-enters the working set and surfaces again

The critical point: **the human made the call to defer.** The AI surfaced it, the user saw it, the user chose to push it out. This is the human touch point that earns the right to move something out of the working set.

Example: "Pick out flights for vacation" → captured → placed in working set → surfaces in next triage → user says "not until next month" → boomeranged → comes back in a month.

---

## The Learning Loop

Every time the user corrects the AI's placement — bumping something up, pushing something down, snoozing — the AI logs it:

- `ai_context` on the task: "User bumped this to top — initial placement was too low"
- `agent_activity`: records the correction
- Over time, `temporal_memory` captures patterns: "User consistently bumps financial tasks higher"
- `memory-update` workflow synthesizes into USER.md: "Financial tasks should be placed higher than default"

Initial placement gets better over time as the AI learns the user's actual priorities vs. what the heuristics predict.

---

## What This Doesn't Need

- **No `triaged_at` field on tasks.** The stream's `promoted_at` + the session timestamps provide the cutoff for "what's new since last triage."
- **No `last_triage_at` field on user_state.** Derived from the most recent session record.
- **No explicit "working set" boundary in the schema.** The working set is a concept the AI uses during triage — the top ~30-50 tasks by sort_key. It's not a stored value.
- **No user-facing priority input.** The user's natural language IS the signal. Urgency, intent, and importance come from the capture text, `user_context`, goals, and area context. The AI reads all of it.

---

## Summary

| Stage | What happens | Who decides |
|-------|-------------|-------------|
| Capture | Raw text → stream (pending) | User captures, AI stores |
| Urgency check | Urgent? → immediate promotion + top of sort | AI decides |
| Batch/sweep | Non-urgent items promoted to tasks | AI promotes, user can correct |
| Initial placement | Task placed in working set using heuristics | AI places |
| Stream UI | User sees what was captured and where it went | User acknowledges |
| Deck | Recently added tasks surface alongside recommendations | AI surfaces, user reacts |
| Triage | Full working set re-sort, recently added called out | AI proposes, user confirms |
| Defer | User snoozes → boomerang, task leaves working set | User decides |
| Learning | Corrections feed back into AI's placement model | System learns |
