# Morning Deck Refresh — Reserved-Id Trigger Spec

Status: proposed
Owner: Trey
Reworks the ad-hoc morning-cron wiring in `src/lib/deck/trigger.ts`.
Related: `docs/deck-proactive-spec.md` (§Trigger model, "cron is never load-bearing"), `docs/executions-spec.md`.

## 1. Context

The daily deck is guaranteed two ways:

1. **Lazy first-look (load-bearing).** `GET /api/deck` → `ensureTodaysDeck()` (`src/lib/deck/ensure-todays-deck.ts:32`) generates today's deck on the first read of the local day. No scheduler required. This is the guarantee and does not change here.
2. **Optional overnight pre-bake.** `setMorningDeckConfig()` (`src/lib/deck/trigger.ts:77`) upserts a row in `triggers` named `"Morning deck refresh"` (`kind:'cron'`, `targetKind:'orchestrator'`) whose prompt asks the orchestrator to call `regenerate_deck`. The generic scheduler tick (`src/lib/scheduler/runner.ts`) fires it.

Path 2 has two structural problems and one product gap.

### 1.1 Problems

- **Fragile linkage (correctness bug).** The deck config surface finds its row **by name**: `findTriggerByName(MORNING_DECK_TRIGGER_NAME, null)` (`src/lib/deck/trigger.ts:64`). The same row is fully editable in the generic Triggers UI (`/api/triggers` → orchestrator `list_triggers`, no name filter, `src/lib/orchestrator/registry.ts:951`). **Rename it there and the deck toggle orphans the row** — the freed name lets the next toggle `createTrigger` a *second* `"Morning deck refresh"`. Two sources of truth joined by a mutable string.
- **Two editors, no guardrails.** The friendly deck pane (`/api/deck/trigger`, `{enabled, time}`) and the raw generic Triggers UI both write the same row. A user can rewrite the prompt, flip `targetKind`, or change `kind` in the generic UI and silently break the refresh contract (`regenerate_deck` assumes an orchestrator target + that specific prompt).
- **On-by-default gap.** The row is opt-in / default off. Product intent is for the morning refresh to exist by default while staying **visible and controllable**, not hidden app magic.

### 1.2 What we are NOT building

An earlier draft added a generic `source` provenance column to power a reusable "managed trigger" primitive. Rejected: one consumer does not justify a framework, and a free-text provenance column is a junk drawer (no enforced values, no crisp "when do I populate this"). We hardcode the single case instead and revisit only if managed triggers proliferate (§12 tripwire).

## 2. Approach — a reserved-id singleton

The morning-deck trigger is one hardcoded row with a **well-known sentinel id**. The app creates and looks it up **by id, never by name**. That immutable handle is the whole fix: a rename can no longer orphan it, and the duplicate-row bug is gone by construction. The generic trigger edit surface special-cases that id (locked identity fields, no delete); everything else about the row stays a normal, visible, user-inspectable trigger.

No schema change. No migration SQL. The mechanism is a constant plus special-casing at three call sites.

## 3. Reserved-id registry (new file)

`src/lib/triggers/reserved.ts`:

```ts
/**
 * Hardcoded sentinel ids for app-managed triggers. All-zeros namespace,
 * one index per managed row. The app creates/looks these up BY ID (never by
 * name), and the generic trigger edit surface special-cases them: identity
 * fields locked, delete blocked. Keep this list short — past a handful,
 * revisit a typed `managed_kind` column instead of enumerating sentinels.
 */
export const RESERVED_TRIGGER_IDS = {
  morningDeck: '00000000-0000-0000-0000-000000000001',
} as const;

const RESERVED = new Set<string>(Object.values(RESERVED_TRIGGER_IDS));
export function isReservedTrigger(id: string): boolean {
  return RESERVED.has(id);
}

/** Identity/behavior fields the generic edit surface must not touch on a reserved row. */
export const RESERVED_LOCKED_FIELDS = [
  'name', 'description', 'prompt', 'targetKind', 'agentId', 'kind',
] as const;
```

- Sentinel is `...001`, not the nil UUID `...000`, so it never collides with an "empty id" check.
- Valid `8-4-4-4-12` hex, so ids stay type-uniform with the uuidv7 rows around it. `createTrigger` already accepts a caller id (`input.id ?? uuidv7()`, `queries.ts:2726`); no validation rejects a sentinel.
- Neutral location so the orchestrator registry imports a constant, not deck internals.

## 4. Deck trigger module (`src/lib/deck/trigger.ts`)

