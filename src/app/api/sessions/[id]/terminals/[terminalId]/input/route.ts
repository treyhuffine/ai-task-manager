import type { NextRequest } from 'next/server';
import { sessionTerminalPlace, terminalInputAt, touchTerminalActivity } from '@/lib/terminal/place';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; terminalId: string }> },
) {
  try {
    const { id, terminalId } = await params;
    return await terminalInputAt(request, sessionTerminalPlace(id), terminalId, () => touchTerminalActivity(id));
  } catch (err) {
    console.error('[POST /api/sessions/:id/terminals/:terminalId/input]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
