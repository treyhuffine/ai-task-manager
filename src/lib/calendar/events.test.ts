import { describe, expect, it } from 'vitest';
import {
  countsAsBusy,
  eventOverlapsDay,
  eventToBlock,
  normalizeGoogleEvent,
  normalizeOutlookEvent,
} from './events';

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
