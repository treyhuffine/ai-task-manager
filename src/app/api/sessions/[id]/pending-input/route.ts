import type { NextRequest } from 'next/server';
import { listForSession } from '@/lib/executor/pending-input';
import { withCompression } from '@/lib/api/compression';

/**
 * Active permission/question requests for this chat_session that are
 * waiting on the user. The UI polls this to drive the floating overlay
 * above the composer; on resolve the entry disappears from the list.
 *
 * Process-local state — no DB read. If the server restarts mid-prompt
 * the agentex callback's awaiting promise is gone with it; the agent
 * sees no response and the next user message creates a fresh session.
 * That's the same recovery model as `runtime-status`.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return Response.json(listForSession(id));
}
