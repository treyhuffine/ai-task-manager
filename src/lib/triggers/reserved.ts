/**
 * Hardcoded sentinel ids for app-managed ("reserved") triggers.
 *
 * All-zeros namespace, one index per managed row. The app creates and looks
 * these rows up BY ID (never by name), so a user renaming the row in the
 * generic Triggers UI can never orphan it. The generic trigger edit surface
 * special-cases them: identity/behavior fields locked, delete blocked
 * (disable instead). A constant primary key also makes seeding idempotent
 * across synced devices (two machines seed the same row, not two duplicates).
 *
 * Keep this list short. Past a handful of managed triggers, stop enumerating
 * sentinels and introduce a typed `managed_kind` column instead — that is the
 * point where a column stops being a junk drawer and starts being a real
 * discriminator. See docs/deck-morning-trigger-spec.md §12.
 */
export const RESERVED_TRIGGER_IDS = {
  /** Overnight deck pre-bake. Owned by src/lib/deck/trigger.ts. */
  morningDeck: '00000000-0000-0000-0000-000000000001',
} as const;

export type ReservedTriggerId =
  (typeof RESERVED_TRIGGER_IDS)[keyof typeof RESERVED_TRIGGER_IDS];

const RESERVED = new Set<string>(Object.values(RESERVED_TRIGGER_IDS));

/** True when `id` is an app-managed sentinel (locked identity, no delete). */
export function isReservedTrigger(id: string): boolean {
  return RESERVED.has(id);
}

/**
 * Identity/behavior fields the generic trigger edit surface must not change on
 * a reserved row. Schedule fields (enabled, cronExpression, timezone) and
 * delivery fields (deliverResultTo, model, effort, timeoutSeconds) stay
 * user-editable — the row is a normal, visible, inspectable trigger apart from
 * these locks.
 */
export const RESERVED_LOCKED_FIELDS = [
  'name',
  'description',
  'prompt',
  'targetKind',
  'agentId',
  'kind',
] as const;
