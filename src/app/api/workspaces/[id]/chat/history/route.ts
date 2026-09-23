import type { NextRequest } from 'next/server';
import { mainChatHistory } from '@/lib/sessions/main-chat';
import { withCompression } from '@/lib/api/compression';
import { resolveAgent } from '../_agent';

/**
 * The agent's past and current main chats, newest activity first. Same
 * shape as `/api/orchestrator-chat/history`.
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
    return Response.json({ sessions: mainChatHistory(id) });
  } catch (err) {
    console.error('[GET /api/workspaces/:id/chat/history]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
