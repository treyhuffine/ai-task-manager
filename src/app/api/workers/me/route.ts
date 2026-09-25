/**
 * Turn off local execution from the worker's own computer
 * (docs/homes-build.md, P2.2): the worker revokes its own key. The computer
 * stays connected with its viewing key, and can enroll again later.
 */

import type { NextRequest } from 'next/server';
import { revokeApiKey } from '@/lib/db/queries';
import { disconnectComputer } from '@/lib/workers/hub';
import { requireWorker } from '@/lib/workers/route-auth';

export async function DELETE(request: NextRequest) {
  const worker = requireWorker(request.headers);
  if (worker instanceof Response) return worker;
  revokeApiKey(worker.apiKeyId, 'Local execution turned off on this computer');
  disconnectComputer(worker.computer.id, `Local execution on ${worker.computer.name} was turned off.`);
  return new Response(null, { status: 204 });
}
