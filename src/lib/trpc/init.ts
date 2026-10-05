import { getRequestKey } from '@/lib/auth/request-key';
import { isOperationError } from '@/lib/server/operation';
import { beginActivity, MaintenanceError } from '@/lib/service/maintenance';
import { isTaskLifecycleError, LIFECYCLE_ERROR_HTTP_STATUS } from '@/lib/tasks/lifecycle';
import { initTRPC, TRPCError } from '@trpc/server';
import { isDrainSaveProcedure } from './admission';
import { currentPerfLabel, perfScope } from '@/lib/perf/recorder';
import { procedureLabel } from '@/lib/perf/labels';

export function createTRPCContext(request: Request): { key: ReturnType<typeof getRequestKey>; request: Request; authorize?: () => void } {
  return { key: getRequestKey(request.headers), request };
}
export type TRPCContext = ReturnType<typeof createTRPCContext>;
const t = initTRPC.context<TRPCContext>().create({
  errorFormatter({ shape, error }) {
    const cause = error.cause;
    return { ...shape, data: { ...shape.data,
      httpStatus: isOperationError(cause) ? cause.status : shape.data.httpStatus,
      domainCode: isTaskLifecycleError(cause) ? cause.code : isOperationError(cause) && cause.body && typeof cause.body === 'object' ? String('code' in cause.body ? cause.body.code : 'error' in cause.body ? cause.body.error : '') : null,
      details: isTaskLifecycleError(cause) ? cause.details : isOperationError(cause) && cause.body && typeof cause.body === 'object' && 'details' in cause.body ? cause.body.details : undefined,
      body: isOperationError(cause) ? cause.body : undefined,
    } };
  },
});
export const router = t.router;
export const viewerProcedure = t.procedure.use(({ ctx, type, path, next }) => {
  const run = async () => {
    ctx.authorize?.();
    if (!ctx.key) throw new TRPCError({ code: 'UNAUTHORIZED' });
    if (ctx.key.scope !== 'viewer') throw new TRPCError({ code: 'FORBIDDEN' });
    let release: (() => void) | undefined;
    try {
      release = beginActivity(undefined, type !== 'mutation' || isDrainSaveProcedure(path));
      const result = await next();
      // tRPC represents downstream errors as a result, rather than throwing.
      if (!result.ok) throw result.error;
      return result;
    } catch (error) {
      const cause = error instanceof TRPCError ? error.cause : error;
      if (isTaskLifecycleError(cause)) {
        const status = LIFECYCLE_ERROR_HTTP_STATUS[cause.code];
        throw new TRPCError({ code: status === 404 ? 'NOT_FOUND' : status === 409 ? 'CONFLICT' : 'UNPROCESSABLE_CONTENT', message: cause.message, cause });
      }
      if (error instanceof MaintenanceError) throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'Ri is preparing an update. Please retry shortly.', cause: error });
      throw error;
    } finally { release?.(); }
  };
  // The perf log's scope for this procedure. Over HTTP the service host has
  // already opened it under the same label, so only WebSocket calls open one.
  const label = procedureLabel(path);
  return currentPerfLabel() === label ? run() : perfScope(label, run);
});
