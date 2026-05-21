/**
 * Reverse lookup — which chat sessions reference a given task / note /
 * area. Powers the "🔗 N sessions" affordance on task/note slideouts
 * so the user can jump back to any execution that mentioned this item.
 *
 * Cheap: reads from chat_refs (materialized on every message send) and
 * joins on chat_sessions for the labels. No per-session DB walks.
 */
import { NextRequest } from 'next/server';
import { listSessionsReferencingEntity } from '@/lib/db/queries';
import type { ChatRefEntityType } from '@/db/types';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get('type') as ChatRefEntityType | null;
    const id = url.searchParams.get('id');
    if (!type || !id) {
      return Response.json({ error: 'type and id query params required' }, { status: 400 });
    }
    if (!['task', 'note', 'area', 'file', 'scratchpad'].includes(type)) {
      return Response.json({ error: `invalid type: ${type}` }, { status: 400 });
    }
    const sessions = listSessionsReferencingEntity(type, id);
    return Response.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        label: s.label,
        workspace_id: s.workspace_id,
        type: s.type,
        status: s.status,
        started_at: s.started_at,
        last_outcome_event_at: s.last_outcome_event_at,
      })),
    });
  } catch (err) {
    console.error('[GET /api/entities/sessions]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
