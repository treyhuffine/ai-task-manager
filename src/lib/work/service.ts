/**
 * The work view's server side (docs/work-view.md): what you and your agents
 * did over a range of days, for the calendar, the saved report and the
 * `work_summary` action. Reads only: the ledger file, chat and agent rows
 * through the query layer, and git.
 */

import { createNote, listExecutionsArchivedBetween, listTasksCompletedBetween, listWorkSessionMeta, listWorkspaces } from '@/lib/db/queries';
import { addDaysLocal, formatDayLabel } from '@/lib/calendar/dates';
import { normalizeTimestamp } from '@/lib/utils/timestamps';
import type { NoteRecord } from '@/db/types';
import { commitsForRange, type Repo } from './commits';
import { formatDuration, formatHours, summaryLines, weeklyReport } from './equivalents';
import { readLedger } from './ledger';
import { MIN_BLOCK_MS, agentSlot, buildRange, localDayStart, type AgentMeta, type SessionMeta } from './model';
import type { WorkRange } from './types';

export const MAX_WORK_DAYS = 31;

export interface WorkRangeInput {
  /** First day, YYYY-MM-DD, server-local. */
  start: string;
  days: number;
}

const iso = (ms: number) => new Date(ms).toISOString();

export async function getWorkRange({ start, days }: WorkRangeInput): Promise<WorkRange> {
  const span = Math.min(Math.max(1, Math.round(days)), MAX_WORK_DAYS);
  const from = localDayStart(start);
  const to = localDayStart(addDaysLocal(start, span));
  if (!Number.isFinite(from)) throw new Error(`Invalid start date: ${start}`);

  const blocks = (await readLedger()).filter((b) => Math.max(b.end, b.start + MIN_BLOCK_MS) > from && b.start < to);

  const sessions = new Map<string, SessionMeta>();
  for (const row of listWorkSessionMeta([...new Set(blocks.map((b) => b.sessionId))])) {
    sessions.set(row.id, {
      id: row.id,
      agentId: row.workspaceId,
      executionId: row.executionId,
      label: row.executionLabel ?? row.label ?? (row.executionId ? 'Untitled' : 'Main chat'),
      scheduled: row.createdByRunId != null,
    });
  }

  const workspaces = [...listWorkspaces({ status: 'active' }), ...listWorkspaces({ status: 'archived' })];
  // Colors follow the agent order the person keeps, so the agents at the top
  // get the palette's most distinct colors and keep them week to week.
  const agents: AgentMeta[] = workspaces.map((w, i) => ({ id: w.id, name: w.name, emoji: w.emoji ?? null, color: agentSlot(i) }));
  // One repo per folder, even when two agents share it, so no commit counts twice.
  const repos = new Map<string, Repo>();
  for (const w of workspaces) {
    if (!w.isGit || !w.cwd) continue;
    const repo = repos.get(w.cwd) ?? { cwd: w.cwd, agentIds: [] };
    repo.agentIds.push(w.id);
    repos.set(w.cwd, repo);
  }
  const commits = await commitsForRange([...repos.values()], iso(from), iso(to));

  const base = buildRange({
    start,
    days: span,
    now: Date.now(),
    blocks,
    sessions,
    agents,
    commits,
    tasksDone: listTasksCompletedBetween(iso(from), iso(to)).map((t) => ({
      id: t.id,
      title: t.title,
      at: normalizeTimestamp(t.completedAt),
    })),
    executionsFinished: listExecutionsArchivedBetween(iso(from), iso(to)).map((x) => ({
      id: x.id,
      label: x.label ?? 'Untitled',
      agentId: x.workspaceId,
      at: normalizeTimestamp(x.archivedAt),
    })),
  });
  return { ...base, report: weeklyReport(base), generatedAt: new Date().toISOString() };
}

const COMMITS_PER_AGENT = 40;

/** The range as a markdown report: the three lines, the numbers, by agent, by day, what shipped. */
export function workReportMarkdown(range: WorkRange): { title: string; body: string } {
  const last = addDaysLocal(range.start, range.days - 1);
  const title = range.days === 1 ? `Work: ${formatDayLabel(range.start)}` : `Work: ${formatDayLabel(range.start)} to ${formatDayLabel(last)}`;
  const t = range.totals;
  const lines: string[] = [];
  lines.push(...range.report.map((l) => `- ${l}`), '');
  const extra = summaryLines(t, range.days);
  if (extra.length) lines.push('## In numbers', '', ...extra.map((l) => `- ${l}`), '');

  const agentName = new Map(range.agents.map((a) => [a.id, a.name] as const));
  if (range.agents.length) {
    lines.push('## By agent', '');
    for (const a of range.agents) {
      lines.push(
        `- **${a.name}**: agents ${formatDuration(a.agentMinutes)}, about ${formatHours(a.personHours)} person-hours, ${a.commits} ${a.commits === 1 ? 'commit' : 'commits'}`,
      );
    }
    lines.push('');
  }

  lines.push('## By day', '');
  for (const d of range.dayList) {
    const s = d.stats;
    if (s.agentMinutes < 1 && s.commits === 0 && s.handsOnMinutes < 1) continue;
    lines.push(
      `- **${formatDayLabel(d.date)}**: ${formatDuration(s.handsOnMinutes)} hands-on, agents ${formatDuration(s.agentMinutes)}, about ${formatHours(s.personHours)} person-hours, ${s.commits} ${s.commits === 1 ? 'commit' : 'commits'}`,
    );
  }
  lines.push('');

  const byAgent = new Map<string | null, string[]>();
  for (const d of range.dayList) {
    for (const c of [...d.spans.flatMap((sp) => sp.commits), ...d.looseCommits]) {
      const list = byAgent.get(c.agentId) ?? [];
      list.push(c.subject);
      byAgent.set(c.agentId, list);
    }
  }
  if (byAgent.size) {
    lines.push('## What shipped', '');
    for (const [id, subjects] of byAgent) {
      lines.push(`### ${agentName.get(id) ?? 'Ri'}`, '');
      for (const s of subjects.slice(0, COMMITS_PER_AGENT)) lines.push(`- ${s}`);
      if (subjects.length > COMMITS_PER_AGENT) lines.push(`- and ${subjects.length - COMMITS_PER_AGENT} more`);
      lines.push('');
    }
  }
  return { title, body: lines.join('\n').trim() + '\n' };
}

/** Save the range's report as a note. */
export async function saveWorkReport(input: WorkRangeInput): Promise<NoteRecord> {
  const { title, body } = workReportMarkdown(await getWorkRange(input));
  return createNote({ title, body });
}
