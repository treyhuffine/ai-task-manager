import { reply, type OperationContext } from '@/lib/server/operation';
import { z } from 'zod/v4';
/**
 * GET /api/home: which home this is, and the device it runs on.
 *
 * A device connecting to a home reads this after pairing to learn the
 * home's stable id, which it keeps alongside the address (docs/homes-spec.md
 * §3.1). The id is what survives an address change. The proxy only lets
 * requests through to an active home, so this always describes one.
 */

import { ensureHomeIdentity } from '@/lib/home/identity';

export async function GET(_input: z.infer<typeof GETInput>, _context: OperationContext) {
  try {
    const { home, device } = ensureHomeIdentity();
    return reply({
      id: home.id,
      kind: home.kind,
      name: home.name,
      host: { id: device.id, name: device.name, platform: device.platform },
    });
  } catch (err) {
    console.error('[GET /api/home]', err);
    return reply({ error: 'home_not_active', message: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }
}

export const GETInput = z.object({}).strict().default({});
