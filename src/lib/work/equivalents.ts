/**
 * What a range of work is worth, said plainly (docs/work-view.md). One
 * source for the calendar's summary, the saved report and the `work_summary`
 * action, so the numbers read the same everywhere. Pure and client-safe.
 *
 * UI copy rules apply to every string here: no long dashes, no semicolons.
 */

import type { WorkRange, WorkStats } from './types';

/** A full-time week and year, in hours. */
export const WEEK_HOURS = 40;
export const DAY_HOURS = 8;
export const YEAR_HOURS = 2000;
/** A fast typist, for "typing that would take". */
export const TYPING_WPM = 40;

/** Well-known books by commonly cited word counts, shortest first. */
export const BOOKS: ReadonlyArray<{ title: string; words: number }> = [
  { title: 'The Old Man and the Sea', words: 26_601 },
  { title: 'The Great Gatsby', words: 47_094 },
  { title: "Harry Potter and the Sorcerer's Stone", words: 76_944 },
  { title: 'The Hobbit', words: 95_356 },
  { title: 'Pride and Prejudice', words: 122_189 },
  { title: 'Moby-Dick', words: 206_052 },
  { title: 'The Lord of the Rings', words: 481_103 },
  { title: 'War and Peace', words: 587_287 },
  { title: 'the whole Harry Potter series', words: 1_084_170 },
];

/** "about The Hobbit", "most of The Great Gatsby", "3 copies of War and Peace". */
export function bookEquivalent(words: number): string | null {
  if (words < 10_000) return null;
  const largest = BOOKS[BOOKS.length - 1]!;
  if (words >= largest.words * 1.5) return `${Math.round(words / largest.words)} times ${largest.title}`;
  // Closest by ratio, so 450k reads as The Lord of the Rings, not War and Peace.
  let best = BOOKS[0]!;
  for (const b of BOOKS) {
    if (Math.abs(Math.log(words / b.words)) < Math.abs(Math.log(words / best.words))) best = b;
  }
  const ratio = words / best.words;
  if (ratio >= 1.5) return `${Math.round(ratio)} copies of ${best.title}`;
  if (ratio < 0.85) return `most of ${best.title}`;
  return `about the length of ${best.title}`;
}

export function formatDuration(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}

