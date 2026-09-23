import type { NextRequest } from 'next/server';
import { resumeMainChat } from '@/lib/sessions/main-chat';
import { archivedAgentResponse, resolveAgent } from '../_agent';

/**
 * Make one of the agent's past main chats current again. A chat from
 * another agent, or the app's main chat, is refused (404). See
 * `resumeMainChat`.
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
    const { sessionId } = (await request.json().catch(() => ({}))) as { sessionId?: unknown };
    if (typeof sessionId !== 'string' || !sessionId) {
      return Response.json({ error: 'sessionId is required' }, { status: 400 });
    }
    const result = await resumeMainChat(id, sessionId);
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ session: result.session });
  } catch (err) {
    console.error('[POST /api/workspaces/:id/chat/resume]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
