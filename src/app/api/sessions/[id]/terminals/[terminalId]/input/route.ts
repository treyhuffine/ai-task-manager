import type { NextRequest } from 'next/server';
import { sessionTerminalOwner } from '@/lib/terminal/owner';
import { terminalInputResponse } from '@/lib/terminal/http';
import { touchSessionActivity } from '@/lib/db/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; terminalId: string }> },
) {
  try {
    const { id, terminalId } = await params;
    return await terminalInputResponse(request, sessionTerminalOwner(id), terminalId, () => {
      // Working in the terminal is working on the execution. Throttled because
      // this route is one POST per keystroke and the rail's sort key does not
      // need per-character resolution.
      touchSessionActivity(id, 'terminal', { throttle: true });
    });
  } catch (err) {
    console.error('[POST /api/sessions/:id/terminals/:terminalId/input]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
