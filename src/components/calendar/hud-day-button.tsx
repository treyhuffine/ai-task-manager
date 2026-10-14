"use client";

/**
 * The TopHud next-boundary button — the calendar's ambient layer, present on
 * every surface including ExecutionView. The label IS the glance ("Standup in
 * 40m"); clicking opens a peek popover with two doors, Day view and Week
 * view, into the full-screen calendar (`CalendarModal`). It opens in place,
 * so a look-ahead never yanks you out of an execution.
 *
 * With no calendar connected it shows a dismissible invitation instead of
 * hiding — this is a key feature people would otherwise never discover. One
 * "Don't show this again" and it stays gone (shared flag with the deck
 * strip's invite).
 */

import { useEffect, useState } from 'react';
import { Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { openSettings } from '@/components/settings/settings-store';
import { useDayShape, usePrefetchDayShape } from '@/hooks/use-day-shape';
import { hudLabel } from '@/lib/calendar/hud';
import { todayLocalDate } from '@/lib/deck/date';
import { mondayOf } from '@/lib/calendar/dates';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { dismissCalendarInvite, readInviteDismissed, subscribeInviteDismissed } from './invite';
import { HudDayPeek } from './hud-day-peek';
import { openCalendarModal } from '@/lib/client/calendar-modal';
import { Tip } from '@/components/ui/tip';

const STALE_MS = 15 * 60_000;
const TICK_MS = 30_000;

export function HudDayButton() {
  const today = todayLocalDate();
  const { data } = useDayShape(today, 1);
  const prefetch = usePrefetchDayShape();
  const [open, setOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteDismissed, setInviteDismissed] = useState(readInviteDismissed);
  useEffect(() => subscribeInviteDismissed(() => setInviteDismissed(true)), []);

  // The countdown re-derives from cached data on a local tick — no refetch.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  if (!data) return null;

  // No calendar yet: the button becomes the invitation, until connected or
  // explicitly declined.
  if (data.status === 'no_providers') {
    if (inviteDismissed) return null;
    return (
      <Popover open={inviteOpen} onOpenChange={setInviteOpen}>
        <PopoverTrigger asChild>
          <Tip label="Connect your calendar" onlyWhenTextHidden>
            <button
              type="button"
              aria-label="Connect your calendar"
              className="flex min-w-0 max-w-full items-center gap-1.5 h-7 px-2 whitespace-nowrap rounded-lg border border-dashed border-border text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <Calendar size={12} className="shrink-0" />
              <span className="truncate">Connect <span className="hud-calendar-invite-detail">your </span>calendar</span>
            </button>
          </Tip>
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={6} className="w-72 p-3">
          <p className="text-sm font-medium text-foreground">Your day, at a glance</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Connect a calendar and this becomes a live glance: your next event, a
            countdown when one is close, and full day and week views from anywhere.
            Read-only.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setInviteOpen(false);
                openSettings('plugins');
              }}
              className="px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-[11px] font-medium hover:opacity-90 transition-opacity"
            >
              Connect
            </button>
            <button
              type="button"
              onClick={() => {
                setInviteOpen(false);
                dismissCalendarInvite();
              }}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Don&apos;t show this again
            </button>
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  const { text, tone, event } = hudLabel(data.days[0], data.status, now);
  const fullLabel = event ? [event.title, event.timing, event.overlap].filter(Boolean).join(' ') : text;
  const stale = now.getTime() - Date.parse(data.asOf) > STALE_MS;
  const degraded = data.status === 'degraded' || data.status === 'error';

  const openDay = () => {
    setOpen(false);
    openCalendarModal({ view: 'day', date: today });
  };

  const openWeek = () => {
    setOpen(false);
    openCalendarModal({ view: 'week', date: today });
  };

  return (
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          // Warm the week range while the peek is being read, so Week view
          // opens instantly instead of after a Google round-trip.
          if (next) prefetch(mondayOf(today), 7);
        }}
      >
        <PopoverTrigger asChild>
          <Tip
            label={stale || degraded ? `${fullLabel}\nAs of ${formatAsOf(data.asOf)}` : fullLabel}
            onlyWhenTextHidden={!stale && !degraded}
          >
            <button
              type="button"
              aria-label={`Day shape: ${fullLabel}`}
              className={cn(
                'relative flex min-w-0 max-w-full items-center gap-1.5 h-7 px-2 whitespace-nowrap rounded-lg border text-[11px] font-medium transition-colors',
                tone === 'warning'
                  ? 'text-amber-600 border-amber-500/40 bg-amber-500/10 dark:text-amber-400'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              <Calendar size={12} className="shrink-0" />
              {event ? (
                <>
                  <span className="min-w-0 max-w-56 truncate">{event.title}</span>
                  <span className="hud-calendar-timing shrink-0 tabular-nums">{event.timing}</span>
                  {event.overlap && <span className="hud-calendar-overlap shrink-0">{event.overlap}</span>}
                </>
              ) : <span className="min-w-0 max-w-56 truncate">{text}</span>}
              {(stale || degraded) && (
                <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-amber-500/80" aria-hidden />
              )}
            </button>
          </Tip>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-[21rem] p-0">
          <HudDayPeek data={data} onOpenDay={openDay} onOpenWeek={openWeek} />
        </PopoverContent>
      </Popover>
  );
}

function formatAsOf(asOf: string): string {
  const d = new Date(asOf);
  if (Number.isNaN(d.getTime())) return 'earlier';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
