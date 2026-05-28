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
 * Idempotency note: Codex's `CodexTranscriptLine` carries no stable wire
 * id (the line has `payload.call_id` for tool calls, but nothing
 * comparable for messages or reasoning). We mint a uuidv7 per row, which
 * means replay-vs-live cannot dedup at the DB level for Codex. The
 * reconcile path compensates by skipping when the executor's `isRunning`
 * flag is set — the live stream is the source of truth during an active
 * turn; reconcile only catches up *after* the turn ends or the server
 * restarts.
 */

import { uuidv7 } from 'uuidv7';
import type { CodexTranscriptLine } from '@agentex/agent';
import type { CreateChatEventInput, ChatEventSource } from '@/db/types';

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
  const base = {
    sessionId: chatSessionId,
    externalEventId: uuidv7(),
    raw: line.raw,
    createdAt,
  };

  if (line.type === 'response_item') {
    if (innerType === 'message') {
      if (p.role !== 'assistant') return null;
      return {
        ...base,
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
