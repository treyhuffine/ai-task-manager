"use client";

/**
 * The calendar, nearly full screen, over whatever is on screen: the rail's
 * Calendar, the header's next-event peek, the deck's day strip, the calendar
 * panel's Week button and "Open calendar" in ⌘K all open it here
 * (`openCalendarModal`). Esc, the X or a click outside leaves you exactly
 * where you were, often an execution you were watching.
 *
 * Two views of the same calendar, the one last used remembered:
 *
 *   - **Week** (the default): seven days, as an hour grid or a stacked list
 *     (Grid / List, also remembered), with task deadlines. A day's header
 *     opens that day.
 *   - **Day**: one day on an hour axis.
 *
 * Read-only over external events, like every calendar surface (see
 * docs/calendar-view-spec.md). The panel tab (Home, More, Calendar) stays for
 * keeping a day docked beside the deck.
 *
 * Layering matches the task board: z-40, the task slideout's own layer, so a
 * deadline opens its task on top with the calendar dimmed behind it, and on
 * desktop it starts below the header, a window drag region in the desktop app.
 * `?calendar=1` keeps it open across a reload.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, RefreshCw, X } from 'lucide-react';
import { Dialog, DialogDescription, DialogOverlay, DialogPortal, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useDashboard } from '@/contexts/dashboard-context';
import { useDayShape, useRefreshDayShape } from '@/hooks/use-day-shape';
import { useTasks } from '@/hooks/use-tasks';
import { viewKey } from '@/lib/client/active-view';
import {
  closeCalendarModal,
  openCalendarModal,
  readCalendarView,
  rememberCalendarView,
  useCalendarModal,
  type CalendarView,
} from '@/lib/client/calendar-modal';
import { closeTaskBoard } from '@/lib/client/task-board';
import { addDaysLocal, formatDayLabel, formatWeekLabel, mondayOf } from '@/lib/calendar/dates';
import { toDateOnly } from '@/lib/dates';
import { todayLocalDate } from '@/lib/deck/date';
import { cn } from '@/lib/utils';
import { CalendarConnectPrompt } from './calendar-connect-prompt';
import { DayView } from './day-view';
import { WeekGrid } from './week-grid';
import { WeekView, type DeadlineMarker } from './week-view';

/** `?calendar=1` keeps the calendar open across a reload and makes it linkable. */
const CALENDAR_PARAM = 'calendar';

const STALE_MS = 15 * 60_000;

type WeekMode = 'grid' | 'list';
const WEEK_MODE_KEY = 'ri.calendar.weekMode';

function readWeekMode(): WeekMode {
  if (typeof window === 'undefined') return 'grid';
  try {
    return window.localStorage.getItem(WEEK_MODE_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

export function CalendarModal() {
  const { open, openId, view, date } = useCalendarModal();
  const { activeView, closeAllSlideouts } = useDashboard();
  // Whatever had focus when the calendar opened (the rail's Calendar). Radix
  // hands focus back to a `Dialog.Trigger`, and this dialog has none.
  const openerRef = useRef<HTMLElement | null>(null);

  // Open from a `?calendar` link on first mount.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has(CALENDAR_PARAM)) openCalendarModal();
  }, []);

  // Reflect the open state in the URL without a router round-trip, as the
  // board does (see `TaskBoardModal` for why the state is null).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (open === params.has(CALENDAR_PARAM)) return;
    if (open) params.set(CALENDAR_PARAM, '1');
    else params.delete(CALENDAR_PARAM);
    const qs = params.toString();
    const url = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
    window.history.replaceState(null, '', url);
  }, [open]);

  // Going somewhere else closes it.
  const key = viewKey(activeView);
  const keyRef = useRef(key);
  useEffect(() => {
    if (keyRef.current === key) return;
    keyRef.current = key;
    closeCalendarModal();
  }, [key]);

  // One full-screen surface at a time, from a clean stack: the board and an
  // open slideout would sit under the calendar, visible but unreachable.
  useEffect(() => {
    if (!open) return;
    closeTaskBoard();
    closeAllSlideouts();
  }, [open, closeAllSlideouts]);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? openCalendarModal() : closeCalendarModal())}>
      <DialogPortal>
        <DialogOverlay className="z-40" />
        <DialogPrimitive.Content
          className={cn(
            'fixed inset-x-2 top-2 bottom-2 z-40 flex flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl outline-none',
            'md:inset-x-4 md:top-12 md:bottom-4',
            'duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
          )}
          onOpenAutoFocus={(e) => {
            // Focus the calendar, not its first control. Tab reaches the
            // toolbar first.
            e.preventDefault();
            openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            (e.currentTarget as HTMLElement | null)?.focus();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            if (openerRef.current?.isConnected) openerRef.current.focus();
            openerRef.current = null;
          }}
        >
          <DialogDescription className="sr-only">
            Your calendar by week or by day, with task deadlines on the week.
          </DialogDescription>
          {/* Keyed by the open, so each open starts from what it asked for. */}
          <CalendarBody
            key={openId}
            initialView={view ?? readCalendarView()}
            initialDate={date ?? todayLocalDate()}
          />
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

