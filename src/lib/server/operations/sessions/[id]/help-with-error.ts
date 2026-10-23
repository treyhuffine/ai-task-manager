import { getRequestKey } from '@/lib/auth/request-key';
import { sessionAuthority, executionOperationFailure } from '@/lib/workspaces/access';
import { submitActionMessage, replayActionMessage } from '@/lib/sessions/action-message';
import { getChatSession } from '@/lib/db/queries';
import * as executor from '@/lib/executor/adapter';
import { buildHelpWithErrorPrompt } from '@/lib/executor/prompts/help-with-error';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z } from 'zod';
import { z as rpcZ } from 'zod/v4';

/**
 * Inject a "this action failed — investigate and fix" prompt into the
 * chat. Called from the action bar's error modal when the user clicks
 * "Solve with agent." Mirrors the `/pr`, `/commit`, and
 * `/resolve-conflicts` routes — no worktree open required (the agent
 * has its own Bash + filesystem access via the executor session), we
 * just stage the prompt and dispatch.
 */

const ContextEntrySchema = z.object({ label: z.string(), value: z.string() });
const BodySchema = z.object({
  action: z.string().min(1).max(120),
  error: z.string().min(1).max(8_000),
  context: z.array(ContextEntrySchema).max(20).optional(),
});

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const { requestId, ...actionInput } = rpcInput.body;
    const intent = { action: 'help-with-error', input: actionInput };
    const replay = replayActionMessage(request.headers, id, requestId, intent);
    if (replay) return reply({ ok: true, ...replay });
    sessionAuthority(getRequestKey(request.headers), id, 'send');
    const raw = rpcInput.body;
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return reply(
        { error: 'invalid_params', message: parsed.error.issues[0]?.message ?? 'Invalid body' },
        { status: 400 },
      );
    }

    const session = getChatSession(id);
    if (!session) return reply({ error: 'Session not found' }, { status: 404 });
    if (session.status === 'archived') {
      return reply({ error: 'Cannot dispatch on an archived session' }, { status: 400 });
    }
    if (executor.isRunning(id)) {
      return reply(
        { error: 'already_running', message: 'A turn is already in flight for this session.' },
        { status: 409 },
      );
    }

    const prompt = buildHelpWithErrorPrompt(parsed.data);

    const receipt = await submitActionMessage(request.headers, id, prompt, requestId, intent);

    return reply({ ok: true, ...receipt });
  } catch (err) {
    const denied = executionOperationFailure(err);
    if (denied) return denied;
    console.error('[POST /api/sessions/:id/help-with-error]', err);
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);
    return reply({ error: name, message }, { status: 400 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({ "requestId": rpcZ.string().uuid().optional(), "action": rpcZ.string(), "error": rpcZ.string(), "context": rpcZ.array(rpcZ.object({ "label": rpcZ.string(), "value": rpcZ.string() }).strict()).optional() }).strict() }).strict();
