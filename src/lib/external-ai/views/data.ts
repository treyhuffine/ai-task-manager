/**
 * What Ri's MCP views show (docs/mcp-oauth.md, "Views"). Built from the same
 * queries as the deck and task list, and shaped for one row grammar: a task's
 * title, its status, and quiet meta (area, deadline, blocked).
 */
import { getRemoteBaseUrl } from '@/lib/auth/bootstrap';
import { calendarDaysUntil } from '@/lib/dates';
import { todayLocalDate } from '@/lib/deck/date';
import { getActiveDeckForDate, getDeadlineTasks, getLatestDeck, getTask, listAreas, listTasks } from '@/lib/db/queries';
import type { TaskRecord } from '@/db/types';

export interface ViewTask {
  id: string;
  title: string;
  status: TaskRecord['status'];
  area: string | null;
  /** The hard deadline's day, `YYYY-MM-DD`. */
  deadline: string | null;
  /** Calendar days until it, negative when overdue. */
  daysUntil: number | null;
  blocked: boolean;
  recurring: boolean;
  /**
   * A repeating task finished for now: when it next comes due. Finishing one
   * returns it to `todo` with this date, and Ri treats it as not ready until
   * then (`src/lib/deck/client-ready.ts`), so the view draws it as done.
   */
  nextOccurrence: string | null;
  /** Why the deck put it here, one line. Deck items only. */
  reason: string | null;
  /** Sent back with a change, so a view that's out of date can't undo newer work. */
  statusChangedCount: number;
  /** The task in Ri, when Ri has an address the person can open from anywhere. */
  url: string | null;
}

export interface DeckView {
  view: 'deck';
  /** The day the deck is for, and whether that's today. */
  forDate: string | null;
  isToday: boolean;
  framing: string | null;
  /** Hard deadlines due within a week that aren't in the stack. They never fold. */
  deadlines: ViewTask[];
  items: ViewTask[];
  inProgress: number;
  url: string | null;
}

export interface TasksView {
  view: 'tasks';
  title: string;
  items: ViewTask[];
  /** More tasks match than the view shows. */
  more: boolean;
  url: string | null;
}

export const TASK_VIEW_LIMIT = 50;

/** The base URL a person can open from the device they're on. A local address means nothing on a phone. */
function openBase(): string | null {
  return getRemoteBaseUrl()?.replace(/\/+$/, '') ?? null;
}

function areaNames(): Map<string, string> {
  return new Map(listAreas({ status: 'all' }).map(area => [area.id, area.name]));
}

type TaskLike = Pick<TaskRecord, 'id' | 'title' | 'status' | 'areaId' | 'hardDeadline' | 'blockedOn' | 'recurrence' | 'nextRecurrenceAt' | 'statusChangedCount'>;

function viewTask(task: TaskLike, areas: Map<string, string>, base: string | null, reason: string | null = null, now = new Date()): ViewTask {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    area: task.areaId ? areas.get(task.areaId) ?? null : null,
    deadline: task.hardDeadline ? task.hardDeadline.slice(0, 10) : null,
    daysUntil: calendarDaysUntil(task.hardDeadline, now),
    blocked: Boolean(task.blockedOn),
    recurring: Boolean(task.recurrence),
    nextOccurrence: task.recurrence && task.nextRecurrenceAt && new Date(task.nextRecurrenceAt).getTime() > now.getTime() ? task.nextRecurrenceAt : null,
    reason,
    statusChangedCount: task.statusChangedCount,
    url: base ? `${base}/task/${encodeURIComponent(task.id)}` : null,
  };
}

