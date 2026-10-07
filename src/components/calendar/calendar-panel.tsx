"use client";

/**
 * The phone's calendar (More, Calendar) — purely a calendar, and purely a
 * DAY: an hour axis fits a phone's width, seven columns never will. Every
 * door on a larger screen opens the full-screen calendar (`CalendarModal`),
 * and so does the Week button here where it shows (md and up). Read-only
 * over external events: the deck never renders here — it's a ranked stack,
 * not a schedule (see the retrenchment note in docs/calendar-view-spec.md).
 */

import { useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Columns3,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDayShape, usePrefetchDayShape, useRefreshDayShape } from '@/hooks/use-day-shape';
import { todayLocalDate } from '@/lib/deck/date';
import { addDaysLocal, formatDayLabel, mondayOf } from '@/lib/calendar/dates';
import { openCalendarModal } from '@/lib/client/calendar-modal';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { CalendarConnectPrompt } from './calendar-connect-prompt';
import { DayView } from './day-view';

const STALE_MS = 15 * 60_000;

export function CalendarPanel() {
  const today = todayLocalDate();
  const [anchor, setAnchor] = useState(today);
  const [refreshing, setRefreshing] = useState(false);

  const { data } = useDayShape(anchor, 1);
  const refresh = useRefreshDayShape();
  const prefetch = usePrefetchDayShape();

  // Warm the week range so the Week button opens instantly.
  useEffect(() => {
    prefetch(mondayOf(today), 7);
  }, [prefetch, today]);

  const step = (dir: -1 | 1) => setAnchor((a) => addDaysLocal(a, dir));

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh(anchor, 1);
    } finally {
      setRefreshing(false);
    }
  };

  const stale = data ? Date.now() - Date.parse(data.asOf) > STALE_MS : false;
  const degraded = data?.status === 'degraded' || data?.status === 'error';

  if (data?.status === 'no_providers') {
    return <CalendarConnectPrompt />;
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col h-full min-h-0">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border shrink-0">
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="Previous day"
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              type="button"
              onClick={() => setAnchor(today)}
              className={cn(
                'px-1.5 py-0.5 rounded-md text-[11px] font-medium transition-colors',
                anchor === today
                  ? 'text-muted-foreground/50 cursor-default'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
              )}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="Next day"
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          <span className="text-xs font-medium text-foreground truncate">
            {formatDayLabel(anchor)}
          </span>

          <div className="flex-1" />

          {/* Week look-ahead — opens the full-screen calendar (needs width) */}
          <button
            type="button"
            onClick={() => openCalendarModal({ view: 'week', date: anchor })}
            className="hidden md:flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-border text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <Columns3 size={11} />
            Week
          </button>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleRefresh}
                aria-label="Refresh calendar"
                className="relative p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              >
                <RefreshCw size={13} className={cn(refreshing && 'animate-spin')} />
                {(stale || degraded) && (
                  <span className="absolute top-0 right-0 w-1.5 h-1.5 rounded-full bg-amber-500/80" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[11px]">
              {data ? `Updated ${formatAsOf(data.asOf)}${degraded ? ' · some calendars unreachable' : ''}` : 'Refresh'}
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Body — always the day */}
        <div className="flex-1 min-h-0">
          <DayView
            date={anchor}
            day={data?.days[0]}
            workday={data?.workday ?? { start: '09:00', end: '18:00' }}
            isToday={anchor === today}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}

function formatAsOf(asOf: string): string {
  const d = new Date(asOf);
  if (Number.isNaN(d.getTime())) return 'earlier';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
