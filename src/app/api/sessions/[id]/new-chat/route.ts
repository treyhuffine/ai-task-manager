import { NextRequest } from 'next/server';
import {
  getChatSessionWithExecution,
  getAgent,
  archiveChatSession,
  createExecutionChat,
  setExecutionLabel,
  updateUserState,
} from '@/lib/db/queries';
import { providerIdForHarness, type ProviderId } from '@/lib/agent-options';
import { EFFORT_LEVELS, type EffortLevel } from '@/db/types';
import { resolveAgentSelection } from '@/lib/agent-model-discovery';

/**
 * Start a fresh chat against the SAME execution as `:id` — a new conversation
 * on the existing worktree/branch/PR, optionally on a different provider. The
 * execution view's "new chat" button and the composer's provider switcher both
 * post here.
 *
 *   POST { providerId?: 'claude'|'codex', model?: string, effort?: EffortLevel }
 *
 * The current chat is archived + its harness process torn down (the execution
 * itself stays active — only the conversation rolls over). The new chat becomes
 * the execution's active/primary chat; the client repoints to it.
 */
interface ChatOverride {
  providerId?: ProviderId;
  model?: string;
  effort?: EffortLevel;
}

function parseOverride(src: { providerId?: unknown; model?: unknown; effort?: unknown }): ChatOverride {
  const out: ChatOverride = {};
  if (src.providerId === 'claude' || src.providerId === 'codex') out.providerId = src.providerId;
  if (typeof src.model === 'string' && src.model.trim()) out.model = src.model.trim();
  if (typeof src.effort === 'string' && EFFORT_LEVELS.includes(src.effort as EffortLevel)) {
    out.effort = src.effort as EffortLevel;
  }
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
  const override = parseOverride((body ?? {}) as {
    providerId?: unknown;
    model?: unknown;
    effort?: unknown;
  });

  try {
    const current = getChatSessionWithExecution(id);
    if (!current) return Response.json({ error: 'Session not found' }, { status: 404 });
    if (!current.executionId) {
      return Response.json({ error: 'Not an execution chat' }, { status: 400 });
    }

    // Resolve one provider-bound tuple before archiving the current chat. A
    // plain new chat carries its tuple forward. A provider switch starts from
    // the destination model + effort supplied by the picker.
    const currentHarness = getAgent(current.agentId)?.harness ?? 'claude_code';
    const providerId = override.providerId ?? providerIdForHarness(currentHarness);
    const switchingProvider = providerId !== providerIdForHarness(currentHarness);
    const selection = await resolveAgentSelection(providerId, {
      model: override.model ?? (switchingProvider ? null : current.model),
      effort: override.effort ?? (switchingProvider ? null : current.effort),
    });

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
      harness: selection.harness,
      model: selection.model,
      effort: selection.effort,
    });
    if (!session) return Response.json({ error: 'Execution not found' }, { status: 404 });

    updateUserState({
      defaultAgentHarness: selection.providerId,
      defaultAgentModel: selection.model,
      defaultAgentEffort: selection.effort,
    });

    return Response.json({ session });
  } catch (err) {
    console.error('[POST /api/sessions/:id/new-chat]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
