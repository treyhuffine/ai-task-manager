"use client";

/**
 * Compact proportional day strip: commitments, gaps, and a now line across
 * workday bounds, with a one-line summary — plus the pairing line, the one
 * bridge between calendar and deck: a code rule matching the current free
 * stretch to the top deck task whose energy suits it. Nothing is ever drawn
 * onto the timeline for the deck; it stays a ranked stack.
 *
 * Lives under the deck's conductor (DeckDayBar) and inside the HUD peek.
 * Clicking opens the full calendar tab (by default in the panel opposite the
 * deck, so deck and calendar end up side by side).
 */

import { useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDashboard } from '@/contexts/dashboard-context';
import { useDayShape } from '@/hooks/use-day-shape';
import { todayLocalDate } from '@/lib/deck/date';
import { formatMinutes, minutesToLabel, parseHhMm } from '@/lib/deck/calendar';
import { eventWindowOnDate, stripSegments } from '@/lib/calendar/layout';
import { pickPairing, type PairableItem } from '@/lib/calendar/pairing';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface DayShapeStripProps {
  /** Today's deck items in rank order — pairing input only, never rendered
   *  as timeline segments. */
  items: PairableItem[];
  /** Hide the pairing line (the HUD peek shows agenda instead). */
  showPairing?: boolean;
  /** Override the click-through (the HUD peek closes itself first). */
  onOpenCalendar?: () => void;
  className?: string;
}

export function DayShapeStrip({
  items,
  showPairing = true,
  onOpenCalendar,
  className,
}: DayShapeStripProps) {
  const today = todayLocalDate();
  const { data } = useDayShape(today, 1);
  const { panelATab, panelBTab, setPanelTab } = useDashboard();

  const day = data?.days[0];
  const segments = useMemo(
    () => (data ? stripSegments(day, data.workday) : []),
    [data, day],
  );

  const now = new Date();
  const pairing = useMemo(
    () => (showPairing ? pickPairing(day, items, now) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showPairing, day, items, now.getMinutes()],
  );

  if (!data || data.status === 'no_providers') return null;

  const wdStart = parseHhMm(data.workday.start);
  const wdEnd = parseHhMm(data.workday.end);
  const span = wdEnd - wdStart;
  if (span <= 0) return null;

  const nowMinute = now.getHours() * 60 + now.getMinutes();
  const nowPct =
    day?.date === today && nowMinute >= wdStart && nowMinute <= wdEnd
      ? ((nowMinute - wdStart) / span) * 100
      : null;

  const nextStart = day
    ? day.events
        .filter((e) => e.countsAsBusy)
        .map((e) => eventWindowOnDate(e, day.date))
        .filter((w): w is NonNullable<typeof w> => w != null)
        .map((w) => w.startMinute)
        .filter((m) => m > nowMinute)
        .sort((a, b) => a - b)[0]
    : undefined;

  const summaryParts = day
    ? [
        `${formatMinutes(day.freeMinutes)} open`,
        `largest ${formatMinutes(day.largestGapMinutes)}`,
        ...(nextStart != null ? [`next ${minutesToLabel(nextStart)}`] : []),
      ]
    : [];

  // Duration labels inside the larger gaps (skip ones too narrow to fit).
  const gapLabels = (day?.gaps ?? [])
    .filter((g) => g.minutes >= 45)
    .map((g) => ({
      centerPct: ((g.startMinute + g.minutes / 2 - wdStart) / span) * 100,
      widthPct: (g.minutes / span) * 100,
      label: formatMinutes(g.minutes),
    }))
    .filter((g) => g.widthPct >= 12);

  const openCalendar =
    onOpenCalendar ??
    (() => {
      const target = panelATab === 'deck' ? 'b' : panelBTab === 'deck' ? 'a' : 'b';
      setPanelTab(target, 'calendar');
    });

  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn('border-b border-border/50', className)}>
        <button
          type="button"
          onClick={openCalendar}
          aria-label="Open calendar"
          className="w-full flex items-center gap-3 px-4 py-1.5 group"
        >
          <div className="relative flex-1 h-4 rounded-[3px] bg-muted/40 overflow-hidden">
            {gapLabels.map((g, i) => (
              <span
                key={`gap-label-${i}`}
                className="absolute inset-y-0 flex items-center -translate-x-1/2 text-[9px] leading-none text-muted-foreground/60 select-none pointer-events-none"
                style={{ left: `${g.centerPct}%` }}
              >
                {g.label}
              </span>
            ))}
            {segments.map((seg, i) => (
              <Tooltip key={`busy-${i}`}>
                <TooltipTrigger asChild>
                  <div
                    className={cn(
                      'absolute inset-y-0 rounded-[3px] bg-muted-foreground/25',
                      seg.clamped && 'border-r-2 border-r-muted-foreground/50',
                    )}
                    style={{ left: `${seg.startPct}%`, width: `${Math.max(seg.widthPct, 0.75)}%` }}
                  />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-[11px]">
                  {seg.detail}
                </TooltipContent>
              </Tooltip>
            ))}
            {nowPct != null && (
              <div className="absolute inset-y-0 w-px bg-primary" style={{ left: `${nowPct}%` }}>
                <div className="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/3 size-1 rounded-full bg-primary" />
              </div>
            )}
          </div>
          {summaryParts.length > 0 && (
            <span className="shrink-0 text-[10px] text-muted-foreground group-hover:text-foreground transition-colors">
              {summaryParts.join(' · ')}
            </span>
          )}
        </button>

        {pairing && (
          <p className="flex items-center gap-1.5 px-4 pb-1.5 text-[10px] text-muted-foreground">
            <Sparkles className="w-2.5 h-2.5 text-primary/60 shrink-0" />
            <span className="truncate">
              {pairing.window} · good window for{' '}
              <span className="text-foreground/80">{pairing.title}</span>
            </span>
          </p>
        )}
      </div>
    </TooltipProvider>
  );
}
