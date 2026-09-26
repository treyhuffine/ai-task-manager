import type { NextRequest } from 'next/server';
import { agentTerminalPlace, terminalResizeAt } from '@/lib/terminal/place';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; terminalId: string }> },
) {
  try {
    const { id, terminalId } = await params;
    return await terminalResizeAt(request, agentTerminalPlace(id), terminalId);
  } catch (err) {
    console.error('[POST /api/workspaces/:id/terminals/:terminalId/resize]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
