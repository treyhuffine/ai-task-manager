import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod/v4';
import { tasks, notes, areas } from '@/lib/db/schema';
import { TASK_STATUSES, TRANSITION_COMMANDS } from '@/lib/tasks/lifecycle';
import type { Attachment, TaskFilter, NoteFilter, AreaFilter } from '@/db/types';

// Drizzle owns entity fields. JSON columns need their hydrated, camelCase
// shape at this boundary, rather than drizzle-zod's generic JSON validator.
const attachment = z.object({
  fileName: z.string().min(1), originalName: z.string(), mimeType: z.string(),
  size: z.number().int().nonnegative(), uploadedAt: z.string(),
}) satisfies z.ZodType<Attachment>;
const jsonFields = {
  attachments: z.array(attachment).nullable().optional(),
  contextTags: z.array(z.string()).nullable().optional(),
  foldedHeadings: z.array(z.string()).nullable().optional(),
};
const immutable = { id: true, createdAt: true, updatedAt: true } as const;
const taskFields = createInsertSchema(tasks).omit({
  ...immutable, statusChangedCount: true, statusChangedAt: true,
  completedAt: true, nextRecurrenceAt: true,
}).extend(jsonFields);
export const createTaskSchema = taskFields.extend({
  title: z.string().min(1), rawInput: z.string().min(1),
  status: z.enum(['consider', 'todo']).optional(),
}).strict();
export const updateTaskSchema = taskFields.omit({ status: true }).partial().strict();
const noteFields = createInsertSchema(notes).omit(immutable).extend(jsonFields);
export const createNoteSchema = noteFields.extend({ status: noteFields.shape.status.optional() }).strict();
export const updateNoteSchema = createNoteSchema.partial().strict();
const areaFields = createInsertSchema(areas).omit(immutable).extend({ attachments: jsonFields.attachments });
export const createAreaSchema = areaFields.extend({
  name: z.string().min(1), status: areaFields.shape.status.optional(),
}).strict();
export const updateAreaSchema = createAreaSchema.partial().strict();

const foreignId = z.string().nullable().optional();
const pagination = { limit: z.number().int().nonnegative().optional(), offset: z.number().int().nonnegative().optional(), orderBy: z.string().optional() };
const statusFilter = z.enum([...TASK_STATUSES, 'active']);
export const taskFilterSchema = z.object({
  status: z.union([statusFilter, z.array(statusFilter)]).optional(),
  areaId: foreignId, workspaceId: foreignId, parentId: foreignId, assigneeMemberId: foreignId,
  energy: z.enum(['deep', 'light']).optional(), q: z.string().optional(), ...pagination,
}).strict() satisfies z.ZodType<TaskFilter>;
export const noteFilterSchema = z.object({
  areaId: foreignId, workspaceId: foreignId, taskId: foreignId,
  status: noteFields.shape.status.optional(), decisionsOnly: z.boolean().optional(), ...pagination,
}).strict() satisfies z.ZodType<NoteFilter>;
export const areaFilterSchema = z.object({ status: z.enum([...areaFields.shape.status.options, 'all']).optional() }).strict() satisfies z.ZodType<AreaFilter>;
export const entityIdSchema = z.object({ id: z.string().min(1) }).strict();
export const lifecycleOptionsSchema = z.object({
  idempotencyKey: z.string().min(1).optional(), expectedStatusChangedCount: z.number().int().nonnegative().optional(),
  runtimeChoice: z.enum(['keep_running', 'stop_running_agent']).optional(),
  acknowledgedChildIds: z.array(z.string().min(1)).optional(), acknowledgedExecutionIds: z.array(z.string().min(1)).optional(),
});
export const completeSchema = lifecycleOptionsSchema.extend({ id: entityIdSchema.shape.id, note: z.string().optional() }).strict();
export const transitionSchema = lifecycleOptionsSchema.extend({ id: entityIdSchema.shape.id, command: z.enum(TRANSITION_COMMANDS), reason: z.string().optional() }).strict();
