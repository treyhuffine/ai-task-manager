import type { NextRequest } from 'next/server';
import { workspaceTerminalOwner } from '@/lib/terminal/owner';
import { terminalInputResponse } from '@/lib/terminal/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; terminalId: string }> },
) {
  try {
    const { id, terminalId } = await params;
    return await terminalInputResponse(request, workspaceTerminalOwner(id), terminalId);
  } catch (err) {
    console.error('[POST /api/workspaces/:id/terminals/:terminalId/input]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
