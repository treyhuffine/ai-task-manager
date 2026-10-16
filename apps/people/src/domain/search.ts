import { iso, type Ctx } from './context.js';

/**
 * Full-text search rows point at a record and carry the source that supplied
 * the text, so a query filters by the caller's sources before ranking or
 * counting. Text from different sources about the same record lives in
 * separate rows.
 */
/**
 * A pseudo-source only the owner's unrestricted search matches. It holds text
 * about a record that no single source may index, such as a company name kept
 * in a private collection on a person affiliated under a shared source. No
 * scope can ever hold this key, so other callers never match it.
 */
export const OWNER_ONLY_SOURCE = 'owner-only';

export function setSearchRow(ctx: Ctx, refKey: string, recordKind: 'person' | 'organization' | 'opportunity', recordId: string, sourceKey: string, text: string) {
  const content = text.replace(/\s+/g, ' ').trim().slice(0, 4000);
  const existing = ctx.db.get<{ id: number; source_key: string; record_id: string }>('SELECT id, source_key, record_id FROM search_rows WHERE ref_key = ?', refKey);
  if (!content) {
    if (existing) removeRow(ctx, existing.id);
    return;
  }
  const time = iso(ctx);
  if (existing) {
    ctx.db.run('UPDATE search_rows SET source_key = ?, record_id = ?, record_kind = ?, updated_at = ? WHERE id = ?', sourceKey, recordId, recordKind, time, existing.id);
    ctx.db.run('DELETE FROM search_fts WHERE rowid = ?', existing.id);
    ctx.db.run('INSERT INTO search_fts (rowid, text) VALUES (?, ?)', existing.id, content);
    return;
  }
  const result = ctx.db.run('INSERT INTO search_rows (created_at, updated_at, ref_key, record_kind, record_id, source_key) VALUES (?, ?, ?, ?, ?, ?)', time, time, refKey, recordKind, recordId, sourceKey);
  ctx.db.run('INSERT INTO search_fts (rowid, text) VALUES (?, ?)', Number(result.lastInsertRowid), content);
}
function removeRow(ctx: Ctx, id: number) {
  ctx.db.run('DELETE FROM search_fts WHERE rowid = ?', id);
  ctx.db.run('DELETE FROM search_rows WHERE id = ?', id);
}
export function removeSearchRow(ctx: Ctx, refKey: string) {
  const row = ctx.db.get<{ id: number }>('SELECT id FROM search_rows WHERE ref_key = ?', refKey);
  if (row) removeRow(ctx, row.id);
}
/** Remove rows for a record whose ref keys start with `prefix`, keeping the ones in `keep`. */
export function pruneSearchRows(ctx: Ctx, recordKind: string, recordId: string, prefix: string, keep: ReadonlySet<string>) {
  for (const row of ctx.db.all<{ id: number; ref_key: string }>('SELECT id, ref_key FROM search_rows WHERE record_kind = ? AND record_id = ?', recordKind, recordId))
    if (row.ref_key.startsWith(prefix) && !keep.has(row.ref_key)) removeRow(ctx, row.id);
}
export function removeSearchForRecord(ctx: Ctx, recordKind: string, recordId: string) {
  for (const row of ctx.db.all<{ id: number }>('SELECT id FROM search_rows WHERE record_kind = ? AND record_id = ?', recordKind, recordId)) removeRow(ctx, row.id);
}
export function removeSearchForSource(ctx: Ctx, sourceKey: string) {
  for (const row of ctx.db.all<{ id: number }>('SELECT id FROM search_rows WHERE source_key = ?', sourceKey)) removeRow(ctx, row.id);
}

/**
 * A safe FTS5 query from typed text: each word becomes a quoted prefix term,
 * all required. Operators and punctuation in the input are never interpreted.
 */
export function ftsQuery(text: string | null | undefined): string | null {
  if (!text) return null;
  const words = text
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}]+/u)
    .map((word) => word.trim())
    .filter(Boolean)
    .slice(0, 8);
  if (!words.length) return null;
  return words.map((word) => `"${word.replace(/"/g, '')}"*`).join(' ');
}
