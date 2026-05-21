/**
 * Inline references in chat messages use the same `[[<kind>:<id>]]`
 * convention as file attachments. One regex, four kinds — sibling
 * to `src/components/chat/editor/parse-file-markers.ts`, but covering
 * the entity-level references too:
 *
 *   - `[[file:<file_name>]]`        — attachment chip (existing).
 *   - `[[task:<task_id>]]`           — task reference.
 *   - `[[note:<note_id>]]`           — note reference.
 *   - `[[scratchpad]]`               — the owning session's scratchpad.
 *
 * The parser is pure: no DB access, no React. The composer uses it to
 * tokenize on send, the transcript uses it to swap chips in for raw
 * markers on render, and the server uses it to materialize `chat_refs`
 * rows and hydrate referenced bodies into the agent prompt.
 */
export type EntityMarker =
  | { kind: 'file'; file_name: string }
  | { kind: 'task'; id: string }
  | { kind: 'note'; id: string }
  | { kind: 'scratchpad' };

export type EntitySegment =
  | { kind: 'text'; text: string }
  | { kind: 'marker'; marker: EntityMarker; raw: string };

/** Strict id charset matches what UUIDv7 + file_name conventions emit. */
const MARKER_RE = /\[\[(file|task|note|scratchpad)(?::([A-Za-z0-9_.-]+))?\]\]/g;

/**
 * Split a chat message into text + marker segments in document order.
 * Unknown / malformed markers fall through as text so the user always
 * sees something rather than a chip that silently disappears.
 */
export function parseEntitySegments(text: string): EntitySegment[] {
  if (!text) return [];
  const segments: EntitySegment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(MARKER_RE)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      segments.push({ kind: 'text', text: text.slice(lastIndex, start) });
    }
    const kind = match[1] as 'file' | 'task' | 'note' | 'scratchpad';
    const id = match[2];
    let marker: EntityMarker | null = null;
    if (kind === 'scratchpad') {
      marker = { kind: 'scratchpad' };
    } else if (kind === 'file' && id) {
      marker = { kind: 'file', file_name: id };
    } else if ((kind === 'task' || kind === 'note') && id) {
      marker = { kind, id };
    }
    if (marker) {
      segments.push({ kind: 'marker', marker, raw: match[0] });
    } else {
      segments.push({ kind: 'text', text: match[0] });
    }
    lastIndex = start + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ kind: 'text', text: text.slice(lastIndex) });
  }
  return segments;
}

/** Flat list of every marker in document order. Skips malformed ones. */
export function listEntityMarkers(text: string): EntityMarker[] {
  const out: EntityMarker[] = [];
  for (const seg of parseEntitySegments(text)) {
    if (seg.kind === 'marker') out.push(seg.marker);
  }
  return out;
}

/** Just the task / note / scratchpad markers — files use a separate path. */
export function listNonFileMarkers(
  text: string,
): Array<Exclude<EntityMarker, { kind: 'file' }>> {
  const out: Array<Exclude<EntityMarker, { kind: 'file' }>> = [];
  for (const m of listEntityMarkers(text)) {
    if (m.kind !== 'file') out.push(m);
  }
  return out;
}
