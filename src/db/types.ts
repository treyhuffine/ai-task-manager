// Shared types derived from Drizzle schema — imported by both client and server.
// Source of truth: src/lib/db/schema.ts

import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import type { userState, areas, stream, tasks, taskCompletions, notes, decks, apiKeys } from '@/lib/db/schema';
export type { DeckItem, DeckAlternative, Attachment } from '@/lib/db/schema';

// ─── User State ────────────────────────────────────────────────

export type UserStateRecord = InferSelectModel<typeof userState>;
export type UpdateUserStateInput = Partial<Omit<InferInsertModel<typeof userState>, 'id'>>;

// ─── Areas ────────────────────────────────────────────────────

export type AreaRecord = InferSelectModel<typeof areas>;
export type CreateAreaInput = Omit<InferInsertModel<typeof areas>, 'id'>;
export type UpdateAreaInput = Partial<CreateAreaInput>;
export type AreaStatus = AreaRecord['status'];

// ─── Stream ───────────────────────────────────────────────────

export type StreamRecord = InferSelectModel<typeof stream>;
export type CreateStreamInput = Omit<InferInsertModel<typeof stream>, 'id'>;
export type UpdateStreamInput = Partial<CreateStreamInput>;
export type StreamSource = StreamRecord['source'];
export type StreamStatus = StreamRecord['status'];

// ─── Tasks ────────────────────────────────────────────────────

export type TaskRecord = InferSelectModel<typeof tasks>;
export type TaskListRecord = TaskRecord & { subtask_count: number; subtask_preview: string | null };
export type CreateTaskInput = Omit<InferInsertModel<typeof tasks>, 'id'>;
export type UpdateTaskInput = Partial<CreateTaskInput>;
export type TaskStatus = NonNullable<TaskRecord['status']>;
export type Energy = NonNullable<TaskRecord['energy']>;
export type Effort = NonNullable<TaskRecord['effort']>;

// ─── Task Completions ─────────────────────────────────────────

export type TaskCompletionRecord = InferSelectModel<typeof taskCompletions>;
export type CreateTaskCompletionInput = Omit<InferInsertModel<typeof taskCompletions>, 'id'>;

// ─── Notes ────────────────────────────────────────────────────

export type NoteRecord = InferSelectModel<typeof notes>;
export type CreateNoteInput = Omit<InferInsertModel<typeof notes>, 'id'>;
export type UpdateNoteInput = Partial<CreateNoteInput>;
export type NoteStatus = NonNullable<NoteRecord['status']>;

// ─── Decks ───────────────────────────────────────────────────

export type DeckRecord = InferSelectModel<typeof decks>;
export type CreateDeckInput = Omit<InferInsertModel<typeof decks>, 'id'>;
export type UpdateDeckInput = Partial<Omit<CreateDeckInput, 'created_at'>>;

// ─── API Keys ─────────────────────────────────────────────────

export type ApiKeyRecord = InferSelectModel<typeof apiKeys>;
export type CreateApiKeyInput = Omit<InferInsertModel<typeof apiKeys>, 'id' | 'prefix' | 'suffix' | 'hash'>;
// Only user-editable metadata is exposed — secret material and audit timestamps
// stay internal and cannot be mutated via the API.
export type UpdateApiKeyInput = Partial<Pick<CreateApiKeyInput, 'name' | 'description' | 'device_type'>>;
export type DeviceType = NonNullable<ApiKeyRecord['device_type']>;

// ─── Filters (query params) ──────────────────────────────────

export interface AreaFilter {
  status?: AreaStatus | 'all';
}

export interface TaskFilter {
  status?: TaskStatus | TaskStatus[];
  area_id?: string | null;
  parent_id?: string | null;
  energy?: Energy;
  q?: string;
  limit?: number;
  offset?: number;
  order_by?: string;
}

export interface NoteFilter {
  area_id?: string | null;
  task_id?: string | null;
  status?: NoteStatus;
  limit?: number;
  offset?: number;
  order_by?: string;
}

export interface StreamFilter {
  status?: StreamStatus;
  limit?: number;
  offset?: number;
}
