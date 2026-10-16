/** Display helpers for the Job Search view. Times show in the interview's own zone. */
import { formatDate, formatInstant, isValidZone, localDate, systemZone, zoneAbbreviation, relativeDay, todayIn } from '@ri/app-kit/time';
import { CLASSIFICATION_LABELS, OUTCOME_LABELS, STAGE_LABELS, WORK_LABELS, stageLabel, type Classification, type Outcome, type Stage } from '../domain/labels.js';
import type { Interview, NextItem, OpportunitySummary } from '../domain/model.js';

export const viewerZone = (() => {
  try {
    return systemZone();
  } catch {
    return 'UTC';
  }
})();

export function zoneOf(zone: string | null | undefined): string {
  return zone && isValidZone(zone) ? zone : viewerZone;
}

/** "Fri, Oct 16, 10:00 MDT", in the event's original zone, with the viewer's time when it differs. */
export function whenText(startAt: string | null, zone: string | null, options: { relative?: boolean; viewer?: boolean } = {}): string {
  if (!startAt) return 'Time not set';
  const eventZone = zoneOf(zone);
  try {
    const day = localDate(startAt, eventZone);
    const relative = options.relative ? relativeDay(day, todayIn(eventZone)) : null;
    const time = formatInstant(startAt, eventZone, { date: 'none', zone: true });
    const text = relative ? `${relative} at ${time}` : `${formatInstant(startAt, eventZone, { date: 'weekday' })} ${zoneAbbreviation(startAt, eventZone)}`;
    if (options.viewer !== false && eventZone !== viewerZone && zoneAbbreviation(startAt, eventZone) !== zoneAbbreviation(startAt, viewerZone))
      return `${text} (${formatInstant(startAt, viewerZone, { date: localDate(startAt, viewerZone) === day ? 'none' : 'short', zone: true })} your time)`;
    return text;
  } catch {
    return startAt;
  }
}
export function durationText(startAt: string | null, endAt: string | null): string | null {
  if (!startAt || !endAt) return null;
  const minutes = Math.round((Date.parse(endAt) - Date.parse(startAt)) / 60000);
  if (!(minutes > 0)) return null;
  return minutes < 60 || minutes % 60 ? `${minutes} minutes` : `${minutes / 60} hour${minutes === 60 ? '' : 's'}`;
}

/** A local date stays as written. An instant becomes the viewer's local date. */
function calendarDay(value: string): string {
  if (value.length <= 10) return value;
  try {
    return localDate(value, viewerZone);
  } catch {
    return value.slice(0, 10);
  }
}
export function shortDate(date: string | null | undefined): string {
  if (!date) return '';
  try {
    return formatDate(calendarDay(date), 'short');
  } catch {
    return date;
  }
}
export function mediumDate(date: string | null | undefined): string {
  if (!date) return '';
  try {
    return formatDate(calendarDay(date), 'medium');
  } catch {
    return date;
  }
}
/** A local date for an instant, in the viewer's zone. */
export function dayOf(instant: string): string {
  try {
    return localDate(instant, viewerZone);
  } catch {
    return instant.slice(0, 10);
  }
}

export function locationText(item: Pick<OpportunitySummary, 'location' | 'workArrangement'>): string {
  const parts = [item.location, item.workArrangement ? WORK_LABELS[item.workArrangement] : null].filter(Boolean) as string[];
  if (parts.length === 2 && parts[0].toLowerCase().includes(parts[1].toLowerCase())) return parts[0];
  return parts.join(' · ') || 'Location not recorded';
}

export function stageText(stage: Stage, outcome: Outcome | null): string {
  return stageLabel(stage, outcome);
}

/** The first line of a card: the next interview, invitation, deadline or chosen action. */
export function nextText(next: NextItem | null): string {
  if (!next) return 'No next step recorded';
  switch (next.kind) {
    case 'interview': return next.startAt ? whenText(next.startAt, next.zone, { relative: true, viewer: false }) : 'Interview time not set';
    case 'scheduling': return 'Scheduling needed';
    case 'deadline': return `${next.label} ${shortDate(next.date)}`;
    case 'action': return next.due ? `${next.text} by ${shortDate(next.due)}` : next.text;
    case 'applied': return `Applied ${shortDate(next.date)}`;
    case 'saved': return next.hasDescription ? `Description saved ${shortDate(next.date)}` : `Saved ${shortDate(next.date)}`;
    case 'closed': return `${next.outcome ? OUTCOME_LABELS[next.outcome] : 'Closed'} ${shortDate(next.date)}`;
  }
}

export function authorText(author: string): string {
  if (author === 'automatic') return 'Automatic';
  if (author.startsWith('owner-ui:') || author.startsWith('fixture:')) return 'You';
  if (author.startsWith('chat:')) return 'A Ri chat';
  if (author.startsWith('workspace:')) return 'A Ri agent';
  if (author.startsWith('job:') || author.startsWith('background:')) return 'Scheduled update';
  return 'Someone';
}
export const CONFIDENCE_TEXT = { user: 'your decision', exact: 'exact match', strong: 'strong match', probable: 'probable match', ai: 'AI reading' } as const;
export const DECISION_TEXT = { applied: 'Applied', suggested: 'Suggested', suppressed: 'Held for review', dismissed: 'Not used', accepted: 'Accepted by you' } as const;

export function classificationText(value: Classification): string {
  return CLASSIFICATION_LABELS[value];
}
export function interviewStatusText(interview: Pick<Interview, 'status' | 'sourceState' | 'startAt' | 'endAt'>): string {
  if (interview.sourceState === 'removed') return 'Removed from calendar';
  if (interview.status === 'scheduling_needed') return 'Scheduling needed';
  if (interview.status === 'canceled') return 'Canceled';
  if (interview.status === 'completed') return 'Held';
  if (interview.startAt && Date.parse(interview.endAt ?? interview.startAt) < Date.now()) return 'Past';
  return interview.startAt ? 'Scheduled' : 'Confirmed, time not set';
}
export const FORMAT_TEXT = { video: 'Video meeting', phone: 'Phone call', onsite: 'In person', unknown: 'Format not stated' } as const;
export { STAGE_LABELS, OUTCOME_LABELS };

export function errorText(error: unknown, fallback = 'That did not work. Try again.'): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
}

/** Stable unique IDs for items the person adds in the browser. */
export function localId(prefix: string): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}${Math.random()}`;
  return `${prefix}-${random.replace(/-/g, '').slice(0, 12)}`;
}
export function newOperationId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : '00000000-0000-4000-8000-000000000000';
}
