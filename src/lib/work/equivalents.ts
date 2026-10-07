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

/** The book a word count is closest to, and how it compares. */
export interface BookMatch {
  title: string;
  /** About as long, most of it, or several copies of it. */
  fit: 'about' | 'most' | 'copies' | 'times';
  count: number;
}

export function bookMatch(words: number): BookMatch | null {
  if (words < 10_000) return null;
  const largest = BOOKS[BOOKS.length - 1]!;
  if (words >= largest.words * 1.5) return { title: largest.title, fit: 'times', count: Math.round(words / largest.words) };
  // Closest by ratio, so 450k reads as The Lord of the Rings, not War and Peace.
  let best = BOOKS[0]!;
  for (const b of BOOKS) {
    if (Math.abs(Math.log(words / b.words)) < Math.abs(Math.log(words / best.words))) best = b;
  }
  const ratio = words / best.words;
  if (ratio >= 1.5) return { title: best.title, fit: 'copies', count: Math.round(ratio) };
  return { title: best.title, fit: ratio < 0.85 ? 'most' : 'about', count: 1 };
}

/** "about the length of The Hobbit", "most of The Great Gatsby", "3 copies of War and Peace". */
export function bookEquivalent(words: number): string | null {
  const m = bookMatch(words);
  if (!m) return null;
  return m.fit === 'about' ? `about the length of ${m.title}` : bookObject(m);
}

