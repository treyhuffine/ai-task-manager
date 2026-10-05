/**
 * The work view's algorithm, pure (docs/work-view.md). No DB, no git, no
 * clock: the ledger feeds it events, the service feeds it commits and rows,
 * and everything here is testable on plain data.
 *
 *   1. Blocks: each chat's work events, cut where 30 minutes pass quietly.
 *   2. Sittings: your own messages, cut the same way. Your hands-on time.
 *   3. Agent time: a block's events no more than 10 minutes apart. Longer
 *      gaps are waiting, not working.
 *   4. Spans: one agent's blocks on a day, merged where they overlap.
 *   5. Commits: sized like an engineer would estimate them. A span's
 *      person-hours are its commits' sizes, or its agent time when nothing
 *      was committed (research, writing and planning count one for one).
 */

import { addDaysLocal } from '@/lib/calendar/dates';
import type { WorkAgent, WorkChat, WorkCommit, WorkDay, WorkRange, WorkSpan, WorkStats } from './types';

export const MINUTE = 60_000;
/** Quiet this long ends a block (and a sitting). */
export const BLOCK_GAP_MS = 30 * MINUTE;
/** Events further apart than this inside a block are waiting, not working. */
export const BUSY_GAP_MS = 10 * MINUTE;
/** A block or sitting is at least this long: one message is still a touch. */
export const MIN_BLOCK_MS = 5 * MINUTE;
/** An agent's blocks this close on a day join into one span. */
const SPAN_JOIN_MS = 10 * MINUTE;
/** A commit belongs to a span it lands in, give or take this. */
const COMMIT_BEFORE_MS = 1 * MINUTE;
const COMMIT_AFTER_MS = 5 * MINUTE;

/** Event sources that are work. System frames, background heartbeats and recaps aren't. */
export const WORK_SOURCES = [
  'user',
  'agent',
  'tool_call',
  'tool_result',
  'thinking',
  'result',
  'approval_request',
  'approval_response',
  'error',
] as const;

// ─── Ledger blocks ──────────────────────────────────────────────

export interface WorkEvent {
  sessionId: string;
  at: number;
  source: string;
  /** A message another chat sent, not you. */
  fromOtherChat: boolean;
  /** Words in a user or agent message, else 0. */
  words: number;
}

/** One chat's continuous stretch, as the ledger file stores it. */
export interface LedgerBlock {
  sessionId: string;
  start: number;
  /** The last event. Display adds `MIN_BLOCK_MS` floor, storage doesn't. */
  end: number;
  busyMs: number;
  /** Your messages in it, epoch ms. */
  touches: number[];
  yourWords: number;
  agentWords: number;
}

/**
 * Append a chat's new events (sorted by time) to its blocks. Returns null
 * when an event predates the chat's blocks by more than a gap (an import of
 * old history): the caller rebuilds that chat from all its events instead.
 */
export function extendBlocks(existing: readonly LedgerBlock[], events: readonly WorkEvent[]): LedgerBlock[] | null {
  const blocks = existing.map((b) => ({ ...b, touches: [...b.touches] }));
  for (const ev of events) {
    let last = blocks[blocks.length - 1];
    if (last && ev.at < last.start - BLOCK_GAP_MS) return null;
    if (!last || ev.at - last.end > BLOCK_GAP_MS) {
      last = { sessionId: ev.sessionId, start: ev.at, end: ev.at, busyMs: 0, touches: [], yourWords: 0, agentWords: 0 };
      blocks.push(last);
    } else if (ev.at > last.end) {
      const step = ev.at - last.end;
      if (step <= BUSY_GAP_MS) last.busyMs += step;
      last.end = ev.at;
    } else if (ev.at < last.start) {
      last.start = ev.at;
    }
    if (ev.source === 'user' && !ev.fromOtherChat) {
      last.touches.push(ev.at);
      last.yourWords += ev.words;
    } else if (ev.source === 'agent') {
      last.agentWords += ev.words;
    }
  }
  return blocks;
}