- `getMorningDeckTrigger()` → `getTrigger(RESERVED_TRIGGER_IDS.morningDeck)` instead of `findTriggerByName(...)`.
- `setMorningDeckConfig()` `createTrigger(...)` passes `id: RESERVED_TRIGGER_IDS.morningDeck`. `MORNING_DECK_TRIGGER_NAME` stays as the **display name only** — nothing keys off it anymore.
- New idempotent seed + legacy adoption, called once per server process:

```ts
/**
 * Ensure the reserved morning-deck row exists. Create-if-absent only — never
 * flips `enabled` on an existing row, so a user's disable survives reboots.
 * Adopts a pre-fix name-linked row once (copies its settings, drops the stray).
 */
export function ensureMorningDeckTrigger(): void {
  if (getTrigger(RESERVED_TRIGGER_IDS.morningDeck)) return;

  // One-time adoption of the legacy name-linked row (pre reserved-id).
  const legacy = findTriggerByName(MORNING_DECK_TRIGGER_NAME, null);
  if (legacy) {
    setMorningDeckConfig({ enabled: legacy.enabled, time: cronToTime(legacy.cronExpression) });
    deleteTrigger(legacy.id); // runs referencing it get triggerId=NULL; history survives
    return;
  }
  setMorningDeckConfig({ enabled: DEFAULT_MORNING_ENABLED, time: DEFAULT_TIME });
}
```

`DEFAULT_MORNING_ENABLED` is the single knob for the on-by-default decision (§9). Wire `ensureMorningDeckTrigger()` into `instrumentation.ts` next to `startScheduler()` (~line 185).

## 5. Edit guardrails (`src/lib/orchestrator/registry.ts`)

The generic Triggers UI routes through orchestrator actions (`/api/triggers/[id]` → `update_trigger` / `delete_trigger`, `remote:false`). Enforce there so CLI + HTTP both get it:

- **`update_trigger`**: if `isReservedTrigger(id)` and the patch touches any `RESERVED_LOCKED_FIELDS` key → `ActionError('conflict', 'This trigger is managed by the app. You can change its schedule and delivery, but not its name, prompt, or target.')`. Schedule (`enabled`, `cronExpression`, `timezone`) and delivery (`deliverResultTo`, `model`, `effort`, `timeoutSeconds`) edits pass through.
- **`delete_trigger`**: if `isReservedTrigger(id)` → `ActionError('conflict', 'This trigger is managed. Disable it instead.')`. Reserved rows are disabled, never deleted, so `ensureMorningDeckTrigger` never re-seeds over a user's off state.
- **`create_trigger`**: reject a caller-supplied `id` in `RESERVED_TRIGGER_IDS` → `ActionError('invalid_params', 'That id is reserved for an app-managed trigger')`.

Internal callers (`setMorningDeckConfig`, `ensureMorningDeckTrigger`) hit raw `createTrigger`/`updateTrigger`/`deleteTrigger` and bypass these action guards by design.

`getTrigger`/`deleteTrigger`/`findTriggerByName`/`cronToTime` are already available; no new query-layer functions are required. (`getTrigger` = `queries.ts:2695`, `deleteTrigger` = `queries.ts:2754`.)

## 6. UI

Two surfaces, one row.

**Deck settings control (primary editor).** Toggle + time picker bound to the existing `GET/PUT /api/deck/trigger` (no route change). Lives in the unified settings modal's Deck pane. Copy — no em/long dashes, no hardcoded product/person names:
- Label: "Refresh the deck each morning"
- Sub: "Prepares tomorrow's deck overnight so it's ready before you open the app. Your deck is always generated on first open regardless."
- Time picker enabled only when the toggle is on.

**Generic Triggers list (inspect / advanced).** For rows where `isReservedTrigger(row.id)`:
- "Managed" badge next to the name.
- Detail view (`src/app/triggers/[id]/page.tsx`): `RESERVED_LOCKED_FIELDS` rendered read-only with a hint "Managed by Deck settings" deep-linking to the Deck pane. Schedule + delivery stay editable.
- Hide Delete; show Disable.

This resolves the two-paths concern: the Deck pane is the friendly editor, the Triggers list is the honest inspector, and neither can diverge the row's identity — locks are enforced server-side (§5) and linkage is by id, not name.

## 7. Legacy adoption (existing installs, no SQL)

Existing dev/prod DBs already hold a `"Morning deck refresh"` row with a *generated* uuid. `id` is the primary key (referenced by `runs.triggerId`, `ON DELETE SET NULL`), so we do not mutate it in place — we reseed under the sentinel id and drop the stray, in code, on first boot after the change (`ensureMorningDeckTrigger`, §4):

