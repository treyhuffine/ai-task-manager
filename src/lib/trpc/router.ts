import { toNoteListDTOs, toTaskListDTOs } from '@/lib/api/dto/entity-list';
import * as q from '@/lib/db/queries';
import { listRunningSessions } from '@/lib/executor/status-snapshot';
import { completeTaskForViewer, transitionTaskForViewer } from '@/lib/tasks/viewer-lifecycle';
import { TRPCError, type inferRouterInputs, type inferRouterOutputs } from '@trpc/server';
import { z } from 'zod/v4';
import { viewerProcedure as p, router } from './init';
import { internalRouters, taskProcedures } from './operation-router';
import * as s from './schemas';
import { terminalSubscriptions } from './terminal-subscription';
import { hasWebSocketRuntime, publishApplicationRouter } from './ws-runtime';
import { launchPluginEvaluation, pluginEvaluationStatus } from '@/lib/server/operations/plugins/evaluation';
import { chatWithPluginEvaluation } from '@/lib/server/operations/plugins/evaluation-chat';
import { evaluationChatInputSchema } from '@/lib/plugins/evaluation-contract';

function required<T>(value: T | null | undefined, entity: string): T {
  if (value == null) throw new TRPCError({ code: 'NOT_FOUND', message: `${entity} not found` });
  return value;
}

export const appRouter = router({
  ...internalRouters,
  transport: router({
    capabilities: p.query(() => ({ websocket: hasWebSocketRuntime() })),
    ping: p.query(() => ({ now: Date.now() })),
  }),
  terminals: terminalSubscriptions,
  pluginEvaluation: router({
    status: p.query(() => pluginEvaluationStatus()),
    launch: p.input(z.object({ parentOrigin: z.string().url() }).strict()).mutation(({ input }) => launchPluginEvaluation(input.parentOrigin)),
    chat: p.input(evaluationChatInputSchema).mutation(({ input }) => chatWithPluginEvaluation(input)),
  }),
  tasks: router({
    ...taskProcedures,
    list: p.input(s.taskFilterSchema.optional()).query(({ input }) => toTaskListDTOs(q.listTasks(input))),
    get: p.input(s.entityIdSchema).query(({ input }) => {
      const task = required(q.getTask(input.id), 'Task');
      q.markTaskViewed(input.id);
      return task;
    }),
    create: p.input(s.createTaskSchema).mutation(({ input }) => q.createTask(input)),
    update: p.input(s.entityIdSchema.extend({ patch: s.updateTaskSchema })).mutation(({ input }) => required(q.updateTask(input.id, input.patch, { source: 'human' }), 'Task')),
    delete: p.input(s.entityIdSchema).mutation(({ input }) => {
      if (!q.deleteTask(input.id)) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
    }),
    complete: p.input(s.completeSchema).mutation(({ input: { id, ...opts } }) => completeTaskForViewer(id, opts)),
    transition: p.input(s.transitionSchema).mutation(({ input: { id, command, ...opts } }) => transitionTaskForViewer(id, command, opts)),
    reorder: p.input(s.entityIdSchema.extend({ prevId: z.string().nullable().optional(), nextId: z.string().nullable().optional() })).mutation(({ input }) => q.reorderTaskInLane(input.id, input.prevId ?? null, input.nextId ?? null)),
    executions: p.input(s.entityIdSchema).query(({ input }) => q.getTaskExecutions(input.id).map(({ id, label, status }) => ({ id, label, status }))),
    counts: p.input(z.object({ areaId: z.string().nullable().optional() }).strict().optional()).query(({ input }) => q.getTaskStatusCounts({ areaId: input?.areaId || undefined })),
    attention: p.input(z.object({ ids: z.array(z.string().min(1)).max(200) }).strict()).query(({ input }) => q.getTasksAttentionSignals(input.ids, new Set(listRunningSessions()))),
    deadlines: p.input(z.object({ withinDays: z.number().int().min(0).max(60).optional() }).strict().optional()).query(({ input }) => q.getDeadlineTasks(input)),
  }),
  notes: router({
    list: p.input(s.noteFilterSchema.optional()).query(({ input }) => toNoteListDTOs(q.listNotes(input))),
    get: p.input(s.entityIdSchema).query(({ input }) => {
      const note = required(q.getNote(input.id), 'Note');
      q.markNoteViewed(input.id);
      return note;
    }),
    create: p.input(s.createNoteSchema).mutation(({ input }) => q.createNote(input)),
    update: p.input(s.entityIdSchema.extend({ patch: s.updateNoteSchema })).mutation(({ input }) => required(q.updateNote(input.id, input.patch, { source: 'human' }), 'Note')),
    delete: p.input(s.entityIdSchema).mutation(({ input }) => {
      if (!q.deleteNote(input.id)) throw new TRPCError({ code: 'NOT_FOUND', message: 'Note not found' });
    }),
  }),
  areas: router({
    list: p.input(s.areaFilterSchema.optional()).query(({ input }) => q.listAreas(input)),
    get: p.input(s.entityIdSchema).query(({ input }) => required(q.getArea(input.id), 'Area')),
    create: p.input(s.createAreaSchema).mutation(({ input }) => q.createArea(input)),
    update: p.input(s.entityIdSchema.extend({ patch: s.updateAreaSchema })).mutation(({ input }) => required(q.updateArea(input.id, input.patch), 'Area')),
  }),
});
publishApplicationRouter(appRouter);
export type AppRouter = typeof appRouter;
export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;
