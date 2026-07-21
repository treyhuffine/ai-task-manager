"use client";

/**
 * The TopHud next-boundary button — the calendar's ambient layer, present on
 * every surface including ExecutionView. The label IS the glance ("Standup in
 * 40m"); clicking opens a peek popover with two doors: Day view (navigates to
 * the calendar tab) and Week view (opens the large overlay in place, so a
 * look-ahead never yanks you out of an execution). Hidden entirely when no
 * calendar is connected.
 */

import { useEffect, useState } from 'react';
import { Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDashboard } from '@/contexts/dashboard-context';
import { useDayShape, usePrefetchDayShape } from '@/hooks/use-day-shape';
import { hudLabel } from '@/lib/calendar/hud';
import { todayLocalDate } from '@/lib/deck/date';
import { mondayOf } from '@/lib/calendar/dates';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { requestCalendarDate } from './calendar-store';
import { HudDayPeek } from './hud-day-peek';
import { WeekOverlay } from './week-overlay';

const STALE_MS = 15 * 60_000;
const TICK_MS = 30_000;

export function HudDayButton() {
  const today = todayLocalDate();
  const { data } = useDayShape(today, 1);
  const prefetch = usePrefetchDayShape();
  const { setActiveView, setPanelTab, openTask } = useDashboard();
  const [open, setOpen] = useState(false);
  const [weekOpen, setWeekOpen] = useState(false);

  // The countdown re-derives from cached data on a local tick — no refetch.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  if (!data || data.status === 'no_providers') return null;

  const { text, tone } = hudLabel(data.days[0], data.status, new Date());
  const stale = Date.now() - Date.parse(data.asOf) > STALE_MS;
  const degraded = data.status === 'degraded' || data.status === 'error';

  const goToCalendarTab = () => {
    setActiveView('command');
    setPanelTab('a', 'calendar');
  };

  const openDay = () => {
    setOpen(false);
    goToCalendarTab();
  };

  const openWeek = () => {
    setOpen(false);
    setWeekOpen(true); // overlay in place — no navigation, no jarring
  };

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          // Warm the week range while the peek is being read, so Week view
          // opens instantly instead of after a Google round-trip.
          if (next) prefetch(mondayOf(today), 7);
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Day shape"
            title={stale || degraded ? `As of ${formatAsOf(data.asOf)}` : undefined}
            className={cn(
              'relative flex items-center gap-1.5 h-7 px-2 rounded-lg border text-[11px] font-medium transition-all',
              tone === 'warning'
                ? 'text-amber-600 border-amber-500/40 bg-amber-500/10 dark:text-amber-400'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            <Calendar size={12} />
            <span className="max-w-56 truncate">{text}</span>
            {(stale || degraded) && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500/80" aria-hidden />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-[21rem] p-0">
          <HudDayPeek data={data} onOpenDay={openDay} onOpenWeek={openWeek} />
        </PopoverContent>
      </Popover>

      {weekOpen && (
        <WeekOverlay
          open={weekOpen}
          onOpenChange={setWeekOpen}
          initialDate={today}
          onSelectDay={(date) => {
            // An explicit day choice earns the navigation.
            requestCalendarDate(date);
            goToCalendarTab();
          }}
          onOpenTask={openTask}
        />
      )}
    </>
  );
}

function formatAsOf(asOf: string): string {
  const d = new Date(asOf);
  if (Number.isNaN(d.getTime())) return 'earlier';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
