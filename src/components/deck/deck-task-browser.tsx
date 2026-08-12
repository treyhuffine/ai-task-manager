"use client";

import { useState, useMemo } from 'react';
import { Search, Plus, Check, Minus, X, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTasks } from '@/hooks/use-tasks';
import { useAreas } from '@/hooks/use-areas';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import type { TaskListDTO } from '@/lib/api/dto/entity-list';

const EFFORT_SHORT: Record<string, string> = {
  trivial: 'XS',
  small: 'S',
  medium: 'M',
  large: 'L',
  epic: 'XL',
};

interface DeckTaskBrowserProps {
  /** IDs of tasks already on the deck (shown as disabled) */
  deckTaskIds: Set<string>;
  onAddToDeck: (task: TaskListDTO) => void;
  onRemoveFromDeck?: (taskId: string) => void;
  onClose: () => void;
}

export function DeckTaskBrowser({ deckTaskIds, onAddToDeck, onRemoveFromDeck, onClose }: DeckTaskBrowserProps) {
  const [query, setQuery] = useState('');
  const [areaFilter, setAreaFilter] = useState<string | null>(null);
  const [energyFilter, setEnergyFilter] = useState<'deep' | 'light' | null>(null);
  const [sortBy, setSortBy] = useState<'default' | 'newest' | 'deadline'>('default');

  const { data: tasks } = useTasks({ status: 'active', limit: 100 });
  const { data: areas } = useAreas();

  const selectedArea = areas?.find(a => a.id === areaFilter);

  const filteredTasks = useMemo(() => {
    if (!tasks) return [];

    let result = tasks.filter(t => !t.parentId); // top-level only

    if (query) {
      const q = query.toLowerCase();
      result = result.filter(t => t.title.toLowerCase().includes(q));
    }

    if (areaFilter) {
      result = result.filter(t => t.areaId === areaFilter);
    }

    if (energyFilter) {
      result = result.filter(t => t.energy === energyFilter);
    }

    if (sortBy === 'newest') {
      result = [...result].sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    } else if (sortBy === 'deadline') {
      result = [...result].sort((a, b) => {
        if (!a.hardDeadline && !b.hardDeadline) return 0;
        if (!a.hardDeadline) return 1;
        if (!b.hardDeadline) return -1;
        return new Date(a.hardDeadline).getTime() - new Date(b.hardDeadline).getTime();
      });
    }

    return result;
  }, [tasks, query, areaFilter, energyFilter, sortBy]);

  const areaMap = useMemo(() => {
    const m = new Map<string, string>();
    areas?.forEach(a => m.set(a.id, a.name));
    return m;
  }, [areas]);

  return (
    <div className="border-t border-border flex flex-col" style={{ height: '50%' }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50">
        {/* Search */}
        <div className="flex items-center gap-1.5 flex-1 bg-muted/50 rounded-md px-2 py-1">
          <Search className="w-3 h-3 text-muted-foreground/50 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search tasks..."
            className="bg-transparent text-xs text-foreground placeholder:text-muted-foreground/40 outline-none w-full"
            autoFocus
          />
        </div>

        {/* Energy toggle */}
        <div className="flex items-center gap-0.5 p-0.5 bg-muted/50 rounded-md shrink-0">
          <button
            onClick={() => setEnergyFilter(energyFilter === 'light' ? null : 'light')}
            className={cn(
              'px-2 py-0.5 rounded text-[9px] font-bold transition-all',
              energyFilter === 'light'
                ? 'bg-sky-400/15 text-sky-400 shadow-sm'
                : 'text-muted-foreground/50 hover:text-muted-foreground'
            )}
          >
            LIGHT
          </button>
          <button
            onClick={() => setEnergyFilter(energyFilter === 'deep' ? null : 'deep')}
            className={cn(
              'px-2 py-0.5 rounded text-[9px] font-bold transition-all',
              energyFilter === 'deep'
                ? 'bg-orange-500/15 text-orange-500 shadow-sm'
                : 'text-muted-foreground/50 hover:text-muted-foreground'
            )}
          >
            DEEP
          </button>
        </div>

        {/* Area filter */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold text-muted-foreground uppercase tracking-widest bg-muted/50 rounded-md hover:bg-muted transition-colors shrink-0">
              {selectedArea ? selectedArea.name : 'All'}
              <ChevronDown size={8} className="text-muted-foreground/50" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuItem onClick={() => setAreaFilter(null)} className={cn('text-xs', !areaFilter && 'font-bold')}>
              All areas
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {areas?.map(area => (
              <DropdownMenuItem
                key={area.id}
                onClick={() => setAreaFilter(area.id)}
                className={cn('text-xs', area.id === areaFilter && 'font-bold')}
              >
                {area.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Sort */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold text-muted-foreground uppercase tracking-widest bg-muted/50 rounded-md hover:bg-muted transition-colors shrink-0">
              {sortBy === 'default' ? 'Priority' : sortBy === 'newest' ? 'Newest' : 'Deadline'}
              <ChevronDown size={8} className="text-muted-foreground/50" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-28">
            <DropdownMenuItem onClick={() => setSortBy('default')} className={cn('text-xs', sortBy === 'default' && 'font-bold')}>
              Priority
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSortBy('newest')} className={cn('text-xs', sortBy === 'newest' && 'font-bold')}>
              Newest
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSortBy('deadline')} className={cn('text-xs', sortBy === 'deadline' && 'font-bold')}>
              Deadline
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Close */}
        <button
          onClick={onClose}
          className="p-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto">
        {filteredTasks.length === 0 ? (
          <p className="text-xs text-muted-foreground/40 px-3 py-4 text-center">No tasks found</p>
        ) : (
          filteredTasks.map(task => {
            const onDeck = deckTaskIds.has(task.id);
            return (
              <div
                key={task.id}
                className={cn(
                  'group/task flex items-center gap-2 px-3 py-1.5 hover:bg-muted/30 transition-colors',
                )}
              >
                {onDeck ? (
                  <button
                    onClick={() => onRemoveFromDeck?.(task.id)}
                    className="shrink-0 transition-colors text-muted-foreground/30 hover:text-red-400"
                    aria-label="Remove from deck"
                  >
                    {/* Mobile: always show minus. Desktop: check that swaps to minus on hover */}
                    <Check className="w-3.5 h-3.5 hidden md:block md:group-hover/task:hidden" />
                    <Minus className="w-3.5 h-3.5 md:hidden md:group-hover/task:block" />
                  </button>
                ) : (
                  <button
                    onClick={() => onAddToDeck(task)}
                    className="shrink-0 transition-colors text-muted-foreground hover:text-foreground"
                    aria-label="Add to deck"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                )}
                <span className={cn(
                  'text-xs truncate flex-1',
                  onDeck ? 'text-muted-foreground/50' : 'text-foreground',
                )}>
                  {task.title}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {task.areaId && areaMap.get(task.areaId) && (
                    <span className="text-[9px] px-1 py-0.5 rounded bg-muted/80 text-muted-foreground/70">
                      {areaMap.get(task.areaId)}
                    </span>
                  )}
                  {task.effort && (
                    <span className="text-[9px] text-muted-foreground/50">
                      {EFFORT_SHORT[task.effort] ?? task.effort}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
