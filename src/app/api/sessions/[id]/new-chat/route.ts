import { NextRequest } from 'next/server';
import {
  getChatSessionWithExecution,
  getAgent,
  getUserState,
  archiveChatSession,
  createExecutionChat,
  setExecutionLabel,
} from '@/lib/db/queries';
import { providerHarnessKey, type ProviderId } from '@/lib/agent-options';

/**
 * Start a fresh chat against the SAME execution as `:id` — a new conversation
 * on the existing worktree/branch/PR, optionally on a different provider. The
 * execution view's "new chat" button and the composer's provider switcher both
 * post here.
 *
 *   POST { providerId?: 'claude'|'codex', model?: string|null }
 *
 * The current chat is archived + its harness process torn down (the execution
 * itself stays active — only the conversation rolls over). The new chat becomes
 * the execution's active/primary chat; the client repoints to it.
 */
interface ChatOverride {
  providerId?: ProviderId;
  model?: string | null;
}

function parseOverride(src: { providerId?: unknown; model?: unknown }): ChatOverride {
  const out: ChatOverride = {};
  if (src.providerId === 'claude' || src.providerId === 'codex') out.providerId = src.providerId;
  if (src.model === null || typeof src.model === 'string') out.model = src.model;
  return out;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const override = parseOverride((body ?? {}) as { providerId?: unknown; model?: unknown });

  try {
    const current = getChatSessionWithExecution(id);
    if (!current) return Response.json({ error: 'Session not found' }, { status: 404 });
    if (!current.executionId) {
      return Response.json({ error: 'Not an execution chat' }, { status: 400 });
    }

    // Resolve the new chat's provider + model. A provider switch picks that
    // provider's executor (model defaults unless given); a plain new chat keeps
    // the current provider and carries the current model forward.
    const currentHarness = getAgent(current.agentId)?.harness ?? 'claude_code';
    const harness = override.providerId ? providerHarnessKey(override.providerId) : currentHarness;
    const model =
      override.model !== undefined
        ? override.model
        : override.providerId
          ? getUserState()?.defaultAgentModel ?? null
          : current.model;

    // The execution's title is what the header shows and must survive this
    // chat rollover. New executions carry it on the execution row, but legacy
    // ones (named before the title moved off chat_sessions) only have it on
    // the chat — promote it now so the new, blank chat doesn't leave the
    // header "Untitled".
    if (!current.execution?.label && current.label) {
      setExecutionLabel(current.executionId, current.label);
    }

    // Archive + tear down the current chat (keeps the execution + worktree).
    const { close } = await import('@/lib/executor/adapter');
    await close(current.id).catch(() => {});
    archiveChatSession(current.id);
    const { deriveRetrospectiveLabel } = await import('@/lib/sessions/derive-label');
    void deriveRetrospectiveLabel(current.id);

    const session = createExecutionChat({
      executionId: current.executionId,
      harness,
      model,
      effort: current.effort,
    });
    if (!session) return Response.json({ error: 'Execution not found' }, { status: 404 });

    return Response.json({ session });
  } catch (err) {
    console.error('[POST /api/sessions/:id/new-chat]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
