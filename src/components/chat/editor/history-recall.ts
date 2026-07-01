/**
 * Shell-style "scroll up through sent messages" for the chat composer,
 * factored out of `chat-input-editor.tsx` so the state machine — which
 * index a given Up/Down keypress lands on, and when to fall through to
 * normal caret motion — is unit-testable without a live Tiptap editor.
 *
 * The editor owns the caret geometry (only recall when the cursor is on
 * the first/last visual line) and the content swap; this module owns the
 * pure decisions:
 *
 *   - `buildRecallHistory` turns a session's chat events into the recall
 *     ring (the user's own sent messages, oldest → newest, cleaned).
 *   - `recallStep` advances the ring index for one keypress.
 *   - `textToDocJSON` renders a recalled string back into a ProseMirror
 *     doc so multi-line messages come back with their line breaks intact.
 */

import { parseEntitySegments } from '@/lib/entity-refs/parse-markers';

/**
 * Cap on how many recent sent messages the ring holds. The transcript
 * itself is paged at 1000 events; user messages are a subset of that, and
 * nobody arrow-keys back through hundreds of entries — this just bounds
 * the array we rebuild on every send.
 */
export const HISTORY_RECALL_LIMIT = 200;

/**
 * Turn a stored user-message `content` back into the plain, editable text
 * the user originally typed. Sent messages carry `[[file:…]]`,
 * `[[task:…]]`, `[[note:…]]`, and `[[scratchpad]]` markers where chips
 * were; chips can't be rehydrated on recall, so their markers are dropped
 * and the surrounding prose is preserved verbatim (only the outer
 * whitespace a dropped marker leaves behind is trimmed).
 */
export function cleanRecalledText(content: string): string {
  if (!content) return '';
  const text = parseEntitySegments(content)
    .filter((seg) => seg.kind === 'text')
    .map((seg) => (seg.kind === 'text' ? seg.text : ''))
    .join('');
  return text.trim();
}

/** Minimal event shape the ring builder reads — a slice of `ChatEventRecord`. */
export interface RecallHistoryEvent {
  role: string;
  source: string;
  content: string | null;
}

/**
 * Build the Up-arrow recall ring from a session's chat events: the user's
 * own sent messages (`role === 'user' && source === 'user'`), oldest →
 * newest, marker-stripped, empties removed, consecutive duplicates
 * collapsed (a shell's `ignoredups`), and capped to the most recent N.
 *
 * Assumes `events` is already in transcript order (created ASC) — the
 * canonical ordering the events cache is kept in.
 */
export function buildRecallHistory(
  events: readonly RecallHistoryEvent[],
  limit: number = HISTORY_RECALL_LIMIT,
): string[] {
  const out: string[] = [];
  for (const e of events) {
    if (e.role !== 'user' || e.source !== 'user') continue;
    const text = cleanRecalledText(e.content ?? '');
    if (!text) continue;
    if (out.length > 0 && out[out.length - 1] === text) continue;
    out.push(text);
  }
  return out.length > limit ? out.slice(out.length - limit) : out;
}

export type RecallDirection = 'prev' | 'next';

export interface RecallStep {
  /**
   * Ring index to display next, or `null` to leave history and restore
   * the draft that was stashed when navigation began.
   */
  nextIndex: number | null;
  /**
   * Capture the live editor contents as the pre-navigation stash before
   * loading `nextIndex`. Only true on the very first step into history so
   * the user's in-progress draft can be handed back on the way down.
   */
  captureStash: boolean;
}

/**
 * Pure transition for one recall keypress, given the current ring index
 * (`null` = not navigating, showing the live draft), the ring length, and
 * the direction.
 *
 * Returns `null` when the keypress should fall through to the editor's
 * default caret motion:
 *   - `prev` with an empty ring (nothing to recall).
 *   - `prev` already at the oldest entry — resting the caret on the first
 *     line, rather than reloading the message and snapping it to the end.
 *   - `next` while not navigating (a normal down-arrow at the last line).
 *
 * Semantics mirror a terminal:
 *   - First `prev` stashes the draft and jumps to the newest entry.
 *   - Further `prev` walks toward the oldest, then stops: at the oldest it
 *     returns `null` so ↑ becomes an inert caret move (stay on line one).
 *   - `next` walks back toward the newest, then one more `next` drops out
 *     of history and restores the stashed draft.
 */
export function recallStep(
  currentIndex: number | null,
  historyLength: number,
  direction: RecallDirection,
): RecallStep | null {
  if (direction === 'prev') {
    if (historyLength === 0) return null;
    if (currentIndex === null) {
      return { nextIndex: historyLength - 1, captureStash: true };
    }
    // Already at the oldest entry: don't reload it (that would re-focus to
    // the end and bounce the caret off the top line). Fall through to a
    // normal ↑, which simply rests on the first line.
    if (currentIndex <= 0) return null;
    return { nextIndex: currentIndex - 1, captureStash: false };
  }
  // direction === 'next'
  if (currentIndex === null) return null;
  if (currentIndex >= historyLength - 1) {
    return { nextIndex: null, captureStash: false };
  }
  return { nextIndex: currentIndex + 1, captureStash: false };
}

type DocInlineNode = { type: 'text'; text: string } | { type: 'hardBreak' };

export interface RecalledDocJSON {
  type: 'doc';
  content: Array<{ type: 'paragraph'; content?: DocInlineNode[] }>;
}

/**
 * Render a recalled string into a ProseMirror doc: a single paragraph
 * with `\n` runs rebuilt as `hardBreak` nodes, matching how the composer
 * serializes newlines on send. Passed to Tiptap's `setContent` so a
 * multi-line message comes back exactly as it was typed.
 */
export function textToDocJSON(text: string): RecalledDocJSON {
  const inline: DocInlineNode[] = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (i > 0) inline.push({ type: 'hardBreak' });
    if (line.length > 0) inline.push({ type: 'text', text: line });
  });
  return {
    type: 'doc',
    content: [inline.length > 0 ? { type: 'paragraph', content: inline } : { type: 'paragraph' }],
  };
}
