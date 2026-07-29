/**
 * Session ids that have been navigated to but whose row may not exist yet.
 *
 * The launcher generates the session id itself so it can close and route to the
 * execution the instant you hit Start, rather than holding a spinner while the
 * create round-trip finishes. Server-side that create is a few milliseconds,
 * but the request queues behind the app's open SSE streams (HTTP/1.1 caps
 * concurrent connections per origin), so in practice it ranged from ~1s to
 * tens of seconds — all of it spent staring at a modal that had nothing left
 * to ask.
 *
 * The cost of going first is a window where `GET /sessions/:id` 404s. Rather
 * than making every session query tolerate that — which would turn a genuinely
 * deleted session into a ten-second spinner — ids are registered here for the
 * duration of the create, and `useSession` retries 404s *only* for those.
 *
 * Module-level and deliberately not React state: the launcher unmounts the
 * moment it closes, and the execution view that needs to read this is a
 * different subtree entirely.
 */

const pending = new Map<string, number>();

/** Registered before navigating, so the view knows the row is on its way. */
export function markLaunchPending(sessionId: string): void {
  pending.set(sessionId, Date.now());
}

/** Called once the row exists, or once the create has definitively failed. */
export function clearLaunchPending(sessionId: string): void {
  pending.delete(sessionId);
}

/**
 * True while a create for this id is believed to be in flight.
 *
 * Self-expiring: an entry older than the ceiling is treated as finished even if
 * nothing cleared it, so a create that dies in a way we never observe (tab
 * suspended mid-flight, request aborted) can't leave a session id retrying
 * 404s forever.
 */
export function isLaunchPending(sessionId: string | null | undefined): boolean {
  if (!sessionId) return false;
  const at = pending.get(sessionId);
  if (at === undefined) return false;
  if (Date.now() - at > PENDING_CEILING_MS) {
    pending.delete(sessionId);
    return false;
  }
  return true;
}

/** Generous — this bounds a pathological create, not a healthy one. */
const PENDING_CEILING_MS = 90_000;
