import type { ChatEventRecord } from '@/db/types';
import { isSubagentTool, isPlumbingTool, fileTargetPath } from '@/lib/executions/tool-display';
import { computeEditDiff } from '@/lib/executions/edit-diff';
import { formatSpanSeconds } from '@/lib/executions/duration';
import type { TranscriptDensity } from '@/lib/client/transcript-density';

/** A file written/edited during a turn, with cumulative +/− across the turn. */
export interface TurnFileEdit {
  path: string;
  additions: number;
  deletions: number;
}

/**
 * Condensed transcript model (Conductor-style). A *completed* agent turn
 * folds its intermediate activity — thinking, tool calls, tool results,
 * and transient (non-final) assistant messages — into one collapsible
 * summary node. The turn's final reply and any actionable rows
 * (auth/permission/question/error) stay visible.
 *
 * Collapsing happens only once a turn is complete: the last turn is left
 * inline while the agent is still running (`isRunning`), then folds the
 * moment the turn finishes.
 */

export interface GroupCounts {
  toolCalls: number;
  thinking: number;
  messages: number;
  subagents: number;
  results: number;
}

export type TranscriptNode =
  | { kind: 'event'; event: ChatEventRecord }
  | {
      kind: 'group';
      id: string;
      events: ChatEventRecord[];
      counts: GroupCounts;
      startedAt: string;
      endedAt: string;
    }
  | { kind: 'files'; id: string; files: TurnFileEdit[] };

/** Aggregate the files written/edited in a turn (reads excluded), by path. */
function aggregateTurnFiles(turn: ChatEventRecord[]): TurnFileEdit[] {
  const byPath = new Map<string, TurnFileEdit>();
  for (const e of turn) {
    if (e.source !== 'tool_call') continue;
    const path = fileTargetPath(e.toolName, e.toolInput);
    if (!path) continue;
    const diff = computeEditDiff(e.toolName, e.toolInput);
    if (!diff) continue; // reads/other → no edit, skip
    const cur = byPath.get(path) ?? { path, additions: 0, deletions: 0 };
    cur.additions += diff.additions;
    cur.deletions += diff.deletions;
    byPath.set(path, cur);
  }
  return [...byPath.values()];
}

/** Rows that belong inside a collapsed activity group (when not the turn's final reply). */
function isCollapsibleSource(source: string): boolean {
  return (
    source === 'thinking' ||
    source === 'tool_call' ||
    source === 'tool_result' ||
    source === 'agent'
  );
}

function countGroup(events: ChatEventRecord[]): GroupCounts {
  const counts: GroupCounts = { toolCalls: 0, thinking: 0, messages: 0, subagents: 0, results: 0 };
  for (const e of events) {
    switch (e.source) {
      case 'thinking':
        counts.thinking++;
        break;
      case 'tool_call':
        if (isPlumbingTool(e.toolName)) break; // PTY plumbing — uncounted
        if (isSubagentTool(e.toolName)) counts.subagents++;
        else counts.toolCalls++;
        break;
      case 'tool_result':
        counts.results++;
        break;
      case 'agent':
        counts.messages++;
        break;
    }
  }
  return counts;
}

/** Human summary, e.g. "6 tool calls · 4 thinking · 2 subagents". */
export function summarizeCounts(c: GroupCounts): string {
  const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
  const parts: string[] = [];
  if (c.toolCalls) parts.push(plural(c.toolCalls, 'tool call'));
  if (c.subagents) parts.push(plural(c.subagents, 'subagent'));
  if (c.thinking) parts.push(plural(c.thinking, 'thinking block'));
  if (c.messages) parts.push(plural(c.messages, 'message'));
  if (!parts.length && c.results) parts.push(plural(c.results, 'result'));
  return parts.join(' · ') || 'activity';
}

/**
 * Build the render list. In `full` density every event is its own node.
 * In `condensed`, completed turns collapse per the model above.
 */
export function buildTranscriptNodes(
  events: ChatEventRecord[],
  opts: { isRunning: boolean; density: TranscriptDensity },
): TranscriptNode[] {
  if (opts.density === 'full') {
    return events.map((event) => ({ kind: 'event', event }));
  }

  const nodes: TranscriptNode[] = [];
  let i = 0;
  while (i < events.length) {
    const e = events[i];
    if (e.source === 'user') {
      nodes.push({ kind: 'event', event: e });
      i++;
      continue;
    }
    // Gather a turn = contiguous run of non-user events.
    let j = i;
    while (j < events.length && events[j].source !== 'user') j++;
    const turn = events.slice(i, j);
    const isLastTurn = j >= events.length;

    if (isLastTurn && opts.isRunning) {
      // Live turn — render inline, don't collapse yet.
      for (const ev of turn) nodes.push({ kind: 'event', event: ev });
      i = j;
      continue;
    }

    appendCollapsedTurn(nodes, turn);
    i = j;
  }
  return nodes;
}

function appendCollapsedTurn(nodes: TranscriptNode[], turn: ChatEventRecord[]): void {
  // Files written/edited this turn — rendered as a footer after the reply.
  const files = aggregateTurnFiles(turn);
  const appendFilesFooter = () => {
    if (files.length) nodes.push({ kind: 'files', id: `files:${turn[0]?.id ?? ''}`, files });
  };

  // The final assistant text message stays visible below the group.
  let finalAgentIdx = -1;
  for (let k = turn.length - 1; k >= 0; k--) {
    if (turn[k].source === 'agent') {
      finalAgentIdx = k;
      break;
    }
  }

  const groupEvents = turn.filter((ev, k) => k !== finalAgentIdx && isCollapsibleSource(ev.source));

  // Nothing worth folding — render the turn as-is.
  if (groupEvents.length === 0) {
    for (const ev of turn) nodes.push({ kind: 'event', event: ev });
    appendFilesFooter();
    return;
  }

  const counts = countGroup(groupEvents);
  let emittedGroup = false;
  for (let k = 0; k < turn.length; k++) {
    const ev = turn[k];
    const inGroup = k !== finalAgentIdx && isCollapsibleSource(ev.source);
    if (inGroup) {
      if (!emittedGroup) {
        nodes.push({
          kind: 'group',
          id: groupEvents[0].id,
          events: groupEvents,
          counts,
          startedAt: groupEvents[0].createdAt,
          endedAt: groupEvents[groupEvents.length - 1].createdAt,
        });
        emittedGroup = true;
      }
      continue;
    }
    nodes.push({ kind: 'event', event: ev });
  }
  appendFilesFooter();
}

/** Compact elapsed label for a group span, e.g. "7.4s", "2m 14s", "1h 5m". */
export function formatSpan(startISO: string, endISO: string): string | null {
  const a = Date.parse(startISO);
  const b = Date.parse(endISO);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return formatSpanSeconds((b - a) / 1000);
}
