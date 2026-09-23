import type { NextRequest } from 'next/server';
import { workspaceTerminalOwner } from '@/lib/terminal/owner';
import { terminalStreamResponse } from '@/lib/terminal/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** SSE stream of the terminal's output. See `terminalStreamResponse`. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; terminalId: string }> },
) {
  const { id, terminalId } = await params;
  return terminalStreamResponse(request, () => workspaceTerminalOwner(id), terminalId);
}
