/**
 * An association grant for this worker's computer (docs/homes-build.md,
 * P2.2, "This Mac"). The worker opens `<home>/#associate=<code>` in its
 * computer's browser, and the page redeems it with its own viewing key at
 * `/api/devices/associate`. The code works once, within 2 minutes.
 */

import type { NextRequest } from 'next/server';
import { createComputerGrant } from '@/lib/db/queries';
import { requireWorker } from '@/lib/workers/route-auth';

export async function POST(request: NextRequest) {
  const worker = requireWorker(request.headers);
  if (worker instanceof Response) return worker;
  const { grant, secret } = createComputerGrant({
    kind: 'associate',
    computerId: worker.computer.id,
    createdByApiKeyId: worker.apiKeyId,
  });
  return Response.json({ code: secret, expiresAt: grant.expiresAt }, { status: 201 });
}
