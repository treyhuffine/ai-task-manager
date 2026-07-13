# Product Philosophy and Vision

Status: direction-setting record of a full philosophy review. Covers the future-of-work model we are building toward, the honest assessment of the premise and product, recommended changes, the team architecture decision, and the staged plan. Companion to `team-product-direction.md` (operational team build plan) and `start-with-why.md` (the founding why). Written 2026-07-06. Reframed 2026-07-07 after a fresh-eyes zoom-out: the earlier version was organized around the app we had (tasks plus notes plus chat, then teams). This version is organized around the work loop the future requires. All prior reasoning is retained inside the new frame.

## 1. What human plus agent work will look like

The trajectory: chat assistants (human asks, AI answers, human does the work) gave way to agentic execution in bounded domains. Coding came first because verification is cheap and context is legible. The capability is spreading to drafting, research, coordination, scheduling, and follow-ups. The endpoint is not "humans do tasks faster with AI help." It is an inversion: agents do most digital execution, and the human's day concentrates into direction, judgment, review, relationships, and the irreducibly human work.

When execution becomes cheap, four things become the scarce resources:

1. **Context.** An agent workforce is only as good as what it knows about you, your work, and your intent. Fragmented context is the number one limiter on delegation. Whoever holds the canonical context holds the relationship.
2. **Attention.** The human's review bandwidth becomes the hard constraint of the whole system. Not execution capacity, not organization.
3. **Trust and authority.** Delegation at scale requires graduated autonomy: what may observe, what may propose, what may act with approval, what may act unattended. Nobody has built the layer where a person configures and inspects what acts on their behalf.
4. **Continuity.** Agents are ephemeral sessions. Work is continuous. Something must persist intent, state, and history across invocations. That is what a home is.

## 2. What the product is

**The operating layer where a human, then a team, runs their agent workforce.** All work lands in one place, AI triages and routes it, agents execute most of it, the human spends attention only on judgment, and the system learns from every acceptance and correction.

Tasks and notes do not disappear, but they are not the product. They are the ledger and the curriculum. The product is the loop:

**Capture → Triage → Route → Execute → Review → Learn**

- **Capture:** work arrives from where it actually originates (email, Slack, meetings, thoughts), not from a human opening an app.
- **Triage:** AI classifies, enriches, deduplicates, and prioritizes at the point of entry.
- **Route:** every item gets a routing decision: agent-now, agent-queued, human-deck, or waiting-on-someone, governed by the autonomy model.
- **Execute:** agents do the work through executions (propose, approve, run, review), humans do theirs from the deck.
- **Review:** humans verify agent output through legible, fast, diffable review surfaces.
- **Learn:** every acceptance, correction, and rejection is recorded with provenance and feeds back into triage quality and autonomy levels.

## 3. The thesis underneath

Productivity systems die the same death: the maintenance cost of their structure exceeds the value extracted from it. Folders, tags, priorities, statuses, and weekly reviews exist to serve human retrieval and triage. Humans will not pay that upkeep tax indefinitely, so every system rots. This is the lived experience in `start-with-why.md`: the tools built to help you focus are the ones draining you.

AI changes both halves. Retrieval is nearly free (embeddings, semantic search). Triage is delegable. So most structure can be deleted and intelligence becomes the organizing layer. Keep the artifacts, delete the scaffolding.

The second inversion is deeper: productivity software has always been "record what a human must do." With agents it becomes "negotiate what gets done and by whom." Delegation is the primitive. Executions are the native unit of work, and the executor may be a human or an agent interchangeably.

Two properties follow. The product gets better for free as models improve, while structure-heavy competitors get commoditized by the same curve. And the product's ceiling is set by trust, not features: when AI maintains the structure, legibility of AI action is the product.

## 4. Assessment: what the premise gets right

