import { chatSourcesRouter } from '@/lib/chat-sources/router';
import { localAppsRouter } from '@/lib/local-apps/router';
import { toNoteListDTOs, toTaskListDTOs } from '@/lib/api/dto/entity-list';
import * as q from '@/lib/db/queries';
import { listRunningSessions } from '@/lib/executor/status-snapshot';
import { completeTaskForViewer, transitionTaskForViewer } from '@/lib/tasks/viewer-lifecycle';
import { TRPCError, type inferRouterInputs, type inferRouterOutputs } from '@trpc/server';
import { z } from 'zod/v4';
import { viewerProcedure as p, sharedProcedure as sp, router } from './init';
import { assertTeamAreaPatch, assertTeamNotePatch, assertTeamTaskPatch, requireBodyRevision, sharedCaller, versionMeta } from '@/lib/team/shared-work';
import { teamRouter } from '@/lib/team/router';
import { internalRouters, taskProcedures } from './operation-router';
import * as s from './schemas';
import { terminalSubscriptions } from './terminal-subscription';
import { hasWebSocketRuntime, publishApplicationRouter } from './ws-runtime';
import { launchPluginEvaluation, pluginEvaluationStatus } from '@/lib/server/operations/plugins/evaluation';
import { accountChatCapture } from '@/lib/server/operations/plugins/account-chat';
import { chatWithPluginEvaluation } from '@/lib/server/operations/plugins/evaluation-chat';
import { evaluationChatInputSchema } from '@/lib/plugins/evaluation-contract';
import { accountEvaluationCatalog, accountEvaluationRpc, accountRpcSchema, endAccountEvaluation, launchAccountEvaluation } from '@/lib/server/operations/plugins/account-evaluation';
import { MAX_WORK_DAYS, getWorkRange, saveWorkReport } from '@/lib/work/service';
import { ONBOARDING_REPLY_MAX, ONBOARDING_STEPS } from '@/lib/onboarding/progress';
import { resultsRouter } from './results-router';

/** A run of days for the work view (docs/work-view.md). */
const workRangeInput = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'start must be YYYY-MM-DD'),
  days: z.number().int().min(1).max(MAX_WORK_DAYS),
}).strict();

const onboardingStep = z.enum(ONBOARDING_STEPS);
const chatId = z.string().min(1).max(64);

function required<T>(value: T | null | undefined, entity: string): T {
  if (value == null) throw new TRPCError({ code: 'NOT_FOUND', message: `${entity} not found` });
  return value;
}

