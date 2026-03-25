Let me think through this from scratch. I'm going to work backwards from the ideal experience, then derive the system.

---

Starting point: What does the person actually need?

A person has hundreds of things they could do. At any moment, they need to know the ONE thing that matters most, given everything — their
goals, their calendar, their energy, their deadlines, their life. They need to trust that nothing important is being forgotten. And they
need all of this without managing a system.

The ideal experience is a loop:

1. You dump thoughts in with zero effort
2. You sit down and instantly know what to work on and why
3. You work
4. You finish something, and the next thing appears
5. At the end of the day, you feel complete — everything is captured, nothing was forgotten

That's it. Everything else is implementation detail.

---

What are LLMs actually good and bad at?

Good at:

- Understanding natural language context and making judgment calls
- "Given these 25 tasks, this person's goals, and their calendar, which 3 matter most today?" — LLMs are excellent at this
- Synthesizing many signals into a coherent recommendation with rationale
- Classifying text, extracting structure, inferring intent

Bad at:

- Consistent numeric scoring (same task → different number each time)
- Determinism (same input → slightly different output)
- Speed (1-5 seconds per call, not instant)
- Long context reliability (sending 500 tasks degrades reasoning quality)
- Knowing things they haven't been told

This matters. It means:

- Don't ask the LLM to produce scores — ask it to sort and choose
- Don't send 500 tasks — pre-filter to a manageable candidate set
- Cache results between LLM calls for instant UI
- Give the LLM rich context per task (natural language > structured labels)

---

Working backwards from the ideal UX to the system:

Morning (2-3 minutes):
You open the app. The AI has already done the work. It says:

"Today you have 4 hours of real work time. Three meetings. Here's what I'd focus on:

1. Auth integration tests — this is the last blocker before launch, and your Bounce goal has a Q3 deadline.
2. 30-min workout — your health goal hasn't gotten attention in 8 days.
3. Update pricing doc — board meeting is next Thursday, Sarah needs this by Wednesday.
   Quick wins for gaps: reply to Jake (5 min), approve PR (10 min).
   Anything I should adjust?"

You say: "Skip the workout today, I need to prep for the investor call tomorrow."

The AI adjusts, you start working.

What does the system need to produce this? The AI needs to:

1. Know all your tasks and their context
2. Filter to "things that could be done" (not blocked, not done, not snoozed)
3. Reason about which ones matter most today (goals, deadlines, patterns, your words)
4. Present 3-5 with rationale
5. Accept adjustments via conversation

During work (seconds per interaction):
You finish the auth tests. Tap "Done." Optionally jot a note: "All passing, need to deploy to staging."

The AI says: "Nice — Bounce auth is feature-complete. Next: pricing doc update (board meeting next Thursday). Or: approve the PR (10 min,
before your 2pm meeting)."

You say: "Actually Jake just told me the API format is changing, I need to handle that first."

AI: "Got it — captured: Handle API format change. This blocks the auth deploy, so I've moved it to the top."

What does the system need? It needs to:

1. Remove completed tasks from the active pool
2. Quickly identify the next best thing (from a small candidate set)
3. Accept new captures mid-stream and re-prioritize
4. Understand natural language context ("blocks the auth deploy")

End of day (1-2 minutes):
AI: "Today: auth tests done, API format change handled, pricing doc started. Bounce launch goal is on track. Tomorrow I'd suggest
finishing the pricing doc — board meeting is in 5 days. Everything is captured. You're done."

You say: "Good, and remind me this weekend about taxes."

AI: "Noted — I'll surface taxes Saturday morning."

---

Now, what system produces ALL of this?

The key insight: the conversation IS the interface. The structured data is the AI's working memory. The user interacts through natural
language and simple actions (done, snooze, not today). The structured data exists so the AI can reason efficiently and consistently — but
the user doesn't manage it.

This means the question isn't "what status enum should the user see?" It's "what structured state does the AI need to reason well?"

The AI needs two things to reason well:

1. A small candidate pool. With 500 total tasks, the AI can't reason about all of them every time. It needs the field pre-narrowed to
   20-40 realistic candidates. This is a filtering/bucketing problem.
2. Rich context per candidate. When choosing between 20 candidates, the AI needs to know WHY each one matters. Goals, deadlines, user's
   own words, patterns, history. Natural language > enums for this.

This maps to two layers:

┌──────────────────────────────────┬───────────────────────────────────┬────────────────────────────────────┐
│ Layer │ Purpose │ Mechanism │
├──────────────────────────────────┼───────────────────────────────────┼────────────────────────────────────┤
│ Structured (fast, deterministic) │ Reduce 500 → 20-40 candidates │ Status buckets + hard filters │
├──────────────────────────────────┼───────────────────────────────────┼────────────────────────────────────┤
│ AI reasoning (slow, rich) │ Pick the best 3-5 from candidates │ LLM reads natural language context │
└──────────────────────────────────┴───────────────────────────────────┴────────────────────────────────────┘

