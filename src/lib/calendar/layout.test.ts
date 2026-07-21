import { describe, expect, it } from 'vitest';
import { normalizeGoogleEvent } from './events';
import {
  FULL_DAY_BOUNDS,
  eventWindowOnDate,
  hourMarks,
  minutePct,
  packColumns,
  landingTopMinute,
  stripSegments,
  trackHeight,
  windowPct,
} from './layout';
import type { CalendarDay, CalendarEvent } from './types';

const DATE = '2026-07-20';
const WORKDAY = { start: '09:00', end: '18:00' };

function ev(id: string, start: string, end: string, extra: Record<string, unknown> = {}): CalendarEvent {
  return normalizeGoogleEvent({ id, summary: id, start, end, ...extra }, 'c1')!;
}

function day(events: CalendarEvent[]): CalendarDay {
  return {
    date: DATE,
    allDay: [],
    events,
    gaps: [],
    freeMinutes: 0,
    largestGapMinutes: 0,
    busyMinutes: 0,
  };
}

describe('fractional time math (no pixels in JS)', () => {
  const bounds = { startMinute: 540, endMinute: 1080 }; // 9:00-18:00
  it('minutePct maps a minute to its percentage of the track', () => {
    expect(minutePct(540, bounds)).toBe(0);
    expect(minutePct(810, bounds)).toBe(50);
    expect(minutePct(1080, bounds)).toBe(100);
  });
  it('windowPct maps an interval to top/height percentages', () => {
    expect(windowPct({ startMinute: 600, endMinute: 660 }, bounds)).toEqual({
      topPct: minutePct(600, bounds),
      heightPct: (60 / 540) * 100,
    });
  });
  it('hourMarks lists the whole hours in range', () => {
    expect(hourMarks({ startMinute: 540, endMinute: 720 })).toEqual([540, 600, 660, 720]);
  });
  it('trackHeight defers the actual length to the CSS hour variable', () => {
    expect(trackHeight(bounds)).toBe('calc(9 * var(--hour-h))');
  });
});

describe('landingTopMinute (worked backward from the reading)', () => {
  const at = (h: number, m = 0) => new Date(2026, 6, 20, h, m);
  const VIEW = 600; // a 10h visible window

  it('an empty morning anchors the top row at 7 AM', () => {
    expect(
      landingTopMinute({ days: [day([])], today: DATE, now: at(8), viewportMinutes: VIEW }),
    ).toBe(420);
  });

  it('an event before 7 AM pulls the top up with a little runway', () => {
    const d = day([ev('flight', `${DATE}T06:30:00`, `${DATE}T08:00:00`)]);
    expect(
      landingTopMinute({ days: [d], today: '2026-07-25', now: at(9), viewportMinutes: VIEW }),
    ).toBe(375); // 6:15
  });

  it('today slides down only when now + 2h lookahead no longer fits', () => {
    // 14:00 now, 10h window from 7 AM reaches 17:00 — 16:00 fits, stay anchored.
    expect(
      landingTopMinute({ days: [day([])], today: DATE, now: at(14), viewportMinutes: VIEW }),
    ).toBe(420);
    // 16:00 now needs 18:00 visible → top slides to 8:00.
    expect(
      landingTopMinute({ days: [day([])], today: DATE, now: at(16), viewportMinutes: VIEW }),
    ).toBe(480);
  });

  it('an early riser never has now above the frame', () => {
    expect(
      landingTopMinute({ days: [day([])], today: DATE, now: at(5, 40), viewportMinutes: VIEW }),
    ).toBe(310); // 5:10 — thirty minutes of past, not a 7 AM anchor hiding now
  });

  it('a browsed evening-only day frames its first event, not an empty 7 AM', () => {
    const d = day([ev('dinner', `${DATE}T19:00:00`, `${DATE}T21:00:00`)]);
    expect(
      landingTopMinute({ days: [d], today: '2026-07-25', now: at(9), viewportMinutes: 360 }),
    ).toBe(1080); // 18:00 — an hour of context above the 19:00 dinner
  });

  it('the frame clamps to the end of the day', () => {
    expect(
      landingTopMinute({ days: [day([])], today: DATE, now: at(23, 30), viewportMinutes: 360 }),
    ).toBe(1080); // 24:00 - 6h window
  });

  it('the viewport itself is always the full day', () => {
    expect(FULL_DAY_BOUNDS).toEqual({ startMinute: 0, endMinute: 1440 });
  });
});

