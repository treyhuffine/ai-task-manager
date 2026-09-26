import type { NextRequest } from 'next/server';
import { getChatSessionWithExecution, getComputerForApiKey, getWorkspace } from '@/lib/db/queries';
import { getRequestKey } from '@/lib/auth/request-key';
import { openOnViewerComputer } from '@/lib/open/on-viewer';

/**
 * Open this computer's review checkout of the execution (P4.1) in an app,
 * through this computer's worker, for a browser linked to it. The home's own
 * browser opens its review through `/api/fs/open`, as it opens anything.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getChatSessionWithExecution(id);
  const workspace = session?.workspaceId ? getWorkspace(session.workspaceId) : null;
  if (!session?.executionId || !workspace) return Response.json({ error: 'Session not found' }, { status: 404 });
  const key = getRequestKey(request.headers);
  const viewer = key?.scope === 'viewer' ? getComputerForApiKey(key.apiKeyId) : null;
  if (!viewer) {
    return Response.json({ error: 'not_here', message: 'Open the review from a browser on the computer that has it.' }, { status: 403 });
  }
  return openOnViewerComputer(request, {
    at: 'elsewhere',
    computerId: viewer.id,
    computerName: viewer.name,
    folder: { kind: 'review', executionId: session.executionId, workspaceSlug: workspace.slug },
  });
}
