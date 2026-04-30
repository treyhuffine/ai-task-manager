# Knowledge Model — Design Rationale

This is the *why* behind the schema and conceptual model for personal knowledge in the app. The PRD captures the *what*; this doc captures the alternatives considered and the reasoning that led to the chosen approach.

---

## The problem

Personal knowledge and productivity systems decay. People build elaborate folder taxonomies, tag vocabularies, project hierarchies — and within months or years, those structures rot. Items end up in the wrong place. Categories overlap. Half-built taxonomies survive as graveyards. Users abandon the system or migrate to the next one.

The root cause: **humans were the only available curators**, and curation is a maintenance tax that compounds. PARA, GTD, Zettelkasten, MECE — each is a coherent philosophy, and each fails for the same structural reason. They require continuous human attention to remain useful.

AI changes the substrate. When AI can reliably classify, retrieve, link, and surface, the question stops being "what taxonomy should the human maintain?" and becomes "what substrate lets AI do the curation while humans stay in flow?"

This doc captures the design exploration that led to our answer.

---

## Approaches considered

### 1. Nested folder hierarchy

The traditional answer. Folders within folders. Examples: filesystem, PARA (Projects/Areas/Resources/Archives), Johnny Decimal, classic file managers. Most knowledge tools (including Obsidian and Notion as default) inherit this model.

**What it's good at**
- Spatial memory and pre-architectable structure. Power users can design a taxonomy before having data and navigate by path.
- Inherited context — items in `Marketing/Q3-launch/` are automatically about Q3 marketing without having to say so.
- Deterministic addressing — a path is stable, gettable by any tool that speaks filesystem.
- Visual depth-cued ordering (numeric prefixes like `00_`, `01_`).

**What it's bad at**
- Forces a placement decision per capture ("where does this go?"). This is the maintenance tax.
- Cross-cutting requires duplication or wiki-links. An item that's about both Marketing and Customer Research has to choose a primary home.
- Refactoring is global migration — rename a folder, update every path.
- Hierarchies rot — old-strategy folders linger, sub-categories blur, junk drawers form.
- Capture from voice, mobile, or ambient sources cannot tolerate folder picking.

**Where it serves**
- People whose work *is* designing knowledge structures (academics, librarians, certain consultants).
- Shared filesystems where governance and permissions are path-defined.
- Code, asset-heavy creative tools, and other path-entwined systems.

**Where it fails**
- Personal productivity at scale, especially with ambient capture and AI assistance. The maintenance burden is exactly what AI should be removing, not what humans should still be doing.

### 2. MECE entity classification

Mutually Exclusive, Collectively Exhaustive — every item fits exactly one category, the categories cover everything. Originated in consulting; popularized in personal knowledge by structured-database approaches and CRM-style "world model" tools.

**What it's good at**
- Stable identity. A person, company, or project exists once and is referenced everywhere.
- Structured retrieval — `WHERE role = 'founder' AND industry = 'fintech'` works.
- Cross-entity reasoning — clean joins because shapes are defined.
- AI/agent legibility — predictable schemas are easier to operate on than free text.
- Compounding when shapes repeat (every meeting has agenda/attendees/outcomes).

**What it's bad at**
- MECE itself is hard. Real life isn't mutually exclusive — people are also collaborators are also customers. Categories blur.
- Capture friction at the entity boundary. Every item must be classified before storage.
- Schema rigidity. Adding a new attribute requires migration or a fallback "notes" field that becomes a junk drawer within the entity.
- Pre-design tax. The taxonomy must exist before the data — but data drives what taxonomy makes sense.
- Doesn't capture the messy 90% — random thoughts, half-baked ideas, observations don't fit any entity.

**Where it serves**
- High-volume entity work (CRM, recruiting, deal flow, research portfolios). When the work *is* tracking thousands of well-defined entities, the structure pays off.
- Roles where pre-design is part of the value (analysts, librarians).

**Where it fails**
- General personal productivity. Most people have ~50 meaningful people, ~5 active projects, ~10 ongoing themes. The classification overhead exceeds the structural benefit.

### 3. Flat with cross-cutting relationships

A small set of stable top-level domains, items as the atomic unit, links between items handling cross-cutting concerns. Inspired by knowledge-graph tools (Roam, Obsidian with backlinks, Tana) but with explicit constraints to prevent the failure modes those tools exhibit at scale.

