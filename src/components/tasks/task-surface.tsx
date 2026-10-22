'use client';

import { TaskList } from './task-list';
import { openTaskBoard } from '@/lib/client/task-board';

/** A task-context Board entry deliberately opens Tasks in the shared Board. */
export function TaskSurface() {
  return <TaskList view="list" onViewChange={(view) => { if (view === 'board') openTaskBoard(); }} />;
}
