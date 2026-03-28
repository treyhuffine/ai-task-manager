"use client";

import { useState } from 'react';
import { Search, Target, X } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent, PopoverClose } from '@/components/ui/popover';
import { useTasks } from '@/hooks/use-tasks';
import { cn } from '@/lib/utils';

interface TaskPickerProps {
  value: string | null;
  onChange: (taskId: string | null) => void;
  className?: string;
}

export function TaskPicker({ value, onChange, className }: TaskPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const { data: tasks } = useTasks({
    status: 'active',
    q: search || undefined,
    limit: 20,
  });

  const { data: linkedTask } = useTasks(
    value ? { status: ['active', 'done'] as any, limit: 1 } : undefined,
  );

  const linkedTitle = linkedTask?.find(t => t.id === value)?.title;

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(''); }}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'inline-flex items-center gap-0.5 text-[8.5px] font-bold uppercase tracking-wider transition-colors hover:bg-muted px-1.5 py-0.5 rounded',
            value ? 'text-primary/60' : 'text-muted-foreground/40',
            className,
          )}
          onClick={(e) => e.stopPropagation()}
          title={value ? `Linked to: ${linkedTitle ?? 'task'}` : 'Link to task'}
        >
          <Target size={8} />
          {value ? 'Linked' : 'Link'}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <div className="p-2 border-b border-border">
          <div className="flex items-center gap-1.5 bg-background border border-border rounded px-2 py-1">
            <Search size={10} className="text-muted-foreground" />
            <input
              autoFocus
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks..."
              className="flex-1 text-[11px] bg-transparent outline-none"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
        <div className="max-h-48 overflow-y-auto p-1">
          {value && (
            <button
              onClick={(e) => { e.stopPropagation(); onChange(null); setOpen(false); }}
              className="w-full text-left px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-muted rounded flex items-center gap-1.5"
            >
              <X size={10} /> Unlink
            </button>
          )}
          {tasks?.map(task => (
            <button
              key={task.id}
              onClick={(e) => { e.stopPropagation(); onChange(task.id); setOpen(false); }}
              className={cn(
                'w-full text-left px-2 py-1.5 text-[11px] hover:bg-muted rounded flex items-center gap-1.5 line-clamp-1',
                task.id === value && 'bg-primary/10 text-primary',
              )}
            >
              <Target size={10} className="flex-shrink-0" />
              <span className="truncate">{task.title}</span>
            </button>
          ))}
          {tasks && tasks.length === 0 && (
            <p className="px-2 py-3 text-[10px] text-muted-foreground text-center">No tasks found</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
