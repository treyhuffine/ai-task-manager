/**
 * An execution's files, read and changed by the computer it runs on
 * (docs/homes-build.md, P2.4 and P3.5). The home asks that computer's
 * worker, which reads or changes the worktree it prepared: the home never
 * looks for another computer's folder on its own disk, where the same path
 * could name a different folder. A computer that isn't connected is said to
 * be, plainly, and a change it may or may not have made is said to be
 * unconfirmed rather than retried.
 */

import { chatPlacement, getChatSessionWithExecution, getComputer, getWorkspace } from '@/lib/db/queries';
import { requestWorker, WorkerRequestError, WorkerUnavailableError } from '@/lib/workers/hub';
import type { ReadExecutionRequest, WriteExecutionRequest } from '@/lib/workers/protocol';
import type { ExecutionRead, ReadAnswer } from '@/lib/workspaces/execution-reads';
import type { ExecutionWrite } from '@/lib/workspaces/execution-writes';

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

/**
 * The change made by the execution's computer, or null when it runs here and
 * the route makes it itself. Refused while that computer is away: a file
 * edit is live work, not something to queue for later.
 */
export async function writeOnOwner(chatSessionId: string, write: ExecutionWrite): Promise<Response | null> {
  const placement = chatPlacement(chatSessionId);
  if (!placement || placement.isHome || !placement.executionId) return null;
  const session = getChatSessionWithExecution(chatSessionId);
  const ws = session?.workspaceId ? getWorkspace(session.workspaceId) : null;
  if (!session || !ws) return Response.json({ error: 'Session not found' }, { status: 404 });
  const name = getComputer(placement.computerId)?.name ?? 'Its computer';
  const request: WriteExecutionRequest = {
    executionId: placement.executionId,
    generation: placement.generation ?? 0,
    workspace: { id: ws.id, isGit: ws.isGit, baseBranch: ws.baseBranch, filesToCopy: ws.filesToCopy ?? [] },
    baseSha: session.baseSha,
    write,
  };
  try {
    const answer = (await requestWorker(placement.computerId, 'write_execution', request)) as ReadAnswer;
    return Response.json(answer.body, { status: answer.status });
  } catch (err) {
    if (err instanceof WorkerUnavailableError) {
      return Response.json(
        { error: 'unavailable', message: `${name} is not connected right now, so the change wasn't made.` },
        { status: 409 },
      );
    }
    if (err instanceof WorkerRequestError) {
      // It may have been made: a timeout doesn't say. Not a 5xx, which
      // clients read as the home being unreachable.
      const message = err.unsupported
        ? `${name} runs an older Ri that can't change files from here. Update Ri there.`
        : `${name} didn't confirm the change. Check the file before trying again. (${err.message})`;
      return Response.json({ error: 'unconfirmed', message }, { status: 424 });
    }
    throw err;
  }
}
