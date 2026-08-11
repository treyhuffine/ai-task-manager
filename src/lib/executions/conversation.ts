import type { ChatEventRecord } from '@/db/types';

/**
 * Synthetic assistant text Claude Code injects to keep its own
 * conversation history API-valid when a turn produced no real output —
 * e.g. a silently-handled rate-limit/model fallback, or a recovered
 * interrupted turn. agentex forwards it on the stream, so it lands here
 * as an `agent` row with this exact content.
 *
 * The Claude Code TUI never paints it: its `AssistantTextMessage`
 * renderer does `case NO_RESPONSE_REQUESTED: return null`. We match that
 * behavior — the row stays in `chat_events` (raw kept for debugging,
 * same as `result`/`init`), it's just filtered out of the transcript.
 * Wrapper apps that don't replicate this filter are exactly why the
 * string leaks into their UI.
 *
 * Mirrors `NO_RESPONSE_REQUESTED` in Claude Code's `utils/messages.ts`.
 */
export const NO_RESPONSE_REQUESTED = 'No response requested.';

/**
 * Plain-text rendering of an event's content for compact surfaces
 * (hover preview, list subtitles). Strips Tiptap-style `[[file:...]]`
 * markers — the full transcript expands those into chips, everywhere
 * else they're noise — and trims trailing space left behind.
 */
export function conversationText(event: Pick<ChatEventRecord, 'content'>): string {
  const raw = event.content ?? '';
  return raw
    .replace(/\[\[file:[^\]]+\]\]/g, '')
    .replace(/\s+\n/g, '\n')
    .trim();
}

/**
 * Reduce a raw event stream to the human-readable conversation: what the
 * user asked, and what the agent answered.
 *
 * Two levels of filtering, both deliberate:
 *
 *   1. Non-conversational sources are dropped outright — `thinking`,
 *      `tool_call`, `tool_result`, `system`, `result`, and friends. The
 *      preview answers "what did we talk about", not "what did the agent
 *      do under the hood".
 *   2. Within a turn (a contiguous run of non-user events), only the
 *      *final* agent message survives. Agents narrate as they work
 *      ("Let me check the schema...", "Found it, now updating..."), and
 *      those mid-turn asides bury the actual reply. This matches the
 *      condensed transcript, which keeps a turn's final reply visible
 *      and folds everything before it into the activity group.
 *
 * Empty agent messages (content-free rows, or nothing left after
 * stripping file markers) are skipped so a trailing blank doesn't
 * shadow the real reply. User events are always kept, even when their
 * only content was an attachment — they anchor the exchange.
 *
 * Output is chronological (oldest first), tail-sliced to `limit`.
 */
export function pickConversationMessages(
  events: ChatEventRecord[],
  limit: number,
): ChatEventRecord[] {
  const messages: ChatEventRecord[] = [];
  let turnFinalAgent: ChatEventRecord | null = null;

  const flushTurn = () => {
    if (turnFinalAgent) messages.push(turnFinalAgent);
    turnFinalAgent = null;
  };

  for (const e of events) {
    if (e.source === 'user') {
      flushTurn();
      messages.push(e);
      continue;
    }
    if (e.source !== 'agent') continue;
    if (e.content === NO_RESPONSE_REQUESTED) continue;
    if (!conversationText(e)) continue;
    // Later agent text in the same turn replaces the earlier narration.
    turnFinalAgent = e;
  }
  flushTurn();

  // Index math rather than `slice(-limit)` so a limit of 0 returns
  // nothing instead of everything (`-0` slices from the start).
  return messages.slice(Math.max(0, messages.length - Math.max(0, limit)));
}
