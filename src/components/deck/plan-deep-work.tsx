"use client";

import { useState } from 'react';
import { Target, X, Ban, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DeepWorkItem } from '@/types/dashboard';

interface PlanDeepWorkProps {
  items: DeepWorkItem[];
  onStart: (taskId: string) => void;
  onNotToday: (taskId: string) => void;
  onBlocked: (taskId: string) => void;
}

export function PlanDeepWork({ items, onStart, onNotToday, onBlocked }: PlanDeepWorkProps) {
  if (items.length === 0) return null;

  return (
    <div className="px-4 pb-2">
      <div className="flex items-center gap-2 mb-2.5">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[8.5px] font-bold text-muted-foreground uppercase tracking-[0.15em]">
          Deep Work
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <div className="space-y-2.5">
        {items.map((item, i) => (
          <DeepWorkCard
            key={item.id}
            item={item}
            index={i + 1}
            onStart={() => onStart(item.taskId)}
            onNotToday={() => onNotToday(item.taskId)}
            onBlocked={() => onBlocked(item.taskId)}
          />
        ))}
      </div>
    </div>
  );
}

function DeepWorkCard({
  item,
  index,
  onStart,
  onNotToday,
  onBlocked,
}: {
  item: DeepWorkItem;
  index: number;
  onStart: () => void;
  onNotToday: () => void;
  onBlocked: () => void;
}) {
  const [expanded, setExpanded] = useState(index === 1);

  return (
    <div className="rounded-xl bg-card border border-border transition-all">
      {/* Header - always visible */}
      <div
        className="flex items-start gap-3 px-4 py-3.5 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-[10px] font-mono text-muted-foreground w-4 text-right mt-0.5">
          {index}
        </span>
        <div className={cn(
          'w-2 h-2 rounded-full mt-1.5 flex-shrink-0',
          index === 1 ? 'bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.3)]' : 'bg-primary/60'
        )} />
        <div className="flex-1 min-w-0">
          <h3 className="text-[13px] font-medium text-foreground leading-tight">
            {item.projectTitle}: {item.taskTitle}
          </h3>
          {item.areaName && (
            <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">
              {item.areaName}
            </span>
          )}
        </div>
        <button className="p-1 text-muted-foreground/40 mt-0.5">
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-3.5 pt-0 ml-[52px]">
          {/* Continuity context */}
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">
            {item.continuityContext}
          </p>

          {/* Rationale */}
          <p className="text-[10.5px] text-foreground/70 leading-relaxed border-t border-border pt-2 mb-3">
            <span className="text-primary font-bold text-[8.5px] uppercase tracking-widest">Why today </span>
            {item.rationale}
          </p>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); onStart(); }}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold rounded-lg transition-all active:scale-95',
                index === 1
                  ? 'bg-orange-500 text-white shadow-sm shadow-orange-500/20 hover:bg-orange-600'
                  : 'bg-primary text-primary-foreground hover:opacity-90'
              )}
            >
              <Target size={10} /> Enter Focus
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onNotToday(); }}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium text-muted-foreground hover:text-foreground rounded-lg border border-border hover:bg-muted transition-all"
            >
              <X size={9} /> Not today
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onBlocked(); }}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium text-muted-foreground hover:text-foreground rounded-lg border border-border hover:bg-muted transition-all"
            >
              <Ban size={9} /> Blocked
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
