import { HarnessSelectionError } from '@/lib/harness/model-discovery';
import type { RequestKey } from '@/lib/auth/request-key';
import { getHome, getExecution, listChatSessions, getTeamChat, placementOf, TeamError, isTeamError, isTeamChatError } from '@/lib/db/queries';
import { authorizeTeamExecution, type ExecutionOperation } from '@/lib/home/execution-authority';
import { isTeamBoundaryError } from '@/lib/home/authority';
import { reply } from '@/lib/server/operation';
import { executionRequestKey } from '@/lib/home/execution-request';
import type { ExecutionAuthorityInput } from '@/lib/home/execution-authority';
import { LifecycleConflictError } from '@/lib/sessions/lifecycle-admission';

/** A contextual policy at the domain boundary, independent of the calling transport. */
export function workspaceAuthority(key: RequestKey | null, workspaceId: string, operation: ExecutionOperation) {
  return getHome()?.kind === 'team' ? authorizeTeamExecution(key, { operation, workspaceId }) : null;
}
export function sessionAuthority(key: RequestKey | null, chatId: string, operation: ExecutionOperation, turnId?: string) {
  return getHome()?.kind === 'team' ? authorizeTeamExecution(key, { operation, chatId, turnId }) : null;
}
export function executionCatalogAuthority(key: RequestKey | null) {
  return getHome()?.kind === 'team' ? authorizeTeamExecution(key, { operation: 'readCatalog' }) : null;
}
export function executionAuthority(key: RequestKey | null, executionId: string, operation: ExecutionOperation) {
  if (getHome()?.kind !== 'team') return null;
  const execution = getExecution(executionId);
  if (!execution) throw new TeamError('not_found', 'That execution is gone.');
  const sharedChat = listChatSessions({ executionId, includeInternal: true }).find(chat => getTeamChat(chat.id));
  if (!sharedChat) throw new TeamError('not_allowed', 'Only shared Team executions are available.');
  const authority = authorizeTeamExecution(key, { chatId: sharedChat.id, workspaceId: execution.workspaceId, operation });
  const placement = placementOf(executionId);
  if (placement && placement.deviceId !== getHome()?.hostDeviceId) throw new TeamError('not_allowed', 'This execution does not run on this team server.');
  return authority;
}
/** Catalog projections reuse the same per-chat policy as direct resource reads. */
export function executionCatalogFilter(key: RequestKey | null) {
  const authority = executionCatalogAuthority(key);
  return (row: { id: string }) => {
    if (!authority) return true;
    try { sessionAuthority(key, row.id, 'read'); return true; }
    catch (error) { if (!isTeamError(error)) throw error; return false; }
  };
}
/** Aggregate execution views use the same resource policy as direct reads. */
export function executionResourceFilter(key: RequestKey | null, operation: ExecutionOperation = 'read') {
  const authority = executionCatalogAuthority(key);
  return (executionId: string) => {
    if (!authority) return true;
    try { executionAuthority(key, executionId, operation); return true; }
    catch (error) { if (!isTeamError(error)) throw error; return false; }
  };
}
/** Resource operations resolve their authority before considering a local filesystem fallback. */
export function executionResourcePolicy(input: ExecutionAuthorityInput) {
  if (getHome()?.kind !== 'team') return { authority: null, refusal: null };
  try { return { authority: authorizeTeamExecution(executionRequestKey(), input), refusal: null }; }
  catch (error) {
    if (!isTeamError(error)) throw error;
    return { authority: null, refusal: { status: error.code === 'not_found' ? 404 : 403, body: { error: error.code, message: error.message } } };
  }
}
export function executionOperationFailure(error: unknown) {
  if (error instanceof HarnessSelectionError) return reply({ error: error.code, message: error.message }, { status: error.code === 'invalid_params' ? 400 : 409 });
  if (error instanceof LifecycleConflictError) return reply({ error: error.code, message: error.message }, { status: 409 });
  if (isTeamBoundaryError(error)) return reply({ error: error.code, message: error.message }, { status: 403 });
  if (isTeamChatError(error)) return reply({ error: error.code, message: error.message }, { status: error.code === 'not_found' ? 404 : error.code === 'conflict' ? 409 : error.code === 'unavailable' ? 412 : 400 });
  return isTeamError(error) ? reply({ error: error.code, message: error.message }, {
    status: error.code === 'not_allowed' ? 403 : error.code === 'not_found' ? 404 : error.code === 'conflict' ? 409 : 400,
  }) : null;
}
