/**
 * Split a chat-message string into a sequence of plain-text and
 * file-chip segments. The transcript renderer maps these to either
 * raw text spans or `<MessageFileChip>` components.
 *
 * Marker format is `[[file:<fileName>]]` — chosen so it's vanishingly
 * unlikely to appear in real user text. `fileName` is the
 * `<uuidv7>.<ext>` form used everywhere in the attachment system, so
 * the regex character class includes dots.
 *
 * If a marker references a fileName that's not in the attachments
 * map, the segment falls through as plain text (the literal marker)
 * so the user sees something rather than the chip silently
 * disappearing.
 */

import type { Attachment } from '@/db/types';

export type FileSegment =
  | { kind: 'text'; text: string }
  | { kind: 'chip'; attachment: Attachment };

const MARKER_RE = /\[\[file:([A-Za-z0-9_.-]+)\]\]/g;

export function parseFileMarkers(
  text: string,
  attachments: ReadonlyArray<Attachment> = [],
): FileSegment[] {
  if (!text) return [];
  const map = new Map(attachments.map((a) => [a.fileName, a]));
  const segments: FileSegment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(MARKER_RE)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      segments.push({ kind: 'text', text: text.slice(lastIndex, start) });
    }
    const fileName = match[1]!;
    const att = map.get(fileName);
    if (att) {
      segments.push({ kind: 'chip', attachment: att });
    } else {
      // Unmatched marker — render the literal so the user can see
      // something went sideways without crashing the message.
      segments.push({ kind: 'text', text: match[0] });
    }
    lastIndex = start + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ kind: 'text', text: text.slice(lastIndex) });
  }
  return segments;
}
