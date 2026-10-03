import { answerResult, failure, operationResponse } from '@/lib/server/operation';
import { installedAppsResponseSchema, openInResultSchema } from '@/lib/server/remote-contracts';
import { z } from 'zod/v4';
/**
 * Opening an execution's or an agent's folder in an app on the viewer's own
 * device (docs/homes-build.md, P3.5, spec §3.3). The files are on the
 * device the work runs on, and an app can only open them there, so this
 * works for a browser linked to that device ("This Mac", P2.2), through
 * that device's worker. A browser anywhere else is told where the files
 * are. Files at home open through `/api/fs/open` from the home's own
 * browser, as before.
 */

import { getRequestKey } from '@/lib/auth/request-key';
import { chatPlacement, getDevice, getDeviceForApiKey, getWorkspace } from '@/lib/db/queries';
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
async function askOpen<T>(request: Pick<Request, 'headers'>, place: OpenPlace, body: unknown, schema: z.ZodType<T>) {
  if (place.at === 'nowhere') return failure({ error: place.error }, place.status);
  if (place.at === 'home') {
    return failure(
      { error: 'at_home', message: 'These files are on this home. Open them from a browser on it.' },
      409,
    );
  }
  // Only a browser on that device: its viewing key, linked to it.
  const key = getRequestKey(request.headers);
  const viewerDevice = key?.scope === 'viewer' ? getDeviceForApiKey(key.apiKeyId) : null;
  if (!viewerDevice || viewerDevice.id !== place.deviceId) {
    return failure(
      { error: 'not_here', message: `The files are on ${place.deviceName}. Open them from a browser on ${place.deviceName}.` },
      409,
    );
  }

  const parsedBody = body as { op?: unknown; path?: unknown; target?: unknown; line?: unknown; column?: unknown; reveal?: unknown } | null;
  let ask: OpenHereRequest;
  if (parsedBody?.op === 'apps') ask = { op: 'apps' };
  else if (parsedBody?.op === 'open' && typeof parsedBody.target === 'string' && TARGETS.has(parsedBody.target)) {
    ask = {
      op: 'open',
      folder: place.folder,
      path: typeof parsedBody.path === 'string' && parsedBody.path ? parsedBody.path : null,
      target: parsedBody.target as Extract<OpenHereRequest, { op: 'open' }>['target'],
      ...(Number.isInteger(parsedBody.line) ? { line: parsedBody.line as number } : {}),
      ...(Number.isInteger(parsedBody.column) ? { column: parsedBody.column as number } : {}),
      ...(parsedBody.reveal === true ? { reveal: true } : {}),
    };
  } else {
    return failure({ error: 'invalid_params', message: 'Ask for { op: "apps" } or { op: "open", target }.' }, 400);
  }

  try {
    const answer = (await requestWorker(place.deviceId, 'open_here', ask)) as { status: number; body: unknown };
    return answerResult(answer, schema);
  } catch (err) {
    if (err instanceof WorkerUnavailableError) {
      return failure({ error: 'unavailable', message: `${place.deviceName} is not connected right now.` }, 409);
    }
    if (err instanceof WorkerRequestError) {
      const message = err.unsupported ? `${place.deviceName} runs an older Ri that can't open apps from here. Update Ri there.` : err.message;
      return failure({ error: 'worker_error', message }, 424);
    }
    throw err;
  }
}

export const openInputSchema = z.object({
  path: z.string().nullable().optional(), target: z.enum(['finder','terminal','iterm','vscode','cursor','antigravity','zed','sublime','webstorm']),
  line: z.number().int().positive().optional(), column: z.number().int().positive().optional(), reveal: z.boolean().optional(),
}).strict();
export function openAppsOnViewer(request: Pick<Request, 'headers'>, place: OpenPlace) { return askOpen(request, place, { op: 'apps' }, installedAppsResponseSchema); }
export function openOnViewer(request: Pick<Request, 'headers'>, place: OpenPlace, body: z.infer<typeof openInputSchema>) {
  return askOpen(request, place, { ...body, op: 'open' }, openInResultSchema);
}
export async function openOnViewerDevice(request: Request, place: OpenPlace): Promise<Response> {
  const body: unknown = await request.json().catch(() => null);
  if (body && typeof body === 'object' && 'op' in body && body.op === 'apps') return operationResponse(await openAppsOnViewer(request, place));
  const parsed = openInputSchema.safeParse(body && typeof body === 'object' ? Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'op')) : body);
  if (!parsed.success || !body || typeof body !== 'object' || !('op' in body) || body.op !== 'open') return operationResponse(failure({ error: 'invalid_params', message: 'Ask for { op: "apps" } or { op: "open", target }.' }, 400));
  return operationResponse(await openOnViewer(request, place, parsed.data));
}
