/**
 * Helpers for the orchestrator's execution-oversight actions: condensing
 * chat_events into an agent-readable transcript tail and deriving "is this
 * session waiting on a human?" from the durable event log.
 *
 * Token discipline matters here — the consumer is another model. Tool
 * calls collapse to one line, content gets truncated, and pure plumbing
 * rows (system init, rate-limit noise, thinking signatures) are dropped.
 */

import type { ChatEventRecord } from '@/db/types';

const CONTENT_MAX = 700;
const TOOL_INPUT_MAX = 200;

function truncate(text: string, max: number): string {
  const cleaned = text.trim();
  return cleaned.length <= max ? cleaned : cleaned.slice(0, max - 1).trimEnd() + '…';
}

export interface CondensedEvent {
  at: string;
  /** user | agent | tool_call | tool_result | result | error | permission_request | question_request | … */
  kind: string;
  /** Present for user/agent/error rows and tool results with output. */
  text?: string;
  /** Present for tool rows. */
  tool?: string;
  /** One-line summary of the tool input (truncated JSON). */
  input?: string;
  isError?: boolean;
  /**
   * Present when a nested actor (a subagent) produced this row rather than
   * the session itself. The value is the `tool_use` id of the launching call,
   * so an agent can group a fan-out back together.
   */
  nestedUnder?: string;
}

/** Sources that carry no signal for an overseeing agent. */
const DROP_SOURCES = new Set(['system', 'thinking', 'recap', 'rate_limit', 'unknown']);

export function condenseEvents(events: ChatEventRecord[]): CondensedEvent[] {
  const out: CondensedEvent[] = [];
  for (const e of events) {
    if (DROP_SOURCES.has(e.source)) continue;
    const row: CondensedEvent = { at: e.createdAt, kind: e.source };
    // Mark nested work so an overseeing agent doesn't read a subagent's
    // narration as the session's own answer. Reading a session mid-fan-out
    // otherwise returns dozens of rows that look identical to the reply.
    if (e.externalParentToolCallId) row.nestedUnder = e.externalParentToolCallId;
    if (e.toolName) row.tool = e.toolName;
    if (e.toolInput && Object.keys(e.toolInput).length > 0) {
      try {
        row.input = truncate(JSON.stringify(e.toolInput), TOOL_INPUT_MAX);
      } catch {
        /* non-serializable — skip */
      }
    }
    if (e.content) row.text = truncate(e.content, CONTENT_MAX);
    if (e.toolIsError) row.isError = true;
    // Empty rows (e.g. a tool_call whose input we dropped) still mark that
    // the call happened — keep them, they cost almost nothing.
    out.push(row);
  }
  return out;
}

export interface PendingFromEvents {
  kind: 'permission' | 'question';
  /** The prompt content/tool the session is blocked on, condensed. */
  detail: string;
  since: string;
}

/**
 * DB-derived "waiting on input" heuristic: the tail contains a
 * permission/question request with no later response row. The
 * authoritative signal is the server's in-memory pending set (see
 * `fetchLiveSignals`) — use this as the fallback/detail source, and for
 * surfacing WHAT the session is blocked on.
 */
export function derivePendingFromEvents(events: ChatEventRecord[]): PendingFromEvents | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.source === 'permission_response' || e.source === 'question_response') return null;
    if (e.source === 'permission_request' || e.source === 'question_request') {
      const detailParts = [e.toolName, e.content].filter(Boolean) as string[];
      let detail = detailParts.join(': ');
      if (!detail && e.toolInput) {
        try {
          detail = truncate(JSON.stringify(e.toolInput), TOOL_INPUT_MAX);
        } catch {
          detail = e.source;
        }
      }
      return {
        kind: e.source === 'permission_request' ? 'permission' : 'question',
        detail: truncate(detail || e.source, CONTENT_MAX),
        since: e.createdAt,
      };
    }
  }
  return null;
}
