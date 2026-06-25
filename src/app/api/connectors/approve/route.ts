import { NextRequest, NextResponse } from 'next/server';
import { resolvePendingApproval } from '@/lib/connectors/approval';

/**
 * Resolve a pending connector approval. `allow` records a single-use, short-TTL grant keyed on the
 * exact (ownerId, action, connection, inputDigest, actionVersion) — so when the agent re-invokes
 * the same call it passes the gate; `deny` just clears it.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { id?: unknown; decision?: unknown };
  const id = typeof body.id === 'string' ? body.id : '';
  const decision = body.decision === 'deny' ? 'deny' : 'allow';
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const resolved = resolvePendingApproval(id, decision);
  if (!resolved) return NextResponse.json({ error: 'unknown or expired approval' }, { status: 404 });
  return NextResponse.json({ ok: true, id, decision });
}
