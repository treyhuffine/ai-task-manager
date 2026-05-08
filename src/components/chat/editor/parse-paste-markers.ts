/**
 * Split a chat-message string into a sequence of plain-text and
 * paste-chip segments. The transcript renderer maps these to either
 * raw text spans or `<MessagePasteChip>` components.
 *
 * Marker format is `[[paste:<id>]]` — chosen so it's vanishingly
 * unlikely to appear in real user text. If a marker references an id
 * that's not in the attachments map, the segment falls through as
 * plain text (the literal marker) so the user sees something rather
 * than the chip silently disappearing.
 */

export type PasteSegment =
  | { kind: 'text'; text: string }
  | { kind: 'chip'; id: string; filename: string; content: string };

const MARKER_RE = /\[\[paste:([0-9a-zA-Z_-]+)\]\]/g;

export function parsePasteMarkers(
  text: string,
  attachments: ReadonlyArray<{ id: string; filename: string; content: string }> = [],
): PasteSegment[] {
  if (!text) return [];
  const map = new Map(attachments.map((a) => [a.id, a]));
  const segments: PasteSegment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(MARKER_RE)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      segments.push({ kind: 'text', text: text.slice(lastIndex, start) });
    }
    const id = match[1]!;
    const att = map.get(id);
    if (att) {
      segments.push({ kind: 'chip', id, filename: att.filename, content: att.content });
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
