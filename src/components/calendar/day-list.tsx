"use client";

/**
 * One day as a list, the List tab in Day: what the hour grid can't fit. Each
 * meeting with its whole time range, calendar (its color down the left edge),
 * location and Join, the free stretches between them, and where now falls.
 * All-day events and deadlines sit at the top. Click a meeting for its
 * details, as everywhere else.
 */

import { Flag, MapPin, Video } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { eventWindowOnDate } from '@/lib/calendar/layout';
import type { CalendarDay, CalendarEvent } from '@/lib/calendar/types';
import { formatMinutes, minutesToLabel } from '@/lib/deck/calendar';
import { cn } from '@/lib/utils';
import { stripeStyle } from './event-color';
import { EventPopoverContent } from './event-popover';
import type { DeadlineMarker } from './week-view';

/** A free stretch shorter than this isn't worth a row. */
const MIN_GAP_MINUTES = 30;

type Row =
  | { kind: 'event'; at: number; end: number; event: CalendarEvent }
  | { kind: 'gap'; at: number; minutes: number }
  | { kind: 'now'; at: number };

export function DayList({
  day,
  deadlines,
  onOpenTask,
  isToday,
  showGaps,
}: {
  day: CalendarDay | undefined;
  deadlines: readonly DeadlineMarker[];
  onOpenTask: (taskId: string) => void;
  isToday: boolean;
  /** Free time means nothing without a calendar connected. */
  showGaps: boolean;
}) {
  if (!day) return null;
  const rows: Row[] = [];
  for (const event of day.events) {
    const w = eventWindowOnDate(event, day.date);
    if (w) rows.push({ kind: 'event', at: w.startMinute, end: w.endMinute, event });
  }
  if (showGaps) {
    for (const g of day.gaps) if (g.minutes >= MIN_GAP_MINUTES) rows.push({ kind: 'gap', at: g.startMinute, minutes: g.minutes });
  }
  if (isToday) {
    const now = new Date();
    rows.push({ kind: 'now', at: now.getHours() * 60 + now.getMinutes() });
  }
  // Events before a gap at the same minute, and now after anything that starts then.
  const order = { event: 0, gap: 1, now: 2 } as const;
  rows.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind]);
  const hasEvents = rows.some((r) => r.kind === 'event');

  return (
    <div className="h-full overflow-y-auto pb-6 pr-1">
      <div className="max-w-3xl space-y-3">
        {(day.allDay.length > 0 || deadlines.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-28 shrink-0 text-[11px] text-muted-foreground">All day</span>
            {day.allDay.map((e) => (
              <Popover key={e.id}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="max-w-64 truncate rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                    style={stripeStyle(e.color, 2)}
                  >
                    {e.title}
                  </button>
                </PopoverTrigger>
                <PopoverContent side="bottom" align="start" className="w-auto p-0">
                  <EventPopoverContent event={e} />
                </PopoverContent>
              </Popover>
            ))}
            {deadlines.map((d) => (
              <button
                key={d.taskId}
                type="button"
                onClick={() => onOpenTask(d.taskId)}
                className="flex max-w-64 items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400"
              >
                <Flag size={10} className="shrink-0" />
                <span className="truncate">{d.title}</span>
              </button>
            ))}
          </div>
        )}

        {!hasEvents ? (
          <p className="py-8 text-sm text-muted-foreground">Nothing booked.</p>
        ) : (
          <ol className="space-y-1">
            {rows.map((row) =>
              row.kind === 'event' ? (
                <li key={`e-${row.event.id}-${row.at}`}>
                  <EventRow event={row.event} start={row.at} end={row.end} />
                </li>
              ) : row.kind === 'gap' ? (
                <li key={`g-${row.at}`} className="flex items-center gap-3 py-1 text-[11px] text-muted-foreground/70">
                  <span className="w-28 shrink-0 tabular-nums">{minutesToLabel(row.at)}</span>
                  <span className="h-px flex-1 border-t border-dashed border-border" aria-hidden />
                  <span>{formatMinutes(row.minutes)} free</span>
                </li>
              ) : (
                <li key="now" className="flex items-center gap-3 py-0.5 text-[11px] font-medium text-primary" aria-label="Now">
                  <span className="w-28 shrink-0 tabular-nums">{minutesToLabel(row.at)}</span>
                  <span className="h-px flex-1 bg-primary" aria-hidden />
                  <span>Now</span>
                </li>
              ),
            )}
          </ol>
        )}
      </div>
    </div>
  );
}

function EventRow({ event, start, end }: { event: CalendarEvent; start: number; end: number }) {
  const declined = event.rsvp === 'declined';
  return (
    <div className={cn('flex items-stretch gap-3', !event.countsAsBusy && 'opacity-50')}>
      <div className="w-28 shrink-0 pt-1.5 text-[11px] tabular-nums leading-tight">
        <p className="text-foreground">{minutesToLabel(start)}</p>
        <p className="text-muted-foreground">to {minutesToLabel(end)}</p>
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'flex min-w-0 flex-1 items-center gap-3 rounded-md border border-border bg-muted py-1.5 pr-2 text-left transition-colors hover:border-muted-foreground/40',
              event.color ? 'pl-3.5' : 'pl-2.5',
            )}
            style={stripeStyle(event.color)}
          >
            <span className="min-w-0 flex-1">
              <span className={cn('block truncate text-sm font-medium text-foreground', declined && 'line-through')}>{event.title}</span>
              <span className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
                {event.calendar && <span className="truncate">{event.calendar.name}</span>}
                {event.location && (
                  <span className="flex min-w-0 items-center gap-1">
                    <MapPin size={10} className="shrink-0" />
                    <span className="truncate">{event.location}</span>
                  </span>
                )}
              </span>
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent side="right" align="start" className="w-auto p-0">
          <EventPopoverContent event={event} />
        </PopoverContent>
      </Popover>
      {/* Always the same width, so every card ends at the same edge. */}
      <div className="flex w-16 shrink-0 items-center justify-end">
        {event.joinUrl && !declined && (
          <a
            href={event.joinUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <Video size={12} />
            Join
          </a>
        )}
      </div>
    </div>
  );
}
