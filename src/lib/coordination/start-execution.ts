import * as q from '@/lib/db/queries';
import { ActionError } from '@/lib/orchestrator/types';
import { UnsupportedPermissionModeError } from '@/lib/executor/permission-map';
import { HarnessDisabledError } from '@/lib/harness/registry';
import { requestScopedId } from './start-id';

/** Approval precedes creation. The shared launcher owns ceiling and child policy. */
export async function startDelegatedExecution(requestId: string) {
  const request = q.getAgentRequest(requestId);
  const initial = q.initialAgentDelivery(requestId);
  if (!request?.options || request.kind !== 'delegation' || !initial || initial.status !== 'queued' || request.status !== 'queued' || !request.sourceSessionId) throw new ActionError('conflict', 'An approved open delegation is required.');
  const { dispatchExecutionSession, WorkspaceNotFoundForDispatch, DeviceUnavailableForDispatch, TaskNotStartableForDispatch } = await import('@/lib/sessions/dispatch');
  let session;
  try { session = await dispatchExecutionSession({ ...request.options, harness: request.options.provider, sessionId: requestScopedId('session', request.options.workspaceId, request.id), coordinationDeliveryId: initial.id, actor: { source: 'ai', sessionId: request.sourceSessionId, apiKeyId: null } }); } catch (error) {
    if (error instanceof WorkspaceNotFoundForDispatch) throw new ActionError('not_found', error.message);
    if (error instanceof TaskNotStartableForDispatch || error instanceof DeviceUnavailableForDispatch || error instanceof HarnessDisabledError) throw new ActionError('conflict', error.message);
    if (error instanceof UnsupportedPermissionModeError) throw new ActionError('invalid_params', error.message);
    throw error;
  }
  q.updateAgentRequest(request.id, { targetSessionId: session.id });
  q.updateAgentDelivery(initial.id, { targetSessionId: session.id });
  return { sessionId: session.id, executionId: session.executionId };
}