1. Sentinel-id row present → no-op.
2. Absent but legacy name row present → copy `{enabled, time}` into the sentinel row, `deleteTrigger(legacy.id)`. Runs pointing at the old id get nulled; run history survives (per the `deleteTrigger` FK comment at `queries.ts:2748`).
3. Neither → seed with `DEFAULT_MORNING_ENABLED`.

Idempotent and safe under retry. No column, no `drizzle-kit` migration, no backfill/dedupe/unique-index sequencing.

## 8. Cross-device sync note

`~/flow` is a sync unit and the DB lives under it (`project_data_dir_layout`). Random-uuid seeding on two devices would mint two different rows that duplicate on sync. A **constant** sentinel id makes seeding idempotent across devices — both seed the same primary key, so sync converges to one row (last-write-wins on schedule fields). This is a real reason the reserved-id approach beats both name-linkage and random-uuid seeding.

## 9. On-by-default decision (`DEFAULT_MORNING_ENABLED`)

Recommendation: **`true`**, seeded enabled on first run. Rationale:

- Lazy generation dedupes (`ensureTodaysDeck` checks `getActiveDeckForDate`), so a cron does not double-generate — it **shifts** the work earlier. First look then finds today's deck already present and skips.
- When the host is asleep at cron time, the tick never fires and lazy covers the day. No harm, no double work.
- Reserved-row treatment (§6) means "seeded by default" is not "hidden magic" — it is one clearly-badged, one-click-disable row.

Caveat: on a laptop asleep every night the pre-bake rarely fires; the value is real mainly on always-on hosts. To ship opt-in instead, flip the single constant to `false` — nothing else changes.

## 10. Edge cases

- **Disable in Deck pane, reboot.** `ensureMorningDeckTrigger` is create-if-absent only; disable persists.
- **Edit the cron in the generic UI.** Allowed (schedule is user-owned); the Deck pane's time picker reflects it via `cronToTime`.
- **Try to rename / rewrite prompt / delete in generic UI.** Blocked with a clear `conflict` message; identity stays app-owned.
- **Two dup legacy rows in a dirty dev DB.** `findTriggerByName` returns one (unique index guarantees at most one at brain scope); adoption copies it and deletes it. If a truly dirty DB somehow has two, the second is a plain user-editable row the user can delete.
- **Fresh install, `DEFAULT_MORNING_ENABLED=false`.** Row seeded disabled and visible; the Deck toggle just flips `enabled`.

## 11. Testing

Extend `src/lib/deck/trigger.test.ts`:

- `setMorningDeckConfig` writes the row under `RESERVED_TRIGGER_IDS.morningDeck`; a raw rename of `name` does not orphan it — `getMorningDeckConfig` still resolves it.
- Calling `setMorningDeckConfig` twice never creates a second row (same primary key).
- `ensureMorningDeckTrigger`: no-op when the sentinel row exists; seeds with `DEFAULT_MORNING_ENABLED` when absent; does **not** re-enable a disabled row.
- Legacy adoption: seed a legacy name-linked row with a random id, run `ensureMorningDeckTrigger`, assert settings copied to the sentinel row and the stray deleted.
- `update_trigger` on the reserved id rejects a `prompt`/`targetKind`/`name` change with `conflict`; allows `enabled`/`cronExpression`.
- `delete_trigger` on the reserved id rejects with `conflict`.
- `create_trigger` with a reserved `id` rejects with `invalid_params`.

## 12. Rollout + tripwire

- **Phase 1:** `reserved.ts`, id-based linkage in the deck module, `ensureMorningDeckTrigger` seed + legacy adoption, action guardrails. Ships the correctness fix and default-on. No migration.
- **Phase 2:** UI polish — Managed badge, locked read-only detail fields, Deck settings control, Disable-not-Delete.

Phase 1 is the load-bearing correctness work and ships without Phase 2 (the row is already visible in the existing list; guardrails prevent breakage before the badge exists).

**Tripwire:** the sentinel list is a hardcoded singleton pattern that pays off at N=1. If managed triggers reach ~3 (evening summary, weekly review, etc.), stop enumerating sentinels and introduce a typed `managed_kind` column then — that is the point where a column stops being a junk drawer and starts being a real discriminator.

## 13. Open questions (your call)

1. **`DEFAULT_MORNING_ENABLED`** — `true` (recommended, §9) or `false` (opt-in)?
2. **Generic list visibility** — show the reserved row locked+badged (recommended: transparency), or hide it and expose only via Deck settings?
