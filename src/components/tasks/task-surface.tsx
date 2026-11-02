'use client';

import { useState, type ComponentProps, type ReactNode } from 'react';
import { TaskList } from './task-list';
import { TaskKanban } from './task-kanban';
import { TASK_VIEW_KEY, TaskViewToggle, type TaskView } from './task-view';
import { KANBAN_COLUMNS } from '@/lib/tasks/lanes';
import { Columns3 } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * The task surface: List and Kanban are two views over the same records and the
 * same lifecycle. The chosen view survives reload. The List/Board switcher is
 * rendered inside each view's own toolbar. A host that opens a separate Board
 * presents a primary action instead of an inline view switcher.
 */
export function TaskSurface({ onOpenTask, privatePlanning = true, viewKey = TASK_VIEW_KEY, initialView = 'list', contextControls, rowMeta, assigneeNames, legacyViewKey, onOpenBoard, ...board }: {
  onOpenTask: (id: string) => void;
  privatePlanning?: boolean;
  viewKey?: string;
  initialView?: TaskView;
  legacyViewKey?: string;
  /** The host can open its Board overlay. Otherwise the same Board renders inline. */
  onOpenBoard?: () => void;
  contextControls?: ReactNode;
  rowMeta?: ComponentProps<typeof TaskKanban>['cardMeta'];
  assigneeNames?: ComponentProps<typeof TaskList>['assigneeNames'];
} & Pick<ComponentProps<typeof TaskKanban>, 'trailing' | 'assigneeMemberId' | 'createDefaults' | 'areaFilter' | 'onAreaFilterChange'>) {
  // Read the persisted view once at init (no setState-in-effect). Guarded for
  // SSR; this surface renders client-side in the dashboard.
  const [view, setView] = useState<TaskView>(() => {
    if (onOpenBoard) return 'list';
    if (typeof window === 'undefined') return initialView;
    try {
      const saved = localStorage.getItem(viewKey) ?? (legacyViewKey ? localStorage.getItem(legacyViewKey) : null);
      return saved === 'board' || saved === 'list' ? saved : initialView;
    } catch {
      return initialView;
    }
  });

  const set = (v: TaskView) => {
    if (v === 'board' && onOpenBoard) { onOpenBoard(); return; }
    setView(v);
    try {
      localStorage.setItem(viewKey, v);
    } catch {
      /* ignore */
    }
  };

  return view === 'list'
    ? <TaskList
        listPreferenceKey={privatePlanning ? undefined : `${viewKey}:list`}
        assigneeNames={assigneeNames}
        onOpenTask={onOpenTask}
        view={onOpenBoard ? undefined : view}
        onViewChange={onOpenBoard ? undefined : set}
        privatePlanning={privatePlanning}
        initialLane={privatePlanning ? 'current' : 'all'}
        contextControls={<>
          {onOpenBoard && <Button type="button" size="sm" aria-haspopup="dialog" onClick={onOpenBoard}
            className="gap-1.5 rounded-lg text-xs font-semibold shadow-sm">
            <Columns3 className="size-3.5" aria-hidden />
            Open board
          </Button>}
          {contextControls}
        </>}
        trailing={board.trailing}
        rowMeta={rowMeta}
        assigneeMemberId={board.assigneeMemberId}
        createDefaults={board.createDefaults}
        areaFilter={board.areaFilter}
        onAreaFilterChange={board.onAreaFilterChange}
      />
    : <TaskKanban {...board} columnPreferenceKey={`${viewKey}:columns`} defaultColumns={privatePlanning ? undefined : KANBAN_COLUMNS} agents onOpenTask={onOpenTask} cardMeta={rowMeta} leading={<><TaskViewToggle value={view} onChange={set} />{contextControls}</>} />;
}