export function countWords(text: string | null | undefined): number {
  if (!text) return 0;
  let n = 0;
  for (const part of text.split(/\s+/)) if (part) n++;
  return n;
}

// ─── Interval math ──────────────────────────────────────────────

export type Interval = [number, number];

export function mergeIntervals(intervals: readonly Interval[], joinMs = 0): Interval[] {
  const sorted = [...intervals].filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1] + joinMs) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

export function unionMs(intervals: readonly Interval[]): number {
  return mergeIntervals(intervals).reduce((sum, [s, e]) => sum + (e - s), 0);
}

export function overlapMs(a: readonly Interval[], b: readonly Interval[]): number {
  const x = mergeIntervals(a);
  const y = mergeIntervals(b);
  let i = 0;
  let j = 0;
  let total = 0;
  while (i < x.length && j < y.length) {
    const s = Math.max(x[i]![0], y[j]![0]);
    const e = Math.min(x[i]![1], y[j]![1]);
    if (e > s) total += e - s;
    if (x[i]![1] < y[j]![1]) i++;
    else j++;
  }
  return total;
}

/** Your messages as sittings: 30 quiet minutes end one, each at least 5 minutes. */
export function sittings(touches: readonly number[]): Interval[] {
  const sorted = [...touches].sort((a, b) => a - b);
  const out: Interval[] = [];
  for (const t of sorted) {
    const last = out[out.length - 1];
    if (last && t - last[1] <= BLOCK_GAP_MS) last[1] = Math.max(last[1], t);
    else out.push([t, t]);
  }
  return out.map(([s, e]) => [s, Math.max(e, s + MIN_BLOCK_MS)]);
}

/** The most intervals open at once, and when that first happened. */
export function peakConcurrency(intervals: readonly Interval[]): { count: number; at: number } | null {
  const edges: Array<[number, number]> = [];
  for (const [s, e] of intervals) {
    if (e <= s) continue;
    edges.push([s, 1], [e, -1]);
  }
  if (edges.length === 0) return null;
  // Ends before starts at the same instant: touching isn't overlapping.
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let open = 0;
  let best = { count: 0, at: 0 };
  for (const [t, d] of edges) {
    open += d;
    if (open > best.count) best = { count: open, at: t };
  }
  return best;
}

// ─── Commit sizing ──────────────────────────────────────────────

/** Files whose lines say nothing about effort: generated, vendored, lock and data files. */
const NOT_EFFORT =
  /(^|\/)(node_modules|dist|build|out|\.next|vendor|coverage)\/|lock|\.min\.|\.snap$|\.map$|\.(csv|tsv|svg|png|jpe?g|gif|webp|ico|pdf|zip|woff2?|ttf|mp[34]|wav)$|drizzle\/meta\/|generated/i;
/** One file can't make a commit huge on its own. */
const MAX_LINES_PER_FILE = 800;

export interface FileChange {
  path: string;
  added: number;
  deleted: number;
}

/**
 * The lines in a commit that took effort: additions, plus a quarter of
 * deletions (removing is cheaper than writing), per file capped, with
 * generated and data files left out. A big JSON change is data, not work.
 */
export function effortLines(files: readonly FileChange[]): number {
  let total = 0;
  for (const f of files) {
    if (NOT_EFFORT.test(f.path)) continue;
    if (f.path.endsWith('.json') && f.added + f.deleted > 300) continue;
    total += Math.min(f.added + Math.floor(f.deleted / 4), MAX_LINES_PER_FILE);
  }
  return total;
}

/**
 * Hours a skilled person would need for a commit of this size, the way an
 * engineer sizes a change: a tweak, a small change, a feature, a large one,
 * a very large one. Bands, not a per-line rate: a 2,000-line change isn't
 * ten times a 200-line one.
 */
