import type { NextRequest } from 'next/server';
import { markSessionViewed } from '@/lib/db/queries';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const row = markSessionViewed(id);
    if (!row) return Response.json({ error: 'Session not found' }, { status: 404 });
    return Response.json(row);
  } catch (err) {
    console.error('[POST /api/sessions/:id/view]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
