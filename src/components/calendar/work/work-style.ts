import type { CSSProperties } from 'react';
import type { RibbonBin } from '@/lib/work/ribbon';
import type { WorkAgent, WorkDay, WorkSpan } from '@/lib/work/types';

/**
 * An agent's series color: `--series-1` to `--series-8` (globals.css, the
 * validated palette in its fixed order, light and dark), or `--series-other`
 * for slot 0. Marks wear it, text never does (docs/work-view.md, "Colors").
 */
export function seriesColor(slot: number): string {
  return slot >= 1 && slot <= 8 ? `var(--series-${slot})` : 'var(--series-other)';
}

/** A dot, a bar and a wash in an agent's color. */
export function agentStyle(slot: number): { dot: CSSProperties; bar: CSSProperties; wash: CSSProperties } {
  const color = seriesColor(slot);
  return {
    dot: { backgroundColor: color },
    bar: { backgroundColor: color },
    wash: { backgroundColor: `color-mix(in oklch, ${color} 12%, transparent)` },
  };
}

/** The work layer for a range: each day's spans, and who each agent is. */
export interface WorkLayer {
  days: ReadonlyMap<string, WorkDay>;
  spansByDate: ReadonlyMap<string, WorkSpan[]>;
  /** Each day's ribbon windows (`activityBins`). */
  bins: ReadonlyMap<string, RibbonBin[]>;
  agents: ReadonlyMap<string | null, WorkAgent>;
  /** Stacking order: by series slot, Other last. */
  order: (agentId: string | null) => number;
  /** The widest window of the range, so every day's ribbon shares a scale. */
  scale: number;
}

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function minuteLabel(minute: number): string {
  const h24 = Math.floor(minute / 60) % 24;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(minute % 60).padStart(2, '0');
  return `${h12}:${mm} ${h24 < 12 ? 'AM' : 'PM'}`;
}