export const appRouter = router({
  localApps: localAppsRouter,
  chatSources: chatSourcesRouter,
  ...internalRouters,
  results: resultsRouter,
  // How the client reaches the server: every signed-in caller's, a team's members included.
  transport: router({
    capabilities: sp.query(() => ({ websocket: hasWebSocketRuntime() })),
    ping: sp.query(() => ({ now: Date.now() })),
  }),
  terminals: terminalSubscriptions,
  // The main chat's first-run conversation, step by step, on the home
  // (src/lib/onboarding/progress.ts, docs/main-chat-onboarding.md). Each
  // returns the user state it leaves, which the client caches.
  onboardingProgress: router({
    show: p.input(z.object({ step: onboardingStep, chatId }).strict()).mutation(({ input }) => required(q.showOnboardingStep(input), 'User state')),
    record: p.input(z.object({
      step: onboardingStep,
      status: z.enum(['answered', 'skipped']),
      reply: z.string().max(ONBOARDING_REPLY_MAX).optional(),
      chatId,
    }).strict()).mutation(({ input }) => required(q.recordOnboardingStep(input), 'User state')),
    finish: p.input(z.object({ skipped: z.boolean(), chatId: chatId.optional() }).strict()).mutation(({ input }) => required(q.finishOnboarding(input), 'User state')),
    moveChat: p.input(z.object({ from: chatId, to: chatId }).strict()).mutation(({ input }) => required(q.moveOnboardingChat(input), 'User state')),
  }),
  pluginEvaluation: router({
    status: p.query(() => pluginEvaluationStatus()),
    launch: p.input(z.object({ parentOrigin: z.string().url(), example: z.enum(['excalidraw', 'flint', 'buildings', 'tldraw']).optional() }).strict()).mutation(({ input }) => launchPluginEvaluation(input.parentOrigin, input.example)),
    chat: p.input(evaluationChatInputSchema).mutation(({ input, ctx }) => chatWithPluginEvaluation(input, ctx.key!.apiKeyId)),
    accounts: p.query(() => accountEvaluationCatalog()),
    launchAccount: p.input(z.object({ parentOrigin: z.string().url(), serverId: z.string().min(1) }).strict()).mutation(({ input, ctx }) => launchAccountEvaluation(input.parentOrigin, input.serverId, ctx.key!.apiKeyId)),
    accountRpc: p.input(accountRpcSchema).mutation(({ input, ctx }) => accountEvaluationRpc(input, ctx.key!.apiKeyId)),
    accountChatCapture: p.input(z.object({ ticket: z.uuid(), retryApproval: z.boolean().optional() }).strict()).mutation(({ input, ctx }) => accountChatCapture(input.ticket, ctx.key!.apiKeyId, input.retryApproval)),
    endAccount: p.input(z.object({ handle: z.uuid() }).strict()).mutation(({ input, ctx }) => endAccountEvaluation(input.handle, ctx.key!.apiKeyId)),
  }),
  // Shared with a team space's members (src/lib/team/shared-work.ts): the
  // same records and queries, acting as the member, on shared fields only.
  tasks: router({
    ...taskProcedures,
    list: sp.input(s.taskFilterSchema.optional()).query(({ input }) => toTaskListDTOs(q.listTasks(input))),
    get: sp.input(s.entityIdSchema).query(({ input, ctx }) => {
      const task = required(q.getTask(input.id), 'Task');
      // Viewing is a person's own state, never a shared record's.
      if (!sharedCaller(ctx.key).team) q.markTaskViewed(input.id);
      return task;
    }),
    create: sp.input(s.createTaskSchema).mutation(({ input, ctx }) => {
      const caller = sharedCaller(ctx.key);
      if (!caller.team) return q.createTask(input);
      assertTeamTaskPatch(input, 'create');
      return q.createTask(input, undefined, versionMeta(caller));
    }),
    update: sp.input(s.entityIdSchema.extend({ patch: s.updateTaskSchema, expectedBodyRevision: z.number().int().nonnegative().optional() })).mutation(({ input, ctx }) => {
      const caller = sharedCaller(ctx.key);
      if (caller.team) assertTeamTaskPatch(input.patch, 'update');
      requireBodyRevision(caller, input.patch, input.expectedBodyRevision);
      return required(q.updateTask(input.id, input.patch, versionMeta(caller), { expectedBodyRevision: input.expectedBodyRevision }), 'Task');
    }),
    delete: sp.input(s.entityIdSchema).mutation(({ input, ctx }) => {
      const caller = sharedCaller(ctx.key);
      // Shared work is archived, not deleted, except by the team's owner.
      if (caller.team && caller.role !== 'owner') throw new TRPCError({ code: 'FORBIDDEN', message: "Archive it instead. Only the team's owner can delete shared work." });
      if (!q.deleteTask(input.id)) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
    }),
    complete: sp.input(s.completeSchema).mutation(({ input: { id, ...opts }, ctx }) => {
      const caller = sharedCaller(ctx.key);
      return completeTaskForViewer(id, opts, caller.team ? { memberId: caller.memberId } : undefined);
    }),
    transition: sp.input(s.transitionSchema).mutation(({ input: { id, command, ...opts }, ctx }) => {
      const caller = sharedCaller(ctx.key);
      return transitionTaskForViewer(id, command, opts, caller.team ? { memberId: caller.memberId } : undefined);
    }),
    reorder: sp.input(s.entityIdSchema.extend({ prevId: z.string().nullable().optional(), nextId: z.string().nullable().optional() })).mutation(({ input }) => q.reorderTaskInLane(input.id, input.prevId ?? null, input.nextId ?? null)),
    executions: p.input(s.entityIdSchema).query(({ input }) => q.getTaskExecutions(input.id).map(({ id, label, status }) => ({ id, label, status }))),
    counts: sp.input(z.object({ areaId: z.string().nullable().optional() }).strict().optional()).query(({ input }) => q.getTaskStatusCounts({ areaId: input?.areaId || undefined })),
    attention: p.input(z.object({ ids: z.array(z.string().min(1)).max(200) }).strict()).query(({ input }) => q.getTasksAttentionSignals(input.ids, new Set(listRunningSessions()))),
    deadlines: p.input(z.object({ withinDays: z.number().int().min(0).max(60).optional() }).strict().optional()).query(({ input }) => q.getDeadlineTasks(input)),
  }),
  notes: router({
    list: sp.input(s.noteFilterSchema.optional()).query(({ input }) => toNoteListDTOs(q.listNotes(input))),
    get: sp.input(s.entityIdSchema).query(({ input, ctx }) => {
      const note = required(q.getNote(input.id), 'Note');
      if (!sharedCaller(ctx.key).team) q.markNoteViewed(input.id);
      return note;
    }),
    create: sp.input(s.createNoteSchema).mutation(({ input, ctx }) => {
      const caller = sharedCaller(ctx.key);
      if (!caller.team) return q.createNote(input);
      assertTeamNotePatch(input);
      return q.createNote(input, undefined, versionMeta(caller));
    }),
    update: sp.input(s.entityIdSchema.extend({ patch: s.updateNoteSchema, expectedBodyRevision: z.number().int().nonnegative().optional() })).mutation(({ input, ctx }) => {
      const caller = sharedCaller(ctx.key);
      if (caller.team) assertTeamNotePatch(input.patch);
      requireBodyRevision(caller, input.patch, input.expectedBodyRevision);
      return required(q.updateNote(input.id, input.patch, versionMeta(caller), { expectedBodyRevision: input.expectedBodyRevision }), 'Note');
    }),
    delete: sp.input(s.entityIdSchema).mutation(({ input, ctx }) => {
      const caller = sharedCaller(ctx.key);
      if (caller.team && caller.role !== 'owner') throw new TRPCError({ code: 'FORBIDDEN', message: "Archive it instead. Only the team's owner can delete shared work." });
      if (!q.deleteNote(input.id)) throw new TRPCError({ code: 'NOT_FOUND', message: 'Note not found' });
    }),
  }),
  work: router({
    range: p.input(workRangeInput).query(({ input }) => getWorkRange(input)),
    saveReport: p.input(workRangeInput).mutation(({ input }) => saveWorkReport(input)),
  }),
  // A team's Areas organize its shared work. They grant nothing (§9.1).
  areas: router({
    list: sp.input(s.areaFilterSchema.optional()).query(({ input }) => q.listAreas(input)),
    get: sp.input(s.entityIdSchema).query(({ input }) => required(q.getArea(input.id), 'Area')),
    create: sp.input(s.createAreaSchema).mutation(({ input, ctx }) => {
      if (sharedCaller(ctx.key).team) assertTeamAreaPatch(input);
      return q.createArea(input);
    }),
    update: sp.input(s.entityIdSchema.extend({ patch: s.updateAreaSchema })).mutation(({ input, ctx }) => {
      if (sharedCaller(ctx.key).team) assertTeamAreaPatch(input.patch);
      return required(q.updateArea(input.id, input.patch), 'Area');
    }),
  }),
  team: teamRouter,
});
publishApplicationRouter(appRouter);
export type AppRouter = typeof appRouter;
export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;
