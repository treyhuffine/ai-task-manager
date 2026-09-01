'use client';

import { useEffect, useState } from 'react';
import { List, LayoutGrid } from 'lucide-react';
import { TaskList } from './task-list';
import { TaskKanban } from './task-kanban';
import { cn } from '@/lib/utils';

type View = 'list' | 'board';
const VIEW_KEY = 'flow.tasks.view';

/**
 * The task surface: List and Kanban are two views over the same records and the
 * same lifecycle. The chosen view survives reload. Both use the shared lane
 * model, the shared lifecycle actions, and the same guards.
 */
export function TaskSurface() {
  const [view, setView] = useState<View>('list');

  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      if (v === 'list' || v === 'board') setView(v);
    } catch {
      /* ignore */
    }
  }, []);

  const set = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };

  const toggle = (v: View, label: string, Icon: typeof List) => (
    <button
      onClick={() => set(v)}
      aria-pressed={view === v}
      className={cn(
        'flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors',
        view === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon size={11} /> {label}
    </button>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end gap-0.5 border-b border-border bg-muted px-3 py-1">
        {toggle('list', 'List', List)}
        {toggle('board', 'Board', LayoutGrid)}
      </div>
      <div className="min-h-0 flex-1">{view === 'list' ? <TaskList /> : <TaskKanban />}</div>
    </div>
  );
}
