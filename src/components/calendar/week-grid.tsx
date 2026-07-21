"use client";

/**
 * The week as an hour-by-day grid — the familiar calendar encoding, for
 * reading the SHAPE of the week: when things cluster, which mornings are
 * safe, how days align. All-day chips and deadline markers (facts that have
 * no hour) live in a pinned header row above the grid.
 *
 * Geometry: one CSS grid (rem gutter + seven fluid day tracks); events
 * position by percentage WITHIN their day cell, vertical positions are
 * percentages of the track, and the track height is `hours × var(--hour-h)`.
 * No pixel math in JS.
 */

import { useEffect, useMemo, useRef } from 'react';
import { Flag } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  FULL_DAY_BOUNDS,
  hourMarks,
  minutePct,
  packColumns,
  landingTopMinute,
  trackHeight,
  windowPct,
  type MinuteWindow,
  type PlacedEvent,
} from '@/lib/calendar/layout';
import { formatMinutes } from '@/lib/deck/calendar';
import { formatDayLabel } from '@/lib/calendar/dates';
import type { CalendarDay, CalendarEvent } from '@/lib/calendar/types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { EventPopoverContent } from './event-popover';
import { NowLine } from './now-line';
import type { DeadlineMarker } from './week-view';

const GRID_COLS = 'grid-cols-[2.5rem_repeat(7,minmax(0,1fr))]';

