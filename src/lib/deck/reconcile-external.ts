/**
 * Mid-day reconcile — keep the deck honest to external reality without the
 * user driving it.
 *
 * The rule: the deck only rearranges itself in response to things you *didn't*
 * do. This handles the canonical case — a meeting appears and shrinks the day,
 * so the deck no longer fits — by deterministically bumping the lowest-priority
 * item(s) off, routing each change through the change-router (absorb / digest /
 * interrupt), and writing a new `midday` version. Every bump lands in the
 * visible bumped lane; nothing vanishes.
 *
 * It's deterministic (no model call) and safe to run on a cadence. A heartbeat
 * or the scheduler calls it via `POST /api/deck/reconcile` or the
 * `reconcile_deck` orchestrator action. Until a calendar connector registers a
 * provider it's a no-op (there's nothing external to react to).
 */

import type { DeckRecord, DeckItem, DeckChange, CalendarBlock } from '@/db/types';
import {
  getActiveDeckForDate,
  getDeckVersions,
  supersedeAndInsertDeck,
  getWorkdayBounds,
} from '@/lib/db/queries';
import { getDb } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { inArray } from 'drizzle-orm';
import { todayLocalDate } from './date';
import {
  getCalendarEventsForDay,
  hasCalendarProvider,
  computeFreeGaps,
  availableMinutes,
} from './calendar';
import { routeChanges, type ProposedChange, type RoutedChange } from './change-router';

/** Default per-task time when a task has no estimate. */
const DEFAULT_TASK_MINUTES = 30;

export interface ReconcileResult {
  changed: boolean;
  deck: DeckRecord | null;
  decisions: RoutedChange[];
  summary: string;
}

function blockKey(b: CalendarBlock): string {
  return `${b.start}|${b.end}|${b.title}`;
}

function diffBlocks(prev: CalendarBlock[], curr: CalendarBlock[]) {
  const prevKeys = new Set(prev.map(blockKey));
  const currKeys = new Set(curr.map(blockKey));
  return {
    added: curr.filter((b) => !prevKeys.has(blockKey(b))),
    removed: prev.filter((b) => !currKeys.has(blockKey(b))),
  };
}

/** How many interrupt-level changes have already surfaced today (budget input). */
function countTodaysInterrupts(date: string): number {
  let n = 0;
  for (const v of getDeckVersions(date)) {
    for (const c of (v.changes ?? []) as DeckChange[]) {
      if (c.channel === 'interrupt') n++;
    }
  }
  return n;
}

export async function reconcileDeckWithExternalChanges(
  opts: { inFocus?: boolean; date?: string } = {},
): Promise<ReconcileResult> {
  const date = opts.date ?? todayLocalDate();
  const deck = getActiveDeckForDate(date);
  if (!deck) {
    return { changed: false, deck: null, decisions: [], summary: 'No active deck for today.' };
  }
  // No connector → nothing external to react to. (Inert until calendar lands.)
  if (!hasCalendarProvider()) {
    return { changed: false, deck, decisions: [], summary: 'No calendar connected.' };
  }

  const current = await getCalendarEventsForDay(date);
  const previous = (deck.calendarSnapshot ?? []) as CalendarBlock[];
  const diff = diffBlocks(previous, current);
  if (diff.added.length === 0 && diff.removed.length === 0) {
    return { changed: false, deck, decisions: [], summary: 'No calendar changes.' };
  }

  const { workdayStart, workdayEnd } = getWorkdayBounds();
  const gaps = computeFreeGaps(current, { workdayStart, workdayEnd, date });
  const nowAvailable = availableMinutes(gaps);

  const items = deck.items as DeckItem[];

  // Task estimates / titles / deadlines for the deck's items.
  const ids = items.map((i) => i.taskId);
  const estById = new Map<string, number>();
  const titleById = new Map<string, string>();
  const deadlineById = new Map<string, string | null>();
  if (ids.length > 0) {
    const db = getDb();
    const rows = db
      .select({
        id: tasks.id,
        est: tasks.estimatedMinutes,
        title: tasks.title,
        deadline: tasks.hardDeadline,
      })
      .from(tasks)
      .where(inArray(tasks.id, ids))
      .all();
    for (const r of rows) {
      estById.set(r.id, r.est ?? DEFAULT_TASK_MINUTES);
      titleById.set(r.id, r.title);
      deadlineById.set(r.id, r.deadline ?? null);
    }
  }
  const itemMinutes = (i: DeckItem) => estById.get(i.taskId) ?? DEFAULT_TASK_MINUTES;

  // Over capacity → bump from the end (lowest priority) until it fits or one left.
  const keep: DeckItem[] = [...items];
  const proposals: ProposedChange[] = [];
  let required = keep.reduce((s, i) => s + itemMinutes(i), 0);

  while (current.length > 0 && nowAvailable < required && keep.length > 1) {
    const victim = keep.pop()!;
    required -= itemMinutes(victim);
    const hasDeadline = !!deadlineById.get(victim.taskId);
    proposals.push({
      kind: 'bumped',
      taskId: victim.taskId,
      reason: `A new commitment shrank today to ~${nowAvailable}m of task time — moved off to keep the day realistic.`,
      source: 'calendar',
      touchesPriority: hasDeadline,
      // A hard-deadline item forced off the deck is a real conflict only the
      // user can resolve → escalate it.
      needsDecision: hasDeadline,
      timeSensitive: hasDeadline,
      magnitude: hasDeadline ? 'major' : 'notable',
    });
  }

  if (proposals.length === 0) {
    return {
      changed: false,
      deck,
      decisions: [],
      summary: 'Calendar changed but the deck still fits.',
    };
  }

  const decisions = routeChanges(proposals, {
    inFocus: !!opts.inFocus,
    interruptsToday: countTodaysInterrupts(date),
  });

  const changes: DeckChange[] = decisions.map(({ change, decision }) => ({
    kind: change.kind,
    taskId: change.taskId,
    title: titleById.get(change.taskId),
    reason: change.reason,
    source: 'calendar',
    channel: decision.channel,
  }));

  const newDeck = supersedeAndInsertDeck({
    forDate: date,
    context: deck.context,
    contextTags: deck.contextTags ?? [],
    framing: deck.framing,
    items: keep,
    alternatives: deck.alternatives,
    searchContext: deck.searchContext,
    model: deck.model,
    origin: 'midday',
    changes,
    calendarSnapshot: current,
  });

  return {
    changed: true,
    deck: newDeck,
    decisions,
    summary: `Bumped ${proposals.length} item(s) after a calendar change.`,
  };
}
