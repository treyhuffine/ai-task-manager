import type { NextRequest } from 'next/server';
import { resizeTerminal } from '@/lib/terminal/pty-manager';
import { terminalOwnerForSession } from '@/lib/terminal/owner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ResizeBody {
  cols: number;
  rows: number;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; terminalId: string }> },
) {
  try {
    const { id, terminalId } = await params;
    const body = (await request.json().catch(() => null)) as ResizeBody | null;
    if (
      !body ||
      !Number.isFinite(body.cols) ||
      !Number.isFinite(body.rows) ||
      body.cols < 1 ||
      body.rows < 1
    ) {
      return Response.json({ error: 'cols and rows must be positive numbers' }, { status: 400 });
    }
    const ownerId = terminalOwnerForSession(id);
    if (!ownerId) return Response.json({ error: 'Session not found' }, { status: 404 });
    const ok = resizeTerminal(ownerId, terminalId, Math.floor(body.cols), Math.floor(body.rows));
    if (!ok) return Response.json({ error: 'Terminal not found or exited' }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/sessions/:id/terminals/:terminalId/resize]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
