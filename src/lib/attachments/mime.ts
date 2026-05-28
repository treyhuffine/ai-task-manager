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

/**
 * Text-like extensions that browsers often misreport as
 * `application/octet-stream`. We treat them all as `text/plain` for
 * upload purposes — Claude reads them fine; the original extension is
 * preserved on disk and in `originalName` so the user can still tell
 * a `.ts` from a `.json` after upload.
 */
const TEXT_LIKE_EXTS: ReadonlySet<string> = new Set([
  // Plain
  'txt', 'md', 'markdown', 'mdx', 'csv', 'tsv', 'log', 'env',
  // JS / TS family
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts',
  // Python / Ruby / Go / Rust / Java family
  'py', 'pyi', 'rb', 'go', 'rs', 'java', 'kt', 'scala', 'groovy',
  // C family
  'c', 'cc', 'cpp', 'cxx', 'h', 'hh', 'hpp', 'hxx', 'cs',
  // Other languages
  'php', 'pl', 'pm', 'lua', 'r', 'jl', 'swift', 'dart', 'ex', 'exs', 'elm',
  // Shell
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
  // Web
  'html', 'htm', 'css', 'scss', 'sass', 'less', 'styl', 'vue', 'svelte', 'astro',
  // Data / config
  'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'xml', 'ini', 'conf', 'cfg', 'properties',
  // Database
  'sql', 'graphql', 'gql',
  // Build / project
  'gitignore', 'gitattributes', 'editorconfig', 'prettierrc', 'eslintrc',
  'dockerfile', 'dockerignore', 'makefile', 'cmake',
  // Patches
  'patch', 'diff',
]);

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
  'image/x-icon',
  'image/vnd.microsoft.icon',
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
  // Office (text extraction via mammoth/xlsx/officeparser server-side)
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',       // .xlsx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/msword',                  // legacy .doc — may extract or fall through
  'application/vnd.ms-excel',            // legacy .xls — same caveat
  'application/vnd.ms-powerpoint',       // legacy .ppt — same caveat
  'application/vnd.oasis.opendocument.text',         // .odt
  'application/vnd.oasis.opendocument.presentation', // .odp
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
  'image/vnd.microsoft.icon': 'ico',
  'image/x-icon': 'ico',
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
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/msword': 'doc',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.presentation': 'odp',
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

/**
 * Best-effort extension derivation, preferring mime over filename.
 *
 * For text-like content (`text/plain` or any text/*), we prefer the
 * original extension when it's a recognized code/data type — so a
 * `.ts` upload writes to disk as `<uuid>.ts` rather than `<uuid>.txt`.
 * Keeps `cat`, `file`, IDE association, and download dialog filenames
 * accurate to user intent.
 */
export function extForFile(mime: string, originalName: string): string {
  const byName = extFromName(originalName);
  // Text/plain (and any text/*) — preserve original ext when it's a
  // known code/data extension. Otherwise fall through to mime mapping.
  if (mime === 'text/plain' || mime.startsWith('text/')) {
    if (byName && TEXT_LIKE_EXTS.has(byName)) return byName;
  }
  const byMime = MIME_TO_EXT[mime];
  if (byMime) return byMime;
  if (byName) return byName;
  return FALLBACK_EXT;
}

/**
 * Resolve a usable mime for storage: normalize, fall back to the extension.
 *
 * For unrecognized mimes, an extension in `TEXT_LIKE_EXTS` maps to
 * `text/plain` so common code/data files (`.ts`, `.json`, `.yaml`,
 * etc.) flow through the upload allowlist — Claude reads them fine
 * regardless of the technical mime type.
 */
export function resolveMime(rawMime: string | null | undefined, name: string): string {
  const normalized = normalizeMime(rawMime);
  if (normalized && normalized !== 'application/octet-stream') return normalized;
  const ext = extFromName(name);
  if (ext) {
    if (EXT_TO_MIME[ext]) return EXT_TO_MIME[ext];
    if (TEXT_LIKE_EXTS.has(ext)) return 'text/plain';
  }
  return normalized || 'application/octet-stream';
}

export function isAllowedMime(mime: string): boolean {
  return ALLOWED_MIMES.has(mime);
}
