"use client";

/**
 * The hour-axis day view — the calendar rendered purely as a calendar.
 * Commitments render solid (packed into up to three columns when they
 * overlap, "+N" chip past that), declined/free events render dimmed with a
 * strikethrough. The deck never appears here: it's a ranked stack, not a
 * schedule (see the retrenchment note in docs/calendar-view-spec.md).
 *
 * Geometry: a two-track CSS grid (rem gutter + fluid day column); every
 * vertical position is a percentage of the track, whose height is
 * `hours × var(--hour-h)`. No pixel math in JS.
 */

import { useEffect, useMemo, useRef } from 'react';
import { cn } from '@/lib/utils';
import {
  FULL_DAY_BOUNDS,
  eventWindowOnDate,
  hourMarks,
  minutePct,
  packColumns,
  landingTopMinute,
  trackHeight,
  windowPct,
  type MinuteWindow,
  type PlacedEvent,
} from '@/lib/calendar/layout';
import type { CalendarDay, CalendarEvent } from '@/lib/calendar/types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AllDayRow } from './all-day-row';
import { EventPopoverContent } from './event-popover';
import { NowLine } from './now-line';

/** Blocks shorter than this show the title only (no time sub-label). */
const TIME_LABEL_MIN_MINUTES = 40;

function hourLabel(minute: number): string {
  const h24 = Math.floor(minute / 60) % 24;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12} ${h24 < 12 ? 'AM' : 'PM'}`;
}

export interface DayViewProps {
  date: string;
  day: CalendarDay | undefined;
  workday: { start: string; end: string };
  isToday: boolean;
}

export function DayView({ date, day, workday, isToday }: DayViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  // The full day, always — workday bounds size the DECK, not the calendar.
  const bounds = FULL_DAY_BOUNDS;
  const packed = useMemo(
    () => (day ? packColumns(day.events, date) : { placed: [], overflow: [] }),
    [day, date],
  );
  const hours = useMemo(() => hourMarks(bounds), [bounds]);

  const now = new Date();
  const nowMinute = now.getHours() * 60 + now.getMinutes();
  const showNow = isToday && nowMinute >= bounds.startMinute && nowMinute <= bounds.endMinute;

  // Land the viewport: 7 AM anchored mornings, sliding only when now + 2h
  // of lookahead needs it. Lengths come from the rendered elements.
  useEffect(() => {
    const el = scrollRef.current;
    const track = trackRef.current;
    if (!el || !track || track.clientHeight === 0) return;
    const viewportMinutes = (el.clientHeight / track.clientHeight) * 1440;
    const top = landingTopMinute({
      days: day ? [day] : [],
      today: isToday && day ? day.date : '',
      now: new Date(),
      viewportMinutes,
    });
    el.scrollTop = (minutePct(top, bounds) / 100) * track.clientHeight;
    // Re-land on date change or when the day's data arrives — not per tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, isToday, day == null]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <AllDayRow events={day?.allDay ?? []} />

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {/* mt-2 keeps the first hour label (offset above its gridline) unclipped */}
        <div
          ref={trackRef}
          className="relative mt-2 mb-4 [--hour-h:3rem]"
          style={{ height: trackHeight(bounds) }}
        >
          {/* Hour gridlines, spanning the day column */}
          {hours.map((m) => (
            <div
              key={m}
              className="absolute left-10 right-0 border-t border-border/40"
              style={{ top: `${minutePct(m, bounds)}%` }}
            />
          ))}

          {/* Gutter + day column */}
          <div className="absolute inset-0 grid grid-cols-[2.5rem_1fr]">
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

            <div className="relative">
              {packed.placed.map((p) => (
                <EventCard key={`${p.event.id}-${p.startMinute}`} placed={p} bounds={bounds} />
              ))}

              {packed.overflow.map((group, i) => (
                <Popover key={`overflow-${i}`}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="absolute z-20 w-1/3 right-2 min-h-5 rounded-md border border-border bg-muted px-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                      style={toStyle(windowPct(group, bounds))}
                    >
                      +{group.events.length} more
                    </button>
                  </PopoverTrigger>
                  <PopoverContent side="left" className="p-1 w-64">
                    {group.events.map((e) => (
                      <OverflowRow key={e.id} event={e} date={date} />
                    ))}
                  </PopoverContent>
                </Popover>
              ))}

              {showNow && <NowLine topPct={minutePct(nowMinute, bounds)} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function toStyle({ topPct, heightPct }: { topPct: number; heightPct: number }): React.CSSProperties {
  return { top: `${topPct}%`, height: `${heightPct}%` };
}

function EventCard({ placed, bounds }: { placed: PlacedEvent; bounds: MinuteWindow }) {
  const { event, column, columns } = placed;
  const busy = event.countsAsBusy;
  const minutes = placed.endMinute - placed.startMinute;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'absolute z-20 min-h-5 rounded-md border text-left px-2 py-0.5 overflow-hidden transition-colors',
            'bg-muted border-border hover:border-muted-foreground/40',
            !busy && 'opacity-40',
          )}
          style={{
            ...toStyle(windowPct(placed, bounds)),
            left: `${(column / columns) * 100}%`,
            width: `${100 / columns}%`,
          }}
        >
          <p className={cn('text-[11px] font-medium text-foreground truncate', !busy && 'line-through')}>
            {event.title}
          </p>
          {minutes >= TIME_LABEL_MIN_MINUTES && (
            <p className="text-[9px] text-muted-foreground truncate">{eventTimeLabel(event)}</p>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="p-0 w-auto">
        <EventPopoverContent event={event} />
      </PopoverContent>
    </Popover>
  );
}

function OverflowRow({ event, date }: { event: CalendarEvent; date: string }) {
  const w = eventWindowOnDate(event, date);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center gap-2 rounded px-2 py-1 text-left hover:bg-muted/60 transition-colors"
        >
          <span className="text-[10px] tabular-nums text-muted-foreground/70 w-14 shrink-0">
            {w ? hourMinuteLabel(w.startMinute) : ''}
          </span>
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

function hourMinuteLabel(minute: number): string {
  const h24 = Math.floor(minute / 60) % 24;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(minute % 60).padStart(2, '0');
  return `${h12}:${mm} ${h24 < 12 ? 'AM' : 'PM'}`;
}

function eventTimeLabel(e: CalendarEvent): string {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };
  return `${fmt(e.start)} to ${fmt(e.end)}`;
}
