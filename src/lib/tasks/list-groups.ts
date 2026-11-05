import type { TaskListDTO } from '@/lib/api/dto/entity-list';
import { TASK_LANES } from './lanes';
import { clampRank, placeAtRank } from './priority-rank';

export type TaskListGrouping = 'status' | 'assignee' | 'area' | 'none';
export type TaskListSort = 'sortKey' | 'lastViewedAt' | 'hardDeadline' | 'createdAt' | 'updatedAt';

export const GROUP_LABELS: Record<TaskListGrouping, string> = {
  status: 'Status', assignee: 'Assignee', area: 'Area', none: 'No grouping',
};

export function taskGroupKey(task: TaskListDTO, by: TaskListGrouping): string {
  if (by === 'status') return task.status;
  if (by === 'assignee') return task.assigneeMemberId ?? '';
  if (by === 'area') return task.areaId ?? '';
  return '';
}

/** Keep the server's selected sort inside each group. Group order is stable
 * regardless of the first task returned by that sort. */
export function groupTaskList(
  tasks: TaskListDTO[], by: TaskListGrouping,
  areas: ReadonlyMap<string, string>, assignees: ReadonlyMap<string, string>,
): { key: string; label: string; tasks: TaskListDTO[] }[] {
  const groups = new Map<string, TaskListDTO[]>();
  for (const task of tasks) {
    const key = taskGroupKey(task, by);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(task);
  }
  if (by === 'status') return TASK_LANES.flatMap(lane => {
    const rows = groups.get(lane.status);
    return rows ? [{ key: lane.status, label: lane.label, tasks: rows }] : [];
  });
  return [...groups].map(([key, rows]) => ({
    key,
    label: by === 'assignee' ? key ? assignees.get(key) ?? 'Former member' : 'Unassigned'
      : by === 'area' ? key ? areas.get(key) ?? 'Unknown area' : 'No area' : '',
    tasks: rows,
  })).sort((a, b) => !a.key ? 1 : !b.key ? -1 : a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
}

export function readTaskListPreferences(key: string | undefined, privatePlanning: boolean): { sort: TaskListSort; group: TaskListGrouping } {
  const fallback = { sort: privatePlanning ? 'sortKey' : 'hardDeadline', group: privatePlanning ? 'none' : 'status' } as const;
  if (!key || typeof window === 'undefined') return fallback;
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null');
    return {
      sort: ['sortKey', 'lastViewedAt', 'hardDeadline', 'createdAt', 'updatedAt'].includes(saved?.sort) ? saved.sort : fallback.sort,
      group: Object.hasOwn(GROUP_LABELS, saved?.group) ? saved.group : fallback.group,
    };
  } catch { return fallback; }
}

/** Reuse canonical priority placement so grouping never creates duplicate keys
 * when two groups are later flattened or regrouped. Only the moved task changes
 * its position, while lifecycle and membership fields stay untouched. */
export function placeInTaskGroup(tasks: TaskListDTO[], id: string, rank: number, by: TaskListGrouping) {
  const ordered = [...tasks].sort((a, b) => {
    if (a.sortKey !== b.sortKey) {
      if (a.sortKey === null) return 1;
      if (b.sortKey === null) return -1;
      return a.sortKey < b.sortKey ? -1 : 1;
    }
    return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
  });
  const moved = ordered.find(task => task.id === id);
  if (!moved) return null;
  const group = ordered.filter(task => taskGroupKey(task, by) === taskGroupKey(moved, by));
  const slot = clampRank(rank, group.length) - 1;
  const siblings = group.filter(task => task.id !== id);
  const others = ordered.filter(task => task.id !== id);
  const before = siblings[slot];
  const after = siblings[slot - 1];
  const globalSlot = before ? others.findIndex(task => task.id === before.id)
    : after ? others.findIndex(task => task.id === after.id) + 1 : ordered.findIndex(task => task.id === id);
  return placeAtRank(ordered, id, globalSlot + 1);
}
