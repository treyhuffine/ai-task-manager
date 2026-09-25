/**
 * The check every worker route makes (docs/homes-build.md, P2.2): the proxy
 * already let only a worker key through, and this confirms its enrollment
 * is live, that the computer matches, and that the worker speaks this
 * home's protocol. A worker on another protocol gets 426 and stops.
 */

import type { ComputerRecord, WorkerEnrollmentRecord } from '@/db/types';
import { getRequestKey } from '@/lib/auth/request-key';
import { getWorkerEnrollment } from '@/lib/db/queries';
import { protocolMismatchMessage, WORKER_PROTOCOL, WORKER_PROTOCOL_HEADER } from './protocol';

export interface WorkerCaller {
  apiKeyId: string;
  computer: ComputerRecord;
  enrollment: WorkerEnrollmentRecord;
}

export function requireWorker(headers: Headers): WorkerCaller | Response {
  const key = getRequestKey(headers);
  if (!key || key.scope !== 'worker') {
    return Response.json({ error: 'not_a_worker', message: 'Only an enrolled worker can reach this route.' }, { status: 403 });
  }
  const worker = getWorkerEnrollment(key.apiKeyId);
  if (!worker || worker.computer.id !== key.workerComputerId) {
    return Response.json({ error: 'unauthorized', message: 'This worker is no longer enrolled.' }, { status: 401 });
  }
  const protocol = Number(headers.get(WORKER_PROTOCOL_HEADER));
  if (protocol !== WORKER_PROTOCOL) {
    return Response.json(
      { error: 'worker_protocol', protocol: WORKER_PROTOCOL, message: protocolMismatchMessage(worker.computer.name) },
      { status: 426 },
    );
  }
  return { apiKeyId: key.apiKeyId, computer: worker.computer, enrollment: worker.enrollment };
}
