/**
 * Local "today" as YYYY-MM-DD.
 *
 * The proactive deck keys on the user's *local* day (local-first, single
 * user), which is distinct from a deck's `createdAt` timestamp — an overnight
 * 4AM run (Phase 3) generates the deck while it's still "yesterday" in UTC but
 * it's *for* today. One helper so `ensureTodaysDeck` and `generateDeck` always
 * agree on where the day boundary falls.
 */
export function todayLocalDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
