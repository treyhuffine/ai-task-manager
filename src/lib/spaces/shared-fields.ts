import type { TaskRecord } from '@/db/types';

/** Shared reference fields belong to the source member, unlike personal planning. */
export const SHARED_TASK_FIELDS = ['title', 'description', 'body', 'outcome', 'hardDeadline', 'attachments', 'status', 'rawInput'] as const satisfies readonly (keyof TaskRecord)[];
