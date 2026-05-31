/**
 * Structured observation of an in-flight (or terminal) run.
 *
 * Replaces "the run has been going for X minutes, kill it" with a
 * richer view: what's the subprocess doing, what was the last event,
 * how long ago, is the agent waiting on something? This is the
 * primitive the orchestrator will need once it's the user's primary
 * interface — when *it* runs scheduled tasks for the user, it has to
 * be able to answer "is daily-briefing stuck or just slow?" with
 * actual evidence instead of a stopwatch.
 *
 * Three layers of evidence, in order of confidence:
 *
 *   1. **Process state** — `isAgentSessionAlive` peeks the SDK
 *      handle's process. If the subprocess has exited cleanly without
 *      a `result` event landing, the run is dead.
 *
 *   2. **Event recency** — every agent emission (assistant text,
 *      thinking, tool_call, tool_result, permission_request,
 *      `result`) updates `chat_events`. The gap between now and the
 *      newest event is the most honest "is it stuck?" signal.
 *
 *   3. **Last-event shape** — what was the agent *doing* when it
 *      went quiet? A `tool_call` still in flight means the agent is
 *      waiting on a long-running tool (test suite, Bash); a
 *      `permission_request` means it's waiting on the human; an
 *      `agent` text with no follow-up means it actually finished and
 *      the result event got dropped.
 *
 * Returns a structured shape — no automatic action. The UI surfaces
 * it as a status badge; the orchestrator will eventually call this
 * directly to decide whether to wait, cancel, or alert.
 */

import { getDb } from '@/lib/db';
import { chatEvents } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { getRun, getChatSession } from '@/lib/db/queries';
import { isAgentSessionAlive, isRunning } from '@/lib/executor/adapter';
import type { ChatEventRecord, ChatEventSource, RunRecord } from '@/db/types';

/**
 * What the agent appears to be doing right now. Derived from the
 * latest event's shape + the gap since it landed. Ordered roughly by
 * "needs attention," highest to lowest.
 */
export type RunActivity =
  /** Terminal — the run row has reached completed / failed / skipped. */
  | { kind: 'terminal'; status: 'completed' | 'failed' | 'skipped' }
  /** Subprocess gone but the run row still says running — boot reaper
   *  will catch this, but the UI can surface it now. */
  | { kind: 'crashed'; lastEventAt: string | null }
  /** Agent emitted a `permission_request` or `question_request` and is
   *  blocked until the user answers. */
  | { kind: 'awaiting_input'; toolName: string | null; lastEventAt: string }
  /** Agent issued a `tool_call` and its `tool_result` hasn't landed.
   *  `tool` and `inFlightForMs` say which tool + how long. */
  | { kind: 'tool_in_flight'; tool: string; inFlightForMs: number; lastEventAt: string }
  /** Recent agent activity (within ACTIVE_WINDOW_MS). The run is
   *  almost certainly working. */
  | { kind: 'working'; lastEventAt: string; lastEventType: ChatEventSource }
  /** Subprocess is alive but no agent event for STALLED_WINDOW_MS.
   *  Could be a slow tool we haven't seen the call for, or genuine
   *  stuckness. The UI surfaces this as a soft warning, not a kill. */
  | { kind: 'stalled'; quietForMs: number; lastEventAt: string | null }
  /** Run row says queued but no inflight count and no recent events.
   *  Should be brief; if it persists, something went wrong before
   *  `markRunStarted`. */
  | { kind: 'queued' };

export interface RunObservation {
  runId: string;
  status: RunRecord['status'];
  startedAt: string | null;
  /** Total wall-clock time the run has been alive, in ms. Null if
   *  startedAt isn't set yet. */
  uptimeMs: number | null;
  /** Latest chat_event timestamp on the run's chat session, if any. */
  lastEventAt: string | null;
  /** Ms since the latest event landed (null if no events). */
  quietForMs: number | null;
  /** True iff the subprocess is alive AND the executor's in-memory
   *  state thinks something is running for this chat. */
  processAlive: boolean;
  /** The activity verdict. */
  activity: RunActivity;
  /** Convenience flag the UI uses to render a warning badge. True iff
   *  activity is `tool_in_flight` over the tool-warn threshold,
   *  `stalled`, or `crashed`. */
  stallWarning: boolean;
}

