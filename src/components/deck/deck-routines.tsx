"use client";

import { ChevronDown, ChevronRight, Circle, CheckCircle2 } from 'lucide-react';
import type { RoutineItem } from '@/types/dashboard';

interface DeckRoutinesProps {
  routines: RoutineItem[];
  onComplete: (id: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function DeckRoutines({
  routines,
  onComplete,
  collapsed,
  onToggleCollapse,
}: DeckRoutinesProps) {
  if (routines.length === 0) return null;

  return (
    <div className="mt-2 pt-4 border-t border-border/50">
      {/* Section header */}
      <button
        onClick={onToggleCollapse}
        className="flex items-center gap-1.5 w-full text-left mb-3"
      >
        {collapsed
          ? <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />
          : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50" />
        }
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
          Routines
        </span>
      </button>

      {!collapsed && (
        <div className="space-y-2">
          {routines.map(routine => {
            const isDone = routine.completedCount >= routine.targetCount;
            return (
              <div key={routine.id} className="flex items-center gap-2.5 py-1">
                <button
                  onClick={() => !isDone && onComplete(routine.id)}
                  className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                >
                  {isDone
                    ? <CheckCircle2 className="w-4 h-4 text-muted-foreground/50" />
                    : <Circle className="w-4 h-4" />
                  }
                </button>
                <span className="text-xs text-muted-foreground flex-1">
                  {routine.title}
                </span>
                <span className="text-[10px] text-muted-foreground/50">
                  {routine.completedCount} of {routine.targetCount} {routine.period}
                  {routine.streak != null && routine.streak > 0 && (
                    <> · {routine.streak}d streak</>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
