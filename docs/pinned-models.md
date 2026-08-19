# Pinned models (exact model IDs)

Status: shipped

Date: 2026-08-18

## The problem

Every model picker in the app is catalog-backed. The catalog comes from three
places, and none of them can name a model the user wants but the app has not
seen yet:

- Claude ships as **tier aliases** on purpose (`opus`, `sonnet`, `haiku`,
  `fable`). The alias means "the best current model of that tier", which is
  right almost always and impossible to override. There was no way to say
  "run `claude-opus-4-8` specifically" while a newer Opus was installed, and no
  way to use a build the day it lands.
- Codex discovery reads `codex debug models`, so it is only as current as the
  installed CLI.
- Cursor and OpenCode have no bundled fallback at all.

A pin is the escape hatch: type an exact provider model id, and it becomes a
first-class model everywhere.

## Model

One concept, `customModels`, stored per provider on `agent_harness_settings`:

```ts
customModels: text({ mode: 'json' }).$type<string[]>().notNull().default([])
```

Two invariants make everything else fall out:

1. **A pin is always enabled.** `addCustomHarnessModel` writes the id into
   `customModels` and `enabledModels` in one transaction. A pin that is not
   visible in the picker is indistinguishable from one that never saved.
2. **A pin is a catalog member.** `getAgentModelCatalog` merges
   `customModelCatalog(providerId)` alongside discovered and bundled models, so
   every validator that already asks "is this model real?" accepts it with no
   per-caller exemption:

   | Gate | File |
   | --- | --- |
   | Session model change | `src/app/api/sessions/[id]/route.ts` |
   | New chat / launcher / triggers | `resolveAgentSelection` in `src/lib/agent-model-discovery.ts` |
   | Allowlist save | `src/app/api/agent/models/enabled/route.ts` |
   | Provider-boundary preflight | `dispatch` in `src/lib/executor/adapter.ts` |

The catalog read is live (a plain settings read), not routed through the
15-minute discovery cache, so a pin is usable on the next read rather than
after a TTL.

### Ordering

Pins are appended **last** in the catalog and rendered **first** in the list.
Catalog order matters because `explicitModelForProvider` falls back to
`catalog[0]` for an unresolvable id, and that fallback should stay the
provider's flagship. List order is a separate, human question: an exact pin is
the one row the user typed, so it outranks the alias it was created to bypass.

### Labels

`customModelOption` labels a pin with `prettifyModelId`, so `claude-opus-4-8`
reads as "Opus 4.8" on the composer chip while the raw id stays visible on the
row beneath it. Nothing to prettify falls back to the id itself.

### Validation

`normalizeCustomModelId` trims and accepts `^[A-Za-z0-9][A-Za-z0-9._:@/+-]*$`
up to 160 characters, which covers every shape providers publish
(`claude-haiku-4-5-20251001`, `anthropic/claude-opus-4-8`, `qwen3:32b`).
Anything with whitespace or shell punctuation is a paste accident and is
rejected at the input rather than at the provider boundary. There is no
reachability check: the point of a pin is to name a model this app cannot see
yet, so the provider is the only authority on whether it resolves, and it says
so on the first send.

## Surfaces

| Where | What it gets |
| --- | --- |
| Composer model menu | Pins at the top of their provider group, an inline pin input inside the expandable drawer |
| Launcher model control | Same, via `ModelList` |
| Settings default picker | Same, via `ModelList` |
| Settings → Models | Pin input under the model search, unpin control on pinned rows |
| Trigger model pill | Lists the provider's visible models plus pins, and pins from the same input |
| Onboarding | Pins appear in the catalog grid |

`ModelList` (`src/components/settings/model-list.tsx`) is the shared list, so
the first three come from one implementation. `PinModelInput`
(`src/components/settings/pin-model-input.tsx`) is the shared input.

Saving also selects: typing a model id is already an unambiguous statement of
which model you want, so a successful pin closes the drawer and picks the model
for the current session (or sets it as the settings default, depending on the
host).

## Clearing a pin

`removeCustomHarnessModel` drops the id from `customModels` **and**
`enabledModels`. Unlike a catalog model, a pin has no entry to fall back to, so
leaving it enabled would keep offering a row that resolves to nothing.

If the pin was the harness default, the default moves to the first remaining
enabled model and `defaultVariant` / `defaultEffort` reset (they belonged to
the model that left). The active harness may not be emptied, matching the rule
`setEnabledHarnessModels` already enforces.

The UI closes the loop for the current session: unpinning the model a session
is using hands that session to the next available model rather than leaving it
pointed at an id that no longer exists.

Sessions **other** than the current one keep the removed id and fail at their
next send with `Model <id> is unavailable`. This is the existing behavior for
any model that leaves the catalog, and it is loud rather than silent. Paths
that inherit a tuple rather than being handed one (`new-chat`,
`orchestrator-chat`, the launcher) pass `repairInvalidModel`, so they fall back
to the harness default instead of failing.

## API

```
POST   /api/agent/models/custom          { harness, modelId } -> { settings, model }
DELETE /api/agent/models/custom?harness=<id>&modelId=<id>     -> { settings }
GET    /api/agent/models?provider=<id>   -> { ..., customModelIds, models[].custom }
```

## Tests

- `src/lib/agent-options.test.ts` — id normalization, pin option shape, resolution through a merged catalog
- `src/lib/db/queries.harness-settings.test.ts` — pin/unpin invariants, default repair, survival across an ordinary model save
- `src/lib/agent-model-discovery.custom.test.ts` — pins reach the validation catalog and read live
