/**
 * GET /api/home: which home this is, and the computer it runs on.
 *
 * A computer connecting to a home reads this after pairing to learn the
 * home's stable id, which it keeps alongside the address (docs/homes-spec.md
 * §3.1). The id is what survives an address change. The proxy only lets
 * requests through to an active home, so this always describes one.
 */

import { ensureHomeIdentity } from '@/lib/home/identity';

export const runtime = 'nodejs';

export function GET() {
  try {
    const { home, computer } = ensureHomeIdentity();
    return Response.json({
      id: home.id,
      kind: home.kind,
      name: home.name,
      host: { id: computer.id, name: computer.name, platform: computer.platform },
    });
  } catch (err) {
    console.error('[GET /api/home]', err);
    return Response.json({ error: 'home_not_active', message: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }
}
