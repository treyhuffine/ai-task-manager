"use client";

/**
 * All-day events pinned above the hour axis: birthdays, OOO, multi-day spans.
 * They never join the busy math (a birthday must not zero out the day) but
 * they absolutely belong in view. Collapses past three chips.
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { CalendarEvent } from '@/lib/calendar/types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { EventPopoverContent } from './event-popover';

const VISIBLE = 3;

export function AllDayRow({ events }: { events: CalendarEvent[] }) {
  const [expanded, setExpanded] = useState(false);
  if (events.length === 0) return null;

  const visible = expanded ? events : events.slice(0, VISIBLE);
  const hidden = events.length - VISIBLE;

  return (
    <div className="flex flex-wrap items-center gap-1 px-3 py-1.5 border-b border-border/50">
      {visible.map((e) => (
        <Popover key={e.id}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                'px-1.5 py-0.5 rounded bg-muted text-[10px] text-muted-foreground truncate max-w-[160px]',
                'hover:text-foreground transition-colors',
              )}
            >
              {e.title}
            </button>
          </PopoverTrigger>
          <PopoverContent side="bottom" align="start" className="p-0 w-auto">
            <EventPopoverContent event={e} />
          </PopoverContent>
        </Popover>
      ))}
      {!expanded && hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="px-1.5 py-0.5 rounded text-[10px] text-muted-foreground/70 hover:text-foreground transition-colors"
        >
          +{hidden} more
        </button>
      )}
    </div>
  );
}
