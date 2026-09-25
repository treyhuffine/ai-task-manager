/**
 * Turn off local execution from the worker's own computer
 * (docs/homes-build.md, P2.2): the worker revokes its own key. The computer
 * stays connected with its viewing key, and can enroll again later. Its
 * work at home is settled with the revocation (`retireWorker`).
 */

import type { NextRequest } from 'next/server';
import { requireWorker } from '@/lib/workers/route-auth';
import { retireWorker } from '@/lib/workers/retire';

export async function DELETE(request: NextRequest) {
  const worker = requireWorker(request.headers);
  if (worker instanceof Response) return worker;
  retireWorker(worker.apiKeyId, worker.computer.id, 'Local execution turned off on this computer');
  return new Response(null, { status: 204 });
}