1. **The rot diagnosis is correct.** Every PKM and todo system fails the same way. The insight that structure exists for human retrieval and triage, and that AI makes the first free and the second delegable, is the right reading of the moment. Most competitors bolt a chat panel onto a structured task list. Flow inverts it.
2. **Right side of the model improvement curve.** Structure-light products ride the frontier instead of being eroded by it.
3. **Delegation as the primitive is the most original part.** Executions as a first-class table, propose-approve-run-review. Software rebuilt around negotiation of work. Very few are building it natively.
4. **The substrate decisions are trustworthy.** One home directory that is simultaneously the human's data, the agent's cwd, and the sync unit. Content as plain markdown at the root. SQLite locally. The orchestrator registry as single source of truth with action names as public contract. queries.ts as the invariant chokepoint. entity_versions for diff and undo. Local-first matters more here than in most apps: handing an agent your whole life context requires trust that is much easier to extend to software running on your machine against your files. User-owned hooks over baked-in magic is the right immune response to over-automation.

## 5. Assessment: what is at risk

1. **Minimalism versus the building ethos.** The philosophy preaches removing structure, and also preaches boiling the ocean because completeness is nearly free. The surface area shows it: deck, triggers, executions, connectors, notifier, previews, terminal, worktrees, voice, two MCP surfaces. Each defensible, the sum is the accretion the thesis warns about. When building is nearly free, restraint is the scarce discipline. The standing question is "what did we delete this month."
2. **Decisions convert into verification.** If verifying the AI's organization costs as much as organizing yourself, nothing was gained. See 7.1 and the time-to-verify metric.
3. **Invisible rot can replace visible rot.** When AI maintains the structure, the failure mode is quiet drift the user cannot inspect. Versioning, attribution, and undo are the countermeasures, and coverage must be total.
4. **The proactive deck is a high-stakes bet.** A reactive assistant that is 80 percent right is useful. A proactive one that is 80 percent right is an interruption machine. Triage accuracy decides whether "AI manages the system" is real.
5. **Concept churn while contracts freeze.** Action names are already the public contract and the window for cheap renames is closing.
6. **The single-human assumption caps the ceiling.** Addressed by the team direction (sections 10 through 13).

## 6. Assessment with fresh eyes: where the tunnel vision was

A zoom-out on 2026-07-07 found the earlier framing refined *how to build what we already assumed* rather than questioning the assumed shape. Findings, mapped to the loop:

- **Capture was the biggest strategic miss.** Real work arrives through email, Slack, meetings, and passing thoughts, not through someone opening a task app. If work does not flow in automatically, the human is the courier and the system rots at its entry point regardless of how good everything downstream is. Connectors are not an integrations feature for later. Ingestion is the front door of the entire system and the thing that makes single-player indispensable. Promoted to a top Horizon 1 priority.
- **Triage is on track.** The proactive deck is exactly this stage. It needs correction telemetry because triage quality is where trust is won or lost.
- **Route needs to become explicit.** The routing decision (agent-now, agent-queued, human-deck, waiting) is currently buried in UI flows. The missing primitive is the **autonomy model**: per action type, graduated levels from propose-only to act-unattended, visible and tunable by the user. This is a new noun and it passes the higher bar deliberately: the entire future of the product is delegation, and delegation without configurable trust does not scale past toy use. IAM for the agent workforce, in the simplest form that works.
- **Execute is the strongest asset,** and it is very code-shaped. Correct for the wedge, wrong for the destination. Mark wedge-specific machinery (worktrees, PR flows, terminals) as wedge-specific so the generalization path stays visible.
- **Review is strong for code and near-empty for everything else.** Diffs and worktrees make code review legible. There is no equivalent for "the agent rescheduled your week, drafted six replies, and reorganized the project note." entity_versions is the seed: staged changes plus diff plus accept for any entity. Generalizing the review surface beyond code is likely the single most defensible thing to build, because review bandwidth is the binding constraint of the agentic era and nobody has nailed non-code review UX.
- **Learn is mostly missing, and it is the flywheel.** Provenance plus acceptance telemetry (which agent outputs got accepted, corrected, rejected) feeds the autonomy model: accepted work earns autonomy, autonomy produces leverage. That data accumulates in the user's home, is specific to them, and cannot be copied by a competitor.
- **Tasks-first is backwards-looking.** The task list is the artifact of a world where humans execute. The differentiated product is the dispatch-and-review loop. Keep the todo layer adequate, spend differentiation elsewhere: the OS vendors give that layer away.
- **Notes are agent context, not reading material.** A note's value is whether it changes agent behavior at the right moment. The commons argument (section 10) stands, and this is the sharper frame for the single-player side. The substrate is already right: content lives as markdown at the home root where agents literally read it.
- **Dogfooding bias.** The roadmap is developer-shaped because the maintainer is one. Right wedge (developers are where agent execution works today), but the doc must keep the generalization path explicit.
- **Timeline honesty.** The frame's biggest risk is that agent capability plateaus near code and drafts for a while. The plan is sequenced so every stage pays for itself in the slow world too: an inbox that triages itself and a deck that respects attention are valuable regardless of timeline. We are not betting the product on a forecast.

