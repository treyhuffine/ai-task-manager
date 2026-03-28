# Capture UX — The Stream

> See also: PRD §6.3 (Capture Experience — The Stream) and §8.1 (The Stream and Background Processing)

## The Insight

Not every externalized thought needs to become an entity. When you jot down "check SEO results" and do it 3 minutes later, creating a task with an area, energy level, and effort classification was wasted work. Many externalizations are momentary holds — your brain needs to let go of something briefly, not track it forever.

More importantly: trying to classify every input at capture time requires the AI to read the user's mind about intent — and it can't. "Check SEO results" could be a task or a momentary hold. The words are identical. The difference is entirely in the user's head.

The stream is the capture primitive. Tasks, notes, and decisions are **promotions** from the stream, not the default output. And the AI's job at capture time is not to classify intent — it's to detect urgency.

## The Principle

**One input. Every time. The AI detects urgency, not intent.**

The user never picks a mode, never chooses a destination, never structures their input. They externalize a thought — text or voice — and it lands in the stream. The AI asks one question: **"Can this wait?"** If yes, it marinates. If no (time-sensitive, deadline, reminder needed), it's processed immediately.

Everything non-urgent benefits from patience:
- The user might handle it themselves in 2 minutes (zero cruft — no entity was ever created)
- More related thoughts might come in (better context for threading)
- The batch pass classifies with full context (higher accuracy than instant one-by-one)
- Truly fleeting thoughts self-resolve without burdening the system

## Three Capture Patterns (Invisible to the User)

The user doesn't choose between these. They all go through the same input. The AI handles them differently based on urgency signals, not user intent.

### 1. Flash Capture

"Call dentist tomorrow." "Pick up kids at 3pm." "Registration closes Friday."

These have urgency signals — time-specific language, deadlines. The AI detects the signal and processes immediately: creates the task, sets the reminder or deadline, confirms via toast. The user trusts it's handled.

Contrast: "Buy oat milk." "Check SEO results." "Email Jake about the demo." — no urgency signal. These marinate. The batch pass picks them up a few minutes later, or the user handles them and dismisses. Either way, no rush, no mind-reading needed.

### 2. Evolving Notes

You're on a walk. A thought about onboarding surfaces. You capture it. Five minutes later, a different angle on the same idea. Ten minutes later, a quick task. Twenty minutes later, back to onboarding with a new connection your subconscious surfaced.

The captures are interleaved and non-linear, but some belong together. The user shouldn't have to manually connect them — they just keep capturing.

Days later, the same topic resurfaces. The user captures another fragment. The AI reconnects it to the earlier note.

**AI behavior:** During the batch pass, the AI sees all recent stream items together and notices: "three of these are about onboarding UX." It creates a new note and groups the fragments. Future fragments that relate get appended to the same note. The LLM reasons about relationships from raw text — no embeddings needed.

### 3. Brain Dump

Sit down, pour it all out at once. Multiple thoughts, mixed types, stream of consciousness. Could be after a meeting, during a planning session, or just clearing mental RAM.

"I need to call insurance about the claim. Also the onboarding wizard feels clunky — maybe progressive disclosure instead. Groceries. Oh and that article about attention routing connects to what Sarah said about focus modes."

**AI behavior:** Brain dump mode (Cmd+Shift+K) provides a larger text area. No processing until you're done. On close, the AI processes as a batch — splitting into discrete thoughts, checking for urgency, classifying with full context. Post-processing summary: "From your dump: 3 tasks, 2 note fragments (1 appended to 'Onboarding UX'), 1 still in stream."

## Urgency vs. Intent

This is the core reframe. Previous designs tried to classify every capture as task/note/decision at capture time. That requires intent detection — reading the user's mind. The new model:

