/**
 * Translate Codex on-disk JSONL lines into `chat_events` insert inputs.
 *
 * Codex's on-disk format is version-specific and not externally
 * documented; agentex's `readCodexTranscript` returns normalized
 * `CodexTranscriptLine`s (raw + outer type + timestamp + payload)
 * without translating to `StreamEvent`. We do that translation here so
 * the JSONL replay path can feed `insertChatEvent` and produce rows
 * shaped identically to what the live executor stream writes.
 *
 * What we map and what we drop:
 *
 *   - `response_item/message` (role="assistant")    → source: 'agent'
 *   - `response_item/reasoning`                     → source: 'thinking'
 *   - `response_item/function_call`                 → source: 'tool_call'
 *   - `response_item/function_call_output`          → source: 'tool_result'
 *   - `event_msg/task_complete`                     → source: 'result'
 *
 * Everything else is dropped:
 *
 *   - `session_meta` / `turn_context` — metadata only, no chat surface
 *   - `event_msg/task_started`         — turn boundary, redundant
 *   - `event_msg/token_count`          — telemetry pill, not user-visible
 *   - `event_msg/agent_message`        — duplicates response_item/message
 *   - `event_msg/agent_reasoning`      — duplicates response_item/reasoning
 *   - `event_msg/user_message`         — we own user-message writes via
 *                                        POST /api/sessions/:id/messages;
 *                                        echoing the JSONL's would create
 *                                        duplicates
 *   - `response_item/message` (developer/user) — system-prompt material
 *                                                we don't surface in the
 *                                                transcript
 *
 * Deduplication against the live stream. Live and on-disk rows describe
 * the same turn in different vocabularies (`command_execution` vs
 * `exec_command` + `write_stdin`) under different synthetic ids, so the
 * unique index can never collide them. Instead, reconcile runs every line
 * through `createCodexReplayFilter`, which drops any line from a turn the
 * live stream already wrote (`externalTurnId`) or whose provider item id is
 * already stored. What survives is history the live stream never saw: turns
 * run from the Codex CLI, or ones Codex started on its own.
 *
 * Idempotency: replayed rows are keyed by Codex's own item identity
 * (`replayEventId`), so re-reading a line is a no-op insert. Byte offsets
 * would not do: newer Codex versions rewrite old rollouts in place (adding
 * `ordinal`, `"content": null`), which shifts every offset after the first
 * changed line and sends the reconcile cursor back over lines it already
 * stored.
 */

import { uuidv7 } from 'uuidv7';
import type { CodexTranscriptLine } from '@agentex/agent';
import type { ChatEventRecord, CreateChatEventInput, ChatEventSource } from '@/db/types';

export function mapCodexLineToInput(
  chatSessionId: string,
  line: CodexTranscriptLine,
): CreateChatEventInput | null {
  if (!line.payload) return null;

  // Payloads carry untyped key/values — the on-disk vocabulary is
  // Codex-internal and changes across versions, so we read fields
  // defensively rather than enforcing a strict shape.
  const p = line.payload as Record<string, unknown>;
  const innerType = typeof p.type === 'string' ? p.type : null;

  const createdAt = line.timestamp ?? new Date().toISOString();
  // Deliberately no `externalTurnId`: that column is how reconcile tells
  // which turns the LIVE stream wrote (see `codexLiveCoverage`). A replayed
  // row carrying it would mark its turn covered, and a turn still being
  // written by the Codex CLI would stop replaying halfway.
  const base = {
    sessionId: chatSessionId,
    externalEventId: replayEventId(line),
    raw: line.raw,
    createdAt,
  };

  if (line.type === 'response_item') {
    if (innerType === 'message') {
      if (p.role !== 'assistant') return null;
      return {
        ...base,
        externalMessageId: stringField(p, 'id'),
        role: 'assistant',
        source: 'agent' satisfies ChatEventSource,
        content: extractMessageText(p.content),
      };
    }

    if (innerType === 'reasoning') {
      const text = extractReasoningSummary(p.summary);
      // Empty/missing reasoning summaries (Codex sometimes emits a
      // reasoning event with only encrypted_content) aren't useful in
      // the transcript — skip rather than insert an empty row.
      if (!text) return null;
      return {
        ...base,
        externalMessageId: stringField(p, 'id'),
        role: 'assistant',
        source: 'thinking' satisfies ChatEventSource,
        content: text,
      };
    }

    if (innerType === 'function_call') {
      return {
        ...base,
        role: 'assistant',
        source: 'tool_call' satisfies ChatEventSource,
        content: null,
        toolName: typeof p.name === 'string' ? p.name : null,
        toolInput: parseToolArguments(p.arguments),
        externalToolCallId:
          typeof p.call_id === 'string' ? p.call_id :
          typeof p.id === 'string' ? p.id : null,
      };
    }

    if (innerType === 'function_call_output') {
      return {
        ...base,
        role: 'tool',
        source: 'tool_result' satisfies ChatEventSource,
        content: typeof p.output === 'string' ? p.output : null,
        externalToolCallId: typeof p.call_id === 'string' ? p.call_id : null,
      };
    }

    return null;
  }

  if (line.type === 'event_msg') {
    if (innerType === 'task_complete') {
      return {
        ...base,
        role: 'system',
        source: 'result' satisfies ChatEventSource,
        content: typeof p.last_agent_message === 'string' ? p.last_agent_message : null,
      };
    }
    // All other event_msg variants are either telemetry, turn-boundary
    // markers, or duplicates of response_item content. Drop.
    return null;
  }

  return null;
}

/**
 * Identity for a replayed row: Codex's item id (`msg_…`, `rs_…`, `call_…`) or,
 * for `task_complete`, the turn id, qualified by payload type because a call
 * and its output share one `call_id`. Offset-free, so it survives Codex
 * rewriting the file. Lines without one fall back to agentex's offset-based
 * line id, and to a fresh uuid only when parsed without file context.
 */
