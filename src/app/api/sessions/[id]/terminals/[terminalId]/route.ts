import type { NextRequest } from 'next/server';
import { getTerminal, killTerminal } from '@/lib/terminal/pty-manager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; terminalId: string }> },
) {
  const { id, terminalId } = await params;
  const t = getTerminal(id, terminalId);
  if (!t) return Response.json({ error: 'Terminal not found' }, { status: 404 });
  return Response.json(t);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; terminalId: string }> },
) {
  const { id, terminalId } = await params;
  const ok = killTerminal(id, terminalId);
  if (!ok) return Response.json({ error: 'Terminal not found' }, { status: 404 });
  return Response.json({ ok: true });
}
