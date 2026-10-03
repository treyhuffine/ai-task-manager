import { getChatSession, insertChatEvent } from '@/lib/db/queries';
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

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
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

    insertChatEvent({
      sessionId: id,
      role: 'user',
      source: 'user',
      content: prompt,
      createdAt: new Date().toISOString(),
    });

    executor.dispatch(id, prompt).catch((err) => {
      console.error(`[POST /api/sessions/:id/help-with-error] dispatch failed for ${id}:`, err);
    });

    return reply({ ok: true });
  } catch (err) {
    console.error('[POST /api/sessions/:id/help-with-error]', err);
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);
    return reply({ error: name, message }, { status: 400 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({ "action": rpcZ.string(), "error": rpcZ.string(), "context": rpcZ.array(rpcZ.object({ "label": rpcZ.string(), "value": rpcZ.string() }).strict()).optional() }).strict() }).strict();