## 7. Philosophy refinements

Refinements, not reversals. The pillars stay untouched: local-first, files plus SQLite, the orchestrator registry as public contract, user-owned hooks over baked-in magic, open source.

### 7.1 Concentrate decisions, do not "minimize" them

Decisions cannot be eliminated. Delegation converts them into verification. The accurate principle: batch decisions into a few finite, well-designed moments (the morning deck, approval gates) instead of ambient micro-decisions all day. "Minimize" tempts toward auto-approving and hiding agent activity. "Concentrate" says make the review moment excellent: small, finite, rich in context, fast to act on. Judge every feature by whether it feeds a review moment or creates a new interruption channel.

Guardrail metric: time-to-verify. If reviewing the morning deck costs more than manual triage, the thesis is failing. Measure from data, not vibes.

### 7.2 Boil the ocean on depth, be a miser on breadth

Any feature we build gets finished completely, tested, documented. But a new noun (table, primitive, top-level concept) needs a dramatically higher bar than a new verb on an existing noun. Schedule recurring deletion passes. A minimalism thesis is only credible if the artifact stays minimal.

Applied examples: the execution queue is lifecycle states on the existing executions table, not a parallel primitive. The autonomy model (6, Route) is a new noun that passes the bar.

### 7.3 Legibility is a first-class principle

Every agent mutation is attributed, diffable, undoable, and surfaced in one digest. When AI maintains the structure, the trust surface is the product.

## 8. Horizon 1 plan: close the loop for one person

The product must be indispensable for one person or nothing else matters. Priorities ordered by the loop, not by feature area:

1. **Provenance and acceptance telemetry (Learn).** Record the actor of every mutation: human, agent, which agent, which session or execution. Record the fate of agent output: accepted, corrected, rejected. Extend entity_versions and the stream. This is the flywheel substrate and the hard prerequisite for teams. Retrofitting provenance is painful, adding it single-player is cheap. Still first.
2. **Ingestion as the front door (Capture).** Email, calendar, Slack, GitHub connectors done deeply rather than broadly, feeding the stream and triage. This is what makes the product the place where work lands rather than a place work must be carried to.
3. **Proactive deck, instrumented (Triage).** Capture every user correction as structured signal. Track time-to-verify.
4. **Generalized review surface (Review).** entity_versions-powered staged-change review for non-code work: see what the agent changed or proposes to change on any entity, diff it, accept or undo it, fast.
5. **Autonomy model v1 (Route).** Can start as small as per-action-type approval defaults with a visible settings surface. Grows into graduated autonomy fed by acceptance data.

Plus the standing items: finish the triggers rename and freeze the vocabulary, audit entity_versions coverage across all agent-reachable write paths, and hold the constraint "does this still work if the task came from somewhere else?"

### 8.1 Grounded against the codebase (audited 2026-07-07)

Horizon 1 is less greenfield than the sections above imply. Much of the raw material exists, and the real work is finishing, unifying, and instrumenting:

