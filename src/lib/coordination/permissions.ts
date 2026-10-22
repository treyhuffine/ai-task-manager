import type { PermissionMode, WorkerCommandActor, ChatSessionRecord } from '@/db/types';
import type { HarnessId } from '@/lib/harness/registry';
import * as q from '@/lib/db/queries';
import { assertSupportedPermissionMode, UnsupportedPermissionModeError } from '@/lib/executor/permission-map';
import { DEFAULT_PERMISSION_MODE } from '@/lib/permissions/modes';
import { requestScopedId } from './start-id';
import { ActionError } from '@/lib/orchestrator/types';

/** Authority can only decrease across an agent launch boundary. */
export function agentLaunchPermission(actor: WorkerCommandActor | undefined, requested: PermissionMode | undefined, harness: HarnessId, existing?: ChatSessionRecord | null): PermissionMode | undefined {
  if (actor?.source !== 'ai') return requested;
  const source = actor.sessionId ? q.getChatSession(actor.sessionId) : null;
  if (!source) throw new ActionError('unsupported', 'An agent launch requires its authenticated source chat.');
  const order: PermissionMode[] = ['plan', 'ask', 'auto_edits', 'auto_all'];
  const ceiling = order.indexOf(source.permissionMode);
  const result = order[Math.min(ceiling, order.indexOf(requested ?? DEFAULT_PERMISSION_MODE))];
  try { assertSupportedPermissionMode(result, harness); } catch (error) {
    if (error instanceof UnsupportedPermissionModeError) throw new ActionError('invalid_params', error.message);
    throw error;
  }
  if (existing && order.indexOf(existing.permissionMode) > order.indexOf(result)) throw new ActionError('conflict', 'This retry cannot authorize the destination’s broader tool permissions. Inspect the existing chat.');
  return result;
}

/** Direct launch endpoints cannot bypass coordination approval by omitting a prompt. */
export function assertAgentLaunchAuthorization(actor: WorkerCommandActor | undefined, input: { workspaceId: string; sessionId?: string | null; coordinationDeliveryId?: string }): void {
  if (actor?.source !== 'ai') return;
  const delivery = input.coordinationDeliveryId ? q.getAgentDelivery(input.coordinationDeliveryId) : null;
  const request = delivery?.requestId ? q.getAgentRequest(delivery.requestId) : null;
  if (!delivery || !request || request.kind !== 'delegation' || delivery.kind !== 'request' || delivery.sourceSessionId !== actor.sessionId || request.options?.workspaceId !== input.workspaceId || !['queued', 'delivered', 'accepted'].includes(delivery.status) || !q.isOpenAgentRequest(request) || input.sessionId !== requestScopedId('session', input.workspaceId, request.id)) {
    throw new ActionError('unsupported', 'Use delegate_work to reserve and authorize a new chat before creating it.');
  }
}
