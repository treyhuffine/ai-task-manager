/**
 * Pure helpers for `[[file:<name>]]`, a file in the home's attachments folder
 * named inline, the marker chat messages already use. Dependency-free so the
 * editor node, the transcript and the attachments manifest share one grammar.
 *
 * The name is a bare file name (`<uuid>.png`, `ballcoach-toolbar-full.png`),
 * never a path, the same shape `GET /api/attachments/:fileName` serves.
 */

/** Matches a `[[file:name]]` marker at the START of the string. */
export const FILE_LINK_RE = /^\[\[file:([A-Za-z0-9_-]+\.[A-Za-z0-9]+)\]\]/;

/** Every `[[file:name]]` marker anywhere in a string. */
export const FILE_LINK_GLOBAL_RE = /\[\[file:([A-Za-z0-9_-]+\.[A-Za-z0-9]+)\]\]/g;

/** The canonical serialized form. */
export function renderFileLinkMarkdown(fileName: string): string {
  return `[[file:${fileName}]]`;
}