function replayEventId(line: CodexTranscriptLine): string {
  const p = line.payload;
  const naturalId = lineItemId(line)
    ?? (line.type === 'event_msg' && p ? stringField(p, 'turn_id') : null);
  if (p && naturalId) return `codex-item:${String(p.type)}:${naturalId}`;
  return line.eventId ?? uuidv7();
}

// ─── Live-stream coverage ─────────────────────────────────────

/**
 * What the live stream has already written for a Codex session, read back
 * from `chat_events` (`listChatEventIdentities`).
 */
export interface CodexLiveCoverage {
  /**
   * Turns the live stream persisted at least one row for. Only the live
   * adapter sets `externalTurnId` (replayed rows leave it null on purpose),
   * so presence here means "the live stream saw this turn".
   */
  turnIds: ReadonlySet<string>;
  /** Provider item ids already stored: `msg_…`, `rs_…`, `call_…`, `exec-…`. */
  itemIds: ReadonlySet<string>;
}

export function codexLiveCoverage(
  rows: Iterable<Pick<ChatEventRecord, 'externalTurnId' | 'externalMessageId' | 'externalToolCallId'>>,
): CodexLiveCoverage {
  const turnIds = new Set<string>();
  const itemIds = new Set<string>();
  for (const row of rows) {
    if (row.externalTurnId) turnIds.add(row.externalTurnId);
    for (const id of [row.externalMessageId, row.externalToolCallId]) {
      if (id && isUniqueItemId(id)) itemIds.add(id);
    }
  }
  return { turnIds, itemIds };
}

/**
 * Build a predicate that says whether a rollout line holds anything the
 * live stream hasn't already written. A line is dropped when:
 *
 *   - its turn is in `coverage.turnIds`. The live stream owns every turn it
 *     saw, including the parts it represents differently (one clean
 *     `command_execution` where disk has `exec_command` + N `write_stdin`),
 *     which no per-item match could pair up. If the server died mid-turn,
 *     the unseen tail stays unreplayed; the health check's orphan
 *     redispatch is what recovers an unanswered turn.
 *   - its provider item id is already stored. A backstop for lines whose
 *     turn isn't known yet, e.g. a cursor that starts mid-turn.
 *
 * Stateful: only some lines carry a turn id (`task_started`, `turn_context`,
 * `item_completed`, and newer `response_item`s), so it remembers the last one
 * it saw. Feed it every line in file order, including ones the mapper drops.
 */
export function createCodexReplayFilter(
  coverage: CodexLiveCoverage,
): (line: CodexTranscriptLine) => boolean {
  let turnId: string | null = null;
  return (line) => {
    turnId = lineTurnId(line) ?? turnId;
    if (turnId && coverage.turnIds.has(turnId)) return false;
    const itemId = lineItemId(line);
    return !(itemId && coverage.itemIds.has(itemId));
  };
}

function lineTurnId(line: CodexTranscriptLine): string | null {
  const p = line.payload;
  if (!p) return null;
  const direct = stringField(p, 'turn_id');
  if (direct) return direct;
  const meta = p.internal_chat_message_metadata_passthrough;
  return meta && typeof meta === 'object'
    ? stringField(meta as Record<string, unknown>, 'turn_id')
    : null;
}

/** The id the live stream stores for the same item, when there is one. */
function lineItemId(line: CodexTranscriptLine): string | null {
  const p = line.payload;
  if (line.type !== 'response_item' || !p) return null;
  const id = p.type === 'message' || p.type === 'reasoning'
    ? stringField(p, 'id')
    : stringField(p, 'call_id');
  return id && isUniqueItemId(id) ? id : null;
}

/**
 * Legacy Codex numbered items `item_N` per turn, so the same id recurs
 * across turns and can't identify anything on its own.
 */
function isUniqueItemId(id: string): boolean {
  return !/^item_\d+$/.test(id);
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

// ─── Payload helpers ──────────────────────────────────────────

/**
 * `response_item/message` content is an array of typed parts. For
 * assistant messages we only see `output_text` in practice; concat
 * them with a blank-line separator for resilience.
 */
function extractMessageText(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const entry of content) {
    if (typeof entry !== 'object' || entry === null) continue;
    const block = entry as { type?: string; text?: unknown };
    if (typeof block.text === 'string' && block.text.length > 0) {
      parts.push(block.text);
    }
  }
  return parts.length > 0 ? parts.join('\n\n') : null;
}

/**
 * `response_item/reasoning.summary` is an array of `{type:
 * "summary_text", text: "..."}` blocks. The raw `content` field is
 * usually null and `encrypted_content` is opaque; the summary is the
 * only readable representation.
 */
function extractReasoningSummary(summary: unknown): string | null {
  if (!Array.isArray(summary)) return null;
  const parts: string[] = [];
  for (const entry of summary) {
    if (typeof entry !== 'object' || entry === null) continue;
    const block = entry as { type?: string; text?: unknown };
    if (typeof block.text === 'string' && block.text.length > 0) {
      parts.push(block.text);
    }
  }
  return parts.length > 0 ? parts.join('\n\n') : null;
}

/**
 * `response_item/function_call.arguments` is a JSON-encoded string
 * (matches the OpenAI function-call wire format). Tolerate malformed
 * inputs — the row is still useful as a marker even if we can't parse
 * the args, and the raw text lives in `raw.arguments` if a downstream
 * consumer needs it.
 */
function parseToolArguments(args: unknown): Record<string, unknown> | null {
  if (typeof args !== 'string' || args.length === 0) return null;
  try {
    const parsed = JSON.parse(args);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
