"use client";

/**
 * The HUD button's popover: compact day strip + today's agenda + summary.
 * Read-only glance surface over real commitments — the full experience lives
 * in the calendar tab.
 */

import { Video } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatMinutes, minutesToLabel } from '@/lib/deck/calendar';
import { eventWindowOnDate } from '@/lib/calendar/layout';
import type { CalendarEvent, CalendarRangeResult } from '@/lib/calendar/types';
import { DayShapeStrip } from './day-shape-strip';

interface AgendaRow {
  key: string;
  startMinute: number;
  timeLabel: string;
  title: string;
  dimmed: boolean;
  joinUrl?: string | null;
}

export function HudDayPeek({
  data,
  onOpenDay,
  onOpenWeek,
}: {
  data: CalendarRangeResult;
  /** Navigate to the calendar tab's day view (leaves the current surface). */
  onOpenDay: () => void;
  /** Open the week overlay in place (works from inside an execution). */
  onOpenWeek: () => void;
}) {
  const day = data.days[0];

  const rows: AgendaRow[] = [];
  if (day) {
    for (const e of day.events) {
      const w = eventWindowOnDate(e, day.date);
      if (!w) continue;
      rows.push({
        key: `e-${e.id}`,
        startMinute: w.startMinute,
        timeLabel: minutesToLabel(w.startMinute),
        title: e.title,
        dimmed: !e.countsAsBusy,
        joinUrl: e.joinUrl,
      });
    }
    rows.sort((a, b) => a.startMinute - b.startMinute);
  }

  const staleAsOf = formatAsOf(data.asOf);

  return (
    <div className="flex flex-col">
      <DayShapeStrip items={[]} showPairing={false} onOpenCalendar={onOpenDay} />

      <div className="max-h-72 overflow-y-auto py-1">
        {day && day.allDay.length > 0 && (
          <div className="flex flex-wrap gap-1 px-3 py-1.5">
            {day.allDay.map((e: CalendarEvent) => (
              <span
                key={e.id}
                className="px-1.5 py-0.5 rounded bg-muted text-[10px] text-muted-foreground truncate max-w-36"
              >
                {e.title}
              </span>
            ))}
          </div>
        )}

        {rows.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground/60">Nothing scheduled today</p>
        ) : (
          rows.map((row) => (
            <div key={row.key} className="flex items-center gap-2.5 px-3 py-1">
              <span className="w-16 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground/70">
                {row.timeLabel}
              </span>
              <span
                className={cn(
                  'flex-1 truncate text-xs',
                  row.dimmed && 'text-muted-foreground/50 line-through',
                )}
              >
                {row.title}
              </span>
              {row.joinUrl && (
                <a
                  href={row.joinUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-border text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Video size={10} />
                  Join
                </a>
              )}
            </div>
          ))
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border/50 px-3 py-2">
        <span className="text-[10px] text-muted-foreground/70">
          {day
            ? `${formatMinutes(day.freeMinutes)} open · largest gap ${formatMinutes(day.largestGapMinutes)}`
            : `As of ${staleAsOf}`}
        </span>
        <span className="flex items-center gap-3">
          <button
            type="button"
            onClick={onOpenDay}
            className="text-[11px] font-medium text-primary hover:underline"
          >
            Day view
          </button>
          <button
            type="button"
            onClick={onOpenWeek}
            className="text-[11px] font-medium text-primary hover:underline"
          >
            Week view
          </button>
        </span>
      </div>
    </div>
  );
}

function formatAsOf(asOf: string): string {
  const d = new Date(asOf);
  if (Number.isNaN(d.getTime())) return 'earlier';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
