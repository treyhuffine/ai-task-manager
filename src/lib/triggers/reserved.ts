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
  /** Rolling-debounce stream sweep — the capture path bumps its runAt.
   *  Owned by src/lib/stream-triage/triggers.ts. */
  streamSweepDebounce: '00000000-0000-0000-0000-000000000002',
  /** Morning stream triage, before the deck pre-bake so the deck sees
   *  fresh triage output. Owned by src/lib/stream-triage/triggers.ts. */
  morningStreamSweep: '00000000-0000-0000-0000-000000000003',
  /** Weekly stream meta-digest (acceptance stats + graduation offers).
   *  Owned by src/lib/stream-triage/triggers.ts. */
  weeklyStreamDigest: '00000000-0000-0000-0000-000000000004',
  /** The heartbeat: a regular check-in that works through the user's own
   *  instructions. Owned by src/lib/heartbeat/trigger.ts. */
  heartbeat: '00000000-0000-0000-0000-000000000005',
} as const;

export type ReservedTriggerId =
  (typeof RESERVED_TRIGGER_IDS)[keyof typeof RESERVED_TRIGGER_IDS];

/**
 * Reserved triggers whose result already has a purpose-built review surface,
 * so the chat they produce must never also pile up in the Unread queue.
 *
 * A normal scheduled chat earns its Unread row: the transcript IS how its
 * result reaches the user. These do not. The deck refresh lands in the Deck
 * pane (with its change brief); every stream sweep lands in the stream digest
 * (unseen dot, "Looks right") and the "Needs your call" review sheet. Leaving
 * them in Unread charges the user twice for the same output — once in the
 * surface built to review it, once as a chat they must open and dismiss —
 * which is exactly the maintenance overhead the app exists to remove.
 *
 * Consumed by `listNeedsReviewSessionCandidates`. Anything added here needs a
 * real surface of its own first; silence in Unread is only earned by being
 * reviewable somewhere else.
 *
 * The heartbeat is deliberately absent: Unread IS where its report lands. It
 * earns silence per run instead, by archiving a check-in that had nothing to
 * report (src/lib/heartbeat/quiet.ts).
 */
export const TRIGGERS_WITH_OWN_REVIEW_SURFACE: readonly ReservedTriggerId[] = [
  RESERVED_TRIGGER_IDS.morningDeck,
  RESERVED_TRIGGER_IDS.streamSweepDebounce,
  RESERVED_TRIGGER_IDS.morningStreamSweep,
  RESERVED_TRIGGER_IDS.weeklyStreamDigest,
];

const RESERVED = new Set<string>(Object.values(RESERVED_TRIGGER_IDS));

/** True when `id` is an app-managed sentinel (locked identity, no delete). */
export function isReservedTrigger(id: string): boolean {
  return RESERVED.has(id);
}

/** Trigger fields a reserved row may lock against the generic edit surface. */
export type ReservedLockableField =
  | 'name'
  | 'description'
  | 'prompt'
  | 'targetKind'
  | 'kind'
  | 'concurrencyPolicy'
  | 'catchUpPolicy'
  | 'timeoutSeconds';

/**
 * The app-owned identity of a managed trigger whose prompt is the app's own
 * instruction (deck refresh, stream sweeps). Schedule fields (enabled,
 * cronExpression, timezone) and delivery fields (deliverResultTo, provider,
 * model, effort, timeoutSeconds) stay user-editable, so the row is a normal,
 * visible, inspectable trigger apart from these locks. `provider` is the
 * sanctioned way to change which engine runs a reserved row.
 */
const APP_PROMPT_LOCKS: readonly ReservedLockableField[] = [
  'name',
  'description',
  'prompt',
  'targetKind',
  'kind',
];

/**
 * Per-row locks. The heartbeat is the one managed trigger whose prompt belongs
 * to the user (their instructions), so its prompt stays editable. Instead it
 * locks the behavior that keeps a check-in bounded: never overlapping itself,
 * never replaying missed slots, and a hard time limit
 * (docs/heartbeat-spec.md §4.2).
 */
export const RESERVED_LOCKED_FIELDS: Readonly<Record<ReservedTriggerId, readonly ReservedLockableField[]>> = {
  [RESERVED_TRIGGER_IDS.morningDeck]: APP_PROMPT_LOCKS,
  [RESERVED_TRIGGER_IDS.streamSweepDebounce]: APP_PROMPT_LOCKS,
  [RESERVED_TRIGGER_IDS.morningStreamSweep]: APP_PROMPT_LOCKS,
  [RESERVED_TRIGGER_IDS.weeklyStreamDigest]: APP_PROMPT_LOCKS,
  [RESERVED_TRIGGER_IDS.heartbeat]: [
    'name',
    'description',
    'targetKind',
    'kind',
    'concurrencyPolicy',
    'catchUpPolicy',
    'timeoutSeconds',
  ],
};

/** The fields locked on `id`, or none when it is not an app-managed row. */
export function lockedFieldsFor(id: string): readonly ReservedLockableField[] {
  return isReservedTrigger(id) ? RESERVED_LOCKED_FIELDS[id as ReservedTriggerId] : [];
}
