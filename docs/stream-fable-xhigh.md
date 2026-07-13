# Stream: From Brain Dump to Trusted Triage

Deep-dive analysis and implementation direction. Written 2026-07-10 from independent research: a full code audit of the current stream implementation plus a market sweep of every notable capture-first and auto-organizing product from 2022 through mid-2026. Deliberately written without reading the existing stream reconciliation PRD so it can serve as an independent check against it.

## 1. Verdict

The stream is the right idea. It is arguably the front door of the entire product, not a side feature. But the naive framing ("agent promotes brain dumps to tasks or notes, or combines them") describes the part that is now a commodity, and if implemented naively it describes the exact product that has already failed multiple times in the market.

The value is not in the transformation (ramble in, structure out). Google Keep ships that at the OS level in summer 2026, Todoist shipped it as Ramble in January 2026, and the App Store has interchangeable clones literally named "Brain Dump AI." The value lives in a design contract the market has painfully converged on:

1. The stream is append-only and permanent. Triage derives artifacts, it never consumes the source.
2. Provenance is bidirectional and always visible. The user never wonders where a thought went.
3. There is a review moment (the digest). Trust is built there, not at capture time.
4. Autonomy is graduated per disposition type and earned via measured acceptance, never default.
5. The agent has explicit permission to do nothing. Most thoughts should not become tasks.

Get that contract right and the stream is the keystone: the top of the Capture, Triage, Route, Execute, Review, Learn loop, and the source of the acceptance telemetry that is the product's stated moat. Get it wrong and it is Mem 1.0, which raised $29M on this exact pitch and had to relaunch as a different product.

## 2. What the stream is, conceptually

Zoomed all the way out: the stream is an append-only log of raw human intent, and the trust boundary between the user's mind and the system.

Traditional inboxes conflate two roles that must be separated:

- A queue to drain (the inbox role): items awaiting a decision. Transient by nature.
- A permanent record (the journal role): the temporal trace of what the user was thinking. Searchable forever, embedded, part of the corpus.

The resolution: a stream item is never deleted or moved. It receives a disposition. The task or note it spawned links back to it. The item stays in the log, in vector search, in FTS, in the file mirror. The current codebase already leans this way instinctively (there is no deleteStream anywhere, dismiss is a soft status change, dismissedBy records who did it). Keep that as a hard invariant.

### The five dispositions

The framing "promote or combine" gives the agent two outcomes. It needs five, and the fourth is the most important:

1. **Promote**: item becomes a new task or note.
2. **Merge / combine**: item is appended into an existing task or note, or several stream items are fused into one new artifact.
3. **Dismiss**: item is noise. Soft status change, recorded, reversible.
4. **Journal (leave alone)**: item is a musing, venting, an observation. It stays in the stream as a record, requiring nothing. This must be a recorded decision, not an absence of one, so the queue still drains.
5. **Incubate (later phase)**: item is not actionable now but should resurface at a time or when related context appears. GTD's someday-maybe, made mechanical.

### The central product risk: over-promotion

The biggest risk in this feature is not mis-filing, it is an agent biased toward action converting every stray thought into a task. An inflated task list is worse than a full inbox. An inbox pile is at least honest about being unprocessed. A noise-filled task list corrodes trust in the one surface that must stay trustworthy, and it recreates the exact system rot the product exists to eliminate. "Left as journal" is a success outcome and should be common.

## 3. What the market evidence says

Condensed from the July 2026 research sweep. Full sources in the appendix.

**The problem is real and it is triage, not capture.** The consistent reason people abandon productivity systems is manual organization collapsing under its own weight (the "digital gardener" trap, the GTD guilt pile). Drafts proved for a decade that "capture first, act later" retains devoted users with zero AI. The unmet half is "act later."

**The naive version has already failed, repeatedly.** Mem raised $29M from the OpenAI Startup Fund on "self-organizing notes," went silent for two years, and relaunched in late 2025 having removed auto-ingestion (their own words: too much "noise"), removed the inbox entirely, and repositioned as chat over manually organized notes. Napkin.one (capture, AI clusters and resurfaces) shut down its desktop app in June 2026. mymind survives on full-auto organization only because it is bootstrapped, deliberately narrow (visual bookmarks, low stakes), and even its fans report the trust break: "search sometimes misses obvious things."