- **Learn:** entity_versions already carries `source: human|ai|system` and `actorSessionId`, and reverts record `revertedFromVersionId`. Acceptance semantics are largely derivable from existing data (AI version reverted = rejected, human-edited soon after = corrected, untouched = accepted). Gaps: provenance on orchestrator/MCP write paths that lack a session, structured deck-correction events, and the aggregation/metric layer (time-to-verify).
- **Capture:** the connectors runtime exists (toolkit connections, OAuth, per-workspace scopes, approvals), the deck already reconciles external items (`reconcile-external`), and calendar is wired in (`calendar-connector`). The gap is the inbound path: email and Slack ingestion into the stream and triage (`connectors-mcp-ingest-spec.md` exists, unbuilt). Notifier design is locked, build pending.
- **Triage:** proactive deck machinery is largely built (`ensure-todays-deck`, deck trigger, morning refresh trigger, calendar sizing). `triage/llm.ts` exists for stream triage. Gap: correction telemetry and accuracy iteration.
- **Review:** diff plus undo exists for content-chat edits, execution view refactor (code review) is in flight. Gap: one unified "changes while you were away" surface over entity_versions plus executions-in-review, with diff, accept, undo per item. Mostly a query plus UI, the primitives exist.
- **Route:** autonomy pieces exist scattered (permission-modes, connector approvals and scopes, trigger scheduling). Gap: unify into one visible per-action-type autonomy surface enforced at the orchestrator dispatch chokepoint.
- **Housekeeping:** executions prod migration and column drop pending, triggers naming half-renamed, `roadmap.md` marked historical (pre-pivot Eon doc, some ideas still worth mining: radar, avoidance detection, temporal memory, import agent).

### 8.2 Execution order

The sequenced plan, with rough sizing. Each step is valuable standalone even if agent capability plateaus, which is what makes the sequence safe to commit to.

- **Step 0: finish the three in-flight threads (days).** Not new work, just closing what is open before starting the new frame: (a) the executions prod migration and the pending column drop on chat_sessions, (b) the in-flight execution view refactor, (c) the Triggers-versus-Automations naming decision so the half-done schedules-to-triggers rename can finish through routes and UI and the vocabulary can freeze. These go first because later steps touch the same ground: provenance work extends the executions and versions tables, and the autonomy surface builds on triggers. Building on unsettled schema and naming multiplies the work.
- **Step 1: Learn substrate (about a week).** Coverage audit so every agent-reachable write path produces an entity_version with correct source and session or execution linkage. Derive acceptance semantics from existing data (reverted equals rejected, human-edited-soon-after equals corrected, untouched equals accepted). Add structured deck-correction events and the time-to-verify measurement.
- **Step 2: Capture, the front door (several weeks, the biggest build).** Inbound email first, then Slack, into the stream, through triage, routed onward. The ingest spec exists and the connectors runtime it needs is built. Notifier Telegram phase alongside (shared plumbing). Exit criterion: a day's real work lands in Flow without the human carrying it there.
- **Step 3: Triage hardening (continuous, rides on 1 and 2).** Feed correction telemetry into the proactive deck and iterate accuracy against time-to-verify. Tuning, not construction, but where trust is won.
- **Step 4: unified Review surface (medium).** One "changes while you were away" pane: recent AI entity_versions plus executions in review state, each with diff, accept, undo. Primitives exist, mostly query plus UI, most defensible surface in the plan.
- **Step 5: Route, unify autonomy (medium).** Consolidate permission-modes, connector approvals and scopes, and trigger settings into one per-action-type autonomy surface enforced at the orchestrator dispatch chokepoint. V1 is propose-versus-auto defaults. Acceptance data from step 1 later earns autonomy upgrades.
- **The gate.** With telemetry live, single-player indispensability becomes measurable: does work land automatically, and does the morning review beat manual triage? Only past that gate does Horizon 2a (the team bot) start. By then step 5's approval machinery is half its prerequisite list.

## 9. Impact: how this matters

The path to impact is not out-featuring incumbents. The OS and model vendors (OpenAI, Anthropic, Apple, Google, Microsoft) will own general assistants and will ship agentic execution with distribution Flow cannot match. What they structurally will not build: the user-owned context home, cross-provider workforce management (Flow already runs multiple executors), legible review for real work, and a trust layer the user controls rather than the vendor. Neutral, local, user-owned control plane. That is the defensible position, and open source is essential to it, not incidental.