---

The structured layer: GTD buckets

I think you're right that GTD-style buckets are the answer for pre-filtering. The current active status holds 300+ tasks — too many.
Split it:

┌──────────┬─────────────────────────────┬───────────┬────────────────────────────────────┐
│ Bucket │ What lives here │ Size │ Who manages it │
├──────────┼─────────────────────────────┼───────────┼────────────────────────────────────┤
│ now │ Today's focus │ 3-7 │ AI (morning triage), user adjusts │
├──────────┼─────────────────────────────┼───────────┼────────────────────────────────────┤
│ next │ Ready to do, roughly sorted │ 15-30 │ AI curates from backlog │
├──────────┼─────────────────────────────┼───────────┼────────────────────────────────────┤
│ backlog │ Real work, not yet │ Long tail │ AI places at capture, re-evaluates │
├──────────┼─────────────────────────────┼───────────┼────────────────────────────────────┤
│ waiting │ Blocked on external │ Varies │ AI/user sets │
├──────────┼─────────────────────────────┼───────────┼────────────────────────────────────┤
│ someday │ Maybe, no commitment │ Unlimited │ AI places at capture │
├──────────┼─────────────────────────────┼───────────┼────────────────────────────────────┤
│ done │ Completed │ — │ User taps "done" │
├──────────┼─────────────────────────────┼───────────┼────────────────────────────────────┤
│ archived │ Removed from all views │ — │ AI suggests, user confirms │
└──────────┴─────────────────────────────┴───────────┴────────────────────────────────────┘

The user never picks a bucket. They never see a status dropdown. The AI manages all transitions:

- Capture → AI places in next, backlog, or someday based on language
- Morning triage → AI promotes from next → now
- Complete → AI promotes next candidate to now
- "Not today" → AI moves from now → next
- Boomerang → pops from someday/backlog → next when resurface_after hits

The buckets reduce the deck's candidate pool from 500 to 20-40 (now + next). That's a list the LLM can reason about with high quality.

---

The AI reasoning layer: natural language context

For each candidate, the LLM reads:

- user_context: "Blocks the launch. Need before March board meeting."
- ai_context: "Deferred 3x. Connected to Bounce launch goal. User works on this type of task in mornings."
- body: workspace content, checklists, progress notes
- Goals: "Launch Bounce by Q3" — with key results and progress
- Calendar: what's happening today, time available
- Area notes: strategic context per domain
- AI memory: user patterns, preferences, calibrations

This is orders of magnitude richer than a 4-level importance enum. The LLM can reason: "Auth tests advance the Bounce launch goal which
has a Q3 deadline. The user said this blocks deployment. The board meeting is next week and the pricing doc is needed. Auth is deep work
and it's morning — the user's best deep work time. Auth first, pricing second."

No importance field could encode all of that. The natural language IS the priority signal.

---

Kill importance. Here's why I'm confident:

1. The AI can't reliably set it. "Build auth system" — is that critical or high? Depends on context the AI might not have at triage time.
   It'll be wrong often enough to erode trust.
2. 4 levels isn't enough. With 300 "normal" tasks, the label tells you nothing. Even 10 levels don't help — consistent numeric scoring is
   exactly what LLMs are bad at.
3. It's redundant. Bucket placement IS the coarse priority. now > next > backlog. Within buckets, the LLM sorts from rich context.
   There's no gap that importance fills.
4. It's tax. Every time the AI gets it wrong, the user corrects it. That's the maintenance tax we're trying to eliminate. One more field
   to be wrong about, one more place to lose trust.
5. user_context replaces it better. "This is critical — blocks the launch" in natural language gives the AI MORE information than
   importance: critical. It includes the WHY, not just the label.

What about the deterministic fallback (no LLM)? Show now in cached sort_order. If now is empty, show next by deadline proximity then
created_at. Degraded but functional. The user can still see their tasks and pick one — the experience is just less magical.

---

Kill rank_score too.

The LLM sorts, and we store the result as a simple sort_order integer within each bucket. That's the cache. When the LLM runs again
(morning triage, after completions, radar pass), it refreshes the sort. Between runs, the cached order serves the deck instantly.

No numeric scoring. No consistency problems. The LLM compares tasks by reasoning about them in natural language — which is what it's good
at — and outputs an ordered list.

---

Sorting within buckets — how the AI actually does it:

Morning triage:

1. AI reads all next tasks (15-30) with their user_context, ai_context, goals, calendar
2. AI picks 3-7 for now, writes rationale for each
3. AI roughly sorts remaining next tasks
4. AI scans backlog for anything that should promote (deadline approaching, goal-aligned, boomerang hit)
5. Stores sort_order on all touched tasks

