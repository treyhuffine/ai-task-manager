# @agentex/agent — feedback from building Flow's async agents

> **Status.** Implementation feedback after wiring scheduled agent runs against
> `@agentex/agent` 0.0.17. Lists the capabilities Flow had to build above the
> SDK because the existing surface didn't cover them, with proposed upstream
> shapes that would let us delete that scaffolding.
>
> **Audience.** The `@agentex/agent` maintainers, or anyone evaluating where
> the natural seam between an SDK consumer and the SDK itself should sit for
> the multi-turn / scheduled-agent use case.

---

## TL;DR

`@agentex/agent` is great at the **interactive co-pilot** shape — open a
session, send a turn, stream events, close. Flow's V1 substrate
(`docs/async-agents-v1.md`) put it under load in a different shape:
**fire-and-forget scheduled runs**, where the SDK consumer needs to:

- bound runtime per turn (cron firing every minute can't run a 6-hour turn)
- attribute cost / artifacts to the right run when subagents fan out
- correlate `tool_result` events back to their tool name without bookkeeping
- distinguish a hung agent from a working one without heuristics

We made it work entirely with consumer-side scaffolding (see Flow's
`src/lib/runs/dispatch.ts`, `event-hooks.ts`, `pricing/models.ts`). This doc
lists the seams that are clearly on the wrong side of the SDK boundary.

Five proposals, ordered by impact:

| #  | Proposal                                                 | Today's workaround                            | Effort upstream     |
|----|----------------------------------------------------------|-----------------------------------------------|---------------------|
| 1  | Per-turn timeout on `AgentSession.send()`                | `Promise.race` + `interrupt()` in consumer    | Small (port `exec`) |
| 2  | `tool_result` events carry `toolName`                    | Consumer-side toolCallId → toolName cache     | Small (data-only)   |
| 3  | Subagent attribution on stream events + TurnResult       | Consumer treats subagents as parent's cost    | Medium              |
| 4  | Normalized cost across providers                         | Consumer-side `pricingFor` table              | Medium              |
| 5  | `drain()` lifecycle and configurable close grace         | Consumer can't gracefully stop a running session | Small            |

The first two are the most valuable and the cheapest — both are tens of lines
of plumbing of existing data.

---

## 1. Motivation: what we built and where the seam broke

Flow's scheduler dispatches into agentex sessions every time a cron / webhook
fires. The dispatch path (`src/lib/runs/dispatch.ts`) needs to:

1. Spawn an `AgentSession` (or reuse the worktree's existing one)
2. Call `send(prompt)` with a **timeout** — schedules carry a
   `timeoutSeconds` field
3. Stream events through a result-event handler that attributes
   **cost**, **artifact refs**, and **summary** to the firing run row
4. Mark the run terminal when the turn completes (or times out, or
   crashes)

Of those four steps, only steps 1 and 4 work cleanly against agentex's
current surface. Steps 2 and 3 required building plumbing that should
properly live below our consumer:

- We implemented `runWithTimeout` (`src/lib/runs/dispatch.ts`) as a
  `Promise.race(send(), setTimeout(...))` pair, calling `agentSession.interrupt()`
  on fire. This duplicates logic the SDK already has in `providers/*/execute.js`.
- We maintain a `toolCallId → toolName` cache (`src/lib/runs/event-hooks.ts`)
  to attribute mutating tool successes to the run's artifact bucket. The
  data exists upstream; the SDK just doesn't surface it on `tool_result`.
- We sum cost across multiple `result` events because subagents fire their
  own results into the same stream. There's no marker to say "this result
  is from a sub-agent of run X."
- We ship a `pricingFor` table (`src/lib/pricing/models.ts`) to compute
  cost when the provider doesn't supply `costUsd`. Every agentex consumer
  has to do this.

The rest of this doc proposes what each of those would look like as an
agentex feature, with backward-compat notes for existing consumers.

---

## 2. Per-turn timeout on `AgentSession.send()`

### The gap

`ProviderConfig.timeoutSec` exists and is honored by every provider's
single-shot `exec()` path:

```
providers/claude/execute.js:126:    timeoutSec: config.timeoutSec,
providers/codex/execute.js:168:     timeoutSec: config.timeoutSec,
providers/openclaw/execute.js:29:   if (config.timeoutSec && config.timeoutSec > 0) {
    ...
```

But `AgentSession.send()` ignores it. The only `setTimeout` in
`providers/claude/session.js` is the 5-second SIGTERM→SIGKILL grace in
`close()`. So a session-based consumer who passes `timeoutSec` in
`ProviderConfig` gets silent zero-effect behavior — the value is read by
nothing.

`TurnResult.status` reflects this asymmetry:

```ts
// Single-shot exec — can report timeout:
export type ExecutionStatus = "completed" | "failed" | "aborted" | "timeout" | "blocked";

// Session-based send — cannot:
status: "completed" | "failed" | "max_turns" | "max_budget" | "aborted";
```

### Proposed shape

Two options, not mutually exclusive:

**A. Per-send timeout (recommended)**

```ts
interface SendOptions {
  /** Hard cap on this send's runtime. On fire, the SDK interrupts the
   *  underlying agent and resolves `result` with status='timeout'. */
  timeoutSec?: number;
  /** Optional AbortSignal — fires `result` with status='aborted' when
   *  triggered. Stackable with timeoutSec; whichever lands first wins. */
  signal?: AbortSignal;
}

interface AgentSession {
  send(message: string, options?: SendOptions): Promise<SendHandle>;
}

// And matching expansion:
type TurnResult = {
  status: "completed" | "failed" | "max_turns" | "max_budget" | "aborted" | "timeout";
  // ...
}
```

Per-send is the right granularity for our shape: Flow's `timeoutSeconds`
lives on the schedule row, varies per fire, and is naturally a `send`
parameter. Carrying it via `ProviderConfig` at session-create time would
force us to recycle the session every time the schedule's timeout
changes — and a reused session (the V1 "fresh chat, same worktree"
pattern) shouldn't have to rebuild for that.

**B. Session-level default fallback**

`ProviderConfig.timeoutSec` becomes the default applied when
`SendOptions.timeoutSec` is unset. Cheap, additive. Useful for consumers
who set one global timeout per session.

### Backward compatibility

- `SendOptions` is optional — existing callers work unchanged.
- `TurnResult.status` adding `"timeout"` is a discriminated-union
  expansion; consumers narrowing on the literal set get a typecheck
  warning, which is the right outcome — they should handle the new
  case.
- `ProviderConfig.timeoutSec` semantics for `exec()` unchanged; only
  meaning gains a fallback role for `send()`.

### What lands when this ships

Flow deletes `runWithTimeout` and `RunTimeoutError` from
`src/lib/runs/dispatch.ts` (~60 lines). `finalizeRunFailure`'s switch
on `RunTimeoutError` collapses into the SDK's `TurnResult.status` —
`status==='timeout'` → `errorCode: 'timeout'`. The interrupt-then-race
plumbing goes away.

---

## 3. `tool_result` events carry `toolName`

### The gap

`tool_call` events carry `name`:

```ts
| {
    type: "tool_call";
    toolCallId: string | null;
    name: string;
    input: unknown;
  }
```

`tool_result` events carry only the `toolCallId`:

```ts
| {
    type: "tool_result";
    toolCallId: string | null;
    content: string;
    isError: boolean;
    exitCode: number | null;
  }
```

This forces every consumer that wants to attribute a tool result to a
named action to maintain its own `toolCallId → toolName` cache. Flow does
this in `src/lib/runs/event-hooks.ts` (`registerToolCallName` +
`consumeToolCallName`). The data exists at the SDK boundary; we just
re-derive it post-hoc.

### Proposed shape

```ts
| {
    type: "tool_result";
    toolCallId: string | null;
    /** Name of the tool whose result this is. Mirrors the matching
     *  tool_call's `name`. Optional only because providers that don't
     *  emit a paired tool_call (rare) might not have it. */
    toolName: string | null;
    content: string;
    isError: boolean;
    exitCode: number | null;
  }
```

Trivial change — the SDK already correlates `toolCallId` internally to
produce the matched result. Carrying the name through is a string copy.

### Backward compatibility

New optional field — fully additive. Existing consumers ignore it.

### What lands when this ships

Flow deletes `registerToolCallName` / `consumeToolCallName` and the
module-level `toolCallNames` Map. `handleToolResult` reads `event.toolName`
directly. ~30 lines of bookkeeping vanish.

---

## 4. Subagent attribution on stream events + TurnResult

### The gap

When Claude (or Codex) spawns a subagent via the Agent tool, the
subagent's `assistant` / `tool_call` / `tool_result` / `result` events
arrive on the **same `onEvent` stream as the parent**, with no marker
to say "this event is from the subagent." Consumers see:

- Multiple `result` events per parent turn — one per subagent
- Tool calls that the parent didn't directly issue
- Token usage that doesn't add up to the parent's reported total
  (subagents have their own usage)

Flow's `handleResultEvent` sums all result events into the run's
`costUsd` / token counts. That's pragmatically correct for V1 — we
want total spend per run regardless of which agent burned it — but it
forces consumers to choose: sum blindly (lose attribution) or invent
their own tagging (we did this for artifacts via the in-flight tool-call
cache, but it's brittle).

`StreamEvent` already has `agentId` on `UserInputRequest`:

```ts
interface UserInputRequest {
  toolName: string;
  // ...
  /** ID of the sub-agent making the request, if any. */
  agentId?: string;
}
```

The same hint should be plumbed through `StreamEvent`'s
`BaseStreamEventFields`.

### Proposed shape

```ts
interface BaseStreamEventFields {
  // ... existing fields
  /**
   * When the parent agent spawns a subagent (e.g. Claude's Agent
   * tool), all events the subagent emits carry the subagent's id
   * here. Parent's own events carry null (or the parent's own id,
   * if the SDK chooses to make this symmetric).
   *
   * For accounting: consumers can attribute cost / tools / artifacts
   * to the originating agent, or sum across by ignoring this field.
   * For UX: surfaces "this tool call was issued by sub-agent X" in
   * the transcript.
   */
  agentId: string | null;
}
```

And in `TurnResult`:

```ts
interface TurnResult {
  // ... existing fields
  /**
   * Per-agent usage rollup keyed by agentId (null = parent). Sums
   * across keys = the run's total. Allows consumers to chart "the
   * planner cost X, the executor cost Y" without re-summing the
   * event stream.
   */
  usageByAgent?: Record<string, TokenUsage>;
}
```

### Backward compatibility

`agentId: string | null` is additive but changes the type from optional
to required. To stay strictly additive, ship as `agentId?: string` first;
the V1 type narrowing is a smaller change to existing callsites.

`usageByAgent` is purely additive.

### What lands when this ships

Flow's run-artifact accumulator (`src/lib/runs/artifact-bucket.ts`)
gains an "attribute this artifact to subagent X" path that's currently
impossible to implement correctly. We can also surface in the runs view
"the cost breakdown by subagent" without re-deriving from raw events.

---

## 5. Normalized cost across providers

### The gap

`TurnResult.costUsd` is provider-dependent:

- Anthropic: supplies `costUsd` natively in the result event.
- Codex: doesn't supply `costUsd` — only token counts.
- Future providers: unknown.

Every consumer that wants accurate cost has to:

1. Ship a per-model pricing table (Flow's `src/lib/pricing/models.json`)
2. Compute cost from token counts when the SDK reports null
3. Update the table when providers publish new prices
4. Strip versioned model ids (`claude-opus-4-7-20260415` → `claude-opus-4-7`)
   to match the pricing table

That's a lot of fragmented duplication. The SDK already knows which
provider and which model; centralizing the pricing table is a natural fit.

### Proposed shape

```ts
// In @agentex/agent
export interface ModelPricing {
  /** Cents per million tokens for fresh (uncached) input. */
  input: number;
  /** Cents per million tokens for cached input reads. */
  cached: number;
  /** Cents per million tokens for writing into the cache. */
  cacheCreation: number;
  /** Cents per million tokens for output. */
  output: number;
}

/** Lookup a model's per-million-token price. Tolerates bare model
 *  names ("claude-sonnet-4-6"), canonical provider-prefixed names,
 *  and Anthropic-style versioned ids ("claude-opus-4-7-20260415"). */
export function pricingFor(model: string): ModelPricing | null;

/** Compute USD cost from a usage shape. Returns null for unknown
 *  models (consumer chooses to ignore or fall back). */
export function costForUsage(model: string, usage: TokenUsage): number | null;
```

And then `TurnResult.costUsd` becomes: provider's reported value, else
`costForUsage(model, usage)`, else null. Consumer reads a single field
regardless of provider.

### Backward compatibility

Net new exports — purely additive.

`TurnResult.costUsd` semantics: today it's "what the provider reported,
or null." If the SDK starts falling back to the pricing table for
non-reporting providers, that's a behavior change — but it's the
behavior every consumer is hand-rolling anyway. Document as a 0.0.18
release note.

### What lands when this ships

Flow's `src/lib/pricing/models.{ts,json,test.ts}` (~150 LOC) collapses
to a call into `costForUsage`. The pricing table — the part that's
actively maintained as providers publish prices — moves to the right
shared layer.

---

## 6. `drain()` lifecycle and configurable close grace

### The gap

`AgentSession` has two stop semantics:

- `interrupt()` — graceful mid-turn, send a control request
- `close()` — kill the session, SIGTERM then SIGKILL after 5s hardcoded

Missing: **"finish the current turn, refuse new sends, then close."** That's
the natural shape for:

- **Budget gates**: when monthly spend crosses 100%, drain all sessions
  cleanly without killing in-flight tools
- **Graceful shutdown** in `instrumentation.ts`: let SIGTERM finish what's
  in flight before closing
- **Schedule pause**: pause means "no new fires," but a running fire
  should complete

Flow currently implements no drain — we either `interrupt()` (loses
in-flight work) or `close()` (kills mid-tool). Both are wrong for the
"budget exceeded, finish what's running" case.

Also: the hardcoded 5s SIGTERM grace in `providers/claude/session.js:321`
isn't enough for sessions running a long tool (test suite, long Bash, etc).
We've seen 30s+ tool executions. Should be configurable.

### Proposed shape

```ts
interface AgentSession {
  /**
   * Refuse new `send()` calls (they throw `ExecutorError('draining')`),
   * await any in-flight turn's `result` to settle, then `close()`.
   *
   * Returns once the session is fully closed. Idempotent — second call
   * is a no-op.
   */
  drain(): Promise<void>;
}

interface ProviderConfig {
  // ... existing fields
  /** SIGTERM → SIGKILL grace seconds in close(). Default 5. Bump for
   *  workloads that legitimately need longer to clean up. */
  graceSec?: number;
}
```

### Backward compatibility

`drain` and `graceSec` are additive. Existing `close()` semantics unchanged.

### What lands when this ships

Flow can implement budget-driven pause that actually does the right thing
(`drain` instead of `interrupt` for in-flight runs at the budget threshold).
`instrumentation.ts`'s SIGTERM hook can `drain` rather than the current
"do nothing for sessions" behavior.

---

## 7. Things we considered and don't think need SDK changes

For honesty: not every gap should move upstream.

- **Skill discovery for our paths** (`<brain>/skills/`, `<workspace>/.flow/skills/`)
  — Flow's own conventions. agentex's `listInstalledSkills` reads what the
  CLI installed. Our resolver in `src/lib/executor/skills.ts` translates
  Flow's paths into the `skillDirs` config option the SDK already accepts.
  That's the right seam — agentex provides the place to pass paths, we
  decide what to put there.

- **Health check for stuck sessions** — Flow has
  `src/lib/executor/health.ts` reconciling session state from the on-disk
  JSONL transcript. That's app-specific (our state is in our DB; the SDK
  is stateless). Stays in the consumer.

- **Realtime SSE to the browser** — entirely Flow's surface; agentex
  shouldn't know about HTTP.

---

## 8. Migration notes for existing consumers

If `@agentex/agent` adopts these:

- **Per-send timeout (proposal #1)**: existing callers unaffected;
  consumers opt in by passing `SendOptions`. `TurnResult.status` adding
  `"timeout"` is a typed-union expansion — TypeScript flags missing case
  handlers. Document the upgrade as a breaking-narrowing change.
- **tool_result.toolName (proposal #2)**: purely additive.
- **Subagent attribution (proposal #3)**: `agentId` ships optional first;
  `usageByAgent` purely additive. No-op upgrade for consumers who don't
  care.
- **Cost normalization (proposal #4)**: `costForUsage` / `pricingFor`
  ship as net-new exports. Behavior change is that `TurnResult.costUsd`
  may be populated for previously-null providers — document as a 0.x
  release note.
- **drain() + graceSec (proposal #5)**: purely additive.

None of these require a major-version bump in semver terms. Each could
land independently as a 0.0.x release.

---

## 9. Priority recommendation

If we had to pick one: **proposal #1 (per-send timeout)**.

The current state — `timeoutSec` exists, is honored by half the SDK,
silently ignored by the other half — is the worst-of-all-worlds. Either
remove it from `ProviderConfig` to be honest, or wire it through to
`send()`. The "wire it through" version makes Flow's scheduled-run
substrate dramatically simpler and brings the type story in line with
the implementation.

Proposals #2 and #5 are the cheapest follow-ups — both are tens of
lines of data-flow work upstream.

Proposals #3 and #4 are larger, but they're the ones that meaningfully
reduce SDK fragmentation across consumers. As soon as a second
agentex consumer beyond Flow needs cost attribution or subagent
accounting, they'll hand-roll the same thing we did — that's the
signal it belongs in the SDK.

---

## Appendix A: the consumer-side scaffolding we'd remove

For each proposal, the consumer code that becomes obsolete:

| Proposal | Files / lines that go away                                     |
|----------|----------------------------------------------------------------|
| #1       | `src/lib/runs/dispatch.ts:runWithTimeout` + `RunTimeoutError`  |
| #2       | `src/lib/runs/event-hooks.ts:toolCallNames` + register/consume |
| #3       | The "subagent costs land on parent" comment in dispatch.ts; replaced with proper attribution |
| #4       | `src/lib/pricing/models.ts` + `models.json` + `models.test.ts` |
| #5       | `src/lib/scheduler/runner.ts` shutdown hook → SDK-side drain   |

Total: ~250 LOC of plumbing that's currently in our repo because it
can't be anywhere else.

---

## Appendix B: testing

Each proposal is independently testable in agentex's existing test layout:

- **#1**: extend `providers/*/test.js` with a slow-prompt + timeout
  assertion, mirroring the exec-side timeout tests. Verify
  `TurnResult.status === 'timeout'` and `interrupt()` was sent.
- **#2**: assertion on emitted `tool_result.toolName` matching the
  prior `tool_call.name`.
- **#3**: spawn a subagent in a test, assert events carry the subagent's
  `agentId` and `TurnResult.usageByAgent` keys it.
- **#4**: unit tests for `pricingFor` model-id normalization (canonical
  / bare / versioned) and `costForUsage` math against a known table.
  Flow's `src/lib/pricing/models.test.ts` is a working starting point.
- **#5**: assert `drain()` rejects new `send()` calls and waits for
  in-flight ones; assert `graceSec` overrides the 5s default.

---

## One-line version

> **Push the per-turn timeout, tool name on `tool_result`, subagent
> attribution, normalized cost, and `drain()` into the SDK so every
> consumer doesn't reinvent them. The first two are tens of lines of
> data-flow plumbing; the rest reduce real fragmentation across
> consumers.**
