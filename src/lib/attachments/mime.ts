/**
 * MIME utilities for the attachments system.
 *
 * Two concerns:
 *   1. Normalizing incoming Blob/File mime types into a canonical form
 *      (trimmed, lowercased, no parameters like `; charset=utf-8`).
 *   2. Deriving a stable filesystem extension from a mime type or filename so
 *      that stored files are introspectable by `file`, `open`, and mime-aware
 *      tools without a DB lookup.
 *
 * Kept separate from `save.ts` so the rules can be unit-tested without pulling
 * in the filesystem.
 */

/** Normalized MIME strings we'll accept for upload. Extend deliberately. */
export const ALLOWED_MIMES: ReadonlySet<string> = new Set([
  // Images
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/avif',
  'image/heic',
  'image/heif',
  // Audio (captures + user uploads)
  'audio/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/x-wav',
  'audio/flac',
  'audio/aac',
  // Documents
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
]);

/** Preferred file extension for a given canonical mime type. */
const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
  'audio/aac': 'aac',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
};

/** Extension → canonical mime. Used when a filename has an extension but the
 *  browser supplied an unhelpful mime (`application/octet-stream`). */
const EXT_TO_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_TO_EXT).map(([mime, ext]) => [ext, mime]),
);

const FALLBACK_EXT = 'bin';

/** Strip parameters, lowercase, trim. Returns empty string for empties. */
export function normalizeMime(raw: string | null | undefined): string {
  if (!raw) return '';
  const head = raw.split(';')[0]?.trim().toLowerCase() ?? '';
  return head;
}

/** Lowercase extension from a filename (no leading dot). */
export function extFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const dot = name.lastIndexOf('.');
  if (dot < 1 || dot === name.length - 1) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  // Reject anything that doesn't look like an extension (e.g. spaces, slashes).
  if (!/^[a-z0-9]+$/.test(ext)) return null;
  return ext;
}

/** Best-effort extension derivation, preferring mime over filename. */
export function extForFile(mime: string, originalName: string): string {
  const byMime = MIME_TO_EXT[mime];
  if (byMime) return byMime;
  const byName = extFromName(originalName);
  if (byName) return byName;
  return FALLBACK_EXT;
}

/** Resolve a usable mime for storage: normalize, fall back to the extension. */
export function resolveMime(rawMime: string | null | undefined, name: string): string {
  const normalized = normalizeMime(rawMime);
  if (normalized && normalized !== 'application/octet-stream') return normalized;
  const ext = extFromName(name);
  if (ext && EXT_TO_MIME[ext]) return EXT_TO_MIME[ext];
  return normalized || 'application/octet-stream';
}

export function isAllowedMime(mime: string): boolean {
  return ALLOWED_MIMES.has(mime);
}
