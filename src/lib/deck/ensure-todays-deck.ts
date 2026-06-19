/**
 * The backbone of the proactive deck: guarantee exactly one active deck for
 * the user's local day, generating (and reconciling yesterday → today) the
 * first time it's needed.
 *
 * This is local-first safe — it needs no scheduler. The lazy `GET /api/deck`
 * call invokes it on first look; a 4AM cron will call it too once the
 * heartbeat lands (Phase 3), passing `origin: 'morning'`.
 */

import type { DeckRecord, DeckOrigin } from '@/db/types';
import type { DeckGenerationContext } from '@/lib/ai/deck-generation';
import { getActiveDeckForDate } from '@/lib/db/queries';
import { todayLocalDate } from '@/lib/deck/date';

// In-process dedupe: two concurrent first-looks on the same day must generate
// exactly one deck, not race two expensive pipeline runs. Keyed by local date.
const inFlight = new Map<string, Promise<DeckRecord>>();

export interface EnsureTodaysDeckOpts {
  /** What to record as the trigger. Defaults to 'first_open' (lazy path). */
  origin?: DeckOrigin;
  /** Optional steer for the generation (energy, time, focus). */
  context?: DeckGenerationContext;
}

/**
 * Return today's active deck, generating it if absent. Idempotent: a second
 * call the same day returns the same deck without regenerating. Generation
 * errors propagate — callers (the GET route) decide how to degrade.
 */
export async function ensureTodaysDeck(opts: EnsureTodaysDeckOpts = {}): Promise<DeckRecord> {
  const today = todayLocalDate();

  const existing = getActiveDeckForDate(today);
  if (existing) return existing;

  const pending = inFlight.get(today);
  if (pending) return pending;

  const origin = opts.origin ?? 'first_open';
  const promise = (async () => {
    // Re-check after the async boundary — another caller may have just written it.
    const fresh = getActiveDeckForDate(today);
    if (fresh) return fresh;
    // Lazy import: generate-deck pulls in the AI SDKs, which a plain route
    // import shouldn't drag in until a generation actually fires.
    const { generateDeck } = await import('@/lib/ai/generate-deck');
    return generateDeck(opts.context ?? {}, { origin });
  })();

  inFlight.set(today, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(today);
  }
}