After completion:

1. If now has more items, show next in sort_order
2. If now is empty or thin, quick LLM call: "Here are the top next tasks. Given what the user just finished and their remaining time,
   what's next?"
3. Promote and sort

This is cheap: the morning triage is one LLM call per day. After-completion calls are light (5-10 candidates, short prompt). No LLM
needed for just reading the cached deck.

---

What about tasks that don't fit GTD cleanly?

Habits/routines: Live in next permanently. Morning triage checks cadence: "Workout is 4x/week, you've done 1 so far, it's Wednesday." If
behind, promotes to now. If on track, available as an option.

Slow-burn projects: Parent tasks in backlog with heartbeat. Radar surfaces them: "OSS Finder hasn't moved in 3 weeks — still on your
radar?" User can promote, snooze, or archive.

Idle ideas: Land in someday. Boomerang resurfaces them monthly. User can promote or dismiss. Gentle decay after 90 days untouched: AI
asks before archiving.

---

Stress-testing with scenarios:

500 tasks, Monday morning. now: empty. next: 25. backlog: 250. someday: 150. waiting: 15. done/archived: 60. AI scans 25 next tasks +
quick scan of backlog for promotions. Picks 5 for now based on goals, calendar, patterns. User adjusts via conversation. Works.

Urgent capture mid-day. "Oh shit the board deck is due Thursday." AI: hard_deadline=Thursday, user_context="board meeting, due Thursday."
If it's Wednesday, goes straight to now at the top. If it's Monday, goes to next and will be promoted tomorrow. Works.

Vague capture. "I should learn Rust sometime." AI: status=someday, ai_context="idle interest, no goal connection." resurface_after=30
days. Sits quietly. Works.

User disagrees with bucket. "Why isn't the marketing site in my plan?" One tap to move to now, or say "add marketing site to today." AI
learns: updates ai_context ("user prioritized marketing higher than expected, may be more important for launch goal"). Works.