**Trust in auto-organization is decided at retrieval time, not filing time.** Every retrieval failure retroactively poisons all prior capture. This is why provenance and search reliability are core features of the stream, not polish.

**The winning autonomy contract is known.** Fyxer went zero to $30M ARR in about a year on email triage with a precise recipe: automatically sort into a tiny number of coarse self-evident buckets, automatically prepare the action (a drafted reply), let the human fire it. Superhuman auto-labels but makes auto-archive opt-in per label. Motion auto-acts on calendars and has a documented two-week second-guessing period where many users churn. Tana ($25M raised, 160K waitlist) lets humans own the ontology while AI fills it. Pattern: auto-classify, auto-prepare, human confirms or trivially reverses. Users delegate labor, not ontology, and not judgment.

**AI is reliable at extraction, unreliable at judgment.** Pulling dates, action items, entities, and area assignment out of a ramble works. Asking AI to score priority, effort, or importance collapses to the mean (Notion's effort-estimate autofill famously scored nearly everything 3 out of 5, making the field useless). Extract automatically, propose judgments as human-correctable defaults.

**The transformation layer is commoditizing, the moat is downstream.** AudioPen makes roughly $15K a month as a lifestyle business because the braindump has no destination workflow. Granola is on a unicorn trajectory because meeting capture feeds a workflow. This product's stream feeds an execution loop where agents actually do the work, and triage decisions generate acceptance telemetry that compounds per user. That is the defensible part. The stream matters strategically as the funnel's mouth, not as a standalone notes feature.

**Power users are actively hostile to black-box filing.** The most engaged note-taking discussion of 2025 on HN was Karpathy's append-and-review single-note method, which is explicitly anti-organization. Nobody in that thread asked for AI filing. The philosophy "remove structure that exists only for human organization" is correct, but it survives contact with reality only when paired with the trust contract. People genuinely want to stop organizing. They refuse to stop knowing where things went.

## 4. The design contract

### 4.1 Capture stays decision-free

Already correct in the current implementation: text, voice, image, webhook, the capture API for iOS Shortcuts. Zero required fields, zero structure at capture time. This is GTD's capture/clarify separation and it is non-negotiable. Any design that forces a decision at capture time kills capture.

### 4.2 Triage runs in batches, not per item

The combine behavior requires seeing a window of items together. Per-item instant triage cannot notice that five captures over two hours are the same project taking shape. Batching also produces a natural unit of review (the digest) and a natural idempotency key (the pass).

Sweep triggers, in priority order:

- **Rolling debounce**: a sweep fires N minutes (default 20) after the last capture. Each new capture pushes the timer. Implemented as a trigger row with nextRunAt updated on capture, so it survives restarts. Not an in-process timer.
- **Scheduled**: a morning pass before deck generation, so the deck can incorporate fresh triage output. Dovetails with the proactive-deck work.
- **Threshold**: pending count at or above N (default 10) fires early even mid-debounce.
- **On demand**: the user says "triage my stream" in chat, or taps Triage in the UI.

### 4.3 The autonomy ladder

Per disposition type, three levels:

- **Suggest**: agent attaches a proposal, user taps to accept. Nothing changes until they do.
- **Auto with digest**: agent acts, every sweep produces a digest, every line is one tap from undo.
- **Silent**: agent acts, digest available but not pushed. Earned per category, never default.

Starting positions:

| Disposition | Start level | Rationale |
|---|---|---|
| Journal (leave alone) | Auto with digest | A no-op with a record. Cheapest trust to build. |
| Promote to task/note | Suggest, graduate fast | Visible, reversible, but creates surface area. |
| Dismiss | Suggest | Wrongly discarding a thought is a trust killer. |
| Merge into existing | Suggest, graduate slowly | A wrong merge is the single most trust-destroying operation. |
| Combine many into one | Suggest, graduate last | Compound merge risk. |

Graduation rules (concrete, tunable):

- Suggest to auto-with-digest: at least 20 decisions of that disposition and at least 90% accepted without correction.
- Auto-with-digest to silent: at least 50 decisions and at least 97% accepted.
- Automatic demotion: trailing-20 acceptance below 80% drops one level.
- Graduation is offered, not taken: "I have been 96% accepted on task promotions over the last month. Want me to start doing those automatically?" The system asking for autonomy is itself a trust-building interaction, and it converts the autonomy setting from configuration into a relationship.

### 4.4 Extraction auto, judgment correctable

The agent extracts: what kind of thing this is, which area it belongs to, dates and times mentioned, entities, a clean title, a cleaned-up body (especially for voice transcripts). The agent proposes but never asserts: energy, effort, priority, placement. The triage UI already collects these as human overrides, which is exactly right. The agent's proposed values pre-fill, the human's tap corrects, the correction is logged as signal.

### 4.5 The digest is the review moment

The digest replaces GTD's weekly review, which is the linchpin habit and the first thing humans drop. Shape:

> Processed 12 items from this afternoon. 3 became tasks (2 in Product, 1 in Home). 2 merged into your migration note. 5 left as journal. 2 dismissed as noise. [each line: tap-through to entity, one-tap undo, re-route]

Surfacing: a deck card per pass (primary), plus notifier delivery (Telegram / web push) respecting the notification matrix. "Re-route" (accept the action but change the destination) is richer signal than undo and should be a first-class affordance, not buried.

A weekly meta-digest reports acceptance stats and proposes graduations.

### 4.6 Provenance is bidirectional and rendered everywhere

- Stream item shows where it went (already: promotedToType, promotedToId, promotedAt).
- Task and note show what they came from, in the UI and in the file mirror. The mirror already renders a Sources section for notes. Tasks must get the same.
- Undo is always possible from either side while the derived entity is unmodified, and via entity_versions revert after.

## 5. Current implementation audit (2026-07-10)

What exists and is sound:

- **Schema** (`src/lib/db/schema.ts:140-178`): stream table with rawText, source (capture/chat/webhook), media (text/voice/image), origin, external dedupe fields (externalSource, externalId, externalPayload with an index), status (pending/promoted/dismissed), dismissedBy, promotedToType/Id/At, attachments JSON.
- **Query layer** (`src/lib/db/queries.ts:576-681`): listStream, getStream, findStreamByExternalId, createStream, updateStream, dismissStream. Embedding upsert and mirror sync fire on create/update. No hard delete exists anywhere. Good.
- **Orchestrator actions** (`src/lib/orchestrator/registry.ts:304-437`): list_stream, get_stream_item, create_stream_item, promote_stream (single item to new task or note, guards status pending, throws conflict on re-promote), dismiss_stream (records dismissedBy agent).
- **Capture surface**: `/api/capture` handles text, voice (transcription), image (vision extraction). Pocket webhook dedupes via externalId. Quick-capture modal in the dashboard.
- **Manual triage UI** (`src/components/stream/`): stream list with promote/merge/dismiss per item, full triage sheet with area/energy/effort override pills, merge-into-existing pickers for tasks and notes.
- **Search**: stream is a first-class entity in sqlite-vec and FTS5, participates in hybrid search, backfill support exists.

The critical gap: **no automated triage exists at all.** Nothing (dispatch, deck, triggers, cron) ever calls the stream actions proactively. The agent-facing surface exists but no agent ever shows up. The feature as designed is a manual GTD inbox with agent-shaped plumbing.

Dormant scaffolding and inconsistencies found:

| Finding | Location | Action |
|---|---|---|
| promotionPass column defined, never read or written | schema.ts:171 | Wire as the sweep pass id (section 6.1) |
| tasks.streamItemId FK exists, never written by any promote path | schema.ts:195 | Populate going forward, backfill from stream.promotedToId |
| promote_stream does not set tasks.streamItemId | registry.ts:389-398 | Fix |
| Task file mirror renders no Sources section (notes do) | export/mirror/sync.ts:269-289 | Add, matching writeNote |
| Triage sheet collects placement override, never sends it | stream-triage.tsx | Wire into createTask or remove the pill |
| brain-dump-modal.tsx not mounted anywhere | components/dashboard/ | Delete (quick-capture supersedes it) |
| Agent cannot merge into existing entities (UI does it client-side, two-step, non-atomic) | registry.ts | New actions (section 6.2) |
| Agent cannot combine N items into one artifact | registry.ts | New actions (section 6.2) |
| No "leave alone" or proposal representation | schema + registry | Section 6.1, 6.2 |

## 6. Technical design

### 6.1 Data model

**Extend stream.status** (text enum is type-level only in Drizzle SQLite, so this is additive and migration-free): `pending | proposed | promoted | dismissed | reviewed | incubating`. `reviewed` is the journal disposition. `proposed` means a suggest-mode proposal is attached and awaiting the user. `incubating` is phase 3, with a resurfaceAt column added at that point (nullable, additive).

**Wire promotionPass**: every item touched by a sweep gets stamped with the pass id. Makes sweeps idempotent and the digest queryable.

**New table: triage_passes.** One row per sweep. `id, ...timestamps, trigger (debounce|schedule|threshold|manual), status (running|completed|failed), sessionId, summary`. Doubles as the single-flight lock: refuse to start a sweep while one is running (with a stale timeout).

**New table: triage_decisions.** The load-bearing table. One row per disposition decision, agent or human. This single table powers four needs at once: proposal storage (suggest mode), digest rendering, undo, and the acceptance telemetry that gates autonomy (the Learn phase made concrete).

```
id, ...timestamps
passId          -> triage_passes.id, null for user-initiated manual triage
streamItemIds   JSON string[], usually one, several for combine
disposition     promote_task | promote_note | merge_task | merge_note |
                combine_task | combine_note | dismiss | journal | incubate
targetType/Id   the entity created or merged into, null until executed
draft           JSON: proposed title, body, areaId, extracted dates,
                proposed (not asserted) energy/effort
confidence      real, agent's self-reported confidence
state           proposed | executed | accepted | undone | corrected
correctedDisposition  what the user changed it to, when state = corrected
actor           agent | user
```

Key move: **log manual UI triage into the same table with actor user.** The user's own routing history is ground-truth labeled data. It bootstraps the agent's few-shot context before the agent has ever acted, and it gives acceptance metrics a baseline.

**Provenance**: stream-side (promotedToType/Id) stays canonical, since it handles many-to-one combine naturally. tasks.streamItemId is populated for single-source promotes as a convenience FK and backfilled. Reverse lookups go through a query helper (getStreamSources(entityType, id)) shared by UI and mirror.

All schema changes are additive, per the established migration discipline (new columns nullable or defaulted, no reorders, drizzle-kit generate).

### 6.2 Orchestrator action vocabulary

Action names are public contract, so promote_stream and dismiss_stream keep their names and semantics. Additions (all mutating, all idempotent via status guards plus pass stamping, all through queries.ts, all throwing ActionError with stable codes):

- **merge_stream**: id or ids, target (task or note by id), semantics append (note body / task description or subtask). Atomic server-side, unlike today's two-step client merge. Records a triage_decision.
- **combine_stream**: ids[] plus to (task | note) plus draft fields. Creates one artifact from several items, stamps every item promoted with the same target.
- **mark_stream_reviewed**: id or ids, optional reason. The journal disposition as a recorded decision.
- **propose_stream_triage**: batch of proposals (the decision rows in state proposed, items flip to status proposed). Used when the autonomy level for a disposition is suggest.
- **undo_triage_decision**: decision id. Deletes or reverts the derived entity (entity_versions for merges), resets item status to pending, marks the decision undone. Transactional.
- **list_stream** gains an optional pass filter, and status filter accepts the new values.

The sweep agent receives only this action set plus read actions. It cannot delete anything because nothing can.

### 6.3 The sweep runner

Runs as a harness session (consistent with the orchestrator-on-harness direction) invoked by the trigger infrastructure. Inputs assembled for the prompt:

1. All pending items with attachments and transcripts, oldest first.
2. Per item: nearest neighbors via existing sqlite-vec embeddings, two candidate sets, (a) other pending items within the window (combine candidates, weighted by semantic similarity and temporal proximity) and (b) existing tasks and notes (merge targets). The agent judges retrieved candidates. It never free-associates merge targets from memory.
3. Compact context: area list, active task titles, recent notes.
4. The user's recent corrections from triage_decisions (state corrected or undone), as few-shot examples of this user's judgment.
5. The current autonomy config: which dispositions it may execute directly and which it must route through propose_stream_triage.

Prompt principles (the agent's constitution):

- Restraint bias. Journal is a success outcome. When in doubt between task and journal, choose journal.
- Extract, do not judge. Dates and areas from the text, never invented deadlines, never confident effort scores.
- Merge only when the target is unambiguous. Ambiguity means propose, or promote standalone and note the possible relation.
- Combine only within tight semantic and temporal proximity. Never combine across unrelated areas.
- Voice transcripts get cleaned (filler removed, structure recovered) but the original rawText is never rewritten. Cleaning happens in the derived artifact.

Concurrency and safety: single-flight via the pass row. Every mutation guarded on current status, so a retried or crashed-and-resumed sweep cannot double-promote (promote_stream already throws conflict on non-pending, extend the same guard to the new actions). A failed sweep leaves items pending, never half-disposed, because each decision executes atomically.

### 6.4 Digest and review surface

- A deck card per completed pass, grouped by disposition, each line with tap-through, undo, and re-route. This is the primary surface and lands inside the existing deck rather than adding a new destination.
- The triage sheet gains a proposals mode: when items are in status proposed, the sheet renders the agent's proposal pre-filled (disposition, target, draft, extracted fields) and accept is one tap. Today's manual controls become the correction affordance.
- Notifier: digest as a notification event type through the existing matrix, off by default until Phase 2.
- Weekly meta-digest: acceptance rates per disposition, graduation offers.

### 6.5 Telemetry and the graduation engine

Acceptance math is a pure query over triage_decisions: executed or proposed decisions resolving to accepted vs corrected vs undone, per disposition, trailing windows. The graduation engine is a small pure function (thresholds from section 4.3) evaluated at sweep end. It never flips autonomy itself. It emits a graduation offer into the digest, and the user's acceptance writes the config change. Demotion on trailing-window regression is automatic and announced in the digest ("I have been getting merges wrong, I will go back to suggesting them").

## 7. Build plan

### Phase 0: Plumbing and honesty (small, one PR)

- Populate tasks.streamItemId in promote_stream and the UI promote paths, backfill from stream.promotedToId.
- Task file mirror renders Sources like notes do.
- Wire or remove the placement override in stream-triage.tsx. Delete brain-dump-modal.tsx.
- Add triage_passes and triage_decisions tables (additive migration).
- Log all manual UI triage as triage_decisions with actor user. Telemetry baseline starts accumulating immediately, before any agent exists.

### Phase 1: On-demand sweep, suggest mode

- New actions: merge_stream, combine_stream, mark_stream_reviewed, propose_stream_triage, undo_triage_decision.
- Sweep runner as a harness session, manually invoked (Triage button runs the agent, chat "triage my stream" works).
- Triage sheet proposals mode with one-tap accept, correction logging.
- Pass digest rendered in the stream tab (deck card comes next phase).
- Exit criteria: agent proposals exist, acceptance rate is being measured, undo works end to end.

### Phase 2: Autonomous cadence

- Rolling-debounce and morning-before-deck sweep triggers through the triggers infrastructure, plus the pending-count threshold.
- Digest as a deck card, notifier delivery.
- Journal disposition runs at auto-with-digest from the start of this phase. Other dispositions graduate per the rules as their numbers arrive.
- Exit criteria: a user who captures all day and never opens the stream tab still ends the day with a drained queue and a digest they trust.

### Phase 3: Graduation, incubation, combine autonomy

- Graduation engine with consent offers and automatic demotion.
- Incubate disposition with resurfaceAt, resurfacing through the deck.
- Combine and merge eligible for auto-with-digest where earned.
- Weekly meta-digest.

## 8. Metrics

Primary:

- **Acceptance rate per disposition** (accepted / (accepted + corrected + undone)). The moat metric. Gates autonomy.
- **Time-to-clarity**: median time from capture to disposition. The number the whole feature exists to crush.
- **Pending age p95**: the guilt-pile indicator. If this grows, the sweep cadence or restraint calibration is wrong.

Guardrails:

- **Over-promotion check**: engagement rate of stream-born tasks (completed, edited, or referenced within 14 days) vs manually created tasks. If stream-born tasks are abandoned at a meaningfully higher rate, the agent is promoting noise and restraint needs tightening.
- **Journal share**: fraction of dispositions that are journal. Suspiciously low means over-promotion. Suspiciously high with frequent user re-promotes means under-promotion.
- **Undo and correction rates** per disposition, trailing windows (drive demotion).
- **Retrieval trust proxy**: search result clicks landing on stream-origin content. Falling retrieval engagement is the early smoke of the mymind failure mode.

## 9. Anti-goals and failure modes

- **Silent promotion with no digest.** This is Mem 1.0. Retrieval-time trust breaks are unrecoverable.
- **Over-promotion.** Covered above. Prompt for restraint, measure for it, celebrate journal.
- **Auto-ingesting firehoses.** Mem's own postmortem: piping email in automatically produced noise that drowned intent. Webhook sources (Pocket) are deliberate user pushes. Keep that bar. The stream is for things a human meant to capture. Connector-sourced signal belongs in the connectors and notifier designs, not dumped here.
- **The stream becoming a destination.** No feed mechanics, no scrolling engagement, no stream-native organization features. It is a log with a queue on top. The moment it grows folders or pinning, the problem the product exists to delete has been recreated inside it.
- **Confident judgment scores.** All-3s effort estimates are worse than none.
- **A new review surface.** The digest lives on the deck. Do not build a second inbox to review what the agent did with the first one.

## 10. Open questions

- Should source chat items (created via create_stream_item mid-conversation) be triaged with extra context from the originating session, or identically to captures? Leaning: identically at first, the session link is available in the decision draft if needed.
- Image items: capture already runs vision extraction. Does the extraction live in rawText (searchable, triageable) or attachments metadata? Verify current behavior is consistent before the sweep depends on it.
- Multi-select accept in the proposals UI ("accept all 8") vs deliberate per-line taps. Bulk accept is probably right once acceptance is high, and it is itself a graduation signal.
- Team context (hub-and-spoke direction): a shared stream demands provenance and actor attribution even harder. The triage_decisions design carries actor already, which should age well, but autonomy config becomes per-principal. Out of scope for v1, worth keeping the tables compatible.
- Does promote_stream in suggest mode subsume propose_stream_triage, or stay separate? Leaning separate: execute-actions and propose-actions with distinct names keep the wire contract unambiguous for agents.

## 11. Appendix: market evidence sources

- Mem raise and thesis: techcrunch.com/2022/11/10/ai-powered-note-taking-app-mem-raises-23-5m-openai
- Mem 2.0 retreat (first-party): get.mem.ai/blog/mem-2-dot-0-transition-guide and get.mem.ai/blog/introducing-mem-2-0
- Napkin.one desktop shutdown notice (June 2026): napkin.one
- mymind model and long-term reviews: mymind.com/reviews, wondertools.substack.com/p/mymind2, thenewsprint.co/2026/01/02/my-2025-app-of-the-year-mymind
- Drafts as the pre-AI control group: macstories.net/reviews/drafts-5-the-macstories-review
- AudioPen economics: indiehackers.com/post/louis-pereira-s-journey-from-idea-to-15k-month-with-audiopen-eda6e4c6e4
- Voicenotes traction vs monetization: techcrunch.com/2024/05/13/buymeacoffees-founder-has-built-an-ai-powered-voice-note-app
- Tana model and raise: techcrunch.com/2025/02/03/tana-snaps-up-25m-with-its-ai-powered-knowledge-graph-for-work-racking-up-a-160k-waitlist
- Fyxer autonomy recipe and ARR: madrona.com/fyxer-ai-productivity-tools-for-email-and-meetings
- Superhuman auto-labels, opt-in auto-archive: techcrunch.com/2025/02/19/superhuman-introduces-ai-powered-categorization-to-reduce-spammy-emails-in-your-inbox
- Shortwave over-eager labels friction: email-tools.me/posts/shortwave-review
- Motion trust ramp: fritz.ai/motion-ai-review, trustpilot.com/review/www.usemotion.com
- Notion autofill judgment collapse: eesel.ai/blog/notion-ai-autofill
- Todoist Ramble (Jan 2026): todoist.com/todoist-assist
- Google Keep brain dump (I/O 2026): blog.google/innovation-and-ai/technology/ai/google-io-2026-all-our-announcements
- Karpathy append-and-review and the HN thread: karpathy.bearblog.dev/the-append-and-review-note, news.ycombinator.com/item?id=44658745
- Granola augment-not-replace trajectory: techcrunch.com/2025/05/14/ai-note-taking-app-granola-raises-43m-at-250m-valuation-launches-collaborative-features
- GTD failure modes (capture/clarify mixing, guilt pile): facilethings.com/blog/en/gtd-flexibility, benny.ghost.io/blog/gtd-inbox-processing-best-practices
