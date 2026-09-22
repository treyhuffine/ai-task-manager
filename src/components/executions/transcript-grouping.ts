import type { ChatEventRecord } from '@/db/types';
import { isSubagentTool, isPlumbingTool, fileTargetPath } from '@/lib/executions/tool-display';
import { isSubagentEvent, isSubagentLaunch, collectNestedEvents } from '@/lib/executions/subagent';
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
 * folds its plumbing — thinking, tool calls, tool results, and any nested
 * subagent narration — into collapsible summary nodes, one per contiguous
 * run of plumbing. Everything the model wrote for the user to read stays
 * visible: user messages, every primary assistant message (not just the
 * turn's last one), and actionable rows (auth/permission/question/error).
 *
 * Folding whole turns onto their final reply used to hide every message but
 * the last, which broke once harnesses began interleaving several user-facing
 * messages through one turn (message → tools → message → tools). Per-run
 * grouping keeps each message beside the work it introduced.
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

/**
 * Aggregate the files written/edited in a turn (reads excluded), by path.
 *
 * Includes files written by the turn's subagents. The footer's contract is
 * "what changed on disk this turn", and a child process doing the writing
 * does not make the file not-changed. Measured on one real session, counting
 * only top-level rows dropped 152 of 272 edited paths — and a turn whose
 * subagent did all the writing rendered no footer at all.
 */
function aggregateTurnFiles(
  turn: ChatEventRecord[],
  nested?: ReadonlyMap<string, ChatEventRecord[]>,
): TurnFileEdit[] {
  const byPath = new Map<string, TurnFileEdit>();
  const scope = nested
    ? [
        ...turn,
        ...turn.flatMap((e) =>
          isSubagentLaunch(e) && e.externalToolCallId
            ? collectNestedEvents(e.externalToolCallId, nested)
            : [],
        ),
      ]
    : turn;
  for (const e of scope) {
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

/**
 * Rows that fold into a collapsed activity group — the turn's plumbing.
 *
 * Thinking, tool calls and tool results are always plumbing. Assistant
 * messages are the exception: a *primary* agent message is something the model
 * wrote for the user to read, so it stays visible. Only a *nested* agent
 * message (a subagent narrating to its caller — `externalParentToolCallId`
 * set) folds, because promoting subagent chatter is what made the visible
 * answer churn. Modern harnesses interleave several user-facing messages
 * through a single turn (message, tool calls, message, ...), so keying the
 * fold on "is this the turn's last message" would hide every message but the
 * last. Keying it on "is this the primary agent" keeps them all.
 */
function isCollapsible(event: ChatEventRecord): boolean {
  switch (event.source) {
    case 'thinking':
    case 'tool_call':
    case 'tool_result':
      return true;
    case 'agent':
      return isSubagentEvent(event);
    default:
      return false;
  }
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
  opts: {
    isRunning: boolean;
    density: TranscriptDensity;
    /**
     * Subagent transcripts keyed by launching tool call. Only used for
     * turn-level aggregates — the nested events themselves render inside
     * their launch row, not here.
     */
    nestedByParentCallId?: ReadonlyMap<string, ChatEventRecord[]>;
  },
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

    appendCollapsedTurn(nodes, turn, opts.nestedByParentCallId);
    i = j;
  }
  return nodes;
}

function appendCollapsedTurn(
  nodes: TranscriptNode[],
  turn: ChatEventRecord[],
  nested?: ReadonlyMap<string, ChatEventRecord[]>,
): void {
  // Files written/edited this turn — rendered as a footer after the reply.
  const files = aggregateTurnFiles(turn, nested);
  const appendFilesFooter = () => {
    if (files.length) nodes.push({ kind: 'files', id: `files:${turn[0]?.id ?? ''}`, files });
  };

  // Fold each *contiguous run* of plumbing into its own group and leave every
  // visible row (user, primary agent message, actionable rows) inline in
  // place. One group per run — not one per turn — so that when a turn
  // interleaves messages and work ("message → tools → message → tools"), each
  // message stays anchored above the work it introduced instead of the whole
  // turn's tools piling into a single blob out of order.
  let k = 0;
  while (k < turn.length) {
    const ev = turn[k];
    if (!isCollapsible(ev)) {
      nodes.push({ kind: 'event', event: ev });
      k++;
      continue;
    }
    let m = k;
    while (m < turn.length && isCollapsible(turn[m])) m++;
    const groupEvents = turn.slice(k, m);
    nodes.push({
      kind: 'group',
      id: groupEvents[0].id,
      events: groupEvents,
      counts: countGroup(groupEvents),
      startedAt: groupEvents[0].createdAt,
      endedAt: groupEvents[groupEvents.length - 1].createdAt,
    });
    k = m;
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
