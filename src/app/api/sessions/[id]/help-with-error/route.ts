import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { getChatSession, insertChatEvent } from '@/lib/db/queries';
import { buildHelpWithErrorPrompt } from '@/lib/executor/prompts/help-with-error';
import * as executor from '@/lib/executor/adapter';

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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const raw = await request.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: 'invalid_params', message: parsed.error.issues[0]?.message ?? 'Invalid body' },
        { status: 400 },
      );
    }

    const session = getChatSession(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    if (session.status === 'archived') {
      return Response.json({ error: 'Cannot dispatch on an archived session' }, { status: 400 });
    }
    if (executor.isRunning(id)) {
      return Response.json(
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

    return Response.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/sessions/:id/help-with-error]', err);
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: name, message }, { status: 400 });
  }
}
