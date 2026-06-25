"use client";

import { useState } from 'react';
import {
  CheckSquare, FileText, Activity, Layers, Sun, Moon, Settings, ChevronLeft,
} from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { TaskList } from '@/components/tasks/task-list';
import { NoteList } from '@/components/notes/note-list';
import { StreamList } from '@/components/stream/stream-list';
import { openSettings } from '@/components/settings/settings-store';
import { cn } from '@/lib/utils';

type MoreSubView = 'menu' | 'tasks' | 'notes' | 'stream';

export function MobileMoreView() {
  const { theme, toggleTheme, openAreasList } = useDashboard();
  const isDark = theme === 'dark';
  const [subView, setSubView] = useState<MoreSubView>('menu');

  // Sub-view rendering
  if (subView !== 'menu') {
    const labels: Record<MoreSubView, string> = { menu: '', tasks: 'Tasks', notes: 'Notes', stream: 'Stream' };
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
          <button onClick={() => setSubView('menu')} className="p-1 -ml-1 rounded-lg hover:bg-muted/50 transition-colors">
            <ChevronLeft size={18} className="text-muted-foreground" />
          </button>
          <span className="text-sm font-bold">{labels[subView]}</span>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          {subView === 'tasks' && <TaskList />}
          {subView === 'notes' && <NoteList />}
          {subView === 'stream' && <StreamList />}
        </div>
      </div>
    );
  }

  const items = [
    { id: 'tasks' as const, label: 'Tasks', icon: CheckSquare, action: () => setSubView('tasks') },
    { id: 'notes' as const, label: 'Notes', icon: FileText, action: () => setSubView('notes') },
    { id: 'stream' as const, label: 'Stream', icon: Activity, action: () => setSubView('stream') },
    { id: 'areas' as const, label: 'Areas', icon: Layers, action: () => openAreasList() },
  ];

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-4 pt-4 pb-2">
        <h2 className="text-sm font-bold text-foreground">More</h2>
      </div>

      {/* Navigation items */}
      <div className="px-4 space-y-1">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={item.action}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left hover:bg-muted/50 active:bg-muted transition-colors"
          >
            <div className={cn(
              'w-9 h-9 rounded-lg flex items-center justify-center',
              isDark ? 'bg-secondary' : 'bg-muted'
            )}>
              <item.icon size={18} className="text-muted-foreground" />
            </div>
            <span className="text-sm font-medium text-foreground">{item.label}</span>
          </button>
        ))}
      </div>

      {/* Divider */}
      <div className="mx-4 my-3 h-px bg-border" />

      {/* Settings-like items */}
      <div className="px-4 space-y-1">
        <button
          onClick={toggleTheme}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left hover:bg-muted/50 active:bg-muted transition-colors"
        >
          <div className={cn(
            'w-9 h-9 rounded-lg flex items-center justify-center',
            isDark ? 'bg-secondary' : 'bg-muted'
          )}>
            {isDark ? <Sun size={18} className="text-muted-foreground" /> : <Moon size={18} className="text-muted-foreground" />}
          </div>
          <span className="text-sm font-medium text-foreground">
            {isDark ? 'Light Mode' : 'Dark Mode'}
          </span>
        </button>

        <button
          onClick={() => openSettings()}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left hover:bg-muted/50 active:bg-muted transition-colors"
        >
          <div className={cn(
            'w-9 h-9 rounded-lg flex items-center justify-center',
            isDark ? 'bg-secondary' : 'bg-muted'
          )}>
            <Settings size={18} className="text-muted-foreground" />
          </div>
          <span className="text-sm font-medium text-foreground">Settings</span>
        </button>
      </div>
    </div>
  );
}
