/**
 * Redeem an enroll grant (docs/homes-build.md, P2.2). The grant in the body
 * is the only credential this route takes: the proxy lets it through without
 * a key, since a computer being enrolled has no worker key yet. The home
 * issues the worker key and records the enrollment in one transaction, and
 * the grant can't be used again.
 */

import { z } from 'zod';
import { getHome, GrantError } from '@/lib/db/queries';
import { enrollWorker } from '@/lib/workers/enroll';
import { protocolMismatchMessage, WORKER_PROTOCOL } from '@/lib/workers/protocol';

const body = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1).max(80),
  platform: z.string().max(40).nullable().optional(),
  hostname: z.string().max(255).nullable().optional(),
  protocol: z.number().int(),
  version: z.string().max(80),
});

export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: 'invalid_params', message: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const input = parsed.data;
  if (input.protocol !== WORKER_PROTOCOL) {
    return Response.json(
      { error: 'worker_protocol', protocol: WORKER_PROTOCOL, message: protocolMismatchMessage(input.name) },
      { status: 426 },
    );
  }
  try {
    const enrolled = enrollWorker({
      secret: input.code,
      name: input.name,
      platform: input.platform ?? null,
      hostname: input.hostname ?? null,
    });
    return Response.json(
      {
        homeId: enrolled.homeId,
        homeName: getHome()?.name ?? null,
        computerId: enrolled.computer.id,
        computerName: enrolled.computer.name,
        workerKey: enrolled.token.plaintext,
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof GrantError) {
      const status = err.code === 'expired' || err.code === 'used' ? 410 : 400;
      return Response.json({ error: err.code, message: err.message }, { status });
    }
    throw err;
  }
}
