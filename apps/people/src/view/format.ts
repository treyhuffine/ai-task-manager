import { formatDate, formatInstant, localDate, relativeDay, systemZone, todayIn, zoneAbbreviation } from '@ri/app-kit/time';
import type { Coverage, NextAction } from '../schemas.js';

export const zone = systemZone();
const today = () => todayIn(zone);

/** "Oct 12", or Today, Tomorrow, Yesterday. */
export function dayLabel(instant: string | null | undefined): string {
  if (!instant) return 'Not recorded';
  const date = instant.length === 10 ? instant : localDate(instant, zone);
  return relativeDay(date, today()) ?? formatDate(date, 'short');
}
/** "Tomorrow, 10:00 MDT" or "Oct 20, 14:00 MDT". */
export function meetingLabel(instant: string): string {
  const date = localDate(instant, zone);
  const relative = relativeDay(date, today());
  const time = formatInstant(instant, zone, { date: 'none' });
  return `${relative ?? formatDate(date, 'short')}, ${time} ${zoneAbbreviation(instant, zone)}`;
}
export function dateLabel(local: string | null | undefined): string {
  if (!local) return 'No date';
  return relativeDay(local, today()) ?? formatDate(local, 'short');
}
export function longDate(local: string): string {
  return formatDate(local.slice(0, 10), 'medium');
}
export function isOverdue(local: string | null | undefined) {
  return !!local && local < today();
}
export function nextActionText(action: NextAction | null): string {
  if (!action) return 'No follow-up chosen';
  return action.dueDate ? `${action.label} · ${dateLabel(action.dueDate)}` : action.label;
}
export function updatedLabel(instant: string | null | undefined): string {
  if (!instant) return 'Not updated yet';
  const date = localDate(instant, zone);
  const relative = relativeDay(date, today());
  const time = formatInstant(instant, zone, { date: 'none' });
  return relative === 'Today' ? `Updated today at ${time}` : `Updated ${formatDate(date, 'short')} at ${time}`;
}
/** "Personal Gmail + Work Gmail · 90 days indexed · Updated today at 09:12" and the extraction line. */
export function coverageLines(coverage: Coverage | undefined): [string, string] {
  if (!coverage) return ['', ''];
  const mail = coverage.accounts.filter((account) => account.kind === 'mail');
  const names = [...new Set(coverage.accounts.map((account) => account.label))];
  const days = mail.map((account) => (account.from ? Math.round((Date.now() - Date.parse(account.from)) / 864e5) : null)).filter((value): value is number => value !== null);
  const latest = coverage.accounts.map((account) => account.lastSuccessAt).filter(Boolean).sort().at(-1) ?? null;
  const first = names.length
    ? [names.join(' + '), days.length ? `${Math.max(...days)} days indexed` : 'History not indexed yet', coverage.partial ? 'Partial coverage' : null, updatedLabel(latest)].filter(Boolean).join(' · ')
    : coverage.imports ? `${coverage.imports} imported file${coverage.imports === 1 ? '' : 's'} · No connected account` : 'Your records only · No connected account';
  const extraction = coverage.extraction === 'on'
    ? coverage.pendingExtraction ? `Relationship extraction is on. ${coverage.pendingExtraction} conversation${coverage.pendingExtraction === 1 ? '' : 's'} waiting.` : 'Relationship extraction is on and up to date.'
    : coverage.extraction === 'unavailable' ? 'Extraction unavailable. Saved context remains available.'
      : coverage.extraction === 'paused' ? 'Relationship extraction paused. Saved context remains available.' : 'Relationship extraction is off. Saved context remains available.';
  return [first, `Briefings cite saved records. ${extraction}${coverage.failed ? ` ${coverage.failed} held failure${coverage.failed === 1 ? '' : 's'} in Sources.` : ''}`];
}
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join('');

/** A version 4 UUID. Falls back to getRandomValues where randomUUID is unavailable in an opaque frame. */
export function uuid(): string {
  const cryptoObject = globalThis.crypto;
  if (typeof cryptoObject?.randomUUID === 'function') return cryptoObject.randomUUID();
  const bytes = new Uint8Array(16);
  cryptoObject.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
