import { listChatSessions, getLastChatEventBySource } from '@/lib/db/queries';
import { withCompression } from '@/lib/api/compression';

const HISTORY_LIMIT = 50;
const SNIPPET_MAX = 80;

/**
 * Past + current interactive orchestrator chats, newest activity first.
 * Scheduled-fire chats (createdByRunId set) are excluded — they belong to
 * the runs surface. Capped: this backs the Chat tab's history menu, not an
 * archive browser.
 *
 * Label model (docs/orchestrator-harness.md): orchestration chats carry no
 * first-message title. `label` is the retrospective summary written at
 * archive time; `snippet` (last user message) is the live fallback while
 * the thread is current or until the summary lands.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET() {
  try {
    const sessions = listChatSessions({ type: 'orchestration' })
      .filter((s) => s.createdByRunId === null)
      .slice(0, HISTORY_LIMIT)
      .map((s) => {
        const lastUser = getLastChatEventBySource(s.id, 'user');
        const raw = lastUser?.content?.trim().replace(/\s+/g, ' ') ?? null;
        const snippet =
          raw && raw.length > SNIPPET_MAX ? raw.slice(0, SNIPPET_MAX - 1).trimEnd() + '…' : raw;
        return {
          id: s.id,
          label: s.label,
          snippet,
          status: s.status,
          startedAt: s.startedAt,
          lastOutcomeEventAt: s.lastOutcomeEventAt,
        };
      });
    return Response.json({ sessions });
  } catch (err) {
    console.error('[GET /api/orchestrator-chat/history]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
