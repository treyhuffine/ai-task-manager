import { UnsupportedPermissionModeError } from '@/lib/executor/permission-map';
import { HarnessDisabledError } from '@/lib/harness/registry';
import { chatOverrideSchema } from '@/lib/server/inputs';
import { reply, type OperationContext } from '@/lib/server/operation';
import { ensureMainChat, parseChatOverride, startNewMainChat } from '@/lib/sessions/main-chat';
import { z as rpcZ } from 'zod/v4';

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

export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    return reply({ session: await ensureMainChat(null) });
  } catch (err) {
    console.error('[GET /api/orchestrator-chat]', err);
    return reply({ error: String(err) }, { status: err instanceof HarnessDisabledError || err instanceof UnsupportedPermissionModeError ? 409 : 500 });
  }
}

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _req: OperationContext) {
  const body: unknown = rpcInput.body;
  try {
    return reply({ session: await startNewMainChat(null, parseChatOverride(body)) });
  } catch (err) {
    console.error('[POST /api/orchestrator-chat]', err);
    return reply({ error: String(err) }, { status: err instanceof HarnessDisabledError || err instanceof UnsupportedPermissionModeError ? 409 : 500 });
  }
}

export const GETInput = rpcZ.object({}).strict().default({});
export const POSTInput = rpcZ.object({ body: chatOverrideSchema.default({}) }).strict();
