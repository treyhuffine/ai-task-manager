/**
 * Keeping delivery states in order across the stream and snapshots (P3
 * review). The session stream writes each message's delivery into the
 * cache the moment it changes. A snapshot fetched over HTTP, or the answer
 * to Cancel, can have been read before that change and arrive after it, and
 * would put the older state back ("Waiting", with Cancel, for a message
 * already delivered). So every stream update is stamped, and a snapshot or
 * an answer keeps whatever the stream changed after its request started.
 */

import type { MessageDelivery } from '@/lib/workers/delivery';

type Deliveries = Record<string, MessageDelivery>;

let clock = 0;
const stamps = new Map<string, Map<string, number>>();

/** Where the stream's clock is now: taken when a request starts. */
export function deliveryClock(): number {
  return clock;
}

/** The stream changed this message's delivery. */
export function noteDeliveryUpdate(sessionId: string, eventId: string): void {
  let session = stamps.get(sessionId);
  if (!session) stamps.set(sessionId, (session = new Map()));
  session.set(eventId, ++clock);
}

/** Whether the stream changed this message's delivery after `since`. */
export function streamedSince(sessionId: string, eventId: string, since: number): boolean {
  return (stamps.get(sessionId)?.get(eventId) ?? 0) > since;
}

/**
 * A snapshot read when the clock was at `since`, with what the stream said
 * since then kept over it, including messages the snapshot doesn't have yet.
 */
export function mergeDeliverySnapshot(sessionId: string, snapshot: Deliveries, cached: Deliveries | undefined, since: number): Deliveries {
  const merged: Deliveries = { ...snapshot };
  for (const [eventId, delivery] of Object.entries(cached ?? {})) {
    if (streamedSince(sessionId, eventId, since)) merged[eventId] = delivery;
  }
  return merged;
}

/** For tests. */
export function _resetDeliveryFence(): void {
  clock = 0;
  stamps.clear();
}
