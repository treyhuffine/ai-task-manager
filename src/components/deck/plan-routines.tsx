"use client";

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RoutineItem } from '@/types/dashboard';

interface PlanRoutinesProps {
  items: RoutineItem[];
  onComplete: (taskId: string) => void;
}

export function PlanRoutines({ items, onComplete }: PlanRoutinesProps) {
  if (items.length === 0) return null;

  return (
    <div className="px-4 pb-3 pt-1">
      <div className="flex items-center gap-2 mb-2">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[8.5px] font-bold text-muted-foreground uppercase tracking-[0.15em]">
          Today&apos;s Routines
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <div className="space-y-1">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-card transition-all group"
          >
            <div className="flex items-center gap-2.5">
              <button
                onClick={() => onComplete(item.taskId)}
                className={cn(
                  'w-4 h-4 rounded border flex items-center justify-center transition-all',
                  'border-border text-transparent hover:border-primary hover:text-primary'
                )}
              >
                <Check size={10} />
              </button>
              <span className="text-[12px] text-foreground/80">{item.title}</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[9px] text-muted-foreground">
                {item.completedCount} of {item.targetCount} {item.period}
              </span>
              {item.streak != null && item.streak > 0 && (
                <span className="text-[8.5px] text-primary/60 font-medium">
                  {item.streak}d streak
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
