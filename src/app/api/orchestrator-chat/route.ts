import { ensureMainChat, parseChatOverride, startNewMainChat } from '@/lib/sessions/main-chat';
import { withCompression } from '@/lib/api/compression';

/**
 * The app's main chat: the dashboard's interactive orchestrator chat
 * (harness modes). One current chat at a time:
 *   GET  → return it, creating one if none exists ("ensure" semantics).
 *   POST → start fresh: retire the current one (closing its cached harness
 *          process) and create a new one. Used by "New chat", the
 *          composer's provider switch, and mode switches.
 *
 * Only chats with no workspace: an agent's main chat is served by
 * `/api/workspaces/:id/chat`, and scheduled fires belong to the runs
 * surface. Both share `src/lib/sessions/main-chat.ts`.
 */

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET() {
  try {
    return Response.json({ session: await ensureMainChat(null) });
  } catch (err) {
    console.error('[GET /api/orchestrator-chat]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body: unknown = await req.json().catch(() => ({}));
  try {
    return Response.json({ session: await startNewMainChat(null, parseChatOverride(body)) });
  } catch (err) {
    console.error('[POST /api/orchestrator-chat]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
