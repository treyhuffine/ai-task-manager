# agentex: preserve inner discriminator + content on `unknown` fallback

## TL;DR

The Claude provider's `unknown` fallback in `providers/claude/parse.ts` drops two fields
that the wire event carried: the **inner subtype** and the **`content`** field.
`raw` preserves the full event, but consumers have to reach into it even when
the relevant information is predictable and useful. This is a ~5-line change in
one function: keep those two fields on the emitted `UnknownStreamEvent` as
first-class properties. No new StreamEvent variants, no API churn, no breaking
changes.

## The problem, concretely

Claude Code emits several `type: "system"` events with meaningful subtypes:
`init`, `away_summary` (idle-timer recap), `compact_boundary`, `api_error`,
`turn_duration`, `local_command`, `informational`, `bridge_status`. Of these,
only `init` is special-cased in `parseStreamLine`. Everything else falls into
the forward-compat fallback at [parse.ts:366](#) and emerges as:

```ts
{
  type: "unknown",
  subtype: "system",    // note: the *outer* type, not the inner subtype
  raw: <full event>,
  ...baseFields,
}
```

The label `"away_summary"` only lives inside `raw.subtype`. The summary text
lives inside `raw.content`. Both are recoverable, but every consumer that cares
writes the same "reach into raw" boilerplate.

**Evidence this matters in practice:**

- JSONL transcripts of interactive Claude Code sessions contain **210 `away_summary` entries** across one user's project history (3-minute idle recap timer writes them to disk while the session is alive). Applications syncing externally-imported Claude sessions encounter these routinely.
- Similarly: 471 `turn_duration`, 20 `api_error`, 8 `compact_boundary` entries in the same dataset.
- `sdk-cli` (agentex-spawned `--print` mode) sessions don't emit these on the stream-json wire *today* — but we've verified the wire format can carry arbitrary `type: "system", subtype: "..."` events (that's how `init` arrives). If Claude Code ever widens what it emits in `--print` mode, all these events start flowing through the wire with no upstream library release needed.

In both cases, the fix is the same: stop dropping the discriminator.

## Proposed change

### 1. `providers/claude/parse.ts`

In the `unknown` fallback (currently at ~line 366), preserve two additional
fields from the wire event:

```ts
// Forward-compat: surface any unrecognized event type with full base fields
// + preserved discriminator + content + raw.
return [{
  type: "unknown",
  subtype: type,                                       // outer type (unchanged)
  innerSubtype: asNullableString(event["subtype"]),    // NEW — inner discriminator
  content: asNullableString(event["content"]),         // NEW — payload when present
  ...baseFieldsFromEvent(event, null),                 // raw already included here
}];
```

### 2. `types.ts` — extend `UnknownStreamEvent`

```ts
export interface UnknownStreamEvent extends BaseStreamEventFields {
  type: "unknown";
  subtype: string;             // outer wire type (existing)
  innerSubtype: string | null; // NEW
  content: string | null;      // NEW
}
```

That's the whole change.

## Why this shape (design principle)

> Agentex normalizes concepts that are universal across providers; for
> provider-specific events it has no universal meaning for, it passes them
> through with enough context that consumers can handle them themselves.

Adding a narrow-typed `SystemAwaySummaryEvent` / `SystemCompactBoundaryEvent` /
etc. would tie agentex releases to upstream CLI evolution — every new Claude
Code subtype becomes a library PR. An enriched `unknown` sidesteps that:
consumers who care dispatch on `event.innerSubtype`; consumers who don't are
unaffected. The fix is additive, not prescriptive.

## Impact analysis

**Non-breaking.** The change only adds two fields to `UnknownStreamEvent`. It
doesn't alter any other event type, doesn't change when `unknown` is emitted
vs. something more specific, and doesn't change what lands in `raw`.

**Dead-code-safe.** If a Claude subtype never arrives on the wire, the new
fields are `null` on every unknown event emitted (which is already most of
them). Zero runtime cost.

**Ergonomic.** Consumers that currently do:

```ts
if (event.type === "unknown" && event.raw?.type === "system" && event.raw?.subtype === "away_summary") {
  const text = event.raw.content;
  // ...
}
```

can do:

```ts
if (event.type === "unknown" && event.subtype === "system" && event.innerSubtype === "away_summary") {
  const text = event.content;
  // ...
}
```

## Scope

**This fix: Claude provider only.** That's where we have evidence of
information loss in real usage.

**Follow-up (not part of this issue):** audit `providers/codex/parse.ts` for
the same pattern — any wire event that lands in an `unknown` fallback while
carrying a discriminator + payload should get the same treatment. If the
Codex parser has that gap, it's worth applying the same change there. I
haven't audited it; flagging for the maintainer.

**Out of scope:** inventing new typed StreamEvent variants for specific
subtypes. If a particular subtype proves to need structured first-class
handling later (e.g. `compact_boundary`'s `compactMetadata`), that's a
separate narrow-typed addition on top of this fix, not instead of it.

## Minimal test additions

Under `providers/claude/__tests__/` or wherever parse tests live:

1. Feed a `{type: "system", subtype: "away_summary", content: "..."}` wire
   event to `parseStreamLine`; assert the emitted event has
   `type: "unknown", subtype: "system", innerSubtype: "away_summary", content: "..."`.
2. Feed a `{type: "system", subtype: "init", model: "claude-...", ...}` wire
   event; assert the existing narrow-typed `SystemInitEvent` still emits
   correctly (regression guard).
3. Feed an event with no `subtype` or no `content`; assert the new fields are
   `null` rather than empty-string or undefined.