export function commitEffortHours(lines: number): number {
  if (lines < 20) return 0.5;
  if (lines < 100) return 2;
  if (lines < 400) return 6;
  if (lines < 1200) return 14;
  return 24;
}

// ─── Assembling a range ─────────────────────────────────────────

export interface SessionMeta {
  id: string;
  agentId: string | null;
  executionId: string | null;
  label: string;
  scheduled: boolean;
}

export interface AgentMeta {
  id: string;
  name: string;
  emoji: string | null;
  /** Palette slot, from the agent's place in the person's agent order. */
  color?: number;
}

export interface CommitInput extends Omit<WorkCommit, 'agentId'> {
  /** Agents whose folder is this repo. The one working at the time wins. */
  agentIds: string[];
}

export interface RangeInput {
  start: string;
  days: number;
  now: number;
  blocks: readonly LedgerBlock[];
  sessions: ReadonlyMap<string, SessionMeta>;
  agents: readonly AgentMeta[];
  commits: readonly CommitInput[];
  tasksDone: ReadonlyArray<{ id: string; title: string; at: string }>;
  executionsFinished: ReadonlyArray<{ id: string; label: string; agentId: string | null; at: string }>;
}

/** Local midnight of a `YYYY-MM-DD` date, epoch ms. */
export function localDayStart(date: string): number {
  return new Date(`${date}T00:00:00`).getTime();
}

export const PALETTE_SIZE = 10;

/** A stable palette slot for an agent the service couldn't place in order. */
export function agentColor(id: string | null): number {
  if (!id) return -1;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % PALETTE_SIZE;
}

interface Clipped {
  block: LedgerBlock;
  meta: SessionMeta;
  start: number;
  end: number;
  busyMs: number;
  touches: number[];
}

