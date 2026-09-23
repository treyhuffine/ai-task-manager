import type { NextRequest } from 'next/server';
import { parseChatOverride, startNewMainChat } from '@/lib/sessions/main-chat';
import { archivedAgentResponse, resolveAgent } from '../_agent';

/**
 * Start a fresh main chat for the agent: the current one is retired (its
 * harness process closed, a retrospective title derived) and a new one is
 * created. Optional body `{ providerId, model, variant, effort }` is the
 * composer's provider switch.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const agent = resolveAgent(id);
    if (!agent.ok) return agent.response;
    if (agent.ws.status === 'archived') return archivedAgentResponse();
    const body: unknown = await request.json().catch(() => ({}));
    return Response.json({ session: await startNewMainChat(id, parseChatOverride(body)) });
  } catch (err) {
    console.error('[POST /api/workspaces/:id/chat/new]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
