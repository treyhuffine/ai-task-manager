import { reply, type OperationContext } from '@/lib/server/operation';
import { resumeMainChat } from '@/lib/sessions/main-chat';
import { z as rpcZ } from 'zod/v4';

/**
 * Make a past main chat of the app the current one. The current one is
 * retired, and the harness picks the resumed conversation back up from its
 * persisted session on the next send. See `resumeMainChat`.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { sessionId } = (rpcInput.body) as { sessionId?: unknown };
    if (typeof sessionId !== 'string' || !sessionId) {
      return reply({ error: 'sessionId is required' }, { status: 400 });
    }
    const result = await resumeMainChat(null, sessionId);
    if (!result.ok) return reply({ error: result.error }, { status: result.status });
    return reply({ session: result.session });
  } catch (err) {
    console.error('[POST /api/orchestrator-chat/resume]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const POSTInput = rpcZ.object({ body: rpcZ.object({ "sessionId": rpcZ.string().optional() }).strict().default({}) }).strict();
