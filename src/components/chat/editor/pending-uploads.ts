/**
 * Pending-upload detection for the chat composer.
 *
 * A file chip starts life as a `pending` placeholder (spinner, no
 * `fileName` yet) and flips to a real attachment once the upload to
 * `POST /api/attachments` resolves. While any chip is still pending the
 * composer blocks Send — sending mid-upload would silently drop the
 * placeholder (`buildMarkerOutput` / `buildUiMessageParts` skip chips
 * with no `fileName`), so the user's file would just vanish from the
 * message. Attaching *more* files on top of an in-flight upload stays
 * allowed; only the send is gated.
 *
 * Kept as a pure function over the editor's `getJSON()` shape so it's
 * unit-testable in the node test environment without standing up a real
 * Tiptap/ProseMirror editor (which needs a DOM).
 */

/** Minimal shape of a ProseMirror / Tiptap JSON node (`editor.getJSON()`). */
export interface ProseMirrorJSONNode {
  type?: string;
  attrs?: Record<string, unknown> | null;
  content?: ProseMirrorJSONNode[] | null;
}

/**
 * True when the document contains at least one file chip that is still
 * uploading. Walks the whole tree (chips are inline atoms nested inside
 * paragraphs) and short-circuits on the first match.
 *
 * `chipType` defaults to the file-chip node name; callers pass
 * `FILE_CHIP_NAME` so the literal stays bound to the schema.
 */
export function hasPendingFileChip(
  node: ProseMirrorJSONNode | null | undefined,
  chipType = 'fileChip',
): boolean {
  if (!node) return false;
  if (node.type === chipType && node.attrs?.pending === true) return true;
  const content = node.content;
  if (!content) return false;
  for (const child of content) {
    if (hasPendingFileChip(child, chipType)) return true;
  }
  return false;
}