The realistic impact path looks like Obsidian's, not Notion's: become the reference implementation for how humans and agents cohabit a workspace. Ideas like "the agent's cwd is your life's home directory" and "structure is a liability, intelligence is the organizer" propagate beyond the install base. The civic stake grows as the workforce era arrives: the default future is everyone's context and agent workforce rented from vendor clouds, and a credible user-owned alternative existing at all changes what people can demand from every vendor.

The wedge audience (developers and AI-forward knowledge workers willing to run a local server) is small. That is fine. Obsidian started there too, and the philosophy travels where the artifact does not.

Compressed: the diagnosis is right, the delegation-native inversion is the most original part, the substrate is trustworthy. Three things decide whether it matters: triage accuracy (trust), review legibility (the binding constraint), and feature restraint (integrity of the thesis).

## 10. Teams: paths considered

Five architectures were weighed. Recorded so the reasoning survives.

**Path A: cloud multi-tenant SaaS.** Rejected. Destroys local-first, fights Notion and Linear on their turf, near-total rewrite. A hosted convenience offering may exist someday but must not shape the data model.

**Path B: shared single instance.** One Flow server, teammates connect over HTTP. Rejected as a direction (viable only as a hack for two co-located people). Every UI query assumes one user, and it blurs the cleanest idea in the architecture: one home, one principal. "Whose deck is it" has no good answer.

**Path C: full CRDT replication.** Replicas synced via CRDTs (cr-sqlite, ElectricSQL, PowerSync class tooling). Philosophically aligned but deferred: conflict semantics with multiple humans and agents writing are genuinely hard, and the sync layer quietly becomes the product. Revisit only if the hub model proves insufficient.

**Path D: pure peer-to-peer federation.** Personal homes exchange commitments over a protocol, no center. Superseded. Its delegation instinct was right but the model is task-shaped and ignores notes. Team knowledge is a commons, and no peer topology yields a canonical knowledge base. Federation also lacks a canonical board and needs a rendezvous relay anyway. Everything good about it survives inside Path E.

**Path E: hub-and-spoke nexus (chosen).** A central team store for shared notes and tasks. Members sync against it and pull relevant things into local execution. Wins because knowledge wants a commons, managers get the canonical view, the hub arbitrates conflicts, the hub is the rendezvous point, and delegation gets simpler through a shared space than over a peer protocol. The hub subsumes Path D.

### 10.1 The one correction: shared context, not all storage

The nexus centralizes the team's shared context, never an individual's life. The invariant: **the personal home stays sovereign, a team nexus is something you mount.** If the hub is where your life lives, local-first dies and this becomes a cloud app with extra steps. People belong to N teams plus themselves, and mounting handles N naturally. The privacy boundary is structural: **sync down is liberal, sync up is deliberate** (an explicit act like git push, or an agent proposal you approve). Personal content can never accidentally leak upward.

The shared-truth versus personal-annotation split from team-product-direction.md is doctrine: the team owns the truth of the task (title, status, completion, assignment), you own your relationship to it (energy, effort, sort order, subtasks, AI context, area placement).

## 11. The nexus is a Flow home, not a database

Team mode is the same binary running with a hub personality. **A team is a principal, just like a person. Every principal gets a home.** The team instance is a member of the team that happens to be software, with a home directory that is an agent cwd. Consequences:

- **Team standing agents fall out for free.** Triage, digest, reconciliation, project-shepherd agents living in the team home the way personal agents live in yours. The org chart of the future includes software, and the team home is where it is staffed.
- **The commons-rot argument.** Shared systems rot an order of magnitude faster than personal ones because maintenance of a commons is nobody's job. The rot thesis is therefore MORE valuable for teams than individuals. Notion, Linear, and Asana all have sync and boards. Nobody has a groundskeeper. The killer feature of team mode is the standing agent that keeps the shared database from rotting. The philosophy compounds in teams. In loop terms: the groundskeeper is Learn applied to the commons.
- **One codebase, one mental model.** Orchestrator actions, queries.ts invariants, entity_versions, embeddings, attachments work identically on the hub.
- **Deployment is a spectrum.** Shared box, cheap VPS, or hosted service. Self-hosted fits the open source ethos. Hosted is the business model (section 13).

### 11.1 Shared agentic use: the team agent surface

