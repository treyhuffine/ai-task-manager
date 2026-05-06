import type { NextRequest } from 'next/server';
import { getChatSession, updateChatSession } from '@/lib/db/queries';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const row = getChatSession(id);
    if (!row) return Response.json({ error: 'Session not found' }, { status: 404 });
    return Response.json(row);
  } catch (err) {
    console.error('[GET /api/sessions/:id]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * Updates a small whitelist of session fields — label only, for now.
 * Other mutations have dedicated routes (`/view`, `/archive`, etc.) so
 * this is intentionally narrow rather than a generic "update session"
 * with arbitrary keys.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body: { label?: string | null } = await request.json();

    const updates: { label?: string | null } = {};
    if ('label' in body) {
      const trimmed = typeof body.label === 'string' ? body.label.trim() : null;
      updates.label = trimmed || null;
    }

    const row = updateChatSession(id, updates);
    if (!row) return Response.json({ error: 'Session not found' }, { status: 404 });
    return Response.json(row);
  } catch (err) {
    console.error('[PATCH /api/sessions/:id]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
