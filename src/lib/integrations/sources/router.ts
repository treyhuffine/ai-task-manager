/**
 * The typed procedures behind Connectors → Sources, the application pages and the chat cards'
 * managed sign-in (docs/connector-service-spec.md §2). Owner-only, like the rest of Connectors,
 * and every change refuses an agent session's credential: an agent can ask for a connection
 * (`request_connection`), but only the person enters keys, consents, disconnects or revokes.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';
import { viewerProcedure as p, router } from '@/lib/trpc/init';
import type { TRPCContext } from '@/lib/trpc/init';
import { SESSION_CREDENTIAL_HEADER } from '@/lib/orchestrator/session-credential';
import { isComposioApiError } from './composio/client';
import { ConnectionRequestError } from '../connection-requests';
import { PreferencesUnavailableError } from './preferences';
import { APPLICATION_IDS } from './types';
import { SOURCE_ID_PATTERN } from './applications';
import * as service from './service';
import { managedAccounts } from './views';

const sourceId = z.string().regex(SOURCE_ID_PATTERN);
const applicationId = z.enum(APPLICATION_IDS);
const connectionId = z.string().min(1).max(300);
const returnTo = z.string().max(2000).optional();
const method = z.union([
  z.object({ sourceId }).strict(),
  z.object({ kind: z.literal('direct'), providerId: z.string().min(1).max(64), authConfigId: z.string().min(1).max(200).optional() }).strict(),
]);

function humanOnly(ctx: TRPCContext): void {
  if (ctx.request.headers.get(SESSION_CREDENTIAL_HEADER)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Connection sources are managed by the user, not by an agent.' });
  }
}

async function run<T>(work: () => Promise<T> | T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof service.SourceError) {
      const code = error.code === 'not_found' ? 'NOT_FOUND' : error.code === 'conflict' ? 'CONFLICT' : error.code === 'unavailable' ? 'PRECONDITION_FAILED' : 'BAD_REQUEST';
      throw new TRPCError({ code, message: error.message, cause: error });
    }
    if (error instanceof PreferencesUnavailableError) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: error.message, cause: error });
    if (error instanceof ConnectionRequestError) {
      throw new TRPCError({ code: error.code === 'not_found' ? 'NOT_FOUND' : error.code === 'already_answered' ? 'CONFLICT' : 'BAD_REQUEST', message: error.message, cause: error });
    }
    if (isComposioApiError(error)) throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: `Composio: ${error.message}`, cause: error });
    throw error;
  }
}

export const integrationSourcesRouter = router({
  overview: p.query(() => run(() => service.sourcesOverview())),
  accounts: p.query(() => run(() => managedAccounts())),
  method: p.input(z.object({ applicationId, capability: z.enum(['agent_tools', 'calendar_view']).optional() }).strict())
    .query(({ input }) => run(() => service.connectionMethod(input.applicationId, input.capability))),

  addComposio: p.input(z.object({ apiKey: z.string().min(1).max(400), label: z.string().max(60).optional() }).strict())
    .mutation(({ input, ctx }) => { humanOnly(ctx); return run(() => service.addComposioSource(input)); }),
  rotateKey: p.input(z.object({ sourceId, apiKey: z.string().min(1).max(400) }).strict())
    .mutation(({ input, ctx }) => { humanOnly(ctx); return run(() => service.rotateSourceKey(input.sourceId, input.apiKey)); }),
  setEnabled: p.input(z.object({ sourceId, enabled: z.boolean() }).strict())
    .mutation(({ input, ctx }) => { humanOnly(ctx); return run(() => service.setSourceEnabled(input.sourceId, input.enabled)); }),
  remove: p.input(z.object({ sourceId, revokeRemote: z.boolean() }).strict())
    .mutation(({ input, ctx }) => { humanOnly(ctx); return run(() => service.removeSource(input.sourceId, { revokeRemote: input.revokeRemote })); }),
  rename: p.input(z.object({ sourceId, label: z.string().min(1).max(60) }).strict())
    .mutation(({ input, ctx }) => { humanOnly(ctx); return run(() => service.renameSource(input.sourceId, input.label)); }),
  setPreferred: p.input(z.object({ sourceId: sourceId.nullable() }).strict())
    .mutation(({ input, ctx }) => { humanOnly(ctx); return run(() => service.setPreferredSource(input.sourceId)); }),
  setApplicationMethod: p.input(z.object({ applicationId, method: method.nullable() }).strict())
    .mutation(({ input, ctx }) => { humanOnly(ctx); return run(() => service.setApplicationMethod(input.applicationId, input.method)); }),

  connect: p.input(z.object({
    applicationId, sourceId: sourceId.optional(), explicitChoice: z.boolean().optional(), label: z.string().max(80).optional(),
    returnTo, calendarUse: z.boolean().optional(),
  }).strict()).mutation(({ input, ctx }) => { humanOnly(ctx); return run(() => service.beginManagedConnect(ctx.request, input)); }),
  reconnect: p.input(z.object({ connectionId, returnTo }).strict())
    .mutation(({ input, ctx }) => { humanOnly(ctx); return run(() => service.beginManagedReconnect(ctx.request, input.connectionId, input.returnTo)); }),
  /** Poll an attempt. Finishes it when the consent completed and the callback never arrived. */
  attempt: p.input(z.object({ attemptId: z.string().regex(/^att_[a-f0-9]{32}$/) }).strict())
    .query(({ input }) => run(() => service.completeManagedAttempt(input.attemptId, { via: 'poll' }))),
  cancelAttempt: p.input(z.object({ attemptId: z.string().regex(/^att_[a-f0-9]{32}$/) }).strict())
    .mutation(({ input, ctx }) => { humanOnly(ctx); return run(() => service.cancelManagedAttempt(input.attemptId)); }),
  discover: p.input(z.object({ sourceId, applicationId }).strict())
    .query(({ input }) => run(() => service.discoverAccounts(input.sourceId, input.applicationId))),
  importAccount: p.input(z.object({ sourceId, applicationId, remoteAccountId: z.string().min(1).max(200), label: z.string().max(80).optional() }).strict())
    .mutation(async ({ input, ctx }) => { humanOnly(ctx); const connection = await run(() => service.importAccount(input.sourceId, input.applicationId, input.remoteAccountId, input.label)); return { connectionId: connection.id }; }),
  disconnect: p.input(z.object({ connectionId }).strict())
    .mutation(({ input, ctx }) => { humanOnly(ctx); return run(() => service.disconnectManaged(input.connectionId)); }),
  revoke: p.input(z.object({ connectionId }).strict())
    .mutation(({ input, ctx }) => { humanOnly(ctx); return run(() => service.revokeManaged(input.connectionId)); }),
  renameAccount: p.input(z.object({ connectionId, label: z.string().max(80) }).strict())
    .mutation(({ input, ctx }) => { humanOnly(ctx); return run(() => service.renameManaged(input.connectionId, input.label)); }),
  setCalendarUse: p.input(z.object({ connectionId, enabled: z.boolean() }).strict())
    .mutation(({ input, ctx }) => { humanOnly(ctx); return run(() => service.setCalendarUse(input.connectionId, input.enabled)); }),
  /** A chat's Connect card, through a managed source. */
  cardSignIn: p.input(z.object({
    eventId: z.string().min(1).max(100), returnTo, sourceId: sourceId.optional(), explicitChoice: z.boolean().optional(), calendarUse: z.boolean().optional(),
  }).strict())
    .mutation(async ({ input, ctx }) => {
      humanOnly(ctx);
      const { startCardManagedSignIn } = await import('../connection-requests');
      return run(() => startCardManagedSignIn(ctx.request, input.eventId, {
        returnTo: input.returnTo ?? null, ...(input.sourceId ? { sourceId: input.sourceId } : {}), ...(input.explicitChoice ? { explicitChoice: true } : {}),
        ...(input.calendarUse !== undefined ? { calendarUse: input.calendarUse } : {}),
      }));
    }),
});