Because the team home is a full Flow instance, it inherits most of the product by construction: chat harness, executions, triggers, connectors, notifier, embeddings, orchestrator surface. A "smart Slack bot" for the team is therefore not a new system. It is the team home's chat surface exposed through the team's Slack connector: a member mentions the bot, the message routes into a session on the team home with the team commons as context, and actions dispatch through the same orchestrator registry. Same primitives, new principal.

What the team home deliberately does NOT get: a deck (decks belong to humans, a team digest is notifier output), personal enrichment, personal agent memory about individuals.

What is genuinely new work:

- **Identity mapping and acting-on-behalf-of.** The bot must know which member is speaking, and provenance gains a second dimension: agent X acting for the team, initiated by member Y.
- **Member-scoped authorization.** ctx.remote's binary trusted-versus-untrusted is not enough. At minimum: approve, assign, delete.
- **Multi-party sessions.** A Slack thread is N humans plus an agent. The session model needs participant awareness.
- **Approval semantics as the injection defense.** A channel-facing agent reads arbitrary inbound text, so bot-initiated mutations route into propose-then-approve with a named human approver, never silent writes. Concentrate-decisions doing security work.

Strategic consequence: **the bot can ship before sync.** A team adopts "a bot with a brain in your Slack" with zero behavior change. Shared context accretes in the team home through use. The app view and personal mounting come after. This is the second adoption wedge: team-down via the bot, individual-up via sources. They meet in the middle.

Restraint note: the bot is powerful precisely because it is a thin channel over the same primitives. If it grows a parallel brain or state outside the orchestrator surface and the team home, it becomes the grab-bag chatbot every company builds and abandons.

## 12. Sync model sketch

- **Sources and adapters.** A personal Flow connects to sources: team hubs and third-party tools (Linear, Asana, GitHub) through the same adapter pattern. Synced items are local copies linked by source plus external_id.
- **Tasks scope by identity.** Your token pulls your assignments and follows.
- **Notes scope by relevance.** Subscription gives coarse scope, agents pull semantically relevant context on demand. Relevance is an intelligence problem, not a folder problem: the thesis applied to sync itself.
- **The deck is the composition point.** With N mounted sources, one finite morning surface composed across personal plus every space plus external tools, sized to the calendar.
- **Shared fields sync bidirectionally, personal enrichment stays local** (10.1).
- **Conflicts: the hub arbitrates.** Last-writer-wins per field, full entity_versions history as audit trail, and for content bodies an agent performs semantic merge the way a human editor merges drafts, logged, undoable, surfaced in the deck when uncertain. Intelligence-heavy merge as differentiator, LWW plus history as the boring fallback.
- **Embeddings are derived data and never sync.** Each replica computes its own.
- **Attachments are content-addressed** and pulled through on demand.
- **Provenance crosses the boundary.** Every synced mutation carries its actor. Non-negotiable, built single-player first.

## 13. Adoption and business

**Bottom-up wedge:** because team hubs and external tools are the same kind of source, personal Flow is useful at work before any team adopts anything (pull your Linear tasks into your deck today). Adoption is individual-first, the way git, Slack, and Notion spread. Team mode never has to win a rip-and-replace sale. **Team-down wedge:** the bot (11.1). The two meet in the middle.

**Business:** hubs need to run somewhere, and hosted rendezvous plus sync is the proven open source monetization path (Obsidian Sync, Bitwarden, Tailscale). The one revenue model that does not betray local-first: the data stays yours, you pay for plumbing. The beamd tunnel work is precedent.

## 14. The future framework

- **Homes.** Every principal (person, team, eventually org) has a sovereign home: a plain files-plus-database context where its agents live and work, agent cwd equals home.
- **Spaces.** Shared context lives in spaces you mount. A space is itself a home whose principal is plural. The primitive recurses (an org can be a space of spaces), though we should not over-architect for that yet.
- **Commitments.** Work moves between homes as commitments with provenance and context attached (the executions lifecycle). The executor may be you, your agent, a teammate, or a team standing agent, and the gesture is identical in every case.
- **Decks.** Humans touch one small, finite, warm surface. The deck's endpoint is a judgment schedule: it allocates the human's decision hours the way a calendar allocates meeting hours. Decisions to make, reviews to do, human-only work, protected deep time.
- **Standing agents.** Teams and individuals staff software the way teams staff people: roles, schedules, budgets (attention, tokens, money), and performance built on acceptance data. Maintenance of the commons is finally somebody's job.
- **The autonomy layer.** Graduated, inspectable authority over what acts on your behalf, earned through the Learn loop.
- **Protocol.** Homes and spaces speak a common contract (the orchestrator action surface is the seed). The long-term ambition is to be the git and email of work: the reference implementation for how humans and agents cohabit shared context, valuable even where the app does not run.

