/**
 * Local-date helpers for the calendar surfaces (YYYY-MM-DD strings, local
 * time — matching the deck's day-boundary rules). Pure and client-safe.
 */
import { todayLocalDate } from '@/lib/deck/date';

export function addDaysLocal(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + n);
  return todayLocalDate(d);
}

/** The Monday of the week containing `date` (weeks start Monday). */
export function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  const day = d.getDay(); // 0 = Sunday
  const back = day === 0 ? 6 : day - 1;
  return addDaysLocal(date, -back);
}

export function formatDayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatWeekLabel(monday: string): string {
  const start = new Date(`${monday}T00:00:00`);
  const end = new Date(`${addDaysLocal(monday, 6)}T00:00:00`);
  const sameMonth = start.getMonth() === end.getMonth();
  const startLabel = start.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const endLabel = end.toLocaleDateString([], sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' });
  return `${startLabel} to ${endLabel}`;
}
