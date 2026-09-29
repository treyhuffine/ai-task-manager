/**
 * The check every worker route makes (docs/homes-build.md, P2.2): the proxy
 * already let only a worker key through, and this confirms it's still its
 * device's worker key, that the device matches, and that the worker speaks this
 * home's protocol. A worker on another protocol gets 426 and stops.
 */

import type { DeviceRecord } from '@/db/types';
import { getRequestKey } from '@/lib/auth/request-key';
import { getWorkerDevice } from '@/lib/db/queries';
import { protocolMismatchMessage, WORKER_PROTOCOL, WORKER_PROTOCOL_HEADER } from './protocol';

export interface WorkerCaller {
  apiKeyId: string;
  device: DeviceRecord;
}

export function requireWorker(headers: Headers): WorkerCaller | Response {
  const key = getRequestKey(headers);
  if (!key || key.scope !== 'worker') {
    return Response.json({ error: 'not_a_worker', message: 'Only an enrolled worker can reach this route.' }, { status: 403 });
  }
  const device = getWorkerDevice(key.apiKeyId);
  if (!device || device.id !== key.workerDeviceId) {
    return Response.json({ error: 'unauthorized', message: 'This worker is no longer enrolled.' }, { status: 401 });
  }
  const protocol = Number(headers.get(WORKER_PROTOCOL_HEADER));
  if (protocol !== WORKER_PROTOCOL) {
    return Response.json(
      { error: 'worker_protocol', protocol: WORKER_PROTOCOL, message: protocolMismatchMessage(device.name) },
      { status: 426 },
    );
  }
  return { apiKeyId: key.apiKeyId, device };
}

/**
 * A worker request's JSON body, read after checking the caller once, so a
 * stranger's body is never read. It returns no caller on purpose: a caller
 * checked before an await says nothing about after it. Turning a worker off
 * can land while its request is in flight, and what the retirement cleared
 * must stay cleared, so a route calls `requireWorker` itself after its last
 * await and writes in the same tick (P2.7 to P2.9 review fixes and re-check).
 */
export async function readWorkerBody(request: Request): Promise<{ json: unknown } | Response> {
  const early = requireWorker(request.headers);
  if (early instanceof Response) return early;
  return { json: await request.json().catch(() => ({})) };
}
