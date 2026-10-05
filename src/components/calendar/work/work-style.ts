import type { CSSProperties } from 'react';
import { instantWindowOnDate, packWindows, type MinuteWindow } from '@/lib/calendar/layout';
import type { CalendarEvent } from '@/lib/calendar/types';
import { eventWindowOnDate } from '@/lib/calendar/layout';
import type { WorkAgent, WorkSpan } from '@/lib/work/types';

/**
 * Hues for the palette slots, in agent order. Neighbors sit far apart on the
 * wheel (blue, orange, green, purple, yellow, pink, teal, red, lime, indigo),
 * so the agents at the top of the list never look alike.
 */
const HUES = [221, 28, 145, 285, 50, 335, 185, 5, 95, 255];

/** An agent's tint for a block, and a solid dot for lists. Slot -1 is Ri itself. */
export function agentStyle(color: number): { block: CSSProperties; dot: CSSProperties } {
  if (color < 0) {
    return {
      block: { backgroundColor: 'color-mix(in oklch, var(--primary) 14%, transparent)', borderColor: 'var(--primary)' },
      dot: { backgroundColor: 'var(--primary)' },
    };
  }
  const h = HUES[color % HUES.length]!;
  return {
    block: { backgroundColor: `hsl(${h} 70% 55% / 0.16)`, borderColor: `hsl(${h} 70% 55% / 0.85)` },
    dot: { backgroundColor: `hsl(${h} 70% 55%)` },
  };
}

/** The work layer for a range: each day's spans, and who each agent is. */
export interface WorkLayer {
  spansByDate: ReadonlyMap<string, WorkSpan[]>;
  agents: ReadonlyMap<string | null, WorkAgent>;
}

export type DayItem = { kind: 'event'; event: CalendarEvent } | { kind: 'work'; span: WorkSpan };

/** A day's meetings and work spans, packed together into side-by-side columns. */
export function packDay(events: readonly CalendarEvent[], spans: readonly WorkSpan[], date: string) {
  const entries: Array<{ item: DayItem; window: MinuteWindow }> = [];
  for (const event of events) {
    const window = eventWindowOnDate(event, date);
    if (window) entries.push({ item: { kind: 'event', event }, window });
  }
  for (const span of spans) {
    const window = instantWindowOnDate(span.start, span.end, date);
    if (window) entries.push({ item: { kind: 'work', span }, window });
  }
  return packWindows(entries);
}

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