/** Today's deck as the view shows it. Never generates one: that runs the AI pipeline and takes minutes. */
export function deckView(now = new Date()): DeckView {
  const today = todayLocalDate(now);
  const deck = getActiveDeckForDate(today) ?? getLatestDeck();
  const areas = areaNames();
  const base = openBase();
  const items: ViewTask[] = [];
  for (const item of deck?.items ?? []) {
    const task = getTask(item.taskId);
    if (!task || task.status === 'archived') continue;
    items.push(viewTask(task, areas, base, item.rationale?.trim() || null, now));
  }
  const stacked = new Set(items.map(item => item.id));
  const deadlines = getDeadlineTasks({ withinDays: 7, now })
    .filter(deadline => !stacked.has(deadline.id))
    .map(deadline => getTask(deadline.id))
    .filter((task): task is TaskRecord => Boolean(task))
    .map(task => viewTask(task, areas, base, null, now));
  return {
    view: 'deck',
    forDate: deck?.forDate ?? null,
    isToday: deck?.forDate === today,
    framing: deck?.framing?.trim() || null,
    deadlines,
    items,
    inProgress: listTasks({ status: 'in_progress', limit: 1000 }).length,
    url: base ? `${base}/` : null,
  };
}

export interface TasksViewInput {
  title?: string;
  ids?: string[];
  status?: TaskRecord['status'] | Array<TaskRecord['status']>;
  areaId?: string;
  q?: string;
  limit?: number;
}

/**
 * Named tasks in the order given (all of them, unless a limit says less), or
 * the tasks a filter finds, as `list_tasks` would. One row past the limit
 * says whether there are more, without counting them.
 */
export function tasksView(input: TasksViewInput, now = new Date()): TasksView {
  const named = input.ids?.length ? input.ids.slice(0, TASK_VIEW_LIMIT) : null;
  const limit = Math.min(input.limit ?? named?.length ?? 20, TASK_VIEW_LIMIT);
  const areas = areaNames();
  const base = openBase();
  const found: TaskLike[] = named
    ? named.slice(0, limit + 1).map(id => getTask(id)).filter((task): task is TaskRecord => Boolean(task))
    : listTasks({
      status: input.status ?? ['todo', 'in_progress'],
      ...(input.areaId ? { areaId: input.areaId } : {}),
      ...(input.q ? { q: input.q } : {}),
      limit: limit + 1,
    });
  return {
    view: 'tasks',
    title: input.title?.trim() || 'Tasks',
    items: found.slice(0, limit).map(task => viewTask(task, areas, base, null, now)),
    more: found.length > limit,
    url: base ? `${base}/` : null,
  };
}

function line(task: ViewTask): string {
  const finished = task.status === 'done' || task.nextOccurrence;
  const meta = [task.nextOccurrence ? `done for now, next ${todayLocalDate(new Date(task.nextOccurrence))}` : task.status === 'in_progress' ? 'in progress' : task.status === 'todo' ? null : task.status, task.area,
    task.daysUntil === null || finished ? null : task.daysUntil < 0 ? `overdue ${-task.daysUntil}d` : task.daysUntil === 0 ? 'due today' : `due ${task.deadline}`,
    task.blocked ? 'blocked' : null].filter(Boolean);
  return `${task.title}${meta.length ? ` (${meta.join(', ')})` : ''} [${task.id}]`;
}

/** The same view as text, for the model and for clients that don't draw views. */
export function viewSummary(view: DeckView | TasksView): string {
  if (view.view === 'tasks') {
    if (!view.items.length) return `${view.title}: no tasks.`;
    const more = view.more ? '\nMore tasks match than are shown.' : '';
    return `${view.title}:\n${view.items.map((task, index) => `${index + 1}. ${line(task)}`).join('\n')}${more}`;
  }
  const parts: string[] = [];
  if (view.deadlines.length) parts.push(`Deadlines:\n${view.deadlines.map(task => `- ${line(task)}`).join('\n')}`);
  if (!view.items.length) parts.push(view.forDate ? 'The deck has no tasks.' : 'There is no deck yet. The person can make one in Ri.');
  else parts.push(`${view.isToday ? 'Today' : `The deck for ${view.forDate}`}:\n${view.items.map((task, index) => `${index + 1}. ${line(task)}`).join('\n')}`);
  if (view.inProgress) parts.push(`${view.inProgress} in progress.`);
  return parts.join('\n\n');
}
