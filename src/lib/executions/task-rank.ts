/**
 * Ordering for task rows in the launcher, shared by every source.
 *
 * The launcher lists tasks from this app plus any connected provider, and each
 * one returns its own idea of "natural" order — Todoist by project position,
 * Linear by creation, Jira by whatever the JQL said. Rendering those side by
 * side produced groups that each looked sorted and collectively looked random.
 *
 * Rather than invent a unified relevance score out of fields that don't mean
 * the same thing across providers, this ranks on the one signal that does
 * survive translation — **when is it due** — and uses priority only to break
 * ties inside a band. Bands are coarse on purpose: "overdue" vs "today" is a
 * real distinction a person acts on, "due in 9 days" vs "due in 11 days" is not.
 *
 * SCOPE: this is for sources that give us no ordering of their own. It is
 * deliberately NOT applied to this app's own tasks, whose `sortKey` is a
 * fractional index the user sets by dragging into priority buckets. An
 * explicit statement of what matters outranks an inferred one, so local tasks
 * keep their drag order and only *borrow* `dueLabel` for the badge. Reach for
 * this when a source hands back rows in its own arbitrary order.
 *
 * Everything is pure and takes `now` explicitly so the bands are testable
 * without freezing the clock.
 */

/** Coarse urgency bucket. Lower sorts first. */
export enum DueBand {
  Overdue = 0,
  Today = 1,
  Soon = 2,
  Later = 3,
  None = 4,
}

export interface RankableTask {
  /** ISO date (`YYYY-MM-DD`) or full timestamp. Null when the source has none. */
  due?: string | null;
  /**
   * Urgency normalized to 0..1 (1 = most urgent), or null when the provider
   * has no notion of priority. Raw provider scales disagree wildly — Todoist
   * counts up, Linear counts down, Jira uses names — so normalization happens
   * at the adapter boundary via the helpers below.
   */
  priority?: number | null;
}

/** Days between two dates, ignoring time-of-day. Negative = `date` is past. */
function dayDelta(due: Date, now: Date): number {
  const a = Date.UTC(due.getFullYear(), due.getMonth(), due.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a - b) / 86_400_000);
}

/**
 * Parse a provider due value.
 *
 * Date-only strings (`2026-07-28`) are read as LOCAL midnight, not UTC. Parsing
 * them as UTC shifts them a day backwards for anyone west of Greenwich, which
 * would mark today's task overdue every morning in US timezones.
 */
export function parseDue(due: string | null | undefined): Date | null {
  if (!due) return null;
  const trimmed = due.trim();
  if (!trimmed) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function dueBand(due: string | null | undefined, now: Date): DueBand {
  const parsed = parseDue(due);
  if (!parsed) return DueBand.None;
  const delta = dayDelta(parsed, now);
  if (delta < 0) return DueBand.Overdue;
  if (delta === 0) return DueBand.Today;
  if (delta <= 7) return DueBand.Soon;
  return DueBand.Later;
}

/**
 * Comparator for tasks from any source.
 *
 * Deliberately returns 0 for genuinely equivalent rows so `Array#sort` (stable
 * in every engine we target) preserves the source's own order underneath. That
 * is what keeps this app's deck ordering intact for tasks with no deadline
 * instead of scrambling a list the user already curated.
 */
export function compareTasks(a: RankableTask, b: RankableTask, now: Date): number {
  const bandA = dueBand(a.due, now);
  const bandB = dueBand(b.due, now);
  if (bandA !== bandB) return bandA - bandB;

  // Inside a band, an earlier due date wins — but only when both have one.
  const dueA = parseDue(a.due);
  const dueB = parseDue(b.due);
  if (dueA && dueB) {
    const diff = dueA.getTime() - dueB.getTime();
    if (diff !== 0) return diff;
  }

  // Priority is a tiebreak, never the primary key: a low-priority task due
  // today still beats an urgent one due next month.
  const prioA = a.priority ?? null;
  const prioB = b.priority ?? null;
  if (prioA !== null && prioB !== null && prioA !== prioB) return prioB - prioA;
  if (prioA !== null && prioB === null) return -1;
  if (prioA === null && prioB !== null) return 1;

  return 0;
}

export function sortTasks<T extends RankableTask>(tasks: T[], now: Date): T[] {
  return [...tasks].sort((a, b) => compareTasks(a, b, now));
}

/**
 * Short human label for a due date, or null when there's nothing worth saying.
 *
 * Shown on the row so the ordering explains itself. A sorted list whose sort
 * key is invisible reads as arbitrary, which is worse than no sorting at all.
 */
export function dueLabel(due: string | null | undefined, now: Date): string | null {
  const parsed = parseDue(due);
  if (!parsed) return null;
  const delta = dayDelta(parsed, now);
  if (delta < -1) return `${Math.abs(delta)} days overdue`;
  if (delta === -1) return 'Yesterday';
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  if (delta <= 7) return parsed.toLocaleDateString(undefined, { weekday: 'short' });
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ─── Per-provider priority normalization ──────────────────────
// Each provider's scale is its own; these map onto 0..1 (1 = most urgent) so
// the comparator never has to know which system a row came from.

/** Todoist: 1 (natural) … 4 (urgent). */
export function todoistPriority(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : null;
  if (n === null || n < 1 || n > 4) return null;
  return (n - 1) / 3;
}

/** Linear: 0 = none, then 1 (urgent) … 4 (low). Inverted relative to Todoist. */
export function linearPriority(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : null;
  if (n === null || n < 1 || n > 4) return null;
  return (4 - n) / 3;
}

const JIRA_PRIORITY: Record<string, number> = {
  highest: 1,
  high: 0.75,
  medium: 0.5,
  low: 0.25,
  lowest: 0,
};

/** Jira: a named scheme, and installs can rename these — unknown names score null. */
export function jiraPriority(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const hit = JIRA_PRIORITY[raw.trim().toLowerCase()];
  return hit === undefined ? null : hit;
}
