import { searchChatSessions, type ChatSearchSource } from '@/lib/db/queries';
import { reply, searchParams, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * Search across chat/execution titles and transcripts. Titles containing
 * every word come first, then transcript matches from the `chat_events_fts`
 * index (message content of user + agent turns), grouped to one result per
 * session with a highlighted snippet. See `searchChatSessions`.
 *
 * Query params:
 *   q            required; blank returns [].
 *   status       'active' | 'archived'; omit for both.
 *   workspaceId  scope to one workspace.
 *   source       'native' | 'imported' | 'claude' | 'codex' | 'opencode'.
 *   limit        max sessions (1-500, default 30).
 *
 * Distinct from `/sessions/history` (a flat feed): this takes a query and
 * ranks by relevance. The static `search` segment is matched ahead of the
 * sibling `[id]` dynamic route by Next.js, so there's no collision.
 */
const SOURCES: ReadonlySet<string> = new Set([
  'native',
  'imported',
  'claude',
  'codex',
  'opencode',
]);

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const params = searchParams(rpcInput.query);
    const query = params.get('q') ?? '';
    if (query.trim().length === 0) {
      return reply([]);
    }

    const statusParam = params.get('status');
    const status = statusParam === 'active' || statusParam === 'archived' ? statusParam : undefined;

    const sourceParam = params.get('source');
    const source = sourceParam && SOURCES.has(sourceParam) ? (sourceParam as ChatSearchSource) : undefined;

    const workspaceId = params.get('workspaceId') ?? undefined;

    // Ceiling is a runaway guard, not a page size. It used to be 100, which the
    // launcher's paging could walk right into — and a cap the caller can reach
    // by asking is indistinguishable from "no more results".
    const limitRaw = parseInt(params.get('limit') ?? '30', 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 30;

    const results = searchChatSessions({ query, status, workspaceId, source, limit });
    return reply(results);
  } catch (err) {
    console.error('[GET /api/sessions/search]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ query: rpcZ.object({ "q": rpcZ.string().optional(), "status": rpcZ.string().optional(), "source": rpcZ.string().optional(), "workspaceId": rpcZ.string().optional(), "limit": rpcZ.string().optional() }).strict().optional() }).strict().default({});
