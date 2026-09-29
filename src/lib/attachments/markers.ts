/**
 * `[[file:<fileName>]]` markers in a message, and where they point.
 *
 * A file the agent reads itself (text, code, images, PDF, JSON, XML) reaches
 * it as a path on the computer the agent runs on: the home's attachments
 * directory for a chat that runs at home, and the worker's own copy for one
 * on a connected computer (docs/homes-build.md, P2.5). Everything else is
 * extracted to text at home (`expand-markers.ts`).
 *
 * No database and no extractors here, so a connected computer's worker
 * places the files it fetched with the same rule the home uses.
 */

export const FILE_MARKER_RE = /\[\[file:([A-Za-z0-9_.-]+)\]\]/g;

/** A stored attachment's name: a bare `<uuid>.<ext>`, never a path. */
export const ATTACHMENT_FILE_NAME = /^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/;

/** Whether the agent opens this kind of file itself, given its path. */
export function readsNatively(mime: string): boolean {
  if (mime.startsWith('text/')) return true;
  if (mime.startsWith('image/')) return true;
  if (mime === 'application/pdf') return true;
  if (mime === 'application/json' || mime === 'application/xml') return true;
  return false;
}

/** The file names a message's markers name, each once. */
export function markedFileNames(text: string): Set<string> {
  return new Set([...text.matchAll(FILE_MARKER_RE)].map((m) => m[1]!));
}

/**
 * Replace each marker whose file `pathOf` knows with that path. A marker for
 * a file it doesn't know stays as written.
 */
export function placeFileMarkers(text: string, pathOf: (fileName: string) => string | null): string {
  return text.replace(FILE_MARKER_RE, (marker, fileName: string) => pathOf(fileName) ?? marker);
}
