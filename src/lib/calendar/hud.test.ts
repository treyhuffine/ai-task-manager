import { describe, expect, it } from 'vitest';
import { normalizeGoogleEvent } from './events';
import { hudLabel } from './hud';
import type { CalendarDay, CalendarEvent } from './types';

const DATE = '2026-07-20';

function ev(title: string, start: string, end: string, extra: Record<string, unknown> = {}): CalendarEvent {
  return normalizeGoogleEvent({ id: title, summary: title, start, end, ...extra }, 'c1')!;
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

const at = (h: number, m = 0) => new Date(2026, 6, 20, h, m);

describe('hudLabel', () => {
  const standup = ev('Standup', `${DATE}T10:00:00`, `${DATE}T10:30:00`);

  it('error status wins', () => {
    expect(hudLabel(day([standup]), 'error', at(9)).text).toBe('Calendar unreachable');
  });

  it('no timed events → Nothing scheduled today', () => {
    expect(hudLabel(day([]), 'ok', at(9)).text).toBe('Nothing scheduled today');
  });

  it('ongoing event → ends time', () => {
    expect(hudLabel(day([standup]), 'ok', at(10, 10)).text).toBe('Standup ends 10:30 AM');
  });

  it('over an hour away → hours and minutes, not raw minutes', () => {
    const late = ev('Eng Sync', `${DATE}T10:27:00`, `${DATE}T11:00:00`);
    expect(hudLabel(day([late]), 'ok', at(9)).text).toBe('Eng Sync in 1h 27m');
    const exact = ev('Review', `${DATE}T10:00:00`, `${DATE}T11:00:00`);
    expect(hudLabel(day([exact]), 'ok', at(9)).text).toBe('Review in 1h');
  });

  it('overlapping meetings → the soonest end wins, with a marker for the rest', () => {
    const long = ev('Eng Sync', `${DATE}T10:00:00`, `${DATE}T11:30:00`);
    const short = ev('Standup 2', `${DATE}T10:00:00`, `${DATE}T10:30:00`);
    expect(hudLabel(day([long, short]), 'ok', at(10, 10)).text).toBe(
      'Standup 2 ends 10:30 AM · +1 now',
    );
  });

  it('an upcoming start beats a later ongoing end (a meeting you could miss)', () => {
    const offsite = ev('Offsite', `${DATE}T09:00:00`, `${DATE}T12:00:00`);
    const incoming = ev('Design review', `${DATE}T10:00:00`, `${DATE}T10:30:00`);
    const s = hudLabel(day([offsite, incoming]), 'ok', at(9, 52));
    expect(s.text).toBe('Design review in 8m');
    expect(s.tone).toBe('warning');
  });

  it('next within 90 minutes → countdown', () => {
    const s = hudLabel(day([standup]), 'ok', at(9, 20));
    expect(s.text).toBe('Standup in 40m');
    expect(s.tone).toBe('default');
  });

  it('imminent (≤10m) → warning tone', () => {
    const s = hudLabel(day([standup]), 'ok', at(9, 52));
    expect(s.text).toBe('Standup in 8m');
    expect(s.tone).toBe('warning');
  });

  it('next later today → at time', () => {
    const s = hudLabel(day([ev('Review', `${DATE}T15:00:00`, `${DATE}T16:00:00`)]), 'ok', at(9));
    expect(s.text).toBe('Review at 3:00 PM');
  });

  it('all events past → Nothing else scheduled today', () => {
    expect(hudLabel(day([standup]), 'ok', at(14)).text).toBe('Nothing else scheduled today');
  });

  it('declined events are invisible to the label', () => {
    const declined = ev('Skipped', `${DATE}T11:00:00`, `${DATE}T12:00:00`, { responseStatus: 'declined' });
    expect(hudLabel(day([declined]), 'ok', at(9)).text).toBe('Nothing scheduled today');
  });

  it('long titles truncate with an ellipsis', () => {
    const long = ev('Quarterly planning session with the whole team', `${DATE}T10:00:00`, `${DATE}T11:00:00`);
    const s = hudLabel(day([long]), 'ok', at(9, 45));
    expect(s.text).toMatch(/… in 15m$/);
    expect(s.text.length).toBeLessThanOrEqual(24 + ' in 15m'.length);
  });
});
