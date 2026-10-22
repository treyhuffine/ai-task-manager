import * as q from '@/lib/db/queries';
import { ActionError } from '@/lib/orchestrator/types';
import { serverFetch, ServerResponseError } from '@/lib/orchestrator/server-client';
import { SESSION_CREDENTIAL_HEADER, sessionCredential } from '@/lib/orchestrator/session-credential';
import { assertSupportedPermissionMode, UnsupportedPermissionModeError } from '@/lib/executor/permission-map';
import { requestScopedId } from './start-id';

/** Server-owned launch primitive. Its durable request controls admission throughout launch. */
export async function startDelegatedExecution(requestId: string, prompt: string) {
  const request = q.getAgentRequest(requestId);
  if (!request || request.kind !== 'delegation' || !request.options) throw new ActionError('invalid_params', 'A durable delegation is required to start work.');
  const assertOpen = () => {
    const current = q.getAgentRequest(requestId);
    if (!current || !['queued', 'sent'].includes(current.status)) throw new ActionError('conflict', 'This assignment has ended. Its work will not be started.');
  };
  assertOpen();
  const input = { ...request.options, requestId, prompt };
  const credential = sessionCredential(request.sourceSessionId);
  if (!credential) throw new ActionError('unsupported', 'The requesting chat no longer has a valid credential.');
  const headers = { [SESSION_CREDENTIAL_HEADER]: credential };
  const workspace = q.getWorkspace(input.workspaceId);
  if (!workspace) throw new ActionError('not_found', `Workspace not found: ${input.workspaceId}`);
  if (workspace.status === 'archived') {
    throw new ActionError('conflict', `Workspace "${workspace.name}" is archived. Restore it before starting work there.`);
  }
  const sessionId = requestScopedId('session', workspace.id, input.requestId);
  const eventId = requestScopedId('prompt', workspace.id, input.requestId);
  const existing = q.getChatSession(sessionId);
  if (input.permissionMode) {
    try {
      assertSupportedPermissionMode(input.permissionMode, existing?.harness ?? input.provider ?? q.defaultTriggerHarness());
    } catch (err) {
      if (err instanceof UnsupportedPermissionModeError) throw new ActionError('invalid_params', err.message);
      throw err;
    }
  }

  // 1. The execution and its chat. The route is idempotent on sessionId, so
  //    a retry converges on the execution the first attempt created.
  let created: { id: string; executionId: string | null };
  try {
    created = existing
      ? { id: existing.id, executionId: existing.executionId ?? null }
      : await serverFetch<{ id: string; executionId: string | null }>(`/workspaces/${workspace.id}/sessions`, {
          method: 'POST',
          // Started by the calling chat, when a chat is calling (P2.6).
          headers,
          body: JSON.stringify({
            sessionId,
            ...(input.label ? { label: input.label } : {}),
            ...(input.provider ? { harness: input.provider } : {}),
            ...(input.model ? { model: input.model } : {}),
            ...(input.effort ? { effort: input.effort } : {}),
            ...(input.serviceTier ? { serviceTier: input.serviceTier } : {}),
            ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
            ...(input.taskId ? { taskId: input.taskId } : {}),
            ...(input.deviceId ? { deviceId: input.deviceId } : {}),
          }),
        });
  } catch (err) {
    if (err instanceof ServerResponseError && (err.status === 404 || err.status === 409 || err.status === 400)) {
      const body = err.json();
      const message = (body?.message ?? body?.error) as string | undefined;
      throw new ActionError(
        err.status === 404 ? 'not_found' : err.status === 409 ? 'conflict' : 'invalid_params',
        message ?? err.message,
      );
    }
    throw err;
  }

  // Bind even after cancellation so the prepared chat remains inspectable.
  q.updateAgentRequest(requestId, { targetSessionId: created.id });
  assertOpen();

  // A retry must not overwrite a permission choice made in the chat since launch.
  if (existing && input.permissionMode && existing.permissionMode !== input.permissionMode) {
    throw new ActionError('conflict', 'The delegated chat has a different permission mode. Inspect it before continuing.');
  }

  // The prompt, idempotent on its event id, labeled with who sent it.
  await serverFetch(`/sessions/${created.id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content: input.prompt, id: eventId }),
    headers,
  });

  return { sessionId: created.id, executionId: created.executionId ?? q.getChatSession(created.id)?.executionId ?? null, started: !existing };
}
