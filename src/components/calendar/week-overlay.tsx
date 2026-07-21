"use client";

/**
 * The week, given the width it needs. Day view lives in the panel (the
 * companion surface beside the deck); the week is a deliberate look-ahead
 * moment, so it opens directly as a large overlay — no cramped in-panel
 * intermediate. Esc or a day click drops you back to the day view.
 *
 * Two renderings of the same facts, toggled and remembered: **Grid** (hour
 * by day, the familiar calendar encoding — shows the shape of the week and
 * carries the now marker) and **List** (stacked agenda per day — denser
 * reading when the week is sparse). Deadline markers and all-day chips
 * appear in both.
 */

import { useCallback, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDayShape } from '@/hooks/use-day-shape';
import { useTasks } from '@/hooks/use-tasks';
import { todayLocalDate } from '@/lib/deck/date';
import { addDaysLocal, formatWeekLabel, mondayOf } from '@/lib/calendar/dates';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { WeekGrid } from './week-grid';
import { WeekView, type DeadlineMarker } from './week-view';

type WeekMode = 'grid' | 'list';

const MODE_KEY = 'flow.calendar.weekMode';

function readMode(): WeekMode {
  if (typeof window === 'undefined') return 'grid';
  try {
    return window.localStorage.getItem(MODE_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

export interface WeekOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The week initially shown contains this date. */
  initialDate: string;
  /** Jump the panel's day view to a date (overlay closes first). */
  onSelectDay: (date: string) => void;
  onOpenTask: (taskId: string) => void;
}

export function WeekOverlay({ open, onOpenChange, initialDate, onSelectDay, onOpenTask }: WeekOverlayProps) {
  const today = todayLocalDate();
  const [monday, setMonday] = useState(() => mondayOf(initialDate));
  const [mode, setMode] = useState<WeekMode>(readMode);
  const { data } = useDayShape(monday, 7);
  const { data: tasks } = useTasks({ status: 'active' });

  // Hard deadlines are date-only strings — group once, both modes render them.
  const deadlinesByDate = useMemo(() => {
    const map = new Map<string, DeadlineMarker[]>();
    for (const t of tasks ?? []) {
      const date = t.hardDeadline?.slice(0, 10);
      if (!date) continue;
      const list = map.get(date) ?? [];
      list.push({ taskId: t.id, title: t.title });
      map.set(date, list);
    }
    return map;
  }, [tasks]);

  const setModePersisted = useCallback((next: WeekMode) => {
    try {
      window.localStorage.setItem(MODE_KEY, next);
    } catch {
      // storage unavailable — state still updates for this session
    }
    setMode(next);
  }, []);

  const step = (dir: -1 | 1) => setMonday((m) => addDaysLocal(m, dir * 7));

  const selectDay = (date: string) => {
    onOpenChange(false);
    onSelectDay(date);
  };

  const openTask = (taskId: string) => {
    onOpenChange(false);
    onOpenTask(taskId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[min(75rem,94vw)] h-[85vh] flex flex-col gap-4 p-5 pb-0 overflow-hidden">
        <DialogDescription className="sr-only">
          Week view: commitments, deadlines, and open time per day
        </DialogDescription>

        {/* Header: week nav + mode toggle */}
        <div className="flex items-center gap-2 shrink-0">
          <DialogTitle className="text-sm font-semibold text-foreground">
            {formatWeekLabel(monday)}
          </DialogTitle>
          <div className="flex items-center ml-2">
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="Previous week"
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              type="button"
              onClick={() => setMonday(mondayOf(today))}
              className={cn(
                'px-1.5 py-0.5 rounded-md text-[11px] font-medium transition-colors',
                monday === mondayOf(today)
                  ? 'text-muted-foreground/50 cursor-default'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
              )}
            >
              This week
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="Next week"
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          <div className="flex items-center rounded-md border border-border overflow-hidden">
            {(['grid', 'list'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setModePersisted(m)}
                className={cn(
                  'px-2 py-0.5 text-[10px] font-medium capitalize transition-colors',
                  mode === m
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {m}
              </button>
            ))}
          </div>

          <div className="flex-1" />
        </div>

        {/* The seven columns — loading and failure must never render as an
            empty week ("no data" and "no meetings" are different facts). */}
        <div className="flex-1 min-h-0">
          {!data ? (
            <div className="grid grid-cols-7 gap-2 h-full">
              {Array.from({ length: 7 }, (_, i) => (
                <div key={i} className="flex flex-col gap-2 rounded-lg border border-border p-2">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-1.5 w-full rounded-full" />
                  <Skeleton className="h-3 w-12" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-3/4" />
                </div>
              ))}
            </div>
          ) : data.status === 'error' ? (
            <div className="flex flex-col items-center justify-center h-full gap-1 text-center">
              <p className="text-sm font-medium text-foreground">Calendar unreachable</p>
              <p className="text-xs text-muted-foreground">
                Could not read your calendars just now. Close and retry in a moment.
              </p>
            </div>
          ) : mode === 'grid' ? (
            <WeekGrid
              days={data.days}
              workday={data.workday}
              today={today}
              deadlinesByDate={deadlinesByDate}
              onSelectDay={selectDay}
              onOpenTask={openTask}
            />
          ) : (
            <WeekView
              days={data.days}
              workday={data.workday}
              today={today}
              deadlinesByDate={deadlinesByDate}
              onSelectDay={selectDay}
              onOpenTask={openTask}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
