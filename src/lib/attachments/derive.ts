/**
 * Body → attachments manifest derivation.
 *
 * The body of a note / task / stream item is authoritative: the user sees
 * and edits it. The `attachments[]` column is a materialized view of which
 * files the body references — kept so that:
 *
 *   - GC can enumerate referenced files with a SQL query, not a Tiptap walk
 *   - Exported frontmatter can list attachments without re-parsing the body
 *   - UI counts ("📎 3") render without mounting the editor
 *   - Richer metadata (original_name, mime_type, size, uploaded_at) can live
 *     alongside the pointer (the body only carries `src`)
 *
 * The derive step runs on every save. New file_names found in the body are
 * merged with `newUploads` (freshly-returned `Attachment` records from the
 * current edit session) so their metadata survives. References that are no
 * longer in the body are dropped. Files that remain in the body reuse their
 * prior Attachment row so metadata doesn't flip-flop.
 */

import type { Attachment } from '@/db/types';

/**
 * Only internal `/api/attachments/<file_name>` references are recognized.
 * External image URLs (screenshots pasted from a web page) are ignored — we
 * don't own those files and shouldn't pretend to manage them.
 *
 * The captured file_name is constrained to the on-disk shape: uuid-ish
 * segment, dot, extension. This prevents a path-traversal reference in the
 * body from showing up in the manifest.
 */
const ATTACHMENT_REF_RE = /\/api\/attachments\/([A-Za-z0-9_-]+\.[A-Za-z0-9]+)/g;

/**
 * Collect every file_name referenced by `/api/attachments/<file>` inside the
 * given body. Dedupes by file_name, first occurrence wins. Returns the
 * file_names in reading order.
 */
export function extractReferencedFileNames(body: string | null | undefined): string[] {
  if (!body) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of body.matchAll(ATTACHMENT_REF_RE)) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

export interface DeriveAttachmentsInput {
  /** The body string that will be saved. Accepts markdown or HTML. */
  body: string | null | undefined;
  /** The entity's existing `attachments[]` from the DB (pre-update). */
  prior: Attachment[] | null | undefined;
  /**
   * Newly uploaded files from this edit session, not yet reflected in prior.
   * Typically the client submits the `Attachment` records returned from
   * `POST /api/attachments` alongside the save payload.
   */
  newUploads?: Attachment[];
}

/**
 * Derive the authoritative `attachments[]` manifest for an entity from its
 * body. Invariants:
 *   - Output contains exactly one row per file_name referenced in the body.
 *   - Rows that existed in `prior` keep their full metadata.
 *   - Rows that were uploaded in the current session use the freshly-
 *     captured metadata.
 *   - Unreferenced prior rows are dropped (body is authoritative).
 *   - Output order matches body reading order for deterministic exports.
 */
export function deriveAttachments(input: DeriveAttachmentsInput): Attachment[] {
  const priorByName = new Map<string, Attachment>();
  for (const a of input.prior ?? []) priorByName.set(a.file_name, a);

  const uploadsByName = new Map<string, Attachment>();
  for (const a of input.newUploads ?? []) uploadsByName.set(a.file_name, a);

  const referenced = extractReferencedFileNames(input.body);
  const out: Attachment[] = [];
  for (const name of referenced) {
    const prior = priorByName.get(name);
    if (prior) {
      out.push(prior);
      continue;
    }
    const upload = uploadsByName.get(name);
    if (upload) {
      out.push(upload);
      continue;
    }
    // Referenced but unknown: the body embeds a pointer to an existing file
    // (e.g. pasted from another entity) and we don't have a record to quote.
    // Record a stub so GC won't delete the file; metadata is filled in on the
    // next save by a side fetch or left as best-effort.
    out.push({
      file_name: name,
      original_name: name,
      mime_type: 'application/octet-stream',
      size: 0,
      uploaded_at: new Date().toISOString(),
    });
  }
  return out;
}

/** Convenience: rewrite `/api/attachments/<name>` to `../attachments/<name>`
 *  for mirror-markdown export. Separate from derive so renderers can call it
 *  without pulling the derive logic. */
export function rewriteAttachmentsForMirror(body: string | null | undefined): string {
  if (!body) return '';
  return body.replace(/\/api\/attachments\//g, '../attachments/');
}
