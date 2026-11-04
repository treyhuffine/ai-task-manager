/**
 * Inline references in chat messages use the same `[[<kind>:<id>]]`
 * convention as file attachments. One regex, five kinds — sibling
 * to `src/components/chat/editor/parse-file-markers.ts`, but covering
 * the entity-level references too:
 *
 *   - `[[file:<fileName>]]`        — attachment chip (existing).
 *   - `[[task:<taskId>]]`           — task reference.
 *   - `[[note:<note_id>]]`           — note reference.
 *   - `[[scratchpad]]`               — the owning session's scratchpad.
 *   - `[[agent:<workspaceId>]]`      — an agent (a workspace), by its id.
 *     Same id as its coordination address `agent:<workspace id>`.
 *   - `[[task:<homeId>/<id>]]`       — a record in another Home, such as a
 *     connected team (also `note` and `area`). See docs/team-links.md.
 *
 * Without a Home, a marker means a record in the Home that owns the text.
 *
 * The parser is pure: no DB access, no React. The composer uses it to
 * tokenize on send, the transcript uses it to swap chips in for raw
 * markers on render, and the server uses it to materialize `chat_refs`
 * rows and hydrate referenced bodies into the agent prompt.
 */
export type RemoteRecordKind = 'task' | 'note' | 'area';

export type RemoteMarker = { kind: 'remote'; recordKind: RemoteRecordKind; homeId: string; id: string };

export type EntityMarker =
  | { kind: 'file'; fileName: string }
  | { kind: 'task'; id: string }
  | { kind: 'note'; id: string }
  | { kind: 'agent'; id: string }
  | { kind: 'scratchpad' }
  | RemoteMarker;

export type EntitySegment =
  | { kind: 'text'; text: string }
  | { kind: 'marker'; marker: EntityMarker; raw: string };

/**
 * Strict id charset matches what UUIDv7 + fileName conventions emit. The `/`
 * in a remote marker is outside it on purpose: a build that doesn't know the
 * form shows plain text instead of looking up the wrong record.
 */
const MARKER_RE = /\[\[(?:(task|note|area):([A-Za-z0-9_-]+)\/([A-Za-z0-9_.-]+)|(file|task|note|agent|scratchpad)(?::([A-Za-z0-9_.-]+))?)\]\]/g;

/** What an agent or person writes to link a record in another Home. */
export function remoteMarkerText(recordKind: RemoteRecordKind, homeId: string, id: string): string {
  return `[[${recordKind}:${homeId}/${id}]]`;
}

/** How the link index names a record in another Home. */
export function remoteLinkTarget(homeId: string, id: string): string {
  return `${homeId}/${id}`;
}

/** The two halves of a remote marker's `<homeId>/<id>`, or null for any other id. */
export function splitRemoteId(value: string): { homeId: string; id: string } | null {
  const match = /^([A-Za-z0-9_-]+)\/([A-Za-z0-9_.-]+)$/.exec(value);
  return match ? { homeId: match[1], id: match[2] } : null;
}

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
    const kind = match[4] as 'file' | 'task' | 'note' | 'agent' | 'scratchpad';
    const id = match[5];
    let marker: EntityMarker | null = null;
    if (match[1]) {
      marker = { kind: 'remote', recordKind: match[1] as RemoteRecordKind, homeId: match[2], id: match[3] };
    } else if (kind === 'scratchpad') {
      marker = { kind: 'scratchpad' };
    } else if (kind === 'file' && id) {
      marker = { kind: 'file', fileName: id };
    } else if ((kind === 'task' || kind === 'note' || kind === 'agent') && id) {
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

/** Just the task / note / agent / scratchpad markers — files use a separate path. */
export function listNonFileMarkers(
  text: string,
): Array<Exclude<EntityMarker, { kind: 'file' }>> {
  const out: Array<Exclude<EntityMarker, { kind: 'file' }>> = [];
  for (const m of listEntityMarkers(text)) {
    if (m.kind !== 'file') out.push(m);
  }
  return out;
}

/**
 * Whether a message references a task or note (not a file or the
 * scratchpad): the references the transcript's chips look up by id, so a
 * new one means the lookup needs a refresh.
 */
export function referencesEntity(text: string | null | undefined): boolean {
  return !!text && /\[\[(?:task|note):[A-Za-z0-9_.-]+\]\]/.test(text);
}
