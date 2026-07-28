import { NextRequest } from 'next/server';
import {
  getChatSessionWithExecution,
  getAgent,
  createExecutionChat,
  deleteChatSessionIfEmpty,
  setExecutionLabel,
  updateUserState,
  ensureAgentHarnessSettings,
} from '@/lib/db/queries';
import { providerIdForHarness, type ProviderId } from '@/lib/agent-options';
import { EFFORT_LEVELS, type EffortLevel } from '@/db/types';
import { resolveAgentSelection } from '@/lib/agent-model-discovery';
import { isHarnessId } from '@/lib/agents/registry';

/**
 * Start a fresh chat against the SAME execution as `:id` — a new conversation
 * on the existing worktree/branch/PR, optionally on a different provider. The
 * execution view's "new chat" button and the composer's provider switcher both
 * post here.
 *
 *   POST { providerId?: 'claude'|'codex', model?: string, effort?: EffortLevel }
 *
 * The current chat stays OPEN — parallel chats on one execution are the
 * normal working mode (ask a side question while the main agent runs, fire
 * two independent threads on the same worktree). The chat tab strip is the
 * management surface; closing a conversation is an explicit X there
 * (`POST /:id/close-chat`), never a side effect of opening a new one.
 */
interface ChatOverride {
  providerId?: ProviderId;
  model?: string;
  variant?: string;
  effort?: EffortLevel;
}

function parseOverride(src: { providerId?: unknown; model?: unknown; variant?: unknown; effort?: unknown }): ChatOverride {
  const out: ChatOverride = {};
  if (isHarnessId(src.providerId)) out.providerId = src.providerId;
  if (typeof src.model === 'string' && src.model.trim()) out.model = src.model.trim();
  if (typeof src.variant === 'string' && src.variant.trim()) out.variant = src.variant.trim();
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
    variant?: unknown;
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
    const harnessSettings = ensureAgentHarnessSettings(providerId);
    const requestedModel = override.model
      ?? (switchingProvider ? harnessSettings.defaultModel : current.model);
    const selection = await resolveAgentSelection(providerId, {
      model: requestedModel,
      variant: override.variant
        ?? (switchingProvider && requestedModel === harnessSettings.defaultModel
          ? harnessSettings.defaultVariant
          : current.modelVariant),
      effort: override.effort
        ?? (switchingProvider ? harnessSettings.defaultEffort : current.effort),
    }, { cwd: current.worktreePath ?? undefined, repairInvalidModel: override.model === undefined });

    // The execution's title is what the header shows and must not depend on
    // which chat is being viewed. New executions carry it on the execution
    // row, but legacy ones (named before the title moved off chat_sessions)
    // only have it on the chat — promote it now so a blank sibling doesn't
    // leave the header "Untitled".
    if (!current.execution?.label && current.label) {
      setExecutionLabel(current.executionId, current.label);
    }

    const session = createExecutionChat({
      executionId: current.executionId,
      harness: selection.harness,
      model: selection.model,
      modelVariant: selection.variant,
      effort: selection.effort,
    });
    if (!session) return Response.json({ error: 'Execution not found' }, { status: 404 });

    // Clean up an accidental blank chat: if the chat we started from never
    // received a single event, opening a new one almost certainly means
    // the blank was a misfire — delete it rather than strand an empty tab.
    // No-op the instant there's any transcript, so parallel chats with
    // real work are never touched. Guarded so we can't delete the chat we
    // just created (a fresh execution's first chat is momentarily empty).
    if (session.id !== current.id) {
      deleteChatSessionIfEmpty(current.id);
    }

    updateUserState({
      defaultAgentHarness: selection.providerId,
      defaultAgentModel: selection.model,
      defaultAgentEffort: selection.effort,
    });

    // Return the same shape as `GET /api/sessions/:id` — execution state
    // flattened on, `agentHarness` sidecar'd — rather than the bare insert
    // result. The client seeds this straight into the `['session', id]`
    // cache so the view can repoint without a refetch, and a bare row
    // would land there missing `worktreePath` (the view would fall into
    // its "setting up" state on a worktree that's right there) and
    // `agentHarness` (the composer would lose its model catalog).
    const full = getChatSessionWithExecution(session.id);
    if (!full) return Response.json({ error: 'Chat not found after create' }, { status: 500 });
    const newAgent = getAgent(full.agentId);
    return Response.json({ session: { ...full, agentHarness: newAgent?.harness ?? null } });
  } catch (err) {
    console.error('[POST /api/sessions/:id/new-chat]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
