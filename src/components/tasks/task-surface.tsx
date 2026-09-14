'use client';

import { useState } from 'react';
import { TaskList } from './task-list';
import { TaskKanban } from './task-kanban';
import { TASK_VIEW_KEY, type TaskView } from './task-view';

/**
 * The task surface: List and Kanban are two views over the same records and the
 * same lifecycle. The chosen view survives reload. The List/Board switcher is
 * rendered inside each view's own toolbar (see TaskViewToggle), so there is no
 * separate strip — the surface only owns the view state and swaps the body.
 */
export function TaskSurface() {
  // Read the persisted view once at init (no setState-in-effect). Guarded for
  // SSR; this surface renders client-side in the dashboard.
  const [view, setView] = useState<TaskView>(() => {
    if (typeof window === 'undefined') return 'list';
    try {
      return localStorage.getItem(TASK_VIEW_KEY) === 'board' ? 'board' : 'list';
    } catch {
      return 'list';
    }
  });

  const set = (v: TaskView) => {
    setView(v);
    try {
      localStorage.setItem(TASK_VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };

  return view === 'list'
    ? <TaskList view={view} onViewChange={set} />
    : <TaskKanban view={view} onViewChange={set} />;
}
