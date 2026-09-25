/**
 * An execution's reads (tree, file, diff, status, diff stats, work in
 * progress), answered by the computer it runs on (docs/homes-build.md,
 * P2.4). The home asks that computer's worker, which reads the worktree it
 * prepared: the home never looks for another computer's folder on its own
 * disk. A computer that isn't connected is said to be, plainly.
 */

import { chatPlacement, getChatSessionWithExecution, getComputer, getWorkspace } from '@/lib/db/queries';
import { requestWorker, WorkerRequestError, WorkerUnavailableError } from '@/lib/workers/hub';
import type { ReadExecutionRequest } from '@/lib/workers/protocol';
import type { ExecutionRead, ReadAnswer } from '@/lib/workspaces/execution-reads';

/** The read answered by the execution's computer, or null when it runs here and the route answers itself. */
export async function readOnOwner(chatSessionId: string, read: ExecutionRead): Promise<Response | null> {
  const placement = chatPlacement(chatSessionId);
  if (!placement || placement.isHome || !placement.executionId) return null;
  const answer = await askOwner(placement.computerId, placement.executionId, chatSessionId, read);
  return Response.json(answer.body, { status: answer.status });
}

/** The same, as data, for callers that combine several. */
export async function readAnswerOnOwner(chatSessionId: string, read: ExecutionRead): Promise<ReadAnswer | null> {
  const placement = chatPlacement(chatSessionId);
  if (!placement || placement.isHome || !placement.executionId) return null;
  return askOwner(placement.computerId, placement.executionId, chatSessionId, read);
}

async function askOwner(computerId: string, executionId: string, chatSessionId: string, read: ExecutionRead): Promise<ReadAnswer> {
  const session = getChatSessionWithExecution(chatSessionId);
  const ws = session?.workspaceId ? getWorkspace(session.workspaceId) : null;
  if (!session || !ws) return { status: 404, body: { error: 'Session not found' } };
  const request: ReadExecutionRequest = {
    executionId,
    workspace: { id: ws.id, isGit: ws.isGit, baseBranch: ws.baseBranch, filesToCopy: ws.filesToCopy ?? [] },
    baseSha: session.baseSha,
    read,
  };
  const name = getComputer(computerId)?.name ?? 'Its computer';
  try {
    return (await requestWorker(computerId, 'read_execution', request)) as ReadAnswer;
  } catch (err) {
    if (err instanceof WorkerUnavailableError) {
      return { status: 409, body: { error: 'unavailable', message: `${name} is not connected right now.` } };
    }
    // Not a 5xx: clients read gateway statuses as the home being unreachable.
    if (err instanceof WorkerRequestError) return { status: 424, body: { error: 'worker_error', message: err.message } };
    throw err;
  }
}