function hourLabel(minute: number): string {
  const h24 = Math.floor(minute / 60) % 24;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12} ${h24 < 12 ? 'AM' : 'PM'}`;
}

export interface WeekGridProps {
  days: CalendarDay[];
  workday: { start: string; end: string };
  today: string;
  deadlinesByDate: Map<string, DeadlineMarker[]>;
  onSelectDay: (date: string) => void;
  onOpenTask: (taskId: string) => void;
}

export function WeekGrid({ days, workday, today, deadlinesByDate, onSelectDay, onOpenTask }: WeekGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  // The full day, always — workday bounds size the DECK, not the calendar.
  const bounds = FULL_DAY_BOUNDS;
  const packed = useMemo(
    () => days.map((day) => ({ day, packed: packColumns(day.events, day.date) })),
    [days],
  );
  const hours = useMemo(() => hourMarks(bounds), [bounds]);

  const now = new Date();
  const nowMinute = now.getHours() * 60 + now.getMinutes();
  const hasToday = days.some((d) => d.date === today);
  const showNow = hasToday && nowMinute >= bounds.startMinute && nowMinute <= bounds.endMinute;

  // Land the viewport: 7 AM anchored, sliding only when now + 2h of
  // lookahead needs it (today on screen). Lengths from rendered elements.
  useEffect(() => {
    const el = scrollRef.current;
    const track = trackRef.current;
    if (!el || !track || days.length === 0 || track.clientHeight === 0) return;
    const viewportMinutes = (el.clientHeight / track.clientHeight) * 1440;
    const top = landingTopMinute({ days, today, now: new Date(), viewportMinutes });
    el.scrollTop = (minutePct(top, bounds) / 100) * track.clientHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.length, hasToday]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Pinned header: day labels + the hour-less facts (all-day, deadlines) */}
      <div className={cn('shrink-0 grid border-b border-border/60', GRID_COLS)}>
        <div />
        {days.map((day) => {
          const isToday = day.date === today;
          const deadlines = deadlinesByDate.get(day.date) ?? [];
          return (
            <div key={day.date} className="flex flex-col gap-1 px-1 pb-1.5 min-w-0">
              <button
                type="button"
                onClick={() => onSelectDay(day.date)}
                className={cn(
                  'text-left text-[11px] font-medium hover:underline truncate',
                  isToday ? 'text-primary' : 'text-foreground',
                )}
              >
                {formatDayLabel(day.date)}
                <span className="ml-1.5 text-[9px] font-normal text-muted-foreground">
                  {formatMinutes(day.freeMinutes)} open
                </span>
              </button>
              {day.allDay.map((e) => (
                <span
                  key={e.id}
                  title={e.title}
                  className="px-1.5 py-0.5 rounded bg-muted text-[10px] text-muted-foreground truncate"
                >
                  {e.title}
                </span>
              ))}
              {deadlines.map((d) => (
                <button
                  key={d.taskId}
                  type="button"
                  onClick={() => onOpenTask(d.taskId)}
                  title={`Due: ${d.title}`}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-[10px] font-medium text-amber-600 dark:text-amber-400 text-left"
                >
                  <Flag size={9} className="shrink-0" />
                  <span className="truncate">{d.title}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>

      {/* The time grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div
          ref={trackRef}
          className="relative mt-2 mb-2 [--hour-h:2.75rem]"
          style={{ height: trackHeight(bounds) }}
        >
          {/* Hour gridlines, spanning the day columns */}
          {hours.map((m) => (
            <div
              key={m}
              className="absolute left-10 right-0 border-t border-border/40"
              style={{ top: `${minutePct(m, bounds)}%` }}
            />
          ))}

          <div className={cn('absolute inset-0 grid', GRID_COLS)}>
            {/* Hour labels in the gutter */}
            <div className="relative select-none">
              {hours.map((m) => (
                <span
                  key={m}
                  className="absolute left-1.5 -translate-y-1/2 text-[9px] text-muted-foreground/60"
                  style={{ top: `${minutePct(m, bounds)}%` }}
                >
                  {hourLabel(m)}
                </span>
              ))}
            </div>

            {/* One relative cell per day; everything inside is cell-percentage */}
            {packed.map(({ day, packed: p }) => {
              const isToday = day.date === today;
              return (
                <div
                  key={day.date}
                  className={cn('relative border-l border-border/30 min-w-0', isToday && 'bg-primary/5')}
                >
                  {p.placed.map((placed) => (
                    <GridEvent key={`${placed.event.id}-${placed.startMinute}`} placed={placed} bounds={bounds} />
                  ))}
                  {p.overflow.map((group, gi) => (
                    <Popover key={`ov-${day.date}-${gi}`}>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="absolute z-20 right-0 w-1/3 min-h-4 rounded border border-border bg-muted px-1 text-[9px] text-muted-foreground hover:text-foreground transition-colors"
                          style={toStyle(windowPct(group, bounds))}
                        >
                          +{group.events.length}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent side="left" className="p-1 w-64">
                        {group.events.map((e) => (
                          <OverflowRow key={e.id} event={e} />
                        ))}
                      </PopoverContent>
                    </Popover>
                  ))}
                  {showNow && isToday && <NowLine topPct={minutePct(nowMinute, bounds)} />}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function toStyle({ topPct, heightPct }: { topPct: number; heightPct: number }): React.CSSProperties {
  return { top: `${topPct}%`, height: `${heightPct}%` };
}

function GridEvent({ placed, bounds }: { placed: PlacedEvent; bounds: MinuteWindow }) {
  const { event, column, columns } = placed;
  const busy = event.countsAsBusy;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'absolute z-10 min-h-4 rounded border text-left overflow-hidden transition-colors',
            'bg-muted border-border hover:border-muted-foreground/40',
            !busy && 'opacity-40',
          )}
          style={{
            ...toStyle(windowPct(placed, bounds)),
            left: `${(column / columns) * 100}%`,
            width: `${100 / columns}%`,
          }}
        >
          <p className={cn('px-1 py-0.5 text-[9px] leading-tight text-foreground truncate', !busy && 'line-through')}>
            {event.title}
          </p>
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="p-0 w-auto">
        <EventPopoverContent event={event} />
      </PopoverContent>
    </Popover>
  );
}

function OverflowRow({ event }: { event: CalendarEvent }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center gap-2 rounded px-2 py-1 text-left hover:bg-muted/60 transition-colors"
        >
          <span className={cn('flex-1 truncate text-xs', !event.countsAsBusy && 'line-through opacity-50')}>
            {event.title}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="left" className="p-0 w-auto">
        <EventPopoverContent event={event} />
      </PopoverContent>
    </Popover>
  );
}
