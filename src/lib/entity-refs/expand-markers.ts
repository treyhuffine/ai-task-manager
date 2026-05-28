/**
 * Server-side hydration of `[[task:id]]` / `[[note:id]]` / `[[scratchpad]]`
 * markers. Counterpart to `src/lib/attachments/expand-markers.ts` for the
 * file path — same idea, just resolved against rows in the DB instead of
 * bytes on disk.
 *
 * Each marker is replaced inline with the entity's title + body wrapped
 * in `<task>` / `<note>` / `<scratchpad>` XML-ish tags. Format chosen
 * to match the `<attachment>` tag the file extractor already emits, so
 * the agent sees a single consistent shape regardless of reference kind.
 *
 * Unknown ids fall through as the literal marker — same approach as
 * file markers, so the agent / user can see something went sideways
 * rather than the reference silently disappearing.
 */
import { getTask, getNote, getChatSession } from '@/lib/db/queries';

const MARKER_RE = /\[\[(task|note|scratchpad)(?::([A-Za-z0-9_.-]+))?\]\]/g;

/** Truncate the body inlined into a turn so a 50k-char note doesn't blow context. */
const ENTITY_BODY_CHAR_CAP = 20_000;

function trim(s: string | null | undefined, cap = ENTITY_BODY_CHAR_CAP): string {
  if (!s) return '';
  if (s.length <= cap) return s;
  return s.slice(0, cap) + `\n\n[…truncated at ${cap} chars]`;
}

function escapeXmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function renderTaskMarker(id: string): string | null {
  const t = getTask(id);
  if (!t) return null;
  const status = t.status ?? 'active';
  const titleAttr = escapeXmlAttr(t.title ?? '');
  const bodySource = [t.description, t.body].filter(Boolean).join('\n\n');
  const body = trim(bodySource);
  // Skip the body block entirely when empty so short tasks stay compact.
  return body
    ? `<task id="${id}" title="${titleAttr}" status="${status}">\n${body}\n</task>`
    : `<task id="${id}" title="${titleAttr}" status="${status}" />`;
}

function renderNoteMarker(id: string): string | null {
  const n = getNote(id);
  if (!n) return null;
  const titleAttr = escapeXmlAttr(n.title ?? '');
  const body = trim(n.body);
  return body
    ? `<note id="${id}" title="${titleAttr}">\n${body}\n</note>`
    : `<note id="${id}" title="${titleAttr}" />`;
}

function renderScratchpadMarker(sessionId: string): string | null {
  const s = getChatSession(sessionId);
  if (!s) return null;
  const body = trim(s.scratchPad);
  return body
    ? `<scratchpad>\n${body}\n</scratchpad>`
    : `<scratchpad status="empty" />`;
}

/**
 * Resolve every task/note/scratchpad marker in `content` into its
 * inlined body form. `sessionId` is required because `[[scratchpad]]`
 * resolves against the owning session's pad. File markers are handled
 * by the sibling module — this one passes them through untouched.
 */
export function expandEntityMarkers(content: string, sessionId: string): string {
  if (!content) return content;
  return content.replace(MARKER_RE, (raw, kind: string, id?: string) => {
    if (kind === 'scratchpad') {
      return renderScratchpadMarker(sessionId) ?? raw;
    }
    if (!id) return raw;
    if (kind === 'task') return renderTaskMarker(id) ?? raw;
    if (kind === 'note') return renderNoteMarker(id) ?? raw;
    return raw;
  });
}
