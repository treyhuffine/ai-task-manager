import type { NextRequest } from 'next/server';
import { actorFromRequest } from '@/lib/auth/actor';
import { archiveAgent } from '@/lib/workspaces/archive-agent';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const row = await archiveAgent(id, actorFromRequest(request.headers));
    if (!row) return Response.json({ error: 'Workspace not found' }, { status: 404 });
    return Response.json(row);
  } catch (err) {
    console.error('[POST /api/workspaces/:id/archive]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
