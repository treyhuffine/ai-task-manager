"use client";

import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, RefreshCw, Clock, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAreas } from '@/hooks/use-areas';
import { api } from '@/lib/api/client';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { WorkMode } from '@/types/dashboard';

// ─── Urgency for Generate New Deck button ───────────────────────

type Urgency = 'low' | 'medium' | 'high' | 'critical';

function getUrgency(generatedAt: string | undefined): Urgency {
  if (!generatedAt) return 'low';
  const hoursAgo = (Date.now() - new Date(generatedAt).getTime()) / (1000 * 60 * 60);
  if (hoursAgo >= 24) return 'critical';
  if (hoursAgo >= 4) return 'high';
  if (hoursAgo >= 2) return 'medium';
  return 'low';
}

const URGENCY_STYLES: Record<Urgency, string> = {
  low: 'text-muted-foreground hover:text-foreground hover:bg-muted',
  medium: 'text-foreground border border-border hover:bg-muted',
  high: 'text-primary bg-primary/5 border border-primary/20 hover:bg-primary/10',
  critical: 'bg-primary text-primary-foreground hover:bg-primary/90',
};

// ─── Component ──────────────────────────────────────────────────

interface DeckConductorProps {
  areaFilter: string | null;
  onAreaFilterChange: (areaId: string | null) => void;
  workMode: WorkMode;
  onWorkModeChange: (mode: WorkMode) => void;
  filterDueToday: boolean;
  dueTodayCount: number;
  onFilterDueTodayChange: (value: boolean) => void;
  onReplan?: () => void;
  generatedAt?: string;
}

export function DeckConductor({
  areaFilter,
  onAreaFilterChange,
  workMode,
  onWorkModeChange,
  filterDueToday,
  dueTodayCount,
  onFilterDueTodayChange,
  onReplan,
  generatedAt,
}: DeckConductorProps) {
  const { data: areas } = useAreas();
  const selectedArea = areas?.find(a => a.id === areaFilter);

  const [urgency, setUrgency] = useState<Urgency>(() => getUrgency(generatedAt));

  useEffect(() => {
    setUrgency(getUrgency(generatedAt));
    const interval = setInterval(() => {
      setUrgency(getUrgency(generatedAt));
    }, 60_000);
    return () => clearInterval(interval);
  }, [generatedAt]);

  // Morning auto-refresh (cron) config — opt-in.
  const [morning, setMorning] = useState<{ enabled: boolean; time: string } | null>(null);
  useEffect(() => {
    api.get<{ enabled: boolean; time: string }>('/deck/schedule')
      .then((c) => setMorning({ enabled: c.enabled, time: c.time }))
      .catch(() => {});
  }, []);
  const toggleMorning = useCallback(() => {
    setMorning((prev) => {
      const next = { enabled: !(prev?.enabled ?? false), time: prev?.time ?? '04:00' };
      api.put('/deck/schedule', { enabled: next.enabled }).catch(() => {});
      return next;
    });
  }, []);

  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-border">
      <div className="flex items-center gap-2">
        {/* Energy toggle: Light / Deep */}
        <div className="flex items-center gap-0.5 p-0.5 bg-card rounded-lg border border-border">
          <button
            onClick={() => onWorkModeChange(workMode === 'light' ? null : 'light')}
            className={cn(
              'px-2.5 py-1 rounded text-[9px] font-bold transition-all',
              workMode === 'light'
                ? 'bg-sky-400/15 text-sky-400 shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            LIGHT
          </button>
          <button
            onClick={() => onWorkModeChange(workMode === 'deep' ? null : 'deep')}
            className={cn(
              'px-2.5 py-1 rounded text-[9px] font-bold transition-all',
              workMode === 'deep'
                ? 'bg-orange-500/15 text-orange-500 shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            DEEP
          </button>
        </div>

        {/* Area filter dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1.5 px-2.5 py-1 bg-card border border-border rounded-lg cursor-pointer hover:border-muted-foreground transition-all">
              <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
                {selectedArea ? selectedArea.name : 'All areas'}
              </span>
              <ChevronDown size={9} className="text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            <DropdownMenuItem
              onClick={() => onAreaFilterChange(null)}
              className={cn('text-xs', !areaFilter && 'font-bold')}
            >
              All areas
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {areas?.map(area => (
              <DropdownMenuItem
                key={area.id}
                onClick={() => onAreaFilterChange(area.id)}
                className={cn('text-xs', area.id === areaFilter && 'font-bold')}
              >
                {area.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Due today filter toggle */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => dueTodayCount > 0 && onFilterDueTodayChange(!filterDueToday)}
                disabled={dueTodayCount === 0}
                className={cn(
                  'px-2.5 py-1 rounded-lg text-[9px] font-bold transition-all border',
                  filterDueToday
                    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20'
                    : dueTodayCount > 0
                      ? 'bg-card text-muted-foreground border-border hover:border-muted-foreground cursor-pointer'
                      : 'bg-card text-muted-foreground/30 border-border cursor-not-allowed'
                )}
              >
                DUE TODAY
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {dueTodayCount === 0
                ? 'No hard deadlines today'
                : `${dueTodayCount} hard deadline${dueTodayCount === 1 ? '' : 's'} today`}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="flex items-center gap-1.5">
        {/* Morning auto-refresh toggle (opt-in cron) */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              title="Morning auto-refresh"
              className={cn(
                'flex items-center justify-center w-7 h-7 rounded-md border transition-colors',
                morning?.enabled
                  ? 'text-primary bg-primary/5 border-primary/20'
                  : 'text-muted-foreground border-border hover:border-muted-foreground',
              )}
            >
              <Clock size={12} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={toggleMorning} className="text-xs gap-2">
              <span className="flex-1">Auto-refresh each morning</span>
              {morning?.enabled && <Check size={12} className="text-primary" />}
            </DropdownMenuItem>
            <div className="px-2 py-1.5 text-[10px] text-muted-foreground/70 leading-snug">
              {morning?.enabled
                ? `Reconciles yesterday into today around ${morning.time} (while the app is running).`
                : 'Off: the deck still deals itself the first time you open it each day.'}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        {onReplan && (
          <button
            onClick={onReplan}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 text-[9px] font-bold rounded-md transition-colors',
              URGENCY_STYLES[urgency],
            )}
          >
            <RefreshCw size={10} />
            Generate New Deck
          </button>
        )}
      </div>
    </div>
  );
}
