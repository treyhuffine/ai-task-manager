import type { NextRequest } from 'next/server';
import { writeInput } from '@/lib/terminal/pty-manager';
import { terminalOwnerForSession } from '@/lib/terminal/owner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface InputBody {
  data: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; terminalId: string }> },
) {
  try {
    const { id, terminalId } = await params;
    const body = (await request.json().catch(() => null)) as InputBody | null;
    if (!body || typeof body.data !== 'string') {
      return Response.json({ error: 'data must be a string' }, { status: 400 });
    }
    const ownerId = terminalOwnerForSession(id);
    if (!ownerId) return Response.json({ error: 'Session not found' }, { status: 404 });
    const ok = writeInput(ownerId, terminalId, body.data);
    if (!ok) return Response.json({ error: 'Terminal not found or exited' }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/sessions/:id/terminals/:terminalId/input]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
