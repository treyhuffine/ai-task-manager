/**
 * Wire shapes for the task and note *list* endpoints.
 *
 * `body` dominates both payloads — 64% of `/api/tasks` and 69% of
 * `/api/notes` when measured against real data — and neither list renders it
 * in full. The task list uses it as a presence flag plus a tooltip already
 * clamped to five lines. The note list derives a display title from the
 * first line, a one-line preview from the rest, and an icon from whether
 * there is any content at all.
 *
 * So the lists carry a bounded excerpt and the full body stays on the
 * per-entity `GET /api/tasks/:id` and `GET /api/notes/:id` that the detail
 * views already call.
 *
 * **The one place that genuinely needs the whole body is the launcher**,
 * which folds a picked task's body into the launch prompt. That is handled
 * the way the launcher already handles PRs and issues: the chip is created
 * from list data, and `warm()` fetches the full record on pick and patches
 * the body in. Truncating without that fetch would silently cut a user's
 * prompt at {@link LIST_BODY_EXCERPT_CHARS} characters, which is why this
 * module renames the field rather than quietly shortening `body` in place —
 * a rename makes every consumer a compile error instead of a silent bug.
 *
 * These types are the contract: routes build them through the projections
 * below and `tasksApi` / `notesApi` declare them as return types, so a field
 * renamed on one side fails to compile on the other.
 */

import type { NoteRecord, TaskListRecord } from '@/db/types';

/**
 * Excerpt length. Comfortably covers every list consumer: the note title is
 * clipped to 80 characters, its preview is one CSS-truncated line, and the
 * task tooltip clamps to five lines.
 */
export const LIST_BODY_EXCERPT_CHARS = 300;

type WithBodyExcerpt<T> = Omit<T, 'body'> & {
  /** First {@link LIST_BODY_EXCERPT_CHARS} characters, or null when empty. */
  bodyExcerpt: string | null;
  /** Length of the full body, so callers can tell empty from truncated. */
  bodyLen: number;
};

export type TaskListDTO = WithBodyExcerpt<TaskListRecord>;
export type NoteListDTO = WithBodyExcerpt<NoteRecord>;

function excerpt<T extends { body?: string | null }>(row: T): WithBodyExcerpt<T> {
  const { body, ...rest } = row;
  const full = body ?? '';
  return {
    ...rest,
    bodyExcerpt: full ? full.slice(0, LIST_BODY_EXCERPT_CHARS) : null,
    bodyLen: full.length,
  } as WithBodyExcerpt<T>;
}

export function toTaskListDTO(row: TaskListRecord): TaskListDTO {
  return excerpt(row);
}

export function toTaskListDTOs(rows: readonly TaskListRecord[]): TaskListDTO[] {
  return rows.map(toTaskListDTO);
}

export function toNoteListDTO(row: NoteRecord): NoteListDTO {
  return excerpt(row);
}

export function toNoteListDTOs(rows: readonly NoteRecord[]): NoteListDTO[] {
  return rows.map(toNoteListDTO);
}
