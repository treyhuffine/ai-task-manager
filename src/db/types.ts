// Shared types derived from Drizzle schema — imported by both client and server.
// Source of truth: src/lib/db/schema.ts

import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import type { areas, stream, tasks, taskCompletions, notes } from '@/lib/db/schema';

// ─── Areas ────────────────────────────────────────────────────

export type AreaRecord = InferSelectModel<typeof areas>;
export type CreateAreaInput = InferInsertModel<typeof areas>;
export type UpdateAreaInput = Partial<Omit<CreateAreaInput, 'id'>>;
export type AreaStatus = AreaRecord['status'];

// ─── Stream ───────────────────────────────────────────────────

export type StreamRecord = InferSelectModel<typeof stream>;
export type CreateStreamInput = InferInsertModel<typeof stream>;
export type UpdateStreamInput = Partial<Omit<CreateStreamInput, 'id'>>;
export type StreamSource = StreamRecord['source'];
export type StreamStatus = StreamRecord['status'];

// ─── Tasks ────────────────────────────────────────────────────

export type TaskRecord = InferSelectModel<typeof tasks>;
export type CreateTaskInput = InferInsertModel<typeof tasks>;
export type UpdateTaskInput = Partial<Omit<CreateTaskInput, 'id'>>;
export type TaskStatus = NonNullable<TaskRecord['status']>;
export type Energy = NonNullable<TaskRecord['energy']>;
export type Effort = NonNullable<TaskRecord['effort']>;

// ─── Task Completions ─────────────────────────────────────────

export type TaskCompletionRecord = InferSelectModel<typeof taskCompletions>;
export type CreateTaskCompletionInput = InferInsertModel<typeof taskCompletions>;

// ─── Notes ────────────────────────────────────────────────────

export type NoteRecord = InferSelectModel<typeof notes>;
export type CreateNoteInput = InferInsertModel<typeof notes>;
export type UpdateNoteInput = Partial<Omit<CreateNoteInput, 'id'>>;

// ─── Filters (query params) ──────────────────────────────────

export interface TaskFilter {
  status?: TaskStatus | TaskStatus[];
  area_id?: string | null;
  parent_id?: string | null;
  energy?: Energy;
  limit?: number;
  offset?: number;
  order_by?: string;
}

export interface NoteFilter {
  area_id?: string | null;
  task_id?: string | null;
  limit?: number;
  offset?: number;
}
