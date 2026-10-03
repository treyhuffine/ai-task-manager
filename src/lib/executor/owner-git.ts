/**
 * Git and GitHub for an execution, where its code is (docs/homes-spec.md
 * §5.3, P4.5). Its worktree is on the device it runs on, so a push or
 * bringing in the base branch happens there, as a `git` command that
 * device carries out in order with the rest of the execution's work.
 * GitHub needs only a clone of the repository: the agent's folder here, or
 * for an agent that lives only on another device, its folder there.
 */

import type { WorkerCommandActor } from '@/db/types';
import { chatPlacement, getChatSessionWithExecution, getDevice, getWorkspace, queueWorkerCommand } from '@/lib/db/queries';
import { runGithub, type GithubRequest } from '@/lib/github/execution-github';
import { agentDeviceFor } from '@/lib/setups/run-on';
import type { GitPayload } from '@/lib/worker/handlers';
import { awaitWorkerCommand, CommandFailedError } from '@/lib/workers/await-command';
import { requestWorker, wakeDevice, WorkerRequestError, WorkerUnavailableError } from '@/lib/workers/hub';
import fs from 'node:fs';

/** GitHub for the execution's branch: in the agent's folder here, or on the device the agent lives on. */
export async function githubAnswerOnOwner(sessionId: string, request: GithubRequest) {
  const session = getChatSessionWithExecution(sessionId);
  const ws = session?.workspaceId ? getWorkspace(session.workspaceId) : null;
  if (!session || !ws) return ({ body: { error: 'Session not found' }, status: ({ status: 404 }).status ?? 200 });
  if (fs.existsSync(ws.cwd)) {
    const answer = await runGithub(ws.cwd, request);
    return ({ body: answer.body, status: ({ status: answer.status }).status ?? 200 });
  }
  const deviceId = agentDeviceFor(ws.id) ?? chatPlacement(sessionId)?.deviceId ?? null;
  const name = deviceId ? getDevice(deviceId)?.name ?? 'its device' : 'its device';
  if (!deviceId) return ({ body: { error: 'not_set_up', message: `${ws.name} has no folder to reach GitHub from.` }, status: ({ status: 409 }).status ?? 200 });
  try {
    const answer = (await requestWorker(deviceId, 'github', { workspaceId: ws.id, request }, 60_000)) as { status: number; body: unknown };
    return ({ body: answer.body, status: ({ status: answer.status }).status ?? 200 });
  } catch (err) {
    if (err instanceof WorkerUnavailableError) {
      // The pull request chip says nothing rather than fail while it's away.
      if (request.op === 'pr') return ({ body: { pr: null, unavailable: `${name} is not connected right now.` }, status: ({ status: 200 }).status ?? 200 });
      return ({ body: { error: 'unavailable', message: `${name} is not connected right now.` }, status: ({ status: 409 }).status ?? 200 });
    }
    if (err instanceof WorkerRequestError) return ({ body: { error: 'worker_error', message: err.message }, status: ({ status: 424 }).status ?? 200 });
    throw err;
  }
}

/**
 * A Git operation on the execution's worktree, on the device it runs on,
 * waited for. Null when it runs here and the route does it itself. Routes
 * run it admitted (`whileAdmitted`), so never under a move.
 */
export async function gitOnOwner(
  sessionId: string,
  payload: GitPayload,
  opts: { timeoutMs: number; what: string; actor?: WorkerCommandActor },
): Promise<{ ok: true; result: unknown } | { ok: false; response: Response } | null> {
  const placement = chatPlacement(sessionId);
  if (!placement || placement.isHome || !placement.executionId) return null;
  const name = getDevice(placement.deviceId)?.name ?? 'its device';
  const command = queueWorkerCommand({
    deviceId: placement.deviceId,
    kind: 'git',
    payload,
    actor: opts.actor ?? { source: 'human' },
    executionId: placement.executionId,
    chatSessionId: sessionId,
    generation: placement.generation,
  });
  wakeDevice(placement.deviceId);
  try {
    return { ok: true, result: await awaitWorkerCommand(command.id, opts.timeoutMs, `${opts.what} on ${name}`) };
  } catch (err) {
    if (!(err instanceof CommandFailedError)) throw err;
    const code = (err.result as { code?: string } | null)?.code ?? 'failed';
    return { ok: false, response: Response.json({ error: code, message: err.message }, { status: 409 }) };
  }
}

/** Compatibility HTTP adapter. UI procedures consume the answer as data. */
export async function githubOnOwner(sessionId: string, request: GithubRequest) {
 const answer = await githubAnswerOnOwner(sessionId, request);
 return Response.json(answer.body, { status: answer.status });
}