describe('eventWindowOnDate', () => {
  it('clamps multi-day events to the day', () => {
    const e = ev('x', `${DATE}T22:00:00`, '2026-07-21T02:00:00');
    expect(eventWindowOnDate(e, DATE)).toEqual({ startMinute: 1320, endMinute: 1440 });
    expect(eventWindowOnDate(e, '2026-07-21')).toEqual({ startMinute: 0, endMinute: 120 });
  });
  it('returns null off-day', () => {
    const e = ev('x', `${DATE}T10:00:00`, `${DATE}T11:00:00`);
    expect(eventWindowOnDate(e, '2026-07-22')).toBeNull();
  });
});

describe('packColumns', () => {
  it('non-overlapping events each get a full-width column', () => {
    const packed = packColumns(
      [ev('a', `${DATE}T09:00:00`, `${DATE}T10:00:00`), ev('b', `${DATE}T10:00:00`, `${DATE}T11:00:00`)],
      DATE,
    );
    expect(packed.overflow).toEqual([]);
    expect(packed.placed.map((p) => [p.event.id, p.column, p.columns])).toEqual([
      ['a', 0, 1],
      ['b', 0, 1],
    ]);
  });

  it('two overlapping events split into two columns', () => {
    const packed = packColumns(
      [ev('a', `${DATE}T09:00:00`, `${DATE}T10:00:00`), ev('b', `${DATE}T09:30:00`, `${DATE}T10:30:00`)],
      DATE,
    );
    expect(packed.placed.map((p) => [p.event.id, p.column, p.columns])).toEqual([
      ['a', 0, 2],
      ['b', 1, 2],
    ]);
  });

  it('a fourth simultaneous event collapses into an overflow chip', () => {
    const packed = packColumns(
      [
        ev('a', `${DATE}T09:00:00`, `${DATE}T10:00:00`),
        ev('b', `${DATE}T09:00:00`, `${DATE}T10:00:00`),
        ev('c', `${DATE}T09:00:00`, `${DATE}T10:00:00`),
        ev('d', `${DATE}T09:15:00`, `${DATE}T10:00:00`),
      ],
      DATE,
    );
    expect(packed.placed).toHaveLength(2); // columns 0 and 1 stay visible
    expect(packed.placed.every((p) => p.columns === 3)).toBe(true);
    expect(packed.overflow).toHaveLength(1);
    expect(packed.overflow[0].events.map((e) => e.id).sort()).toEqual(['c', 'd']);
  });

  it('a later separate cluster resets column packing', () => {
    const packed = packColumns(
      [
        ev('a', `${DATE}T09:00:00`, `${DATE}T10:00:00`),
        ev('b', `${DATE}T09:00:00`, `${DATE}T10:00:00`),
        ev('c', `${DATE}T14:00:00`, `${DATE}T15:00:00`),
      ],
      DATE,
    );
    const c = packed.placed.find((p) => p.event.id === 'c')!;
    expect([c.column, c.columns]).toEqual([0, 1]);
  });
});

describe('stripSegments', () => {
  it('renders busy events as percentage segments, skipping non-busy ones', () => {
    const d = day([
      ev('meet', `${DATE}T09:00:00`, `${DATE}T10:00:00`),
      ev('declined', `${DATE}T11:00:00`, `${DATE}T12:00:00`, { responseStatus: 'declined' }),
    ]);
    const segments = stripSegments(d, WORKDAY);
    expect(segments).toHaveLength(1);
    expect(segments[0].label).toBe('meet');
    expect(segments[0].startPct).toBeCloseTo(0);
    expect(segments[0].widthPct).toBeCloseTo((60 / 540) * 100);
  });

  it('clamps events spilling past workday edges and flags them', () => {
    const d = day([ev('early', `${DATE}T08:00:00`, `${DATE}T09:30:00`)]);
    const [seg] = stripSegments(d, WORKDAY);
    expect(seg.startPct).toBe(0);
    expect(seg.clamped).toBe(true);
  });
});
