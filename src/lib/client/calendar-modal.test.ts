import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CALENDAR_VIEW,
  closeCalendarModal,
  getCalendarModalState,
  openCalendarModal,
  parseCalendarView,
} from './calendar-modal';

describe('calendar modal store', () => {
  it('opens with the requested view and date, and a fresh open id each time', () => {
    openCalendarModal({ view: 'day', date: '2026-10-05' });
    const first = getCalendarModalState();
    expect(first).toMatchObject({ open: true, view: 'day', date: '2026-10-05' });

    // Unsaid, the view and date fall back (to the last view, and today).
    openCalendarModal();
    expect(getCalendarModalState()).toMatchObject({ open: true, view: null, date: null });
    expect(getCalendarModalState().openId).toBeGreaterThan(first.openId);
  });

  it('closes, and a second close changes nothing', () => {
    openCalendarModal({ view: 'week' });
    closeCalendarModal();
    const closed = getCalendarModalState();
    expect(closed.open).toBe(false);
    closeCalendarModal();
    expect(getCalendarModalState()).toBe(closed);
  });
});

describe('parseCalendarView', () => {
  it('keeps day and week, and defaults anything else to week', () => {
    expect(parseCalendarView('day')).toBe('day');
    expect(parseCalendarView('week')).toBe('week');
    expect(parseCalendarView(null)).toBe(DEFAULT_CALENDAR_VIEW);
    expect(parseCalendarView('month')).toBe(DEFAULT_CALENDAR_VIEW);
    expect(DEFAULT_CALENDAR_VIEW).toBe('week');
  });
});
