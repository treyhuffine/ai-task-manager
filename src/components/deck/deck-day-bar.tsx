"use client";

import { useState } from 'react';
import { Plus, Check, Circle, CheckCircle2, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DeckItem, RoutineItem } from '@/types/dashboard';
import { DayShapeStrip } from '@/components/calendar/day-shape-strip';

interface DeckDayBarProps {
  /** Today's active deck items — slotted ones render on the day strip. */
  items: DeckItem[];
  completedItems: DeckItem[];
  routines: RoutineItem[];
  onRoutineComplete: (id: string) => void;
  quickAddOpen: boolean;
  onToggleQuickAdd: () => void;
}

export function DeckDayBar({ items, completedItems, routines, onRoutineComplete, quickAddOpen, onToggleQuickAdd }: DeckDayBarProps) {
  const [openDropdown, setOpenDropdown] = useState<'completed' | 'routines' | null>(null);

  const toggle = (which: 'completed' | 'routines') => {
    setOpenDropdown(prev => (prev === which ? null : which));
  };

  const completedCount = completedItems.length;
  const routinesDone = routines.filter(r => r.completedCount >= r.targetCount).length;

  return (
    <div className="relative">
      <DayShapeStrip items={items} />
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-border/50">
        {/* Left side — add task button + completed count */}
        <div className="flex items-center gap-3">
          <button
            onClick={onToggleQuickAdd}
            className={cn(
              'flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border transition-colors',
              quickAddOpen
                ? 'border-primary/30 bg-primary/5 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground',
            )}
          >
            <Plus className="w-3 h-3" />
            Add task
          </button>
          {completedCount > 0 && (
            <button
              onClick={() => toggle('completed')}
              className={cn(
                'flex items-center gap-1.5 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors',
                openDropdown === 'completed' && 'text-muted-foreground',
              )}
            >
              <Check className="w-3 h-3" />
              {completedCount} done
              <ChevronDown className={cn('w-2.5 h-2.5 transition-transform', openDropdown === 'completed' && 'rotate-180')} />
            </button>
          )}
        </div>

        {/* Routines dropdown trigger — right side */}
        <button
          onClick={() => toggle('routines')}
          className={cn(
            'flex items-center gap-1.5 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors',
            openDropdown === 'routines' && 'text-muted-foreground',
          )}
        >
          <Circle className="w-3 h-3" />
          {routinesDone}/{routines.length} habits
          <ChevronDown className={cn('w-2.5 h-2.5 transition-transform', openDropdown === 'routines' && 'rotate-180')} />
        </button>
      </div>

      {/* Dropdown panels */}
      {openDropdown === 'completed' && completedCount > 0 && (
        <div className="absolute left-4 top-full mt-1 z-10 w-64 bg-popover border border-border rounded-lg shadow-md p-3">
          <div className="space-y-1.5">
            {completedItems.map(item => (
              <div key={item.id} className="text-xs text-muted-foreground/50 line-through">
                {item.parentTitle && <>{item.parentTitle} · </>}
                {item.title}
              </div>
            ))}
          </div>
        </div>
      )}

      {openDropdown === 'routines' && (
        <div className="absolute right-4 top-full mt-1 z-10 w-72 bg-popover border border-border rounded-lg shadow-md p-3">
          {routines.length === 0 ? (
            <p className="text-xs text-muted-foreground/50">No routines</p>
          ) : (
            <div className="space-y-2">
              {routines.map(routine => {
                const isDone = routine.completedCount >= routine.targetCount;
                return (
                  <div key={routine.id} className="flex items-center gap-2.5">
                    <button
                      onClick={() => !isDone && onRoutineComplete(routine.id)}
                      className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                    >
                      {isDone
                        ? <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground/50" />
                        : <Circle className="w-3.5 h-3.5" />
                      }
                    </button>
                    <span className="text-xs text-muted-foreground flex-1">{routine.title}</span>
                    <span className="text-[10px] text-muted-foreground/50">
                      {routine.completedCount}/{routine.targetCount} {routine.period}
                      {routine.streak != null && routine.streak > 0 && (
                        <> · {routine.streak}d</>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
