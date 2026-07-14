/**
 * Shared, dependency-free highlight helpers for chat/session search snippets.
 *
 * `searchChatSessions` (server) asks SQLite's FTS5 `snippet()` to wrap matched
 * terms in these sentinels. They're ASCII control chars (STX/ETX) that never
 * occur in transcript text, so a renderer can split on them to emit <mark>
 * without colliding with real content (brackets/quotes/etc. all appear in
 * transcripts). The web client splits with `splitHighlight`; the agent surface
 * strips them with `stripHighlight` so tool output stays plain text.
 *
 * Kept out of `queries.ts` (server) and `api/sessions.ts` (client) so both
 * sides — and the orchestrator — share one definition without either dragging
 * in the other's deps.
 */

export const CHAT_SEARCH_HL_START = '\u0002';
export const CHAT_SEARCH_HL_END = '\u0003';

export interface HighlightSegment {
  text: string;
  highlighted: boolean;
}

/**
 * Split an FTS snippet into ordered segments on the highlight sentinels, for
 * rendering (highlighted segments become <mark>). Never drops text: an
 * unterminated start marker degrades its remainder to plain.
 */
export function splitHighlight(snippet: string): HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  let rest = snippet;
  while (rest.length > 0) {
    const start = rest.indexOf(CHAT_SEARCH_HL_START);
    if (start === -1) {
      segments.push({ text: rest, highlighted: false });
      break;
    }
    if (start > 0) segments.push({ text: rest.slice(0, start), highlighted: false });
    const end = rest.indexOf(CHAT_SEARCH_HL_END, start + 1);
    if (end === -1) {
      segments.push({ text: rest.slice(start + 1), highlighted: false });
      break;
    }
    const inner = rest.slice(start + 1, end);
    if (inner) segments.push({ text: inner, highlighted: true });
    rest = rest.slice(end + 1);
  }
  return segments;
}

/** Remove the highlight sentinels, yielding plain text (agent/CLI surface). */
export function stripHighlight(snippet: string): string {
  return snippet
    .split(CHAT_SEARCH_HL_START)
    .join('')
    .split(CHAT_SEARCH_HL_END)
    .join('');
}