/** Window inside which the agent is "actively working." */
const ACTIVE_WINDOW_MS = 30_000;
/** Beyond this, the UI surfaces a "stalled" warning. */
const STALLED_WINDOW_MS = 5 * 60_000;
/** Long-running tools (test suites, gh) can take a while. We don't
 *  warn until a tool's been in flight this long. */
const TOOL_WARN_MS = 5 * 60_000;

/**
 * Inspect a run and return a structured observation. Cheap — bounded
 * to a small number of recent events + a process-liveness peek. Safe
 * to poll on a ~5s cadence.
 */
export function observeRun(runId: string, now: Date = new Date()): RunObservation | null {
  const run = getRun(runId);
  if (!run) return null;

  const nowMs = now.getTime();
  const uptimeMs = run.startedAt ? Math.max(0, nowMs - new Date(run.startedAt).getTime()) : null;

  // Terminal first — no need to probe further.
  if (run.status === 'completed' || run.status === 'failed' || run.status === 'skipped') {
    return {
      runId: run.id,
      status: run.status,
      startedAt: run.startedAt,
      uptimeMs,
      lastEventAt: run.completedAt,
      quietForMs: run.completedAt
        ? Math.max(0, nowMs - new Date(run.completedAt).getTime())
        : null,
      processAlive: false,
      activity: { kind: 'terminal', status: run.status },
      stallWarning: false,
    };
  }

  if (run.status === 'queued') {
    return {
      runId: run.id,
      status: 'queued',
      startedAt: null,
      uptimeMs: null,
      lastEventAt: null,
      quietForMs: null,
      processAlive: false,
      activity: { kind: 'queued' },
      stallWarning: false,
    };
  }

  // status = running — do the actual probe.
  const chatSessionId = run.chatSessionId;
  const events: ChatEventRecord[] = chatSessionId ? recentEventsDesc(chatSessionId, 20) : [];
  const latest = events[0] ?? null;
  const lastEventAt = latest?.createdAt ?? null;
  const quietForMs = lastEventAt
    ? Math.max(0, nowMs - new Date(lastEventAt).getTime())
    : null;

  const processAlive = chatSessionId
    ? isRunning(chatSessionId) && isAgentSessionAlive(chatSessionId)
    : false;

  // Process gone but row still running → crashed mid-flight.
  if (!processAlive) {
    // Be slightly conservative: don't classify as crashed in the
    // first few seconds after start, since the runtime probe may not
    // yet have seen the subprocess. uptime < 5s → fall through to
    // "working/stalled" classification.
    if (uptimeMs != null && uptimeMs > 5_000) {
      return {
        runId: run.id,
        status: 'running',
        startedAt: run.startedAt,
        uptimeMs,
        lastEventAt,
        quietForMs,
        processAlive: false,
        activity: { kind: 'crashed', lastEventAt },
        stallWarning: true,
      };
    }
  }

  // Awaiting human input → highest priority among live states.
  const blockedOn = findBlockedOnInput(events);
  if (blockedOn) {
    return {
      runId: run.id,
      status: 'running',
      startedAt: run.startedAt,
      uptimeMs,
      lastEventAt,
      quietForMs,
      processAlive,
      activity: {
        kind: 'awaiting_input',
        toolName: blockedOn.toolName,
        lastEventAt: blockedOn.at,
      },
      stallWarning: false,
    };
  }

  // Tool call whose result hasn't landed yet.
  const pendingTool = findPendingToolCall(events);
  if (pendingTool) {
    const inFlightForMs = Math.max(0, nowMs - new Date(pendingTool.at).getTime());
    return {
      runId: run.id,
      status: 'running',
      startedAt: run.startedAt,
      uptimeMs,
      lastEventAt,
      quietForMs,
      processAlive,
      activity: {
        kind: 'tool_in_flight',
        tool: pendingTool.toolName,
        inFlightForMs,
        lastEventAt: pendingTool.at,
      },
      stallWarning: inFlightForMs > TOOL_WARN_MS,
    };
  }

  // Recent agent activity → working.
  if (latest && quietForMs != null && quietForMs <= ACTIVE_WINDOW_MS) {
    return {
      runId: run.id,
      status: 'running',
      startedAt: run.startedAt,
      uptimeMs,
      lastEventAt,
      quietForMs,
      processAlive,
      activity: {
        kind: 'working',
        lastEventAt: latest.createdAt,
        lastEventType: latest.source as ChatEventSource,
      },
      stallWarning: false,
    };
  }

  // Quiet — possibly stalled. Warn after STALLED_WINDOW_MS.
  return {
    runId: run.id,
    status: 'running',
    startedAt: run.startedAt,
    uptimeMs,
    lastEventAt,
    quietForMs,
    processAlive,
    activity: { kind: 'stalled', quietForMs: quietForMs ?? 0, lastEventAt },
    stallWarning: (quietForMs ?? 0) > STALLED_WINDOW_MS,
  };
}