A workday in this world: your deck is composed overnight from your personal home, two team spaces, and your external tools, sized to your calendar and your decision budget. You review it over coffee in one concentrated pass: approve three agent proposals, decline one, reorder the rest. Work that arrived overnight was already triaged and routed, most of it executed by agents whose autonomy was earned, the exceptions waiting in review with legible diffs. The team space was groundskept while you slept, all attributed, all undoable. You spend the day on judgment, relationships, and the work only you can do.

## 15. Staged path

- **Horizon 1 (now): close the loop for one person.** Section 8. Single-player indispensability is the gate for everything below.
- **Horizon 2a: the team agent surface.** Team home deployed with Slack and email connectors as the first shared surface. No sync machinery required. Needs identity mapping, member-scoped authz, multi-party sessions, approval semantics (11.1). Can lead or trail 2b depending on which wedge pulls harder.
- **Horizon 2b: mount and sync.** Personal instances mount the team home: subscribe, scoped task sync, note relevance-pull, assignment through the space, deck composition across sources. Schema work per team-product-direction.md.
- **Horizon 3: the workforce era.** Standing roles with budgets and performance, team standing agents as the differentiator (the groundskeeper), cross-org spaces, email-grade degradation for non-users, the protocol ambition.

## 16. What we will not build

- A differentiated todo UI beyond adequacy. That layer is a commodity the OS vendors give away.
- A general chatbot, personal or team. Every conversational surface is a thin channel over the same primitives.
- Breadth-first integrations. Depth on where work actually arrives (email, calendar, Slack, GitHub) before anything else.
- CRDT infrastructure (unless the hub model proves insufficient).
- Knowledge features that do not change agent behavior.

## 17. Open questions

- Identity: email plus magic link per home is probably enough for a long time. Keypairs per home if the protocol ambition gets serious.
- Authorization model for members: roles, per-area grants, or flat membership with approval gates? Start flat plus approval gates.
- Multi-party session shape: how do N humans plus an agent share one thread (attribution, interruption, who the agent defers to)?
- Version skew: hub and spokes are the same binary but will not run the same version. Sync needs a protocol version and a schema evolution story (a v1.2 personal instance against a v1.4 hub must degrade gracefully, not corrupt).
- Sync engine hard parts generally: offline edits, partial failures, retry idempotency. Hub-and-spoke removes peer divergence but not these. Budget honestly.
- Autonomy model granularity: per action type is the floor. Per counterparty, per area, per dollar amount are candidate dimensions. Resist building all of them before one is proven.
- Subscription granularity for notes: per-area, per-project, or agent-negotiated? Start coarse.
- Team mode surface split: triggers yes (they drive standing agents), deck no (decks belong to humans). Verify as it builds.
- When a member leaves: personal enrichment was never on the hub, authored shared content stays with provenance intact. Verify the model holds.
- Whether the philosophy refinements in section 7 should be folded into CLAUDE.md itself. Recommended, but that edit is a deliberate act for the maintainer.

## 18. Relationship to other docs

- `start-with-why.md` holds the founding why: living deliberately, and the burnout of tools that became a second job. Section 3 is that experience turned into a thesis.
- `team-product-direction.md` is the operational team plan: schema deltas, sync mechanics, workspace switcher UX, build-after-MVP. All of it stands and is incorporated here.
- This doc supersedes the 2026-07-06 version of itself, which was organized around the app-as-assumed rather than the loop. Nothing was dropped in the reframe: the assessment, the refinements, the team paths record, and the future framework all carry forward.
