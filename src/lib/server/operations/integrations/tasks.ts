import { listIntegrationTasks } from '@/lib/integrations/task-sources';
import { reply, searchParams, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * Tasks from connected task-management providers (Todoist, Jira, Asana).
 *
 * Read-only and app-initiated — see `task-sources.ts` for why this bypasses the
 * agent tool path and calls the integration engine directly. Providers that fail
 * come back in `failures` rather than failing the whole request, so one dead
 * connection degrades to a note instead of an empty launcher group.
 */

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const params = searchParams(rpcInput.query);
    const query = params.get('q') ?? '';
    // Per provider, not overall — the launcher renders one group each, so a
    // shared budget would let a chatty provider starve a quiet one. Grows as
    // the user pages through a group; clamped so a hand-written URL can't ask
    // a provider for its entire backlog.
    const limitRaw = parseInt(params.get('limit') ?? '', 10);
    const limitPerProvider = Number.isFinite(limitRaw)
      ? Math.min(Math.max(limitRaw, 1), 200)
      : undefined;
    return reply(await listIntegrationTasks(query, { limitPerProvider }));
  } catch (err) {
    console.error(`[GET /api/integrations/tasks]`, err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ query: rpcZ.object({ "q": rpcZ.string().optional(), "limit": rpcZ.string().optional() }).strict().optional() }).strict().default({});
