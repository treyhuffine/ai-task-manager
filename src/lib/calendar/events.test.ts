import { describe, expect, it } from 'vitest';
import {
  calendarCountsTime,
  countsAsBusy,
  eventOverlapsDay,
  eventToBlock,
  hexColor,
  mergeCopies,
  normalizeGoogleEvent,
  normalizeOutlookEvent,
  type RawGoogleEvent,
} from './events';
import type { CalendarSource } from './types';

const DATE = '2026-07-20';

describe('countsAsBusy', () => {
  const base = { allDay: false, transparency: 'busy' as const, rsvp: null };
  it('plain timed busy event counts', () => {
    expect(countsAsBusy(base)).toBe(true);
  });
  it('tentative counts busy (an unresolved maybe still owns the time)', () => {
    expect(countsAsBusy({ ...base, rsvp: 'tentative' })).toBe(true);
  });
  it('needs_action counts busy', () => {
    expect(countsAsBusy({ ...base, rsvp: 'needs_action' })).toBe(true);
  });
  it('declined does not count', () => {
    expect(countsAsBusy({ ...base, rsvp: 'declined' })).toBe(false);
  });
  it('free transparency does not count', () => {
    expect(countsAsBusy({ ...base, transparency: 'free' })).toBe(false);
  });
  it('all-day does not count', () => {
    expect(countsAsBusy({ ...base, allDay: true })).toBe(false);
  });
});

describe('normalizeGoogleEvent', () => {
  it('maps a full timed event', () => {
    const ev = normalizeGoogleEvent(
      {
        id: 'g1',
        summary: 'Design review',
        start: `${DATE}T10:00:00-04:00`,
        end: `${DATE}T11:00:00-04:00`,
        status: 'confirmed',
        htmlLink: 'https://cal.example/g1',
        location: 'HQ',
        joinUrl: 'https://meet.example/abc',
        responseStatus: 'accepted',
      },
      'c1',
    )!;
    expect(ev).toMatchObject({
      id: 'g1',
      providerId: 'google',
      connectionId: 'c1',
      title: 'Design review',
      allDay: false,
      location: 'HQ',
      joinUrl: 'https://meet.example/abc',
      sourceUrl: 'https://cal.example/g1',
      rsvp: 'accepted',
      transparency: 'busy',
      countsAsBusy: true,
    });
  });

  it('declined event survives normalization but does not count busy', () => {
    const ev = normalizeGoogleEvent(
      { id: 'g2', start: `${DATE}T10:00:00Z`, end: `${DATE}T11:00:00Z`, responseStatus: 'declined' },
      'c1',
    )!;
    expect(ev.rsvp).toBe('declined');
    expect(ev.countsAsBusy).toBe(false);
  });

  it('transparent (free) event does not count busy', () => {
    const ev = normalizeGoogleEvent(
      { id: 'g3', start: `${DATE}T10:00:00Z`, end: `${DATE}T11:00:00Z`, transparency: 'transparent' },
      'c1',
    )!;
    expect(ev.transparency).toBe('free');
    expect(ev.countsAsBusy).toBe(false);
  });

  it('date-only start means all-day, kept but not busy', () => {
    const ev = normalizeGoogleEvent({ id: 'g4', summary: 'Birthday', start: DATE, end: '2026-07-21' }, 'c1')!;
    expect(ev.allDay).toBe(true);
    expect(ev.countsAsBusy).toBe(false);
  });

  it('cancelled events are dropped entirely', () => {
    expect(
      normalizeGoogleEvent({ id: 'g5', start: `${DATE}T10:00:00Z`, end: `${DATE}T11:00:00Z`, status: 'cancelled' }, 'c1'),
    ).toBeNull();
  });

  it('no attendees means null rsvp, untitled means Busy', () => {
    const ev = normalizeGoogleEvent({ id: 'g6', start: `${DATE}T10:00:00Z`, end: `${DATE}T10:30:00Z` }, 'c1')!;
    expect(ev.rsvp).toBeNull();
    expect(ev.title).toBe('Busy');
    expect(ev.countsAsBusy).toBe(true);
  });
});

describe('normalizeOutlookEvent', () => {
  it('maps a full timed event', () => {
    const ev = normalizeOutlookEvent(
      {
        id: 'o1',
        subject: 'Standup',
        start: `${DATE}T14:00:00Z`,
        end: `${DATE}T14:30:00Z`,
        location: 'Teams',
        webLink: 'https://outlook.example/o1',
        showAs: 'busy',
        responseStatus: 'organizer',
        joinUrl: 'https://teams.example/j',
      },
      'c2',
    )!;
    expect(ev).toMatchObject({
      providerId: 'microsoft',
      connectionId: 'c2',
      title: 'Standup',
      rsvp: 'accepted', // organizer normalizes to accepted
      joinUrl: 'https://teams.example/j',
      countsAsBusy: true,
    });
  });

  it('oof counts busy, workingElsewhere and free do not', () => {
    const mk = (showAs: string) =>
      normalizeOutlookEvent({ id: 'o', start: `${DATE}T09:00:00Z`, end: `${DATE}T10:00:00Z`, showAs }, 'c2')!;
    expect(mk('oof').countsAsBusy).toBe(true);
    expect(mk('workingElsewhere').countsAsBusy).toBe(false);
    expect(mk('free').countsAsBusy).toBe(false);
  });

  it('tentativelyAccepted normalizes to tentative and still counts busy', () => {
    const ev = normalizeOutlookEvent(
      { id: 'o2', start: `${DATE}T09:00:00Z`, end: `${DATE}T10:00:00Z`, responseStatus: 'tentativelyAccepted' },
      'c2',
    )!;
    expect(ev.rsvp).toBe('tentative');
    expect(ev.countsAsBusy).toBe(true);
  });

  it('isAllDay flag wins even with instant datetimes', () => {
    const ev = normalizeOutlookEvent(
      { id: 'o3', start: `${DATE}T00:00:00Z`, end: '2026-07-21T00:00:00Z', isAllDay: true },
      'c2',
    )!;
    expect(ev.allDay).toBe(true);
    expect(ev.countsAsBusy).toBe(false);
  });

  it('cancelled events are dropped', () => {
    expect(
      normalizeOutlookEvent({ id: 'o4', start: `${DATE}T09:00:00Z`, end: `${DATE}T10:00:00Z`, isCancelled: true }, 'c2'),
    ).toBeNull();
  });
});

