"use client";

import { useState } from 'react';
import { Circle, CheckCircle2, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DeckItem, RoutineItem } from '@/types/dashboard';
import { DayShapeStrip } from '@/components/calendar/day-shape-strip';

interface DeckDayBarProps {
  /** Today's active deck items — slotted ones render on the day strip. */
  items: DeckItem[];
  routines: RoutineItem[];
  onRoutineComplete: (id: string) => void;
}

/**
 * The day strip under the deck's conductor, plus a habits row once habits are
 * backed by real tracking. Everything that used to share that row moved to
 * where it belongs: adding a task is the add bar at the top of the deck, and
 * "done today" and the heartbeat are chips in the Today section's status row.
 * So the row renders only when there are habits, never as an empty bar.
 */
export function DeckDayBar({ items, routines, onRoutineComplete }: DeckDayBarProps) {
  const [open, setOpen] = useState(false);
  const routinesDone = routines.filter(r => r.completedCount >= r.targetCount).length;

  return (
    <div className="relative">
      <DayShapeStrip items={items} />

      {routines.length > 0 && (
        <div className="flex items-center justify-end px-4 py-1.5 border-b border-border/50">
          <button
            onClick={() => setOpen(o => !o)}
            className={cn(
              'flex items-center gap-1.5 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors',
              open && 'text-muted-foreground',
            )}
          >
            <Circle className="w-3 h-3" />
            {routinesDone}/{routines.length} habits
            <ChevronDown className={cn('w-2.5 h-2.5 transition-transform', open && 'rotate-180')} />
          </button>
        </div>
      )}

      {open && routines.length > 0 && (
        <div className="absolute right-4 top-full mt-1 z-10 w-72 bg-popover border border-border rounded-lg shadow-md p-3">
          <div className="space-y-2">
            {routines.map(routine => {
              const isDone = routine.completedCount >= routine.targetCount;
              return (
                <div key={routine.id} className="flex items-center gap-2.5">
                  <button
                    onClick={() => !isDone && onRoutineComplete(routine.id)}
                    aria-label={isDone ? `${routine.title} done` : `Mark ${routine.title} done`}
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
        </div>
      )}
    </div>
  );
}
