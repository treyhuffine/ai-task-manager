import type { NextRequest } from 'next/server';
import { getTerminal, killTerminal } from '@/lib/terminal/pty-manager';
import { terminalOwnerForSession } from '@/lib/terminal/owner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
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