export function formatHours(hours: number): string {
  if (hours >= 100) return `${Math.round(hours).toLocaleString('en-US')}`;
  if (hours >= 10) return `${Math.round(hours)}`;
  return hours >= 1 ? hours.toFixed(1).replace(/\.0$/, '') : hours.toFixed(1);
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  return Math.round(n).toLocaleString('en-US');
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n === 1 ? one : many}`;
}

/**
 * The person-hours headline, in the unit that reads best for the range: a
 * team for a day or a week, people for a year once that's meaningful.
 */
export function personHoursLine(stats: WorkStats, days: number): string | null {
  const h = stats.personHours;
  if (h < 0.5) return null;
  const parts = [teamPhrase(h, days), yearPhrase(h)].filter((p): p is string => !!p);
  const head = `About ${formatHours(h)} person-hours of work`;
  return parts.length ? `${head}: ${parts.join(', or ')}.` : `${head}.`;
}

/** "a team of 60 for a week", "a team of 85 for a day", or null below 1.5 people. */
export function teamPhrase(personHours: number, days: number): string | null {
  const day = days <= 1;
  const team = personHours / (day ? DAY_HOURS : WEEK_HOURS * Math.max(1, days / 7));
  return team >= 1.5 ? `a team of ${Math.round(team)} for a ${day ? 'day' : 'week'}` : null;
}

/** "1.2 people for a year", "a person for 4 months", or null under a month. */
export function yearPhrase(personHours: number): string | null {
  const years = personHours / YEAR_HOURS;
  if (years >= 1) {
    const n = years >= 10 ? String(Math.round(years)) : years.toFixed(1).replace(/\.0$/, '');
    return `${n} ${n === '1' ? 'person' : 'people'} for a year`;
  }
  const months = Math.round(years * 12);
  return months >= 1 ? `a person for ${months} ${plural(months, 'month')}` : null;
}

/** Person-hours per hour you were hands-on, or null when you weren't. */
export function leverage(stats: WorkStats): number | null {
  const hours = stats.handsOnMinutes / 60;
  return hours >= 0.25 && stats.personHours > hours ? stats.personHours / hours : null;
}

export interface WorkTile {
  key: 'personHours' | 'leverage' | 'peak' | 'away' | 'commits';
  label: string;
  value: string;
  /** One or two short lines of context. */
  context: string[];
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The calendar's headline numbers, as stat tiles: the value is the point,
 * one line or two say what it means. Tiles with nothing to say are left out.
 */
export function workTiles(stats: WorkStats, days: number, opts: { weekday?: boolean } = {}): WorkTile[] {
  const tiles: WorkTile[] = [];
  if (stats.personHours >= 0.5) {
    tiles.push({
      key: 'personHours',
      label: 'Person-hours of work',
      value: formatHours(stats.personHours),
      context: [teamPhrase(stats.personHours, days), yearPhrase(stats.personHours)].filter((l): l is string => !!l).map((l, i) => (i === 0 ? capitalize(l) : `or ${l}`)),
    });
  }
  const lev = leverage(stats);
  if (lev) {
    tiles.push({
      key: 'leverage',
      label: 'Your leverage',
      value: `${formatHours(lev)}×`,
      context: [`From ${formatDuration(stats.handsOnMinutes)} hands-on`],
    });
  }
  if (stats.peak && stats.peak.count >= 2) {
    const when = new Date(stats.peak.at).toLocaleString('en-US', { ...(opts.weekday ? { weekday: 'short' } : {}), hour: 'numeric', minute: '2-digit' });
    tiles.push({ key: 'peak', label: 'Agents at once', value: String(stats.peak.count), context: [`At the peak, ${when}`] });
  }
  if (stats.whileAwayMinutes >= 30) {
    tiles.push({
      key: 'away',
      label: 'While you were away',
      value: formatDuration(stats.whileAwayMinutes),
      context: ['Agents kept working'],
    });
  }
  if (stats.commits > 0) {
    tiles.push({
      key: 'commits',
      label: 'Commits',
      value: formatCount(stats.commits),
      context: [`Across ${stats.agents} ${plural(stats.agents, 'agent')}`],
    });
  }
  return tiles;
}

/** You, your agents, and what each of your hours became. */
export function leverageLine(stats: WorkStats): string | null {
  if (stats.agentMinutes < 1 && stats.handsOnMinutes < 1) return null;
  const you = stats.handsOnMinutes >= 1 ? `You were hands-on ${formatDuration(stats.handsOnMinutes)}.` : 'You stayed out of it.';
  const agents = `Agents ran ${formatDuration(stats.agentMinutes)}.`;
  const handsOnHours = stats.handsOnMinutes / 60;
  const each = handsOnHours >= 0.25 && stats.personHours > handsOnHours
    ? ` Each hour of yours became ${formatHours(stats.personHours / handsOnHours)} hours of work.`
    : '';
  return `${you} ${agents}${each}`;
}

/** Texture: work done on its own, the busiest moment, what shipped. */
export function textureLine(stats: WorkStats, opts: { weekday?: boolean } = {}): string | null {
  const parts: string[] = [];
  if (stats.whileAwayMinutes >= 30) parts.push(`${formatDuration(stats.whileAwayMinutes)} while you were away`);
  if (stats.peak && stats.peak.count >= 2) {
    const at = new Date(stats.peak.at);
    const when = at.toLocaleString('en-US', { ...(opts.weekday ? { weekday: 'short' } : {}), hour: 'numeric', minute: '2-digit' });
    parts.push(`${stats.peak.count} at once at the peak, ${when}`);
  }
  if (stats.commits > 0) parts.push(`${formatCount(stats.commits)} ${plural(stats.commits, 'commit')} across ${stats.agents} ${plural(stats.agents, 'agent')}`);
  return parts.length ? parts.join(' · ') : null;
}

/** Words, as a book and as typing time. */
export function wordsLine(stats: WorkStats): string | null {
  if (stats.agentWords < 1000) return null;
  const book = bookEquivalent(stats.agentWords);
  const typingHours = stats.agentWords / TYPING_WPM / 60;
  const typing = typingHours >= 1 ? ` Typing that at ${TYPING_WPM} words a minute would take ${formatHours(typingHours)} hours.` : '';
  return `Agents wrote ${formatCount(stats.agentWords)} words${book ? `, ${book}` : ''}.${typing}`;
}

/** On code, how much faster agents shipped than a person would have. */
export function speedLine(stats: WorkStats): string | null {
  const codeAgentHours = stats.codeAgentMinutes / 60;
  if (stats.codeHours < 4 || codeAgentHours < 0.5) return null;
  const x = stats.codeHours / codeAgentHours;
  if (x < 1.5) return null;
  return `On code, agents worked about ${Math.round(x)}× faster than a person would.`;
}

export function summaryLines(stats: WorkStats, days: number): string[] {
  return [personHoursLine(stats, days), leverageLine(stats), textureLine(stats, { weekday: days > 1 }), wordsLine(stats), speedLine(stats)].filter(
    (l): l is string => !!l,
  );
}

/** "a", "a and b", "a, b and c". */
function joinAnd(parts: readonly string[]): string {
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

const FEATURE = /^feat(\(|:|!)/i;
const FIX = /^fix(\(|:|!)/i;

/**
 * The report: what shipped, where the agent time went, and the leverage.
 * Three lines, deterministic, so it reads the same when saved as a note.
 */
export function weeklyReport(range: Omit<WorkRange, 'report' | 'generatedAt'>): string[] {
  const t = range.totals;
  const commits = range.dayList.flatMap((d) => [...d.spans.flatMap((s) => s.commits), ...d.looseCommits]);
  const features = commits.filter((c) => FEATURE.test(c.subject)).length;
  const fixes = commits.filter((c) => FIX.test(c.subject)).length;
  const finished = range.dayList.reduce((n, d) => n + d.executionsFinished.length, 0);
  const tasks = range.dayList.reduce((n, d) => n + d.tasksDone.length, 0);

  const did: string[] = [];
  if (commits.length) {
    const kinds = [features && `${features} ${plural(features, 'feature')}`, fixes && `${fixes} ${plural(fixes, 'fix', 'fixes')}`].filter(Boolean);
    did.push(`shipped ${formatCount(commits.length)} ${plural(commits.length, 'commit')}${kinds.length ? ` (${kinds.join(', ')})` : ''}`);
  }
  if (finished) did.push(`finished ${finished} ${plural(finished, 'execution')}`);
  if (tasks) did.push(`completed ${tasks} ${plural(tasks, 'task')}`);
  const sentence = joinAnd(did);
  const line1 = did.length
    ? `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)} across ${t.agents} ${plural(t.agents, 'agent')}.`
    : `Worked across ${t.agents} ${plural(t.agents, 'agent')} in ${t.chats} ${plural(t.chats, 'chat')}.`;

  const top = range.agents.find((a) => a.agentMinutes > 0);
  const line2 = top && t.agentMinutes > 0
    ? `Most agent time went to ${top.name}: ${formatDuration(top.agentMinutes)} of ${formatDuration(t.agentMinutes)} (${Math.round((top.agentMinutes / t.agentMinutes) * 100)}%).`
    : 'No agent time yet.';

  const handsOnHours = t.handsOnMinutes / 60;
  const line3 = t.personHours >= 0.5
    ? `About ${formatHours(t.personHours)} person-hours of work from ${formatDuration(t.handsOnMinutes)} of yours${handsOnHours >= 0.25 ? `, ${formatHours(t.personHours / handsOnHours)}× your own time` : ''}.`
    : 'Nothing measurable yet.';

  return [line1, line2, line3];
}
