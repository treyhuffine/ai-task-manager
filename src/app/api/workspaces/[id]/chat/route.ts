import type { NextRequest } from 'next/server';
import { currentMainChat, ensureMainChat } from '@/lib/sessions/main-chat';
import { withCompression } from '@/lib/api/compression';
import { archivedAgentResponse, resolveAgent } from './_agent';

/**
 * The agent's main chat: an orchestration chat scoped to this workspace,
 * running in the agent's folder (docs/agents-view-spec.md §4). GET returns
 * the current one, creating it if the agent has none ("ensure" semantics,
 * like `/api/orchestrator-chat`). An archived agent still returns its
 * current chat but never gets a new one.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const agent = resolveAgent(id);
    if (!agent.ok) return agent.response;
    const existing = currentMainChat(id);
    if (existing) return Response.json({ session: existing });
    if (agent.ws.status === 'archived') return archivedAgentResponse();
    return Response.json({ session: await ensureMainChat(id) });
  } catch (err) {
    console.error('[GET /api/workspaces/:id/chat]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