| | Urgency Detection | Intent Classification |
|---|---|---|
| **Question** | "Can this wait?" | "What is this?" |
| **Signal** | Textual (times, dates, deadlines) | Contextual (user's plans, habits, patterns) |
| **Reliability** | High — clear signals in the words | Low — same words, different intent |
| **Error cost** | Low — processing a non-urgent item is slightly wasteful | High — misrouting erodes trust |
| **When** | Immediately on capture | Batch pass, with full context |

The AI asks the easy question now, and the hard question later (with more context, fewer items, higher accuracy).

## The Three Exits

Every stream item exits through exactly one door:

1. **Promoted** — AI created an entity (task, note, decision, or appended to thread)
2. **Dismissed** — User swiped it away, or it was transient and they handled it
3. **Elevated** — AI surfaced it in the daily brief for user's call

If the user ignores an elevated item, it decays after ~1 week. That's a conscious non-action, not a system failure.

## The Stream as Working Memory

The stream naturally serves as working memory without being a separate concept:

- Fire off 5 things before a meeting → they're all in the stream
- 2 minutes later, glance at the stream: one's already done (dismiss), one the AI processed as urgent (leave it), three still marinating (fine — batch will handle them, or dismiss the ones you already dealt with)
- No second inbox, no scratchpad, no badge count
- The stream empties itself over time: processed items show annotations and fade, dismissed items disappear, daily sweep catches the rest

## Note Accumulation

Any note can be appended to over time — there is no separate "thread" flag or entity:

- AI detects related stream items during batch processing → creates a new note grouping them
- New fragments that relate get appended with timestamps to the existing note
- Note title evolves as the AI understands the topic
- At critical mass, AI offers synthesis: "You've had 5 thoughts about onboarding UX. Want me to consolidate into a structured document?"
- If grouping is wrong: one-tap "Separate" or "Move to [other note]"
- No embeddings for matching — the LLM reads all recent stream items + active note summaries in raw text and reasons about relationships directly

## Fleeting Notes and Decay

Not every thought deserves permanent residence. "Maybe I should learn woodworking" shouldn't generate guilt for 6 months.

- Stream items with low intent may never get promoted — they decay after the daily sweep cycle
- If promoted as a note, the AI can flag it as fleeting
- Fleeting notes surface in Radar at ~2 weeks: "Keep, convert to task, or dismiss?"
- Auto-archived at 3 weeks if untouched
- If the user returns to the topic (new stream item threads in), the fleeting flag is removed

## What This Doesn't Require

- **No new entity types for capture.** Stream is a table, not an entity. Threads are just notes. Tasks are tasks.
- **No embeddings for threading.** The LLM reads all recent context in raw text. One person's captures + active notes fit easily in context.
- **No user-facing mode selection.** Same input for flash, thread, and dump. Brain dump mode is just a larger text area.
- **No intent detection at capture time.** The AI only detects urgency (easy, reliable). Classification happens in the batch pass with full context.
- **No scratchpad.** The stream IS the working memory. No second inbox.
- **No badge counts or inbox clearing.** The stream empties itself. Ignoring it is fine.

## The User's Mental Model

The user doesn't need to understand urgency detection, batch passes, or processing mechanics. Their mental model is:

1. I capture a thought
2. I can see what I recently captured
3. Important things show up in my deck when I need them
4. The rest fades away

That's it. Everything else is invisible background processing.

## The Feeling

- **Capturing:** "I said it. It's in the stream. I can let go."
- **Rapid-fire:** "I got 5 things out in 30 seconds. They're held. I'll look in a minute if I want."
- **Coming back:** "Let me glance at what I dumped. That one's done, dismiss. That one's already a task, cool. Those I don't care about, dismiss."
- **Threading:** "I had another thought about onboarding. The system noticed I've been thinking about this."
- **After a brain dump:** "I poured it out. The system sorted it. I can review or not."
- **Daily brief:** "2 thoughts from yesterday need my call. One's a task, one I don't care about. Done."
- **Weeks later:** "I forgot I was thinking about this. The system reminded me and asked if I still care."

The user's only job is to externalize. Everything else is routing.