/** What you'd be writing: "The Hobbit", "most of The Great Gatsby", "3 copies of War and Peace". */
function bookObject(m: BookMatch): string {
  if (m.fit === 'times') return `${m.count} times ${m.title}`;
  if (m.fit === 'copies') return `${m.count} copies of ${m.title}`;
  return m.fit === 'most' ? `most of ${m.title}` : m.title;
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
 * The human-time headline, in the unit that reads best for the range: a team
 * for a day or a week, people for a year once that's meaningful.
 */
export function personHoursLine(stats: WorkStats, days: number): string | null {
  const h = stats.personHours;
  if (h < 0.5) return null;
  const parts = [teamPhrase(h, days), yearPhrase(h)].filter((p): p is string => !!p);
  const head = `About ${formatHours(h)} hours of human work`;
  return parts.length ? `${head}, like ${parts.join(', or ')}.` : `${head}.`;
}

/** How many full-time people the hours keep busy for the day or the week, or null below 1.5. */
export function teamSize(personHours: number, days: number): { size: number; span: 'day' | 'week' } | null {
  const day = days <= 1;
  const team = personHours / (day ? DAY_HOURS : WEEK_HOURS * Math.max(1, days / 7));
  return team >= 1.5 ? { size: Math.round(team), span: day ? 'day' : 'week' } : null;
}

/** "a team of 60 for a week", "a team of 85 for a day", or null below 1.5 people. */
export function teamPhrase(personHours: number, days: number): string | null {
  const team = teamSize(personHours, days);
  return team ? `a team of ${team.size} for a ${team.span}` : null;
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

/** Human-time hours per hour of yours (the leverage), or null when you weren't there. */
export function leverage(stats: WorkStats): number | null {
  const hours = stats.handsOnMinutes / 60;
  return hours >= 0.25 && stats.personHours > hours ? stats.personHours / hours : null;
}

/** A long stretch in whole hours ("124h"), a short one to the minute ("8h 42m"). */
export function formatSpan(minutes: number): string {
  return minutes >= 600 ? `${Math.round(minutes / 60).toLocaleString('en-US')}h` : formatDuration(minutes);
}

/**
 * The leverage, as a chain (docs/work-view.md, "The numbers"): your hands-on
 * time, the agent time it set going, and what a person would need for the
 * same work. Each step's multiplier, and the two together.
 */
export interface LeverageChain {
  handsOnMinutes: number;
  agentMinutes: number;
  personHours: number;
  whileAwayMinutes: number;
  /** Agent hours for each hour you were hands-on. */
  agentsPerHour: number | null;
  /** Person-hours for each agent hour: how much longer a person would take. */
  personPerAgentHour: number | null;
  /** Person-hours for each hour you were hands-on (`leverage`). */
  leverage: number | null;
}

export function leverageChain(stats: WorkStats): LeverageChain | null {
  if (stats.agentMinutes < 1 && stats.personHours < 0.5) return null;
  const handsOnHours = stats.handsOnMinutes / 60;
  const agentHours = stats.agentMinutes / 60;
  return {
    handsOnMinutes: stats.handsOnMinutes,
    agentMinutes: stats.agentMinutes,
    personHours: stats.personHours,
    whileAwayMinutes: stats.whileAwayMinutes,
    agentsPerHour: handsOnHours >= 0.25 && agentHours > 0 ? agentHours / handsOnHours : null,
    personPerAgentHour: agentHours >= 0.25 && stats.personHours > 0 ? stats.personHours / agentHours : null,
    leverage: leverage(stats),
  };
}

/** A multiplier: "3×", "19×", "1.4×". */
export function formatTimes(x: number): string {
  return `${formatHours(x)}×`;
}

export interface WorkTile {
  key: 'team' | 'book' | 'peak' | 'commits';
  label: string;
  value: string;
  /** One or two short lines of context. */
  context: string[];
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The numbers beside the chain, as stat tiles: the value is the point, one
 * line or two say what it means. The first two read top to bottom as a
 * sentence ("Like a team of / 60 / for a week"). Tiles with nothing to say
 * are left out.
 */
export function workTiles(stats: WorkStats, days: number, opts: { weekday?: boolean } = {}): WorkTile[] {
  const tiles: WorkTile[] = [];
  const team = teamSize(stats.personHours, days);
  if (team) {
    const year = yearPhrase(stats.personHours);
    tiles.push({
      key: 'team',
      label: 'Like a team of',
      value: String(team.size),
      context: [`working a full ${team.span}`, ...(year ? [`or ${year}`] : [])],
    });
  }
  const book = bookMatch(stats.agentWords);
  if (book) {
    const typingHours = stats.agentWords / TYPING_WPM / 60;
    tiles.push({
      key: 'book',
      label: 'Like writing',
      value: capitalize(bookObject(book)),
      context: [`Agents wrote ${formatCount(stats.agentWords)} words`, ...(typingHours >= 1 ? [`${formatHours(typingHours)} hours just to type`] : [])],
    });
  }
  if (stats.peak && stats.peak.count >= 2) {
    const when = new Date(stats.peak.at).toLocaleString('en-US', { ...(opts.weekday ? { weekday: 'short' } : {}), hour: 'numeric', minute: '2-digit' });
    tiles.push({ key: 'peak', label: 'Agents at once', value: String(stats.peak.count), context: [`At the peak, ${when}`] });
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

/** Your time, your agents' time, and what each of your hours turned into. */
export function leverageLine(stats: WorkStats): string | null {
  if (stats.agentMinutes < 1 && stats.handsOnMinutes < 1) return null;
  const agents = formatDuration(stats.agentMinutes);
  if (stats.handsOnMinutes < 1) return `Agents worked ${agents} on their own.`;
  const handsOnHours = stats.handsOnMinutes / 60;
  const each = handsOnHours >= 0.25 && stats.personHours > handsOnHours
    ? ` Each hour of yours turned into about ${formatHours(stats.personHours / handsOnHours)} hours of human work.`
    : '';
  return `You spent ${formatDuration(stats.handsOnMinutes)}. Agents worked ${agents}.${each}`;
}

/** Texture: work done on its own, the busiest moment, what shipped. */
export function textureLine(stats: WorkStats, opts: { weekday?: boolean } = {}): string | null {
  const parts: string[] = [];
  if (stats.whileAwayMinutes >= 30) parts.push(`Agents worked ${formatDuration(stats.whileAwayMinutes)} while you were away`);
  if (stats.peak && stats.peak.count >= 2) {
    const at = new Date(stats.peak.at);
    const when = at.toLocaleString('en-US', { ...(opts.weekday ? { weekday: 'short' } : {}), hour: 'numeric', minute: '2-digit' });
    parts.push(`up to ${stats.peak.count} at once, ${when}`);
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
  const line3 = t.personHours < 0.5
    ? 'Nothing measurable yet.'
    : handsOnHours >= 0.25
      ? `From ${formatSpan(t.handsOnMinutes)} of your time, agents did about ${formatHours(t.personHours)} hours of human work, ${formatHours(t.personHours / handsOnHours)}× your time.`
      : `Agents did about ${formatHours(t.personHours)} hours of human work on their own.`;

  return [line1, line2, line3];
}
