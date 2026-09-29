/**
 * Opening an execution's or an agent's folder in an app on the viewer's own
 * device (docs/homes-build.md, P3.5, spec §3.3). The files are on the
 * device the work runs on, and an app can only open them there, so this
 * works for a browser linked to that device ("This Mac", P2.2), through
 * that device's worker. A browser anywhere else is told where the files
 * are. Files at home open through `/api/fs/open` from the home's own
 * browser, as before.
 */

import { chatPlacement, getDevice, getDeviceForApiKey, getWorkspace } from '@/lib/db/queries';
import { getRequestKey } from '@/lib/auth/request-key';
import { agentDeviceFor } from '@/lib/setups/run-on';
import { requestWorker, WorkerRequestError, WorkerUnavailableError } from '@/lib/workers/hub';
import type { OpenHereRequest } from '@/lib/workers/protocol';

type Folder = Extract<OpenHereRequest, { op: 'open' }>['folder'];

export type OpenPlace =
  | { at: 'elsewhere'; deviceId: string; deviceName: string; folder: Folder }
  | { at: 'home' }
  | { at: 'nowhere'; error: string; status: number };

export function sessionOpenPlace(sessionId: string): OpenPlace {
  const placement = chatPlacement(sessionId);
  if (!placement) return { at: 'nowhere', error: 'Session not found', status: 404 };
  if (placement.isHome) return { at: 'home' };
  if (!placement.executionId) return { at: 'nowhere', error: 'Only an execution has a folder to open.', status: 409 };
  return {
    at: 'elsewhere',
    deviceId: placement.deviceId,
    deviceName: getDevice(placement.deviceId)?.name ?? 'its device',
    folder: { kind: 'execution', executionId: placement.executionId, generation: placement.generation ?? 0 },
  };
}

export function agentOpenPlace(workspaceId: string): OpenPlace {
  if (!getWorkspace(workspaceId)) return { at: 'nowhere', error: 'Workspace not found', status: 404 };
  const deviceId = agentDeviceFor(workspaceId);
  if (!deviceId) return { at: 'home' };
  return {
    at: 'elsewhere',
    deviceId,
    deviceName: getDevice(deviceId)?.name ?? 'its device',
    folder: { kind: 'agent', agentId: workspaceId },
  };
}

const TARGETS = new Set(['finder', 'terminal', 'iterm', 'vscode', 'cursor', 'antigravity', 'zed', 'sublime', 'webstorm']);

/**
 * `{ op: 'apps' }` lists the apps installed there. `{ op: 'open', path,
 * target, line?, column?, reveal? }` opens a path inside the folder.
 */
export async function openOnViewerDevice(request: Request, place: OpenPlace): Promise<Response> {
  if (place.at === 'nowhere') return Response.json({ error: place.error }, { status: place.status });
  if (place.at === 'home') {
    return Response.json(
      { error: 'at_home', message: 'These files are on this home. Open them from a browser on it.' },
      { status: 409 },
    );
  }
  // Only a browser on that device: its viewing key, linked to it.
  const key = getRequestKey(request.headers);
  const viewerDevice = key?.scope === 'viewer' ? getDeviceForApiKey(key.apiKeyId) : null;
  if (!viewerDevice || viewerDevice.id !== place.deviceId) {
    return Response.json(
      { error: 'not_here', message: `The files are on ${place.deviceName}. Open them from a browser on ${place.deviceName}.` },
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
    const answer = (await requestWorker(place.deviceId, 'open_here', ask)) as { status: number; body: unknown };
    return Response.json(answer.body, { status: answer.status });
  } catch (err) {
    if (err instanceof WorkerUnavailableError) {
      return Response.json({ error: 'unavailable', message: `${place.deviceName} is not connected right now.` }, { status: 409 });
    }
    if (err instanceof WorkerRequestError) {
      const message = err.unsupported ? `${place.deviceName} runs an older Ri that can't open apps from here. Update Ri there.` : err.message;
      return Response.json({ error: 'worker_error', message }, { status: 424 });
    }
    throw err;
  }
}
