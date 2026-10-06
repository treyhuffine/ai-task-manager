"use client";

import { Users } from 'lucide-react';
import { useWorkRange } from '@/hooks/use-work';
import { openCalendarModal } from '@/lib/client/calendar-modal';
import { useCalendarWork } from '@/lib/client/calendar-work';
import { todayLocalDate } from '@/lib/deck/date';
import { formatDuration, formatHours, leverage, teamPhrase } from '@/lib/work/equivalents';

/** Every five minutes: a glance, not a ticker. Each read also asks git. */
const REFRESH_MS = 5 * 60_000;

/**
 * Today's work in the header (docs/work-view.md, "Header"): the person-hours
 * your agents and you have put in so far, from every view, including the
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
  const title = [
    `Today so far: about ${formatHours(s.personHours)} person-hours of work${team ? `, ${team}` : ''}.`,
    `You were hands-on ${formatDuration(s.handsOnMinutes)}. Agents ran ${formatDuration(s.agentMinutes)}${lev ? `, ${formatHours(lev)}× your time` : ''}.`,
    'Open the day in the calendar.',
  ].join('\n');

  return (
    <button
      type="button"
      onClick={() => openCalendarModal({ view: 'day', date: today })}
      title={title}
      aria-label={title}
      className="flex h-7 items-center gap-1.5 rounded-lg border border-border px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      <Users size={12} />
      <span className="text-foreground">{formatHours(s.personHours)}</span>
      <span>person-hours today</span>
    </button>
  );
}
