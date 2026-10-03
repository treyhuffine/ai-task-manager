/**
 * An execution's files, read and changed by the device it runs on
 * (docs/homes-build.md, P2.4 and P3.5). The home asks that device's
 * worker, which reads or changes the worktree it prepared: the home never
 * looks for another device's folder on its own disk, where the same path
 * could name a different folder. A device that isn't connected is said to
 * be, plainly, and a change it may or may not have made is said to be
 * unconfirmed rather than retried.
 */

import { chatPlacement, getChatSessionWithExecution, getDevice, getWorkspace } from '@/lib/db/queries';
import { requestWorker, WorkerRequestError, WorkerUnavailableError } from '@/lib/workers/hub';
import type { ReadExecutionRequest, WriteExecutionRequest } from '@/lib/workers/protocol';
import type { ExecutionRead, ReadAnswer } from '@/lib/workspaces/execution-reads';
import type { ExecutionWrite } from '@/lib/workspaces/execution-writes';
import { existsSync } from 'node:fs';

/** The read answered by the execution's device, or null when it runs here and the route answers itself. */
export async function readOnOwner(chatSessionId: string, read: ExecutionRead): Promise<Response | null> {
  const placement = chatPlacement(chatSessionId);
  if (!placement || placement.isHome || !placement.executionId) return null;
  const answer = await askOwner(placement.deviceId, placement.executionId, chatSessionId, read);
  return Response.json(answer.body, { status: answer.status });
}

/** The same, as data, for callers that combine several. */
export async function readAnswerOnOwner(chatSessionId: string, read: ExecutionRead): Promise<ReadAnswer | null> {
  const placement = chatPlacement(chatSessionId);
  if (!placement || placement.isHome || !placement.executionId) return null;
  return askOwner(placement.deviceId, placement.executionId, chatSessionId, read);
}

async function askOwner(deviceId: string, executionId: string, chatSessionId: string, read: ExecutionRead): Promise<ReadAnswer> {
  const session = getChatSessionWithExecution(chatSessionId);
  const ws = session?.workspaceId ? getWorkspace(session.workspaceId) : null;
  if (!session || !ws) return { status: 404, body: { error: 'Session not found' } };
  const request: ReadExecutionRequest = {
    executionId,
    workspace: { id: ws.id, isGit: ws.isGit, baseBranch: ws.baseBranch, remoteName: ws.remoteName, filesToCopy: ws.filesToCopy ?? [] },
    baseSha: session.baseSha,
    read,
  };
  const name = getDevice(deviceId)?.name ?? 'Its device';
  try {
    return (await requestWorker(deviceId, 'read_execution', request)) as ReadAnswer;
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
 * The change made by the execution's device, or null when it runs here and
 * the route makes it itself. Refused while that device is away: a file
 * edit is live work, not something to queue for later.
 */
export async function writeAnswerOnOwner(chatSessionId: string, write: ExecutionWrite) {
  const placement = chatPlacement(chatSessionId);
  if (!placement || placement.isHome || !placement.executionId) return null;
  const session = getChatSessionWithExecution(chatSessionId);
  const ws = session?.workspaceId ? getWorkspace(session.workspaceId) : null;
  if (!session || !ws) return ({ body: { error: 'Session not found' }, status: ({ status: 404 }).status ?? 200 });
  const name = getDevice(placement.deviceId)?.name ?? 'Its device';
  const request: WriteExecutionRequest = {
    executionId: placement.executionId,
    generation: placement.generation ?? 0,
    workspace: { id: ws.id, isGit: ws.isGit, baseBranch: ws.baseBranch, remoteName: ws.remoteName, filesToCopy: ws.filesToCopy ?? [] },
    baseSha: session.baseSha,
    write,
  };
  try {
    const answer = (await requestWorker(placement.deviceId, 'write_execution', request)) as ReadAnswer;
    return ({ body: answer.body, status: ({ status: answer.status }).status ?? 200 });
  } catch (err) {
    if (err instanceof WorkerUnavailableError) {
      return ({ body: { error: 'unavailable', message: `${name} is not connected right now, so the change wasn't made.` }, status: ({ status: 409 }).status ?? 200 });
    }
    if (err instanceof WorkerRequestError) {
      // It may have been made: a timeout doesn't say. Not a 5xx, which
      // clients read as the home being unreachable.
      const message = err.unsupported
        ? `${name} runs an older Ri that can't change files from here. Update Ri there.`
        : `${name} didn't confirm the change. Check the file before trying again. (${err.message})`;
      return ({ body: { error: 'unconfirmed', message }, status: ({ status: 424 }).status ?? 200 });
    }
    throw err;
  }
}

/**
 * The execution's diff against its base, from wherever its worktree is
 * (P4.5): the commit, PR and conflict helpers build their prompt from it.
 */
export async function executionDiff(chatSessionId: string): Promise<{ ok: true; diff: unknown } | { ok: false; response: Response }> {
  const remote = await readAnswerOnOwner(chatSessionId, { kind: 'diff', file: null });
  if (remote) {
    if (remote.status !== 200 || !remote.body) {
      return { ok: false, response: Response.json(remote.body ?? { error: 'Worktree unavailable' }, { status: remote.status === 200 ? 404 : remote.status }) };
    }
    return { ok: true, diff: remote.body };
  }
  const session = getChatSessionWithExecution(chatSessionId);
  const ws = session?.workspaceId ? getWorkspace(session.workspaceId) : null;
  if (!session || !ws) return { ok: false, response: Response.json({ error: 'Session not found' }, { status: 404 }) };
  const { openWorktreeHandle } = await import('@/lib/workspaces');
  const handle = await openWorktreeHandle(session, ws);
  if (!handle || handle.kind !== 'git') return { ok: false, response: Response.json({ error: 'Worktree unavailable' }, { status: 404 }) };
  return { ok: true, diff: await handle.git.diff('base') };
}

/** The execution's folder wherever it runs (P4.5): the worktree here, or the one its device prepared. */
export function executionFolder(chatSessionId: string): string | null {
  const placement = chatPlacement(chatSessionId);
  if (placement && !placement.isHome) return placement.worktreePath;
  // Here, only a worktree that's still on disk.
  const here = getChatSessionWithExecution(chatSessionId)?.worktreePath ?? null;
  return here && existsSync(here) ? here : null;
}

/** Compatibility HTTP adapter. UI procedures consume the answer as data. */
export async function writeOnOwner(chatSessionId: string, write: ExecutionWrite) {
 const answer = await writeAnswerOnOwner(chatSessionId, write);
 return answer ? Response.json(answer.body, { status: answer.status }) : null;
}