function CalendarBody({ initialView, initialDate }: { initialView: CalendarView; initialDate: string }) {
  const today = todayLocalDate();
  const [view, setViewState] = useState<CalendarView>(initialView);
  // A date in what's shown: the day itself, or any day of the week.
  const [anchor, setAnchor] = useState(initialDate);
  const [weekMode, setWeekModeState] = useState<WeekMode>(readWeekMode);
  const [refreshing, setRefreshing] = useState(false);
  const { openTask } = useDashboard();

  const monday = mondayOf(anchor);
  const start = view === 'day' ? anchor : monday;
  const days = view === 'day' ? 1 : 7;
  const { data } = useDayShape(start, days);
  const refresh = useRefreshDayShape();

  // The commitment calendar shows Todo and In progress deadlines. Consider
  // stays off it (it uses resurface, not the calendar).
  const { data: tasks } = useTasks({ status: ['todo', 'in_progress'] });
  const deadlinesByDate = useMemo(() => {
    const map = new Map<string, DeadlineMarker[]>();
    for (const t of tasks ?? []) {
      const due = toDateOnly(t.hardDeadline);
      if (!due) continue;
      const list = map.get(due) ?? [];
      list.push({ taskId: t.id, title: t.title });
      map.set(due, list);
    }
    return map;
  }, [tasks]);

  const setView = useCallback((next: CalendarView) => {
    rememberCalendarView(next);
    setViewState(next);
  }, []);

  const setWeekMode = useCallback((next: WeekMode) => {
    try {
      window.localStorage.setItem(WEEK_MODE_KEY, next);
    } catch {
      // storage unavailable: the choice holds for this session
    }
    setWeekModeState(next);
  }, []);

  const step = (dir: -1 | 1) => setAnchor((a) => addDaysLocal(a, dir * (view === 'day' ? 1 : 7)));
  const showingToday = view === 'day' ? anchor === today : monday === mondayOf(today);

  const openDay = (date: string) => {
    setAnchor(date);
    setView('day');
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh(start, days);
    } finally {
      setRefreshing(false);
    }
  };

  const stale = data ? Date.now() - Date.parse(data.asOf) > STALE_MS : false;
  const degraded = data?.status === 'degraded' || data?.status === 'error';
  const noCalendar = data?.status === 'no_providers';

  return (
    <>
      <header className="flex flex-shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <DialogTitle className="flex items-center gap-1.5 px-1 text-sm font-semibold">
          <CalendarIcon className="size-4 text-muted-foreground" />
          Calendar
        </DialogTitle>

        {!noCalendar && (
          <>
            <Segmented
              label="View"
              value={view}
              options={[
                { value: 'week', label: 'Week' },
                { value: 'day', label: 'Day' },
              ]}
              onChange={setView}
            />

            <div className="flex items-center">
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label={view === 'day' ? 'Previous day' : 'Previous week'}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              >
                <ChevronLeft size={15} />
              </button>
              <button
                type="button"
                onClick={() => setAnchor(today)}
                disabled={showingToday}
                className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:cursor-default disabled:text-muted-foreground/50 disabled:hover:bg-transparent"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label={view === 'day' ? 'Next day' : 'Next week'}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              >
                <ChevronRight size={15} />
              </button>
            </div>

            <span className="truncate text-sm font-medium text-foreground">
              {view === 'day' ? formatDayLabel(anchor) : formatWeekLabel(monday)}
            </span>
          </>
        )}

        <div className="flex-1" />

        {!noCalendar && (
          <>
            {view === 'week' && (
              <Segmented
                label="Week layout"
                value={weekMode}
                options={[
                  { value: 'grid', label: 'Grid' },
                  { value: 'list', label: 'List' },
                ]}
                onChange={setWeekMode}
              />
            )}
            <button
              type="button"
              onClick={handleRefresh}
              aria-label="Refresh calendar"
              title={
                data
                  ? `Updated ${formatAsOf(data.asOf)}${degraded ? ', some calendars unreachable' : ''}`
                  : 'Refresh'
              }
              className="relative flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <RefreshCw size={14} className={cn(refreshing && 'animate-spin')} />
              {(stale || degraded) && (
                <span className="absolute top-1 right-1 size-1.5 rounded-full bg-amber-500/80" aria-hidden />
              )}
            </button>
          </>
        )}

        <DialogPrimitive.Close
          className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Close calendar"
          title="Close calendar (Esc)"
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      </header>

      <div className={cn('min-h-0 flex-1', !noCalendar && 'px-4 pt-3')}>
        {noCalendar ? (
          <CalendarConnectPrompt onConnect={closeCalendarModal} />
        ) : view === 'day' ? (
          <DayView
            date={anchor}
            day={data?.days[0]}
            workday={data?.workday ?? { start: '09:00', end: '18:00' }}
            isToday={anchor === today}
          />
        ) : !data ? (
          // Loading and failure never render as an empty week: "no data"
          // and "no meetings" are different facts.
          <WeekSkeleton />
        ) : data.status === 'error' ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
            <p className="text-sm font-medium text-foreground">Calendar unreachable</p>
            <p className="text-xs text-muted-foreground">
              Could not read your calendars just now. Refresh to try again.
            </p>
          </div>
        ) : weekMode === 'grid' ? (
          <WeekGrid
            days={data.days}
            workday={data.workday}
            today={today}
            deadlinesByDate={deadlinesByDate}
            onSelectDay={openDay}
            onOpenTask={openTask}
          />
        ) : (
          <WeekView
            days={data.days}
            workday={data.workday}
            today={today}
            deadlinesByDate={deadlinesByDate}
            onSelectDay={openDay}
            onOpenTask={openTask}
          />
        )}
      </div>
    </>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center overflow-hidden rounded-md border border-border">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'px-2 py-0.5 text-[11px] font-medium transition-colors',
            value === o.value ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function WeekSkeleton() {
  return (
    <div className="grid h-full grid-cols-7 gap-2 pb-4">
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
  );
}

function formatAsOf(asOf: string): string {
  const d = new Date(asOf);
  if (Number.isNaN(d.getTime())) return 'earlier';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
