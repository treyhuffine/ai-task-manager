import { casual } from 'chrono-node/en';

/**
 * Read typed text ("fri", "nov 12", "11/12", "in 3 days") as a calendar date:
 * a bare `YYYY-MM-DD`, or null when nothing in it reads as a date. A date with
 * no year means the next one coming up, so "nov 1" typed on Nov 4 is next year.
 * Lives apart from `dates.ts`, which server code imports, so the parser only
 * loads where someone can type a date.
 */
export function parseTypedDate(text: string, now: Date = new Date()): string | null {
  const start = casual.parse(text, now, { forwardDate: true })[0]?.start;
  if (!start) return null;
  const part = (name: 'month' | 'day') => String(start.get(name)).padStart(2, '0');
  return `${start.get('year')}-${part('month')}-${part('day')}`;
}
