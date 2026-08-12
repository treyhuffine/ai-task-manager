/**
 * Side-load referenced entities for the transcript's chip rendering.
 * Returns lookup maps the client uses to swap `[[task:id]]` markers
 * for proper chips on render — one query per session beats N queries
 * per chip.
 *
 * Pulls from chat_refs (materialized on every message send), so newly
 * mentioned entities show up after a refetch.
 */
import { NextRequest } from 'next/server';
import { withCompression } from '@/lib/api/compression';
import {
  getChatSession,
  listSessionRefs,
  getTask,
  getNote,
} from '@/lib/db/queries';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = getChatSession(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });

    const refs = listSessionRefs(id);
    const taskIds = new Set<string>();
    const noteIds = new Set<string>();
    for (const r of refs) {
      if (r.entityType === 'task') taskIds.add(r.entityId);
      else if (r.entityType === 'note') noteIds.add(r.entityId);
    }

    const tasks: Array<{ id: string; title: string; status: string }> = [];
    for (const tid of taskIds) {
      const t = getTask(tid);
      if (t) tasks.push({ id: t.id, title: t.title, status: t.status });
    }

    const notes: Array<{ id: string; title: string | null }> = [];
    for (const nid of noteIds) {
      const n = getNote(nid);
      if (n) notes.push({ id: n.id, title: n.title });
    }

    return Response.json({ tasks, notes });
  } catch (err) {
    console.error('[GET /api/sessions/:id/entities]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