// ── Helpers ─────────────────────────────────────────────────

function recentEventsDesc(chatSessionId: string, limit: number): ChatEventRecord[] {
  const db = getDb();
  return db
    .select()
    .from(chatEvents)
    .where(eq(chatEvents.sessionId, chatSessionId))
    .orderBy(desc(chatEvents.createdAt))
    .limit(limit)
    .all() as ChatEventRecord[];
}

/**
 * Walk newest-first for the most recent `permission_request` or
 * `question_request` that hasn't received a response. Returns the
 * tool name + timestamp, or null when not blocked.
 */
function findBlockedOnInput(
  eventsDesc: ChatEventRecord[],
): { toolName: string | null; at: string } | null {
  for (const e of eventsDesc) {
    // A response to a prior request unblocks — done looking.
    if (e.source === 'permission_response' || e.source === 'question_response') {
      return null;
    }
    if (e.source === 'permission_request' || e.source === 'question_request') {
      return { toolName: e.toolName ?? null, at: e.createdAt };
    }
  }
  return null;
}

/**
 * Walk newest-first for the most recent `tool_call` that hasn't been
 * paired with its `tool_result`. The unique-index on
 * `external_tool_call_id` means we can match by that field — but it's
 * nullable, so fall back to a "no result newer than this call" scan.
 *
 * Returns `{toolName, at}` for the still-pending call, or null when
 * everything's matched.
 */
function findPendingToolCall(
  eventsDesc: ChatEventRecord[],
): { toolName: string; at: string } | null {
  // Collect tool_result ids seen so far (walking newest-first, so
  // anything older than the result is matched).
  const resultedCallIds = new Set<string>();
  for (const e of eventsDesc) {
    if (e.source === 'tool_result' && e.externalToolCallId) {
      resultedCallIds.add(e.externalToolCallId);
    }
    if (e.source === 'tool_call') {
      const id = e.externalToolCallId;
      if (id && !resultedCallIds.has(id) && e.toolName) {
        return { toolName: e.toolName, at: e.createdAt };
      }
      // Found a tool_call but it has a matching result or no id —
      // not pending. Keep walking older calls.
    }
    if (e.source === 'result') {
      // The agent emitted a turn-end result. Any earlier tool_calls
      // would have been completed inside that turn; not pending.
      return null;
    }
  }
  return null;
}

/** Convenience for callers that don't need the full object. */
export function summarizeActivity(observation: RunObservation): string {
  const a = observation.activity;
  switch (a.kind) {
    case 'terminal':
      return a.status;
    case 'crashed':
      return 'Subprocess exited';
    case 'awaiting_input':
      return a.toolName ? `Awaiting input (${a.toolName})` : 'Awaiting input';
    case 'tool_in_flight':
      return `${a.tool} in flight for ${humanMs(a.inFlightForMs)}`;
    case 'working':
      return 'Working';
    case 'stalled':
      return `Quiet for ${humanMs(a.quietForMs)}`;
    case 'queued':
      return 'Queued';
  }
}

function humanMs(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)} min`;
  return `${Math.round(ms / (60 * 60_000))} hr`;
}

// Re-export to silence "unused" until callers reach for it.
void getChatSession;