export function buildRange(input: RangeInput): Omit<WorkRange, 'report' | 'generatedAt'> {
  const dates = Array.from({ length: input.days }, (_, i) => addDaysLocal(input.start, i));
  const rangeStart = localDayStart(dates[0]!);
  const rangeEnd = localDayStart(addDaysLocal(dates[dates.length - 1]!, 1));
  const agentById = new Map(input.agents.map((a) => [a.id, a] as const));
  const perAgent = new Map<string | null, { agentMinutes: number; personHours: number; commits: number }>();
  const bump = (id: string | null, d: { agentMinutes?: number; personHours?: number; commits?: number }) => {
    const cur = perAgent.get(id) ?? { agentMinutes: 0, personHours: 0, commits: 0 };
    cur.agentMinutes += d.agentMinutes ?? 0;
    cur.personHours += d.personHours ?? 0;
    cur.commits += d.commits ?? 0;
    perAgent.set(id, cur);
  };

  const relevant = input.blocks.filter(
    (b) => Math.max(b.end, b.start + MIN_BLOCK_MS) > rangeStart && b.start < rangeEnd && input.sessions.has(b.sessionId),
  );

  const dayList: WorkDay[] = dates.map((date) => {
    const dayStart = localDayStart(date);
    const dayEnd = localDayStart(addDaysLocal(date, 1));
    // Nothing after now: today's blocks end where work has got to.
    const ceiling = Math.min(dayEnd, Math.max(input.now, dayStart));

    const clipped: Clipped[] = [];
    for (const block of relevant) {
      const meta = input.sessions.get(block.sessionId)!;
      const fullEnd = Math.max(block.end, block.start + MIN_BLOCK_MS);
      const start = Math.max(block.start, dayStart);
      const end = Math.min(fullEnd, dayEnd, Math.max(ceiling, start));
      if (end <= start) continue;
      const share = (end - start) / (fullEnd - block.start);
      clipped.push({
        block,
        meta,
        start,
        end,
        busyMs: block.busyMs * Math.min(1, share),
        touches: meta.scheduled ? [] : block.touches.filter((t) => t >= dayStart && t < dayEnd),
      });
    }

    // Spans: an agent's clipped blocks, merged where close.
    const byAgent = new Map<string | null, Clipped[]>();
    for (const c of clipped) {
      const list = byAgent.get(c.meta.agentId) ?? [];
      list.push(c);
      byAgent.set(c.meta.agentId, list);
    }
    const spans: WorkSpan[] = [];
    for (const [agentId, list] of byAgent) {
      for (const [s, e] of mergeIntervals(list.map((c) => [c.start, c.end] as Interval), SPAN_JOIN_MS)) {
        // A block belongs to the merged span its start falls in.
        const members = list.filter((c) => c.start >= s && c.start <= e);
        const chats = new Map<string, WorkChat & { touches: number[] }>();
        for (const c of members) {
          const chat = chats.get(c.meta.id) ?? {
            sessionId: c.meta.id,
            executionId: c.meta.executionId,
            label: c.meta.label,
            agentMinutes: 0,
            withYou: false,
            scheduled: c.meta.scheduled,
            touches: [],
          };
          chat.agentMinutes += c.busyMs / MINUTE;
          chat.touches.push(...c.touches);
          chat.withYou ||= c.touches.length > 0;
          chats.set(c.meta.id, chat);
        }
        const allTouches = [...chats.values()].flatMap((c) => c.touches);
        spans.push({
          id: `${date}:${agentId ?? 'ri'}:${s}`,
          agentId,
          start: new Date(s).toISOString(),
          end: new Date(e).toISOString(),
          agentMinutes: [...chats.values()].reduce((sum, c) => sum + c.agentMinutes, 0),
          withYouMinutes: overlapMs([[s, e]], sittings(allTouches)) / MINUTE,
          chats: [...chats.values()]
            .map(({ sessionId, executionId, label, agentMinutes, withYou, scheduled }) => ({ sessionId, executionId, label, agentMinutes, withYou, scheduled }))
            .sort((a, b) => b.agentMinutes - a.agentMinutes),
          commits: [],
          personHours: 0,
        });
      }
    }
    spans.sort((a, b) => a.start.localeCompare(b.start));

    // Commits land in the span of an agent working on that repo at the time.
    const looseCommits: WorkCommit[] = [];
    for (const c of input.commits) {
      const t = Date.parse(c.at);
      if (t < dayStart || t >= dayEnd) continue;
      const span = spans.find(
        (sp) =>
          (sp.agentId ? c.agentIds.includes(sp.agentId) : false) &&
          t >= Date.parse(sp.start) - COMMIT_BEFORE_MS &&
          t <= Date.parse(sp.end) + COMMIT_AFTER_MS,
      );
      const { agentIds, ...rest } = c;
      const commit: WorkCommit = { ...rest, agentId: span?.agentId ?? agentIds[0] ?? null };
      if (span) span.commits.push(commit);
      else looseCommits.push(commit);
    }

    let codeAgentMinutes = 0;
    for (const sp of spans) {
      sp.commits.sort((a, b) => a.at.localeCompare(b.at));
      if (sp.commits.length > 0) {
        sp.personHours = sp.commits.reduce((sum, c) => sum + c.effortHours, 0);
        codeAgentMinutes += sp.agentMinutes;
      } else {
        sp.personHours = sp.agentMinutes / 60;
      }
      bump(sp.agentId, { agentMinutes: sp.agentMinutes, personHours: sp.personHours, commits: sp.commits.length });
    }
    for (const c of looseCommits) bump(c.agentId, { personHours: c.effortHours, commits: 1 });

    const dayCommits = [...spans.flatMap((sp) => sp.commits), ...looseCommits];
    const youSittings = sittings(clipped.flatMap((c) => c.touches));
    // A block's agent time, minus the share of it you were hands-on for.
    const whileAwayMs = clipped.reduce((sum, c) => {
      const len = c.end - c.start;
      const withYou = len > 0 ? overlapMs([[c.start, c.end]], youSittings) / len : 0;
      return sum + c.busyMs * (1 - Math.min(1, withYou));
    }, 0);
    const peak = peakConcurrency(clipped.map((c) => [c.start, c.end] as Interval));
    const stats: WorkStats = {
      handsOnMinutes: youSittings.reduce((sum, [s, e]) => sum + (Math.min(e, dayEnd) - s), 0) / MINUTE,
      agentMinutes: clipped.reduce((sum, c) => sum + c.busyMs, 0) / MINUTE,
      whileAwayMinutes: whileAwayMs / MINUTE,
      activeMinutes: unionMs(clipped.map((c) => [c.start, c.end] as Interval)) / MINUTE,
      personHours: spans.reduce((sum, sp) => sum + sp.personHours, 0) + looseCommits.reduce((sum, c) => sum + c.effortHours, 0),
      codeHours: dayCommits.reduce((sum, c) => sum + c.effortHours, 0),
      codeAgentMinutes,
      commits: dayCommits.length,
      agents: new Set([...spans.map((sp) => sp.agentId), ...looseCommits.map((c) => c.agentId)]).size,
      chats: new Set(clipped.map((c) => c.meta.id)).size,
      // Words count on the day a block starts, so a block over midnight isn't counted twice.
      agentWords: clipped.filter((c) => c.block.start >= dayStart).reduce((sum, c) => sum + c.block.agentWords, 0),
      yourWords: clipped.filter((c) => c.block.start >= dayStart).reduce((sum, c) => sum + c.block.yourWords, 0),
      peak: peak && peak.count > 0 ? { count: peak.count, at: new Date(peak.at).toISOString() } : null,
    };

    return {
      date,
      spans,
      looseCommits,
      tasksDone: input.tasksDone.filter((t) => inDay(t.at, dayStart, dayEnd)),
      executionsFinished: input.executionsFinished.filter((x) => inDay(x.at, dayStart, dayEnd)),
      stats,
    };
  });

  const agents: WorkAgent[] = [...perAgent.entries()]
    .map(([id, t]) => {
      const meta = id ? agentById.get(id) : undefined;
      return {
        id,
        name: id ? (meta?.name ?? 'Removed agent') : 'Ri',
        emoji: meta?.emoji ?? null,
        color: id ? (meta?.color ?? agentColor(id)) : -1,
        agentMinutes: t.agentMinutes,
        personHours: t.personHours,
        commits: t.commits,
      };
    })
    .sort((a, b) => b.personHours - a.personHours || b.agentMinutes - a.agentMinutes);

  const chatsInRange = new Set(relevant.map((b) => b.sessionId));
  return { start: input.start, days: input.days, dayList, totals: sumStats(dayList, agents.length, chatsInRange.size), agents };
}

function inDay(at: string, dayStart: number, dayEnd: number): boolean {
  const t = Date.parse(at);
  return t >= dayStart && t < dayEnd;
}

function sumStats(days: readonly WorkDay[], agents: number, chats: number): WorkStats {
  const total: WorkStats = {
    handsOnMinutes: 0,
    agentMinutes: 0,
    whileAwayMinutes: 0,
    activeMinutes: 0,
    personHours: 0,
    codeHours: 0,
    codeAgentMinutes: 0,
    commits: 0,
    agents,
    chats,
    agentWords: 0,
    yourWords: 0,
    peak: null,
  };
  for (const { stats: s } of days) {
    total.handsOnMinutes += s.handsOnMinutes;
    total.agentMinutes += s.agentMinutes;
    total.whileAwayMinutes += s.whileAwayMinutes;
    total.activeMinutes += s.activeMinutes;
    total.personHours += s.personHours;
    total.codeHours += s.codeHours;
    total.codeAgentMinutes += s.codeAgentMinutes;
    total.commits += s.commits;
    total.agentWords += s.agentWords;
    total.yourWords += s.yourWords;
    if (s.peak && (!total.peak || s.peak.count > total.peak.count)) total.peak = s.peak;
  }
  return total;
}
