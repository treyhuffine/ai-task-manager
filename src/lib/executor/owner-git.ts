/**
 * Git and GitHub for an execution, where its code is (docs/homes-spec.md
 * §5.3, P4.5). Its worktree is on the device it runs on, so a push or
 * bringing in the base branch happens there, as a `git` command that
 * device carries out in order with the rest of the execution's work.
 * GitHub needs only a clone of the repository: the agent's folder here, or
 * for an agent that lives only on another device, its folder there.
 */

import fs from 'node:fs';
import { chatPlacement, getChatSessionWithExecution, getDevice, getWorkspace, queueWorkerCommand } from '@/lib/db/queries';
import { agentDeviceFor } from '@/lib/setups/run-on';
import { requestWorker, wakeDevice, WorkerRequestError, WorkerUnavailableError } from '@/lib/workers/hub';
import { awaitWorkerCommand, CommandFailedError } from '@/lib/workers/await-command';
import { runGithub, type GithubRequest } from '@/lib/github/execution-github';
import type { GitPayload } from '@/lib/worker/handlers';
import type { WorkerCommandActor } from '@/db/types';

/** GitHub for the execution's branch: in the agent's folder here, or on the device the agent lives on. */
export async function githubOnOwner(sessionId: string, request: GithubRequest): Promise<Response> {
  const session = getChatSessionWithExecution(sessionId);
  const ws = session?.workspaceId ? getWorkspace(session.workspaceId) : null;
  if (!session || !ws) return Response.json({ error: 'Session not found' }, { status: 404 });
  if (fs.existsSync(ws.cwd)) {
    const answer = await runGithub(ws.cwd, request);
    return Response.json(answer.body, { status: answer.status });
  }
  const deviceId = agentDeviceFor(ws.id) ?? chatPlacement(sessionId)?.deviceId ?? null;
  const name = deviceId ? getDevice(deviceId)?.name ?? 'its device' : 'its device';
  if (!deviceId) return Response.json({ error: 'not_set_up', message: `${ws.name} has no folder to reach GitHub from.` }, { status: 409 });
  try {
    const answer = (await requestWorker(deviceId, 'github', { workspaceId: ws.id, request }, 60_000)) as { status: number; body: unknown };
    return Response.json(answer.body, { status: answer.status });
  } catch (err) {
    if (err instanceof WorkerUnavailableError) {
      // The pull request chip says nothing rather than fail while it's away.
      if (request.op === 'pr') return Response.json({ pr: null, unavailable: `${name} is not connected right now.` });
      return Response.json({ error: 'unavailable', message: `${name} is not connected right now.` }, { status: 409 });
    }
    if (err instanceof WorkerRequestError) return Response.json({ error: 'worker_error', message: err.message }, { status: 424 });
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
