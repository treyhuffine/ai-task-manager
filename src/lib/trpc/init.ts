import { getRequestKey } from '@/lib/auth/request-key';
import { isOperationError, OperationError } from '@/lib/server/operation';
import { isTeamAuthority, isTeamBoundaryError } from '@/lib/home/authority';
import { isBodyRevisionConflict, isTeamError, type TeamErrorCode } from '@/lib/db/queries';
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

const TEAM_ERROR_STATUS: Record<TeamErrorCode, number> = {
  invalid: 400, expired: 410, used: 409, revoked: 410, not_allowed: 403, conflict: 409, not_found: 404,
};
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
/**
 * Who may call a procedure. Personal procedures take the owner's viewing
 * key. In a team space there is no viewer: shared work takes a member's key
 * (docs/homes-spec.md §9.1), and every personal procedure refuses it.
 */
type Admission = (key: NonNullable<TRPCContext['key']>) => void;

const viewerOnly: Admission = (key) => {
  if (key.scope !== 'viewer') throw new TRPCError({ code: 'FORBIDDEN' });
};
/** A personal home's owner, or in a team a member: the task/note/area surface both share. */
const sharedWork: Admission = (key) => {
  if (isTeamAuthority() ? key.scope !== 'member' : key.scope !== 'viewer') throw new TRPCError({ code: 'FORBIDDEN' });
};
const teamMember: Admission = (key) => {
  if (!isTeamAuthority() || key.scope !== 'member' || !key.memberId) throw new TRPCError({ code: 'FORBIDDEN' });
};
const teamOwner: Admission = (key) => {
  teamMember(key);
  if (key.memberRole !== 'owner') throw new TRPCError({ code: 'FORBIDDEN', message: "Only the team's owner can do that." });
};

function admitted(admit: Admission) {
  return t.procedure.use(({ ctx, type, path, next }) => {
  const run = async () => {
    ctx.authorize?.();
    if (!ctx.key) throw new TRPCError({ code: 'UNAUTHORIZED' });
    admit(ctx.key);
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
      const teamCause = error instanceof TRPCError ? error.cause : error;
      if (isBodyRevisionConflict(teamCause)) {
        throw new TRPCError({ code: 'CONFLICT', message: teamCause.message, cause: new OperationError(409, { error: 'body_conflict', message: teamCause.message, details: teamCause.current }) });
      }
      if (isTeamError(teamCause)) {
        const status = TEAM_ERROR_STATUS[teamCause.code];
        throw new TRPCError({ code: status === 404 ? 'NOT_FOUND' : status === 409 ? 'CONFLICT' : status === 403 ? 'FORBIDDEN' : 'BAD_REQUEST', message: teamCause.message, cause: new OperationError(status, { error: teamCause.code, message: teamCause.message }) });
      }
      if (isTeamBoundaryError(teamCause)) throw new TRPCError({ code: 'FORBIDDEN', message: teamCause.message, cause: teamCause });
      throw error;
    } finally { release?.(); }
  };
  // The perf log's scope for this procedure. Over HTTP the service host has
  // already opened it under the same label, so only WebSocket calls open one.
  const label = procedureLabel(path);
  return currentPerfLabel() === label ? run() : perfScope(label, run);
  });
}

export const viewerProcedure = admitted(viewerOnly);
/** Tasks, notes, Areas, their history and search: the owner's at home, a member's in a team. */
export const sharedProcedure = admitted(sharedWork);
/** A team member's own: who's in the team, their sign-ins. */
export const memberProcedure = admitted(teamMember);
/** A team owner's: people, invitations, the team's name. */
export const ownerProcedure = admitted(teamOwner);
