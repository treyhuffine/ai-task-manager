/**
 * Client-side Ready-Todo check, mirroring the server `isReady` predicate used by
 * deck generation, so every client Deck path (stack reconciliation, alternatives,
 * Browse, fallback) agrees on eligibility. Ready means: Todo, unblocked, not
 * deferred past `resurfaceAfter`, and not a future recurrence. Blocker resolution
 * is conservative here (any blocker = not Ready) since the client cannot always
 * see the blocker's Done state.
 */
export function isClientReadyTodo(
  t: {
    status: string;
    blockedOn?: string | null;
    resurfaceAfter?: string | null;
    recurrence?: string | null;
    nextRecurrenceAt?: string | null;
  },
  nowMs: number = Date.now(),
): boolean {
  if (t.status !== 'todo') return false;
  if (t.blockedOn) return false;
  if (t.resurfaceAfter && new Date(t.resurfaceAfter).getTime() > nowMs) return false;
  if (t.recurrence && t.nextRecurrenceAt && new Date(t.nextRecurrenceAt).getTime() > nowMs) return false;
  return true;
}
