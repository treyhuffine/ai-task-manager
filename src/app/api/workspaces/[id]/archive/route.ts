import type { NextRequest } from 'next/server';
import { archiveAgent } from '@/lib/workspaces/archive-agent';

export const runtime = 'nodejs';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const row = await archiveAgent(id);
    if (!row) return Response.json({ error: 'Workspace not found' }, { status: 404 });
    return Response.json(row);
  } catch (err) {
    console.error('[POST /api/workspaces/:id/archive]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
