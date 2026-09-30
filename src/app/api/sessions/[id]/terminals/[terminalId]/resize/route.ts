import type { NextRequest } from 'next/server';
import { sessionTerminalPlace, terminalResizeAt } from '@/lib/terminal/place';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; terminalId: string }> },
) {
  try {
    const { id, terminalId } = await params;
    return await terminalResizeAt(request, sessionTerminalPlace(id), terminalId);
  } catch (err) {
    console.error('[POST /api/sessions/:id/terminals/:terminalId/resize]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
