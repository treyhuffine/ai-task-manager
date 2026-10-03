import { getRequestKey } from '@/lib/auth/request-key';
import { getChatSessionWithExecution, getDeviceForApiKey, getWorkspace } from '@/lib/db/queries';
import { openInputSchema, openOnViewer } from '@/lib/open/on-viewer';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * Open this device's review checkout of the execution (P4.1) in an app,
 * through this device's worker, for a browser linked to it. The home's own
 * browser opens its review through `/api/fs/open`, as it opens anything.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  const { id } = rpcInput.params;
  const session = getChatSessionWithExecution(id);
  const workspace = session?.workspaceId ? getWorkspace(session.workspaceId) : null;
  if (!session?.executionId || !workspace) return reply({ error: 'Session not found' }, { status: 404 });
  const key = getRequestKey(request.headers);
  const viewer = key?.scope === 'viewer' ? getDeviceForApiKey(key.apiKeyId) : null;
  if (!viewer) {
    return reply({ error: 'not_here', message: 'Open the review from a browser on the device that has it.' }, { status: 403 });
  }
  return openOnViewer(request, {
    at: 'elsewhere',
    deviceId: viewer.id,
    deviceName: viewer.name,
    folder: { kind: 'review', executionId: session.executionId, workspaceSlug: workspace.slug },
  }, rpcInput.body);
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: openInputSchema }).strict();
