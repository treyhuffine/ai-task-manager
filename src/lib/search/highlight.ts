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
 * Titles have no FTS snippet, so the words of the search (`searchTerms`) are
 * the one definition both sides use: the server matches a title that contains
 * every one (`containsAllTerms` is the same rule in JS), and the client marks
 * them with `highlightTerms`.
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

/** At most this many words of a search are matched against titles. */
export const MAX_SEARCH_TERMS = 8;

/**
 * The words of a search, as title matching and highlighting split it:
 * whitespace-separated, with double quotes dropped (the transcript search
 * strips them too). Apostrophes stay, since titles have them ("Maya's").
 */
export function searchTerms(query: string): string[] {
  return query.replace(/"/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, MAX_SEARCH_TERMS);
}

/** Whether `text` contains every term, ignoring case. A title matches by this rule. */
export function containsAllTerms(text: string, terms: readonly string[]): boolean {
  if (terms.length === 0) return false;
  const folded = text.toLowerCase();
  return terms.every((term) => folded.includes(term.toLowerCase()));
}

/**
 * Split `text` into segments with every occurrence of any term marked,
 * ignoring case, for rendering the way `splitHighlight` segments render.
 * Longer terms win where two would start at the same place.
 */
export function highlightTerms(text: string, terms: readonly string[]): HighlightSegment[] {
  if (terms.length === 0 || !text) return text ? [{ text, highlighted: false }] : [];
  const pattern = new RegExp(
    [...terms]
      .sort((a, b) => b.length - a.length)
      .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|'),
    'gi',
  );
  const segments: HighlightSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    if (start > last) segments.push({ text: text.slice(last, start), highlighted: false });
    segments.push({ text: match[0], highlighted: true });
    last = start + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), highlighted: false });
  return segments;
}
