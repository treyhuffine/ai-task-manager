import { describe, it, expect } from 'vitest';
import { addDays, dateRange, daysBetween, formatDate, formatDateRange, formatInstant, instantFromLocal, isLocalDate, isValidZone, localDate, localTime, offsetMinutes, relativeDay, zoneAbbreviation } from '@ri/app-kit/time';

describe('zone-aware dates', () => {
  it('shows an overnight Denver to Lisbon flight on both local dates with zone labels', () => {
    const departure = instantFromLocal('2026-11-09T17:55', 'America/Denver');
    const arrival = instantFromLocal('2026-11-10T08:40', 'Europe/Lisbon');
    expect(departure).toEqual({ instant: '2026-11-10T00:55:00.000Z', status: 'exact' });
    expect(arrival).toEqual({ instant: '2026-11-10T08:40:00.000Z', status: 'exact' });
    expect(localDate(departure.instant, 'America/Denver')).toBe('2026-11-09');
    expect(localDate(departure.instant, 'Europe/Lisbon')).toBe('2026-11-10');
    expect(zoneAbbreviation(departure.instant, 'America/Denver')).toBe('MST');
    expect(zoneAbbreviation(arrival.instant, 'Europe/Lisbon')).toBe('WET');
    expect(zoneAbbreviation('2026-07-10T08:40:00Z', 'Europe/Lisbon')).toBe('WEST');
    expect(zoneAbbreviation('2026-07-10T08:40:00Z', 'America/Denver')).toBe('MDT');
    expect(zoneAbbreviation('2026-07-10T08:40:00Z', 'Asia/Tokyo')).toBe('GMT+9');
    expect(formatInstant(arrival.instant, 'Europe/Lisbon', { zone: true })).toBe('Nov 10, 08:40 WET');
    expect(localTime(departure.instant, 'America/Denver')).toBe('17:55');
  });

  it('reports a spring-forward gap and a repeated fall-back hour explicitly', () => {
    expect(instantFromLocal('2026-03-08T02:30', 'America/Denver')).toEqual({ instant: '2026-03-08T09:30:00.000Z', status: 'gap' });
    expect(instantFromLocal('2026-11-01T01:30', 'America/Denver')).toEqual({ instant: '2026-11-01T07:30:00.000Z', status: 'ambiguous' });
    expect(instantFromLocal('2026-10-25T01:30', 'Europe/Lisbon').status).toBe('ambiguous');
    expect(offsetMinutes('2026-07-01T00:00:00Z', 'Europe/Lisbon')).toBe(60);
    expect(() => instantFromLocal('2026-02-30T10:00', 'UTC')).toThrow();
    expect(() => instantFromLocal('2026-02-10T10:00', 'Mars/Base')).toThrow();
  });

  it('does calendar arithmetic on dates, never midnight timestamps', () => {
    expect(isLocalDate('2026-02-29')).toBe(false);
    expect(isLocalDate('2028-02-29')).toBe(true);
    expect(addDays('2026-11-09', 5)).toBe('2026-11-14');
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09');
    expect(daysBetween('2026-11-10', '2026-11-14')).toBe(4);
    expect(dateRange('2026-11-09', '2026-11-11')).toEqual(['2026-11-09', '2026-11-10', '2026-11-11']);
    expect(dateRange('2026-11-11', '2026-11-09')).toEqual([]);
    expect(relativeDay('2026-10-16', '2026-10-15')).toBe('Tomorrow');
    expect(isValidZone('Europe/Lisbon')).toBe(true);
    expect(isValidZone('Not/AZone')).toBe(false);
  });

  it('formats dates and ranges without dashes', () => {
    expect(formatDate('2026-11-10', 'short')).toBe('Nov 10');
    expect(formatDate('2026-11-10', 'weekday')).toBe('Tue 10');
    expect(formatDate('2026-11-10', 'weekdayLong')).toBe('Tuesday, November 10');
    expect(formatDateRange('2026-11-09', '2026-11-14')).toBe('November 9 to 14, 2026');
    expect(formatDateRange('2026-10-30', '2026-11-02')).toBe('October 30 to November 2, 2026');
    expect(formatDateRange('2026-12-30', '2027-01-02')).toBe('December 30, 2026 to January 2, 2027');
  });
});
