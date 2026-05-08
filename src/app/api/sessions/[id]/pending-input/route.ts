import type { NextRequest } from 'next/server';
import { listForSession } from '@/lib/executor/pending-input';

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
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return Response.json(listForSession(id));
}
