/**
 * Hydrate/dehydrate the `attachments` JSON column at the DB boundary.
 *
 * On-disk shape is snake_case (`StoredAttachment`) to match the SQL
 * column convention. App-side shape is camelCase (`Attachment`). Any
 * raw Drizzle read of an entity with attachments needs to be hydrated;
 * any insert/update needs to be dehydrated. The public `queries.ts`
 * functions do this internally — these helpers are exported so that
 * modules outside `queries.ts` that still need raw Drizzle access
 * (mirror sync, GC, reconcile) can apply the same translation.
 */

import { camelizeKeys, snakeizeKeys } from '@/lib/case/keys';
import type { Attachment, StoredAttachment } from '@/lib/db/schema';

/** Camelize a row's `attachments` field after a Drizzle read. */
export function hydrateRow<R extends { attachments: StoredAttachment[] | null }>(row: R): Omit<R, 'attachments'> & { attachments: Attachment[] | null };
export function hydrateRow<R extends { attachments: StoredAttachment[] | null }>(row: R | undefined): (Omit<R, 'attachments'> & { attachments: Attachment[] | null }) | undefined;
export function hydrateRow<R extends { attachments: StoredAttachment[] | null }>(row: R | undefined) {
  if (!row) return undefined;
  const { attachments, ...rest } = row;
  return {
    ...rest,
    attachments: attachments ? camelizeKeys(attachments) : null,
  };
}

/** Snakeize an attachments array before writing it to a JSON column. */
export function dehydrateAttachments(attachments: Attachment[] | null | undefined): StoredAttachment[] | null | undefined {
  if (attachments === null) return null;
  if (attachments === undefined) return undefined;
  return snakeizeKeys(attachments);
}

/**
 * Strip the `attachments` field from an input before spreading it into a
 * Drizzle `.values()` / `.set()`. Lets callers spread the rest of `input`
 * and then assign `attachments: dehydrateAttachments(...)` explicitly
 * without TypeScript flagging the spread's camelCase shape as
 * incompatible with the storage shape.
 */
export function withoutAttachments<T extends { attachments?: unknown }>(input: T): Omit<T, 'attachments'> {
  const copy = { ...input };
  delete (copy as { attachments?: unknown }).attachments;
  return copy as Omit<T, 'attachments'>;
}