**What it's good at**
- Near-zero capture friction. Capture happens; placement is AI-suggested or deferred.
- Cross-cutting handled cleanly. An item can link to many anchors without duplication.
- Refactor freedom. Rename a domain, links survive. No path migration.
- Handles novel domains — you don't need to pre-design what doesn't exist yet.
- Accommodates messy 90% (free-form thoughts) alongside structured entities.

**What it's bad at**
- Loses depth-encoded ordering and inherited path context. Items must self-describe more than in nested models.
- Loses pre-architectable structure. The shape emerges from data, which frustrates users whose value comes from designing taxonomies.
- Hub-and-link navigation is a different muscle than path navigation; transition cost is real.
- Can devolve into tag soup if the constraints aren't explicit.

**The constraints that make it work**
- Single primary domain per item (not multi-membership). Multi-membership is tags-with-discipline; tags rot.
- Closed, opinionated vocabulary for entity kinds.
- Links are local, write-time decisions — not a curated vocabulary.
- AI assists structurally (placement, linking) but doesn't make architectural decisions silently.

---

## The decision: flat with single-membership areas + typed knowledge items + cross-cutting links

The chosen model takes the *capture friction* and *refactor freedom* of flat-with-links, the *structured-identity* benefit of entity-based systems, and the *life-domain orientation* humans naturally use for context-switching.

**Four user-facing primitives**:
- **Areas** — flat, single-membership, durable life domains (3–15 typical). Sub-aspects live in content, not structure.
- **Tasks** — things with a done state. Subtasks via `parent_id` for natural decomposition. Projects = top-level tasks with subtasks.
- **Knowledge** — durable items including free-form notes, structured entities (people, meetings, decisions, goals), and AI-maintained synthesis pages. Single area, optionally linked to a task. Carries a `compiled_truth` field for AI-synthesized current view (separate from user-authored `body`). Items track their import origin via `source_capture_method` when externally captured.
- **Links** *(planned)* — polymorphic edges between any two items. The cross-cutting graph.

**Supporting infrastructure** (not user-facing as content):
- **Stream** — user-originated captures (text, voice, image, brain dumps). Promoted into knowledge or tasks during triage. *Reserved for user input — never used for integration data.*
- **Knowledge events** *(planned)* — append-only timeline of facts about each knowledge entity. Per-entity history, immutable, derivable.
- **Integration events** *(planned)* — raw dumps from third-party sources, ingested in the background and reconciled into knowledge by AI. Not surfaced to the user directly; auditable via the agent activity log.

**The principles holding it together**:
- Quality bar for areas: durable for years AND coherent in scope.
- No tags, no projects, no sub-areas — each was considered and rejected for specific reasons.
- Hubs are emergent (high in-degree items), not a separate primitive.
- Closed kind vocabulary for knowledge — opinionated, product-defined, never user-defined.
- AI suggests structure; human commits. Architectural decisions stay human.

---

## Schema implications

### Renaming `notes` → `knowledge`

The original schema named the table `notes`, reflecting an early model where the only durable items were free-form text. As the model evolved to include people, meetings, decisions, and goals as items in the same table (discriminated by `kind`), the name "notes" became too narrow.

`knowledge` is a more accurate umbrella. The user-facing language stays kind-specific (Notes, People, Meetings, Decisions, Goals) — users never have to learn that "knowledge" is the technical term. The rename matters for:

- Code clarity and agent tool naming (`searchKnowledge`, `createKnowledge`)
- AI prompts and reasoning ("search your knowledge for X" reads better than "search your notes for X" when the search returns people and decisions)
- Future-proofing as kinds expand

The migration touches API routes, type names, query helpers, and downstream agent prompts. It's not free, but the alternative is permanent semantic drift between schema and reality.

### `kind` field with closed vocabulary

Knowledge items carry a `kind` discriminator. The vocabulary is closed and product-defined.

Initial vocabulary (each earns its place by unlocking structure or behavior):

| Kind | What it unlocks |
|------|------------------|
| `note` | Default — free-form text capture, user-authored |
| `source` *(deferred)* | External material brought in (article, PDF, transcript). Body holds extracted text; raw file in attachments. *Captured via the `source_capture_method` field on any kind, not a separate kind itself — see below.* |
| `person` | Canonical identity, last_contact, relationships, dedicated UI |
| `meeting` | Attendees, agenda, outcomes, pre-meeting brief |
| `decision` | Lifecycle (pending → made → superseded), supersession chain, blocking semantics |
| `goal` | Time frame, measures, contributing tasks, status |
| `synthesis` | AI-maintained aggregation across sources. Distinct lifecycle (AI-managed body), distinct lint behavior (cross-source contradictions), distinct UI (source list, contradictions, last-AI-update). |

