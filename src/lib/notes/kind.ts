/**
 * What a note is (docs/homes-spec.md §9.7): an ordinary note or a decision,
 * stored in `notes.kind`. A note written before kinds existed has none in
 * storage and reads as `note`. Its title never decides its kind.
 */

import { hydrateRow } from '@/lib/db/hydrate';
import type { notes } from '@/lib/db/schema';
import type { NoteKind, NoteRecord } from '@/db/types';

export type { NoteKind };

/** A note row as every reader sees it: hydrated, with a kind. */
export function normalizeNoteRow(row: typeof notes.$inferSelect): NoteRecord {
  const hydrated = hydrateRow(row);
  return { ...hydrated, kind: hydrated.kind ?? 'note' };
}
