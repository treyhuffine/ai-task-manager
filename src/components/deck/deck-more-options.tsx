"use client";

import { ChevronUp, ChevronDown, Plus, Radar } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AlternativeItem, RadarItem } from '@/types/dashboard';

interface DeckMoreOptionsProps {
  alternatives: AlternativeItem[];
  radarItems?: RadarItem[];
  onPromote: (id: string, type: 'alternative' | 'radar') => void;
  onViewAllTasks?: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function DeckMoreOptions({
  alternatives,
  radarItems = [],
  onPromote,
  onViewAllTasks,
  collapsed,
  onToggleCollapse,
}: DeckMoreOptionsProps) {
  const totalCount = alternatives.length + radarItems.length;
  if (totalCount === 0) return null;

  return (
    <div className="border-t border-border">
      {/* Thin bar trigger */}
      <button
        onClick={onToggleCollapse}
        className="flex items-center justify-between w-full px-4 py-1.5 hover:bg-muted/50 transition-colors"
      >
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          More options
          <span className="ml-1.5 text-muted-foreground/40 font-normal normal-case tracking-normal">
            {totalCount}
          </span>
        </span>
        {collapsed
          ? <ChevronUp className="w-3 h-3 text-muted-foreground/40" />
          : <ChevronDown className="w-3 h-3 text-muted-foreground/40" />
        }
      </button>

      {/* Expanded content */}
      {!collapsed && (
        <div className="px-4 pb-3 max-h-64 overflow-y-auto space-y-0.5">
          {/* Alternative items */}
          {alternatives.map(item => (
            <button
              key={item.id}
              onClick={() => onPromote(item.id, 'alternative')}
              className="group/alt w-full flex items-center gap-2 py-1.5 pl-1 rounded-md hover:bg-muted/50 active:bg-muted/70 transition-colors text-left"
            >
              <Plus className="w-3.5 h-3.5 text-muted-foreground md:opacity-0 md:group-hover/alt:opacity-100 group-hover/alt:text-foreground transition-opacity flex-shrink-0" />
              <span className="text-xs text-muted-foreground flex-1 truncate">
                {item.title}
              </span>
              <div className="flex items-center gap-1.5">
                {item.areaName && (
                  <span className="text-[9px] px-1 py-0.5 rounded bg-muted/80 text-muted-foreground/70">
                    {item.areaName}
                  </span>
                )}
                {item.effort && (
                  <span className="text-[9px] text-muted-foreground/50">
                    {item.effort}
                  </span>
                )}
              </div>
            </button>
          ))}

          {/* Radar items */}
          {radarItems.map(item => (
            <button
              key={item.id}
              onClick={() => onPromote(item.id, 'radar')}
              className="group/radar w-full flex items-start gap-2 py-1.5 pl-1 rounded-md hover:bg-muted/50 active:bg-muted/70 transition-colors text-left"
            >
              <Plus className="w-3.5 h-3.5 text-muted-foreground md:opacity-0 md:group-hover/radar:opacity-100 group-hover/radar:text-foreground mt-0.5 transition-opacity flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground truncate">
                    {item.title}
                  </span>
                  <span className="text-[8px] px-1 py-0.5 rounded bg-muted/80 text-muted-foreground/50 font-medium shrink-0">
                    radar
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                  {item.reason}
                </p>
              </div>
            </button>
          ))}

          {/* View all tasks */}
          {onViewAllTasks && (
            <div className="pt-2 pb-1">
              <button
                onClick={onViewAllTasks}
                className="text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
              >
                View all tasks →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