Optional opt-in extensions ship with the product as user-enabled kinds (e.g., `company`, `book`, `place`). They're not user-defined — each is designed with intentional structure and UI.

**Sources are not a separate kind.** Externally captured content (clipped articles, uploaded PDFs, transcribed audio) lives in any appropriate kind (`note`, `meeting`, etc.) with a `source_capture_method` field indicating how it entered the system:

```
source_capture_method: null | 'clipping' | 'upload' | 'transcription' | 'integration'
```

Null for manually-written items. Populated when the item came from outside. Combined with the existing `url` field and attachments, this captures provenance without forcing a separate "source" kind. Filters in the UI ("My notes" vs "Sources") are a `WHERE` clause on this field.

**Sub-types within a kind: typed columns when worth it.** For most attributes, the JSON `attributes` blob is fine. But when a sub-categorization is *frequently filtered* and *drives different system behavior*, promote it to a typed nullable column. The first such case is `synthesis_type`:

```
synthesis_type: null | 'theme' | 'comparison' | 'analysis' | 'overview'
```

Each value drives different AI generation, different rendering, and different lint behavior — earning its column. Other kinds may eventually deserve the same treatment (e.g., a `relationship` column on Person, a `scope` column on Decision) — promote when usage demands it; don't pre-design columns that may not be needed.