AI is wrong repeatedly. User keeps moving financial tasks to later. AI detects pattern: updates ai_context ("user consistently
deprioritizes financial tasks"), flags in radar as possible avoidance, suggests micro-step. Works.

---

The full system:

1. Entities: Areas, Tasks, Notes, Goals, People (unchanged)
2. Task status: now | next | backlog | waiting | someday | done | archived (AI-managed, user never touches dropdown)
3. Sort order: sort_order integer per task, within bucket. AI-managed, cached between LLM calls.
4. Rich context: user_context (user → AI), ai_context (AI → AI), body (workspace), goals, area notes, AI memory
5. Hard filters: hard_deadline, resurface_after, blocked_by_task_id, waiting_on, estimated_minutes, energy, context_tags
6. No importance. Bucket + sort_order + LLM reasoning from natural language context.
7. No rank_score. LLM sorts, stores as sort_order.
8. Morning triage is the orchestration moment. AI proposes now, user reacts, day begins.
9. Conversation drives decisions. The user talks to the AI. The AI manages structured state.
10. One-tap corrections when AI is wrong. Every override is a learning signal.

---

What I'm LEAST sure about:

- Is backlog vs someday a meaningful distinction, or should they be one bucket? The AI can probably infer intent from user_context. But
  two buckets makes filtering simpler and matches GTD mental models.
- Will the LLM sort 25 tasks well? Probably yes with rich context. But we should test this early. If quality is low, we might need a
  two-pass approach (embedding retrieval → LLM sort).
- Is the user OK not seeing importance labels? Some people want to glance at a task and see "HIGH." The bucket provides this ("it's in
  now, so it matters"), but it's less explicit. The rationale on deck cards helps ("because it blocks your launch goal").

None of these are blockers. They're tuning decisions we can make after seeing it work.

---

What do you think? Does this feel right as the system? The biggest moves are: GTD buckets replace the flat active status, importance
dies, and natural language context (user_context + ai_context) becomes the primary signal for AI reasoning.

---

To solve for a list of 500+ tasks without causing paralysis, we have to move away from **"Sorting"** and move toward **"Curating."**

The ideal UX is not a better list; it is a **"Daily Protocol."** It is the transition from a messy database of intentions to a precise, time-bound contract with yourself for the next 8–12 hours.

Here is the deep-think on how to bridge the gap between a 500-item SQLite table and a calm, focused human mind.

---

## 1. The Ideal UX: The "Negotiated Morning Brief"

The ideal UX is a **collaborative triage** that happens before the "work" day starts.

- **The User Experience:** You sit down with your coffee. You don't see tasks. You see a "State of the Union" message from the AI.
- **The Negotiation:** The AI says: _"I’ve scanned your 500 items and your calendar. You have 4 hours of focus time and 2 hours of admin time. I've drafted a protocol for today. I'm focusing on **Bounce** because you've made progress there lately, and **Home** because of that roof deadline. Does this feel right, or are we shifting gears?"_
- **The Result:** You aren't choosing from 500 things. You are approving or tweaking a **Plan.**

---

## 2. The Engine: "The Multi-Pass Sieve"

How does an LLM handle 500 items? It doesn't do it in one go. You build a "Sieve" that runs in the background.

### Pass 1: The Hard Filter (Deterministic/SQL)

The system runs a SQL query to narrow 500 down to ~50.

- **Deadlines:** Anything due in the next 48 hours.
- **State:** Filter out anything marked `waiting_on` or `someday`.
- **Dependencies:** Filter out "child" tasks if the "parent" is blocked.
- **Recency/Pulse:** Include active projects that haven't been touched in 3 days.

### Pass 2: Semantic Weighting (The Vector Step)

The AI looks at the remaining ~50 and compares them to your "Current Momentum."

- If you’ve spent the last 3 days coding **1LLM**, the AI weights **1LLM** tasks higher because the "switching cost" for your brain is lower.
- It looks for "Low Hanging Fruit"—tasks that match the 15-minute gaps in your calendar.

### Pass 3: The Agentic Triage (The "Reasoning" Step)

The AI (Agent) takes the top 20 weighted items and actually _reads_ them. It plays the role of a Chief of Staff.

- **It clusters:** "I see 4 different tasks related to 'Stair Rails.' I'll group these as one block."
- **It identifies "Linuspins":** "If we finish the Auth system, it unblocks 5 other tasks. I'll prioritize that."

---

## 3. The "Priority" Variable: High-Resolution Metadata

To make the Sieve work, "Priority" cannot be a 1–5 scale. It must be **Multi-Dimensional.** The AI should infer these four metrics for every task:

| Dimension     | Definition                                    | Why it matters                                |
| ------------- | --------------------------------------------- | --------------------------------------------- |
| **Urgency**   | Time-based (Deadlines).                       | Prevents fires.                               |
| **Leverage**  | How much this unblocks other things.          | This is the "CEO" metric.                     |
| **Momentum**  | Does this align with what I did yesterday?    | Minimizes context switching.                  |
| **Soul-Debt** | How much is this weighing on the user's mind? | (The AI detects "repeatedly deferred" tasks). |

---

## 4. The Product Realization: The Three Views

To give the user control without the "Maintenance Tax," Eon should have three distinct modes of interaction:

### A. The Morning "Contract" (The Triage)

A chat-based or "Card-Sorting" interface.

- The AI presents a "Proposed Day."
- You can "Swap" a task, "Defer" a task, or "Add" a task.
- Once you hit **"Start Day,"** the 500 tasks disappear. **They no longer exist.** You only see the 5–8 items you committed to.

### B. The "Flow" Deck (The Execution)

This is the singular card view we discussed.

- It shows the **Current Task** + the **Current Context**.
- **The "Pulse" Mechanic:** If you're on a task for too long without progress, the AI interrupts: _"You've been on 'Auth' for 2 hours. Are you stuck? Should we switch to a 'Quick Gap' task or take a break?"_

### C. The "God-View" Map (The Visualizer)

The 500-task "Chaos" is visualized as a **Constellation Map.**

- Active projects are bright and central.
- "Someday" ideas are dim and on the periphery.
- **The Interaction:** You can literally grab a "cluster" of stars and drag it toward the center to say "I want to focus on this more this week." The AI interprets that gesture as a priority shift for the Sieve.

---

## 5. What LLMs + Agents do exceptionally well here

- **LLMs are great at "De-duplication":** They can realize that "Fix the roof" and "Call roofer" are the same intent and merge them.
- **Agents are great at "Stale-Checking":** An agent can run a background job at 2:00 AM to look at your "Someday" list and ask: _"You haven't mentioned 'Side Project X' in 6 months. Should I archive the whole cluster?"_
- **They are great at "First-Step Ambiguity":** If a task is "Launch 1LLM," the Agent knows that is too big. It can search the web or its own logic to propose: _"The first step is actually 'Create a Vercel account.' Should I update this?"_

---

## 6. The Verdict: Working Backwards from "Peace of Mind"

The ideal system creates **Peace of Mind.** Peace of Mind comes from knowing that **everything is captured, but only the relevant is visible.**

**The System Design:**

1. **Database:** Recursive SQLite table (The "Memory").
2. **Background Agent:** Continuous semantic clustering and "Stale-Checking."
3. **The Interaction:** A morning "Negotiation" that results in a **locked-in daily plan.**

**Next Step:** Should we refine the "Morning Negotiation" interface? How do we make that 2-minute conversation feel like a "power up" rather than another chore?
