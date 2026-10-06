"use client";

/**
 * The dense week: seven real columns of facts. Per day — a slim capacity
 * header (from actual busy time), all-day chips, deadline markers (tasks
 * whose hard deadline lands that day: recorded facts, not estimates), and
 * the day's timed events as compact agenda rows. No verdicts, no scores —
 * judgment stays with the reader.
 *
 * Rendered in the full-screen calendar (it needs width); the in-panel
 * calendar is day-only.
 */

import { Flag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatMinutes, minutesToLabel, parseHhMm } from '@/lib/deck/calendar';
import { eventWindowOnDate } from '@/lib/calendar/layout';
import { formatDayLabel } from '@/lib/calendar/dates';
import type { CalendarDay, CalendarEvent } from '@/lib/calendar/types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { stripeStyle } from './event-color';
import { EventPopoverContent } from './event-popover';
import { WorkWorth } from './work/work-worth';
import type { WorkLayer } from './work/work-style';
import { Tip } from '@/components/ui/tip';

export interface DeadlineMarker {
  taskId: string;
  title: string;
}

export interface WeekViewProps {
  days: CalendarDay[];
  workday: { start: string; end: string };
  today: string;
  deadlinesByDate: Map<string, DeadlineMarker[]>;
  onSelectDay: (date: string) => void;
  onOpenTask: (taskId: string) => void;
  /** With agent work on, each day also says what its work was worth (docs/work-view.md). */
  work?: WorkLayer;
  /** Free time per day, which means nothing without a calendar connected. */
  showOpen?: boolean;
}

export function WeekView({ days, workday, today, deadlinesByDate, onSelectDay, onOpenTask, work, showOpen = true }: WeekViewProps) {
  const span = Math.max(1, parseHhMm(workday.end) - parseHhMm(workday.start));

  return (
    <div className="grid grid-cols-7 gap-2 h-full min-h-0 overflow-y-auto">
      {days.map((day) => {
        const isToday = day.date === today;
        const busyPct = Math.min(100, (day.busyMinutes / span) * 100);
        const deadlines = deadlinesByDate.get(day.date) ?? [];
        const rows = agendaRows(day);

        return (
          <div
            key={day.date}
            className={cn(
              'flex flex-col gap-1.5 rounded-lg border p-2 min-w-0',
              isToday ? 'border-primary/40 bg-primary/5' : 'border-border',
            )}
          >
            {/* Day header — click to jump to that day's view */}
            <button
              type="button"
              onClick={() => onSelectDay(day.date)}
              className="flex flex-col gap-1.5 text-left group shrink-0"
            >
              <span
                className={cn(
                  'text-[11px] font-medium group-hover:underline',
                  isToday ? 'text-primary' : 'text-foreground',
                )}
              >
                {formatDayLabel(day.date)}
              </span>
              {showOpen && (
                <>
                  <span className="relative h-1.5 rounded-full bg-muted/50 overflow-hidden">
                    <span
                      className="absolute inset-y-0 left-0 bg-muted-foreground/40"
                      style={{ width: `${busyPct}%` }}
                    />
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {formatMinutes(day.freeMinutes)} open
                  </span>
                </>
              )}
              <WorkWorth stats={work?.days.get(day.date)?.stats} className="truncate text-[10px]" />
            </button>

            {/* All-day chips */}
            {day.allDay.map((e) => (
              <Tip key={e.id} label={e.calendar ? `${e.title} (${e.calendar.name})` : e.title}>
                <span
                  className="px-1.5 py-0.5 rounded bg-muted text-[10px] text-muted-foreground truncate shrink-0"
                  style={stripeStyle(e.color, 2)}
                >
                  {e.title}
                </span>
              </Tip>
            ))}

            {/* Deadline markers — obligations landing on this day */}
            {deadlines.map((d) => (
              <Tip key={d.taskId} label={`Due: ${d.title}`}>
                <button
                  type="button"
                  onClick={() => onOpenTask(d.taskId)}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-[10px] font-medium text-amber-600 dark:text-amber-400 text-left shrink-0"
                >
                  <Flag size={9} className="shrink-0" />
                  <span className="truncate">{d.title}</span>
                </button>
              </Tip>
            ))}

            {/* Timed events, compact agenda rows */}
            {rows.map(({ event, startMinute }) => (
              <Popover key={`${event.id}-${startMinute}`}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      'flex flex-col rounded-md border border-border bg-muted py-1 pr-1.5 text-left shrink-0',
                      event.color ? 'pl-2.5' : 'pl-1.5',
                      'hover:border-muted-foreground/40 transition-colors',
                      !event.countsAsBusy && 'opacity-40',
                    )}
                    style={stripeStyle(event.color)}
                  >
                    <span className="text-[9px] tabular-nums text-muted-foreground">
                      {minutesToLabel(startMinute)}
                    </span>
                    <span
                      className={cn(
                        'text-[10px] text-foreground truncate leading-tight',
                        event.rsvp === 'declined' && 'line-through',
                      )}
                    >
                      {event.title}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent side="bottom" align="start" className="p-0 w-auto">
                  <EventPopoverContent event={event} />
                </PopoverContent>
              </Popover>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** A day's timed events in order, with their start minute on that day. */
export function agendaRows(day: CalendarDay): Array<{ event: CalendarEvent; startMinute: number }> {
  return day.events
    .map((event) => {
      const w = eventWindowOnDate(event, day.date);
      return w ? { event, startMinute: w.startMinute } : null;
    })
    .filter((x): x is { event: CalendarEvent; startMinute: number } => x != null)
    .sort((a, b) => a.startMinute - b.startMinute);
}