**The test for whether a kind earns inclusion**: does it unlock structured behavior or specific affordances? `person` passes (canonical identity matters). `idea` and `concept` fail (no specific structure beyond free-form text with aspiration; they're notes with subtle labels).

**No user-defined kinds.** This is the open-tag-vocabulary trap in disguise. Users would create `idea`, `thought`, `quote`, `link`, `todo`, `meeting-note`, `meeting-prep` — most of which are subtle distinctions of free-form text. The vocabulary balloons, AI classification gets unreliable, predictability erodes. Vocabulary additions are product decisions, not user customizations.

### Decisions and goals as kinds, not separate tables

Both have first-class concept status in the user's mental model — dedicated views, dedicated UI, dedicated AI behavior. None of that requires schema separation.

The test: a `kind` deserves its own table only when at least two of these are true:
1. Different lifecycle shape (not just status values, but a fundamentally different state machine).
2. High row count benefiting from dedicated indexes.
3. Required fields that don't fit `attributes` naturally.
4. Cross-entity joins so common they justify typed FKs.

Tasks vs. knowledge passes (different lifecycle, different required fields). Decisions and goals vs. notes don't — same shape, lifecycle expressible as status enum, low row counts, sparse cross-entity joins handled by the links table.

The PRD's separate Decision and Goal sections describe *behavior*, not *storage*. The behavior survives intact when both live as `kind`-typed knowledge.

---

## Free-form attributes: a contested tradeoff (unresolved)

The current schema sketch uses a JSON `attributes` blob for kind-specific structured fields:

```
knowledge:
  id, area_id, title, body, kind
  ...common fields...
  synthesis_type: nullable typed column  // already promoted
  attributes: JSON { ...kind-specific fields }
```

**This position is actively contested.** Free-form `attributes` is treated by some as an antipattern, and the concern has merit. Documenting where we stand and what alternatives remain on the table.

### The case against attributes as the default

- **Schema invisibility.** You can't see the shape of a Person by looking at the table — you have to know what `attributes` keys it carries. The schema lives in tribal knowledge, not the database.
- **Weak typing at the DB level.** Nothing enforces that a Person's `last_contact` is a date or that a Decision's `status` is in a specific enum. Validation is deferred entirely to application code.
- **Clunky queries.** `WHERE attributes->>'status' = 'pending'` is harder to read, harder to index, and slower than `WHERE status = 'pending'`. JSON-path indexes help but don't fully close the gap.
- **Invisible migrations.** Renaming an attribute doesn't trigger any DB error — stale data silently lingers. A typed column rename is a migration the system notices.
- **Weaker tooling.** Autocomplete, ORM type generation, query builders, schema documentation — all stronger with typed columns.

These aren't theoretical. They become real maintenance pain as the system grows.

### Alternatives if we keep `kind` and need per-kind data

| Option | Shape | Pros | Cons |
|---|---|---|---|
| A. Wide table with kind-specific nullable columns | `person_role`, `meeting_at`, `decision_status`, etc. on the same table | Strong typing, simple queries, indexable directly | Many nulls, table grows wider with each kind, every new kind requires migration |
| B. One table per kind, sharing base via FK | `knowledge_base` (common fields) + `people`, `meetings`, etc. | Strong typing, clean separation per kind | Joins for full views, more tables, schema-explosion-adjacent |
| C. JSON attributes | One blob per row | Flexible, no migrations, no column explosion | Weak typing, clunky queries, invisible migrations |
| D. Hybrid (typed-default, JSON-escape-hatch) | Typed columns for predictable per-kind fields; JSON only for genuinely variable data | Strong typing for hot paths, flexibility where actually needed | Requires judgment per-field about which goes where |

### The position worth defending

Most per-kind fields *are* predictable: Person.role, Meeting.at, Decision.status, Goal.target_date. Pretending they need JSON flexibility is over-engineering — they have stable shapes that benefit from typed columns. The cases that genuinely need JSON are narrower:

- Variable-shape data (e.g., Goal.measures — some numeric KRs, some narrative)
- Variable-length collections (e.g., Person.aliases as an array of strings)
- Truly experimental fields where the shape isn't known yet

So the strong position: **typed columns as default, JSON `attributes` only as escape hatch for genuinely variable data.** This is closer to Option D, leaning toward Option A.

This contradicts the earlier framing where attributes was the default and typed columns the exception. The earlier framing optimized for "no migrations" and "schema flexibility." That optimization is wrong when most fields aren't actually variable — it just defers structure to runtime.

### What's actually unresolved

- **Should we adopt typed-default now or stay attributes-default through v1?** Migrating from JSON to columns later is a real project; starting with columns avoids that debt. Counter: shipping faster matters early.
- **What's the threshold for "promote to column"?** Frequency of query? Importance of validation? Number of kinds that share the field? Not yet defined.
- **How wide is too wide?** A knowledge table with 40-50 columns is fine in modern SQLite. 200 is not. Where the practical ceiling sits depends on how many kinds we end up shipping.

This is an explicit position to revisit, not a settled fact. The current schema can absorb either direction; the choice is when to make the call. Until resolved, lean toward typed columns when adding new per-kind fields rather than deepening the attributes blob.

---

## Third-party integrations: dump and reconcile

External sources (calendar, email, drive, project trackers, fitness data) are first-class inputs to the knowledge graph, but they're handled in a way the user doesn't see directly.

The chosen pattern: **dump raw, reconcile in the background, surface synthesized truth**.

### The flow

1. **Raw ingestion** → `integration_events` table. Integration adapters write external data verbatim. Each row carries `source`, `external_id`, `event_type`, full `payload`, and timestamps. The user never sees this table; it's an internal substrate.
2. **AI reconciliation** runs in the background. For each unreconciled event, AI identifies the relevant knowledge entity (existing or new), extracts structured facts, appends to `knowledge_events` (the per-entity timeline), updates `attributes`, and regenerates `compiled_truth`. Each action is logged to the agent activity log.
3. **User-facing view** is the synthesized result. Opening a Person entity shows: their `compiled_truth` (AI's current understanding), their `body` (user's own notes), recent `knowledge_events` (timeline). Raw integration events are never displayed as content; only auditable via "what has AI been doing?" surfaces.

### Why this pattern over alternatives

**Selective mirror only** loses the supporting raw inputs. If reconciliation gets the synthesis wrong, there's nothing to re-derive from. Dump-and-reconcile preserves fidelity.

**Federated query only** is structurally brittle: offline doesn't work, source rate limits bite, cross-source reasoning compounds latency. Background AI passes can't run "while the user sleeps" because the data isn't local.

**Mixing integration data into the user's capture stream** conflates two fundamentally different concerns: user-originated thought (which is small, intentional, and surface-worthy) versus integration ingest (which is high-volume, automatic, and noise unless filtered). Stream is for user ideas; it must stay clean.

### The three concepts, separated

The dump-and-reconcile pattern requires distinguishing three things that are easy to conflate:

- **Raw dumps** (`integration_events`) — original event data, full fidelity, immutable, retention-managed. Source of truth for re-reconciliation. User-invisible.
- **Compiled truth** (`knowledge.compiled_truth`) — AI-synthesized current view of an entity. Rebuilt as new events arrive. Separate from user-authored `body` so AI can rebuild deterministically without touching what the user wrote.
- **Timeline** (`knowledge_events`) — append-only event log per entity. Immutable history of facts as they were known ("Sarah was at TechCorp 2020-2024, then Acme from 2024"). Derivable from raw dumps; supports historical queries and audit trails.

Putting all three in the entity's `body` field would conflate ownership (user wrote vs AI synthesized), volume (compact view vs full history), and lifecycle (mutable current state vs immutable past). They want separate homes.

### What stays in source systems

Some external data shouldn't be mirrored even as raw events: full email bodies, document content, large media files, real-time streams. These stay in their source systems and are queried on demand via integration tools. The integration layer is hybrid by intent — mirror what's worth synthesizing, query what's too large or too live to mirror.

### The principle

**Knowledge is the user's primary, canonical, local world model.** Raw integration data feeds into it via a background pipeline the user doesn't operate but can audit. The user works at the synthesized layer; the raw layer exists for fidelity, recoverability, and the AI's own reasoning.

---

## The synthesis layer

Beyond typed entities and free-form notes, there's a third shape of knowledge worth naming: **AI-maintained synthesis pages that aggregate across many sources**. These are notes-of-a-different-character — not user-authored thoughts, not structured entity records, but evolving long-form synthesis on a topic.

Examples of synthesis pages in practice:
- *Theme* — "Cognitive performance: what I've learned" (running synthesis from 30 sources)
- *Comparison* — "Tool A vs Tool B" (compare-and-contrast that updates when either side changes)
- *Analysis* — "Why our V1 launch failed" (deep dive with claims and evidence)
- *Overview* — "Map of agent design patterns" (orientation to other knowledge items)

These earn their own kind (`kind=synthesis`) because they have:
- *Different ownership* — body is AI-maintained, not user-authored. The user prompts and reviews; AI writes.
- *Different lifecycle* — regenerated/extended when relevant sources arrive or on lint passes. Not edited the way a note is.
- *Different affordances* — synthesis-specific UI (source count, contributing items, contradictions inline, regenerate action, diff view).
- *Different lint behavior* — scanned for cross-source contradictions and staleness in ways notes aren't.

### How synthesis pages stay current

When a new source enters, AI finds the synthesis pages it might affect via:

- **Existing links** — synthesis pages link to entities and other items; new sources mentioning those targets are immediate update candidates.
- **Semantic similarity** — embeddings on source content vs. existing synthesis page content; high overlap surfaces candidates that aren't yet linked.
- **Area scope** — narrow the candidate set to the area the source belongs to.
- **AI judgment** — final filter that reads candidates and decides which are genuinely affected.

For each affected synthesis, AI updates the body (appending, revising, flagging contradictions) and appends a `knowledge_events` row. This is the operation that makes the wiki *feel alive* — the pages get richer with every related source, contradictions surface as they appear, and synthesis evolves without manual curation.

### Why synthesis is a kind, not just a flag on note

A `kind=note` with an `is_ai_maintained` flag would *technically* express the same data shape, but it would conflate two genuinely different artifacts under one type. Different ownership semantics, different lifecycle, different UI, different lint passes — these are precisely the criteria that earn a kind its place in the closed vocabulary. It passes the "structured behavior or affordance" test that `idea` and `concept` fail.

---

## Index and log: computed views, not stored documents

Pattern-shaped knowledge bases (like markdown-and-folders setups) often maintain explicit `index.md` (catalog of pages) and `log.md` (chronological event record) as files because their substrate has no other way to surface those views. The catalog and the log are real concepts; in their world, they have to be stored.

In a database substrate, both are computed views over data that already exists:

| Filesystem-substrate artifact | Database-substrate equivalent |
|---|---|
| `index.md` (catalog of all pages) | Knowledge listings by area/kind via UI views and `getKnowledgeIndex` query/MCP tool |
| `log.md` (chronological event log) | `agent_activity` (AI actions) + `knowledge_events` (per-entity timeline) |
| `[[wiki-links]]` (cross-references) | `links` table with FK-enforced referential integrity |
| Source summary pages (one per source) | `compiled_truth` field on the source item (lives with the source, not as a separate file) |
| Wiki sub-folders (topical scope) | Areas |
| `raw/` directory (immutable sources) | Raw integration data in `integration_events`; user-clipped/uploaded items in `knowledge` with `source_capture_method` populated |

**The structural advantage**: filesystem indexes and logs can go stale if maintenance falters. Computed views can't — they're queries against the live data. The tradeoff is portability: filesystem artifacts are universally readable; database artifacts need the markdown mirror to deliver equivalent portability. The mirror earns its weight here — it's the bridge that gives database substrates the same "open in any editor" affordance, without requiring a maintained index file.

---

## Junk drawer concerns

`kind=note` is the default catch-all. Most captures will live there. The worry: does it become unfindable?

**Mitigations baked into the model**:
- Embeddings make 5,000 notes as findable as 50.
- Areas partition the pile by life domain.
- Links to typed entities (Person, Meeting) make notes discoverable from the entity ("everything I have about Sarah" = items linking to Sarah's Person record).
- AI surfaces relevant notes contextually (during planning, before meetings, in chat).

Browse-by-folder fails at scale. Search + AI surfacing + entity-driven discovery does not. The catch-all bucket stays navigable as long as the surrounding affordances are good.

---

## Open questions and future evolutions

- **When does a kind graduate to its own table?** If goal-progress event sourcing becomes important (weekly KR snapshots, charts), a `goal_progress` event table makes sense — *supplementing* the knowledge model, not replacing it.
- **Should the kind vocabulary be community-extensible?** A curated extension catalog (community-designed kinds with reviewed schemas) is a more disciplined alternative to user-defined kinds. Open question for v2+.
- **Is the schema stable long-term?** Plausibly yes for the user-facing primitives (areas, tasks, knowledge, links). Supporting infrastructure (stream, knowledge_events, integration_events, embeddings, agent activity, sessions) will continue to evolve as integrations and AI behaviors mature.
- **Which sub-types deserve typed columns vs. attributes?** `synthesis_type` is promoted because it drives different generation, rendering, and lint behavior. Other sub-types (Person.relationship, Decision.scope, Meeting.format) may earn promotion as filtering and behavior demands surface. Default home is attributes; promote individual sub-types when their need is felt.
- **Free-form attributes vs. typed columns more broadly.** Position currently held: JSON attributes for kind-specific fields the system rarely filters on, typed columns for fields that are filtered/sorted/indexed frequently. This is an unresolved tradeoff and an explicit position to revisit; the lean toward fewer JSON-blob fields and more typed columns may grow as the schema matures.
- **How do we handle attribute schema evolution?** Versioned attribute shapes, migration helpers, agent assistance with backfilling. Not yet built.
- **Is single-membership the right long-term constraint?** It's the right constraint *now* because it forces clarity. Multi-membership might be reconsidered if cross-cutting links prove insufficient — but the bar should be high. Multi-membership is tags with discipline, and discipline decays.
- **Compiled truth: text or structured?** Currently planned as free-form text the AI writes. Structured (per-attribute updates with provenance) is more rigorous but requires per-kind reconciliation schemas. Ship with text; let structured emerge per-kind as patterns demand.
- **Integration events retention.** Long-term, raw events table will be large. Retention policies will need to balance fidelity (re-reconciliation needs raw data) against storage. Compiled truth and knowledge events compress the signal; raw can age out for sources where the original is still queryable on demand.
- **Markdown mirror as portability moat.** The mirror is what gives the database substrate equivalent portability to filesystem-based knowledge tools. It needs to be a faithful, browseable representation (cross-references rendered, areas as directories, kinds as readable formats) — not a flat dump. This is on the roadmap but not yet first-class.

---

## Summary

The model is opinionated where opinionation matters (vocabulary, structure, single-membership, no user-defined kinds) and flexible where flexibility serves the user (capture, content, areas, links, attributes). It rejects nested folder hierarchy and MECE classification not because they're wrong, but because they optimize for human-curated structure — and the substrate we're building assumes AI shares the curation burden.

Where this model could turn out wrong: the free-form `attributes` choice if structured queries become bottlenecks; the closed kind vocabulary if a meaningful kind we didn't anticipate emerges; the single-membership constraint if cross-cutting links prove insufficient. None of these is unrecoverable; all are worth revisiting as the product matures.

The thing that won't be revisited: the principle that humans should not be the curators of their own digital systems. That's the whole point.
