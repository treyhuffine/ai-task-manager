/**
 * Shared lane model for the task surfaces. List and Kanban are two views over
 * the same records and the same lifecycle — neither owns a second workflow
 * model, so the lane definitions live here once.
 */

import type { TaskStatus } from './lifecycle';

export type TaskLane = 'current' | 'todo' | 'consider' | 'done' | 'archived';

export interface LaneDef {
  key: TaskLane;
  label: string;
  status: TaskStatus;
  /** One-line empty-state copy for the lane. */
  empty: string;
}

/** Every lane, in the default top-to-bottom order for the List surface. */
export const TASK_LANES: LaneDef[] = [
  { key: 'current', label: 'Current Work', status: 'in_progress', empty: 'Nothing is underway. Start a task to bring it here.' },
  { key: 'todo', label: 'Todo', status: 'todo', empty: 'The committed queue is empty.' },
  { key: 'consider', label: 'Consider', status: 'consider', empty: 'No possibilities parked here yet.' },
  { key: 'done', label: 'Done', status: 'done', empty: 'Nothing completed yet.' },
  { key: 'archived', label: 'Archived', status: 'archived', empty: 'Nothing archived.' },
];

export const LANE_BY_KEY: Record<TaskLane, LaneDef> = Object.fromEntries(
  TASK_LANES.map((l) => [l.key, l]),
) as Record<TaskLane, LaneDef>;

/** The everyday Kanban board columns. Archived is reached via a history toggle,
 * not an everyday column. */
export const KANBAN_COLUMNS: TaskLane[] = ['consider', 'todo', 'current', 'done'];

/** The status a lane filters to. */
export function laneStatus(lane: TaskLane): TaskStatus {
  return LANE_BY_KEY[lane].status;
}

/** The lane a task's status belongs to. */
export function laneForStatus(status: TaskStatus): TaskLane {
  return status === 'in_progress' ? 'current' : (status as TaskLane);
}
