/**
 * Pure helpers for placing a task onto the current Deck — the "create a task
 * from the Deck and add it immediately" flow, and the sibling browser / restore
 * adds that share the same membership rules.
 *
 * These live outside the React container on purpose. The invariants that matter
 * for the create-and-add flow — never list the same task twice, and round-trip
 * the client items to the persisted shape without dropping membership or the
 * user/ai provenance — are then unit-testable in the node test env (the app has
 * no jsdom/RTL harness, so container behaviour can't be tested directly).
 */
import type { DeckItem } from '@/types/dashboard';
import type { DeckItem as PersistedDeckItem } from '@/db/types';

/**
 * Append a deck item, refusing to list the same task twice. Returns the same
 * array reference (a no-op) when the task is already on the deck, so a repeated
 * event or a retry after a partial failure can never create a duplicate
 * membership for one task.
 */
export function appendDeckItem(items: DeckItem[], item: DeckItem): DeckItem[] {
  if (items.some((i) => i.taskId === item.taskId)) return items;
  return [...items, item];
}

/**
 * Like {@link appendDeckItem} but places the task at the top of the stack. Used
 * by the redesigned quick-add variants: a task the user just chose to work on
 * belongs where their eye already is (under the composer), ready to start, not
 * buried at the bottom. Same dedupe guarantee.
 */
export function prependDeckItem(items: DeckItem[], item: DeckItem): DeckItem[] {
  if (items.some((i) => i.taskId === item.taskId)) return items;
  return [item, ...items];
}

/**
 * Serialize the client deck items to the persisted `DeckItem[]` shape sent to
 * `PATCH /deck/:id`. The write always carries the full array rather than a
 * delta — that is what preserves the rest of the deck on every save, including
 * a retry. `manuallyAdded` maps to `source: 'user'` so a task the user placed
 * stays attributed to the user (not re-labelled as an AI pick) across reload.
 */
export function toPersistedDeckItems(items: DeckItem[]): PersistedDeckItem[] {
  return items.map((item) => ({
    taskId: item.taskId,
    rationale: item.rationale,
    continuityContext: item.continuityContext ?? null,
    source: item.manuallyAdded ? 'user' : 'ai',
  }));
}
