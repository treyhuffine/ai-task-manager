"use client";

import { Users } from 'lucide-react';
import { useWorkRange } from '@/hooks/use-work';
import { openCalendarModal } from '@/lib/client/calendar-modal';
import { useCalendarWork } from '@/lib/client/calendar-work';
import { todayLocalDate } from '@/lib/deck/date';
import { formatDuration, formatHours, leverage, teamPhrase } from '@/lib/work/equivalents';
import { Tip } from '@/components/ui/tip';

/** Every five minutes: a glance, not a ticker. Each read also asks git. */
const REFRESH_MS = 5 * 60_000;

/**
 * Today's work in the header (docs/work-view.md, "Header"): how many hours of
 * human work your agents and you have done so far, from every view, including the
 * execution you're watching. Hover for what it's made of, click to open the
 * day in the calendar. Follows the calendar's Agent work switch, and stays out of
 * the way until there's something to say.
 */
export function WorkHudPill() {
  const { on } = useCalendarWork();
  const today = todayLocalDate();
  const { data } = useWorkRange(today, 1, on, REFRESH_MS);
  const day = data?.dayList[0];
  if (!on || !day || data.start !== today || day.stats.personHours < 1) return null;

  const s = day.stats;
  const lev = leverage(s);
  const team = teamPhrase(s.personHours, 1);
  const lines = [
    `Today so far, about ${formatHours(s.personHours)} hours of human work${lev ? `, ${formatHours(lev)}× your time` : ''}${team ? `, like ${team}` : ''}.`,
    s.handsOnMinutes >= 1
      ? `From ${formatDuration(s.handsOnMinutes)} of your time and ${formatDuration(s.agentMinutes)} of agent time.`
      : `From ${formatDuration(s.agentMinutes)} of agent time, on their own.`,
    'Click to open today in the calendar.',
  ];

  return (
    <Tip
      label={
        <span className="flex max-w-72 flex-col gap-1">
          {lines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </span>
      }
    >
      <button
        type="button"
        onClick={() => openCalendarModal({ view: 'day', date: today })}
        aria-label={lines.join(' ')}
        className="flex h-7 items-center gap-1.5 rounded-lg border border-border px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <Users size={12} />
        <span className="text-foreground">{formatHours(s.personHours)}h</span>
        <span>of human work today</span>
      </button>
    </Tip>
  );
}
