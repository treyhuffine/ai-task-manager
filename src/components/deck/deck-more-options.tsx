"use client";

import { ChevronUp, ChevronDown, Plus, RotateCcw } from 'lucide-react';
import type { AlternativeItem, RadarItem, DeckChangeView } from '@/types/dashboard';

interface DeckMoreOptionsProps {
  alternatives: AlternativeItem[];
  /** Items the AI moved off today's deck (deferred/dropped) — restorable. */
  bumped?: DeckChangeView[];
  onRestore?: (taskId: string) => void;
  radarItems?: RadarItem[];
  onPromote: (id: string, type: 'alternative' | 'radar') => void;
  onViewAllTasks?: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function DeckMoreOptions({
  alternatives,
  bumped = [],
  onRestore,
  radarItems = [],
  onPromote,
  onViewAllTasks,
  collapsed,
  onToggleCollapse,
}: DeckMoreOptionsProps) {
  const totalCount = bumped.length + alternatives.length + radarItems.length;
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
          {/* ─── Bumped today — moved off the deck, nothing lost ─── */}
          {bumped.length > 0 && (
            <>
              <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/50 pt-1 pb-0.5">
                Bumped today
              </p>
              {bumped.map(item => (
                <button
                  key={`bumped-${item.taskId}`}
                  onClick={() => onRestore?.(item.taskId)}
                  className="group/bump w-full flex items-start gap-2 py-1.5 pl-1 rounded-md hover:bg-muted/50 active:bg-muted/70 transition-colors text-left"
                  title="Restore to today's deck"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-muted-foreground md:opacity-0 md:group-hover/bump:opacity-100 group-hover/bump:text-foreground mt-0.5 transition-opacity flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground truncate">
                        {item.title}
                      </span>
                      <span className="text-[8px] px-1 py-0.5 rounded bg-muted/80 text-muted-foreground/50 font-medium shrink-0">
                        {item.kind === 'dropped' ? 'dropped' : 'later'}
                      </span>
                      {item.areaName && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-muted/80 text-muted-foreground/70 shrink-0">
                          {item.areaName}
                        </span>
                      )}
                    </div>
                    {item.reason && (
                      <p className="text-[10px] text-muted-foreground/50 mt-0.5 line-clamp-2">
                        {item.reason}
                      </p>
                    )}
                  </div>
                </button>
              ))}
              {alternatives.length > 0 && <div className="h-1.5" />}
            </>
          )}

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