describe('eventToBlock', () => {
  it('projects to the planning-layer CalendarBlock', () => {
    const ev = normalizeGoogleEvent(
      { id: 'g1', summary: 'Sync', start: `${DATE}T10:00:00Z`, end: `${DATE}T11:00:00Z` },
      'c1',
    )!;
    expect(eventToBlock(ev)).toEqual({
      start: `${DATE}T10:00:00Z`,
      end: `${DATE}T11:00:00Z`,
      title: 'Sync',
      source: 'google',
    });
  });
});

describe('eventOverlapsDay', () => {
  const timed = (start: string, end: string) =>
    normalizeGoogleEvent({ id: 't', start, end }, 'c1')!;

  it('same-day timed event overlaps its day only', () => {
    const ev = timed(`${DATE}T10:00:00`, `${DATE}T11:00:00`);
    expect(eventOverlapsDay(ev, DATE)).toBe(true);
    expect(eventOverlapsDay(ev, '2026-07-21')).toBe(false);
  });

  it('multi-day timed event overlaps every touched day', () => {
    const ev = timed(`${DATE}T22:00:00`, '2026-07-21T02:00:00');
    expect(eventOverlapsDay(ev, DATE)).toBe(true);
    expect(eventOverlapsDay(ev, '2026-07-21')).toBe(true);
    expect(eventOverlapsDay(ev, '2026-07-22')).toBe(false);
  });

  it('all-day exclusive end does not bleed into the next day', () => {
    const ev = normalizeGoogleEvent({ id: 'a', summary: 'OOO', start: DATE, end: '2026-07-21' }, 'c1')!;
    expect(eventOverlapsDay(ev, DATE)).toBe(true);
    expect(eventOverlapsDay(ev, '2026-07-21')).toBe(false);
  });
});

describe('calendars, colors and copies', () => {
  const cal = (name: string, over: Partial<CalendarSource> = {}): CalendarSource => ({
    id: `${name}@cal`,
    name,
    color: null,
    primary: false,
    owned: true,
    ...over,
  });
  const google = (over: Partial<RawGoogleEvent>, calendar: CalendarSource | null = null) =>
    normalizeGoogleEvent({ id: 'e', iCalUID: 'u', summary: 'Sync', start: '2026-07-20T10:00:00Z', end: '2026-07-20T11:00:00Z', ...over }, 'c1', calendar)!;

  it("wears its own color over its calendar's, as Google shows it today", () => {
    expect(google({ colorId: '7' }, cal('Work', { color: '#9fc6e7' })).color).toBe('#039be5');
    expect(google({}, cal('Work', { color: '#9fc6e7' })).color).toBe('#9fc6e7');
    expect(google({}).color).toBeNull();
    expect([hexColor('#ABCDEF'), hexColor('blue'), hexColor('')]).toEqual(['#abcdef', null, null]);
  });

  it('only takes your time on a calendar you own', () => {
    expect(google({}, cal('Shared', { owned: false })).countsAsBusy).toBe(false);
    expect(google({}, cal('Primary', { owned: false, primary: true })).countsAsBusy).toBe(true);
    expect(google({}, cal('Gym')).countsAsBusy).toBe(true);
    expect(calendarCountsTime(null)).toBe(true);
  });

  it('merges copies of one meeting into the one you own, naming the others', () => {
    const shared = google({ id: 'a', responseStatus: 'accepted' }, cal('Work (shared)', { owned: false }));
    const mine = google({ id: 'b', responseStatus: 'accepted' }, cal('Work', { primary: true }));
    const merged = mergeCopies([shared, mine]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: 'b', countsAsBusy: true, alsoOn: ['Work (shared)'] });
  });

  it('keeps the RSVP you kept when invited at two addresses', () => {
    const declined = google({ id: 'a', responseStatus: 'declined' }, cal('Personal', { primary: true }));
    const accepted = google({ id: 'b', responseStatus: 'accepted' }, cal('Work', { primary: true }));
    expect(mergeCopies([declined, accepted])[0]).toMatchObject({ id: 'b', rsvp: 'accepted', countsAsBusy: true, alsoOn: ['Personal'] });
  });

  it('leaves apart what only looks alike: other instances of a series, and events without a UID', () => {
    const monday = google({ id: 'r1' }, cal('Work'));
    const tuesday = google({ id: 'r2', start: '2026-07-21T10:00:00Z', end: '2026-07-21T11:00:00Z' }, cal('Work'));
    const noUid = [google({ id: 'x', iCalUID: undefined }), google({ id: 'y', iCalUID: undefined })];
    expect(mergeCopies([monday, tuesday, ...noUid]).map((e) => e.id)).toEqual(['r1', 'r2', 'x', 'y']);
  });

  it('matches copies by instant, whatever offset each calendar wrote', () => {
    const utc = google({ id: 'a' }, cal('A'));
    const local = google({ id: 'b', start: '2026-07-20T04:00:00-06:00', end: '2026-07-20T05:00:00-06:00' }, cal('B'));
    expect(mergeCopies([utc, local])).toHaveLength(1);
  });
});
