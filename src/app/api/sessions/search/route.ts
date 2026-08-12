import type { NextRequest } from 'next/server';
import { searchChatSessions, type ChatSearchSource } from '@/lib/db/queries';
import { withCompression } from '@/lib/api/compression';

/**
 * Full-text search across chat/execution transcripts. Backed by the
 * `chat_events_fts` index — matches message content (user + agent turns),
 * grouped to one result per session with a highlighted snippet.
 *
 * Query params:
 *   q            required; blank returns [].
 *   status       'active' | 'archived'; omit for both.
 *   workspaceId  scope to one workspace.
 *   source       'native' | 'imported' | 'claude' | 'codex' | 'opencode'.
 *   limit        max sessions (1-100, default 30).
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
export const GET = withCompression(handleGET);

async function handleGET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const query = params.get('q') ?? '';
    if (query.trim().length === 0) {
      return Response.json([]);
    }

    const statusParam = params.get('status');
    const status = statusParam === 'active' || statusParam === 'archived' ? statusParam : undefined;

    const sourceParam = params.get('source');
    const source = sourceParam && SOURCES.has(sourceParam) ? (sourceParam as ChatSearchSource) : undefined;

    const workspaceId = params.get('workspaceId') ?? undefined;

    const limitRaw = parseInt(params.get('limit') ?? '30', 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 30;

    const results = searchChatSessions({ query, status, workspaceId, source, limit });
    return Response.json(results);
  } catch (err) {
    console.error('[GET /api/sessions/search]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
