"use client";

import { Check, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LightTaskItem } from '@/types/dashboard';

interface PlanLightTasksProps {
  items: LightTaskItem[];
  onComplete: (taskId: string) => void;
  startIndex: number;
}

export function PlanLightTasks({ items, onComplete, startIndex }: PlanLightTasksProps) {
  if (items.length === 0) return null;

  return (
    <div className="px-4 pb-2 pt-1">
      <div className="flex items-center gap-2 mb-2">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[8.5px] font-bold text-muted-foreground uppercase tracking-[0.15em]">
          Light / Gaps
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <div className="space-y-0.5">
        {items.map((item, i) => (
          <div
            key={item.id}
            className="group flex items-center justify-between px-3 py-2 rounded-lg hover:bg-card transition-all cursor-pointer border border-transparent hover:border-border"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-[10px] font-mono text-muted-foreground w-4 text-right">
                {startIndex + i}
              </span>
              <div className="w-1.5 h-1.5 rounded-full bg-sky-400/60 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-[12px] font-medium leading-tight truncate text-foreground">
                  {item.title}
                </p>
                {item.areaName && (
                  <span className="text-[9px] text-muted-foreground font-bold uppercase tracking-wider">
                    {item.areaName}
                  </span>
                )}
              </div>
              {item.isNew && (
                <span className="text-[8px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded flex-shrink-0">
                  new
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {item.estimatedMinutes && (
                <span className="text-[9.5px] text-muted-foreground flex items-center gap-0.5">
                  <Clock size={8} /> ~{item.estimatedMinutes}m
                </span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onComplete(item.taskId); }}
                className="p-1 rounded-md text-muted-foreground/30 hover:text-primary hover:bg-primary/10 transition-all opacity-0 group-hover:opacity-100"
                title="Complete"
              >
                <Check size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
