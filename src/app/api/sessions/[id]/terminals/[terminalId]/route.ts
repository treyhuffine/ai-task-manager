import type { NextRequest } from 'next/server';
import { getTerminal, killTerminal } from '@/lib/terminal/pty-manager';
import { terminalOwnerForSession } from '@/lib/terminal/owner';
import { withCompression } from '@/lib/api/compression';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; terminalId: string }> },
) {
  const { id, terminalId } = await params;
  const ownerId = terminalOwnerForSession(id);
  if (!ownerId) return Response.json({ error: 'Session not found' }, { status: 404 });
  const t = getTerminal(ownerId, terminalId);
  if (!t) return Response.json({ error: 'Terminal not found' }, { status: 404 });
  return Response.json(t);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; terminalId: string }> },
) {
  const { id, terminalId } = await params;
  const ownerId = terminalOwnerForSession(id);
  if (!ownerId) return Response.json({ error: 'Session not found' }, { status: 404 });
  const ok = killTerminal(ownerId, terminalId);
  if (!ok) return Response.json({ error: 'Terminal not found' }, { status: 404 });
  return Response.json({ ok: true });
}
