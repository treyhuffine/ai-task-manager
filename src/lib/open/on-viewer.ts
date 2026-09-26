/**
 * Opening an execution's or an agent's folder in an app on the viewer's own
 * computer (docs/homes-build.md, P3.5, spec §3.3). The files are on the
 * computer the work runs on, and an app can only open them there, so this
 * works for a browser linked to that computer ("This Mac", P2.2), through
 * that computer's worker. A browser anywhere else is told where the files
 * are. Files at home open through `/api/fs/open` from the home's own
 * browser, as before.
 */

import { chatPlacement, getComputer, getComputerForApiKey, getWorkspace } from '@/lib/db/queries';
import { getRequestKey } from '@/lib/auth/request-key';
import { agentComputerFor } from '@/lib/setups/run-on';
import { requestWorker, WorkerRequestError, WorkerUnavailableError } from '@/lib/workers/hub';
import type { OpenHereRequest } from '@/lib/workers/protocol';

type Folder = Extract<OpenHereRequest, { op: 'open' }>['folder'];

export type OpenPlace =
  | { at: 'elsewhere'; computerId: string; computerName: string; folder: Folder }
  | { at: 'home' }
  | { at: 'nowhere'; error: string; status: number };

export function sessionOpenPlace(sessionId: string): OpenPlace {
  const placement = chatPlacement(sessionId);
  if (!placement) return { at: 'nowhere', error: 'Session not found', status: 404 };
  if (placement.isHome) return { at: 'home' };
  if (!placement.executionId) return { at: 'nowhere', error: 'Only an execution has a folder to open.', status: 409 };
  return {
    at: 'elsewhere',
    computerId: placement.computerId,
    computerName: getComputer(placement.computerId)?.name ?? 'its computer',
    folder: { kind: 'execution', executionId: placement.executionId, generation: placement.generation ?? 0 },
  };
}

export function agentOpenPlace(workspaceId: string): OpenPlace {
  if (!getWorkspace(workspaceId)) return { at: 'nowhere', error: 'Workspace not found', status: 404 };
  const computerId = agentComputerFor(workspaceId);
  if (!computerId) return { at: 'home' };
  return {
    at: 'elsewhere',
    computerId,
    computerName: getComputer(computerId)?.name ?? 'its computer',
    folder: { kind: 'agent', agentId: workspaceId },
  };
}

const TARGETS = new Set(['finder', 'terminal', 'iterm', 'vscode', 'cursor', 'antigravity', 'zed', 'sublime', 'webstorm']);

/**
 * `{ op: 'apps' }` lists the apps installed there. `{ op: 'open', path,
 * target, line?, column?, reveal? }` opens a path inside the folder.
 */
export async function openOnViewerComputer(request: Request, place: OpenPlace): Promise<Response> {
  if (place.at === 'nowhere') return Response.json({ error: place.error }, { status: place.status });
  if (place.at === 'home') {
    return Response.json(
      { error: 'at_home', message: 'These files are on this home. Open them from a browser on it.' },
      { status: 409 },
    );
  }
  // Only a browser on that computer: its viewing key, linked to it.
  const key = getRequestKey(request.headers);
  const viewerComputer = key?.scope === 'viewer' ? getComputerForApiKey(key.apiKeyId) : null;
  if (!viewerComputer || viewerComputer.id !== place.computerId) {
    return Response.json(
      { error: 'not_here', message: `The files are on ${place.computerName}. Open them from a browser on ${place.computerName}.` },
      { status: 409 },
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { op?: unknown; path?: unknown; target?: unknown; line?: unknown; column?: unknown; reveal?: unknown }
    | null;
  let ask: OpenHereRequest;
  if (body?.op === 'apps') ask = { op: 'apps' };
  else if (body?.op === 'open' && typeof body.target === 'string' && TARGETS.has(body.target)) {
    ask = {
      op: 'open',
      folder: place.folder,
      path: typeof body.path === 'string' && body.path ? body.path : null,
      target: body.target as Extract<OpenHereRequest, { op: 'open' }>['target'],
      ...(Number.isInteger(body.line) ? { line: body.line as number } : {}),
      ...(Number.isInteger(body.column) ? { column: body.column as number } : {}),
      ...(body.reveal === true ? { reveal: true } : {}),
    };
  } else {
    return Response.json({ error: 'invalid_params', message: 'Ask for { op: "apps" } or { op: "open", target }.' }, { status: 400 });
  }

  try {
    const answer = (await requestWorker(place.computerId, 'open_here', ask)) as { status: number; body: unknown };
    return Response.json(answer.body, { status: answer.status });
  } catch (err) {
    if (err instanceof WorkerUnavailableError) {
      return Response.json({ error: 'unavailable', message: `${place.computerName} is not connected right now.` }, { status: 409 });
    }
    if (err instanceof WorkerRequestError) {
      const message = err.unsupported ? `${place.computerName} runs an older Ri that can't open apps from here. Update Ri there.` : err.message;
      return Response.json({ error: 'worker_error', message }, { status: 424 });
    }
    throw err;
  }
}
