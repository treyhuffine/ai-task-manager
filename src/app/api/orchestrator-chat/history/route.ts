import { mainChatHistory } from '@/lib/sessions/main-chat';
import { withCompression } from '@/lib/api/compression';

/**
 * Past and current main chats of the app, newest activity first. Agent main
 * chats and scheduled-fire chats are excluded. Capped: this backs the Chat
 * tab's history menu, not an archive browser.
 *
 * Label model (docs/orchestrator-harness.md): orchestration chats carry no
 * first-message title. `label` is the retrospective summary written at
 * archive time; `snippet` (last user message) is the live fallback while
 * the thread is current or until the summary lands.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET() {
  try {
    return Response.json({ sessions: mainChatHistory(null) });
  } catch (err) {
    console.error('[GET /api/orchestrator-chat/history]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
