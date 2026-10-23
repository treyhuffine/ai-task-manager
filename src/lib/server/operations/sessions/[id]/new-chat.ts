import { mainChatReplacementRefusal } from '@/lib/sessions/home-policy';
import { actorFromRequest } from '@/lib/auth/actor';
import { EFFORT_LEVELS, type EffortLevel } from '@/db/types';
import {
  createExecutionChat,
  deleteChatSessionIfEmpty,
  getChatSessionWithExecution,
  getLastChatEventBySource,
  listExecutionChatIds,
  setExecutionLabel,
} from '@/lib/db/queries';
import { permissionsForNewChat, UnsupportedPermissionModeError } from '@/lib/executor/permission-map';
import { resolveHarnessSelection } from '@/lib/harness/model-discovery';
import { resolveStartSelection } from '@/lib/harness/start-selection';
import type { ProviderId } from '@/lib/harness/options';
import { HarnessDisabledError, isKnownHarnessId } from '@/lib/harness/registry';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
import { getRequestKey } from '@/lib/auth/request-key';
import { siblingChatPolicy } from '@/lib/sessions/home-policy';
import { executionOperationFailure } from '@/lib/workspaces/access';

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
 *
 * `forApp` is a new chat a connected app asked for (`target: "new"`), where
 * its draft goes. An app needs no click to ask, so the execution's newest
 * chat is reused while nobody has written in it, and asking again can't pile
 * up chats.
 */
interface ChatOverride {
  providerId?: ProviderId;
  model?: string;
  variant?: string;
  effort?: EffortLevel;
  serviceTier?: string;
}

function parseOverride(src: { providerId?: unknown; model?: unknown; variant?: unknown; effort?: unknown; serviceTier?: unknown }): ChatOverride {
  const out: ChatOverride = {};
  if (isKnownHarnessId(src.providerId)) out.providerId = src.providerId;
  if (typeof src.model === 'string' && src.model.trim()) out.model = src.model.trim();
  if (typeof src.variant === 'string' && src.variant.trim()) out.variant = src.variant.trim();
  if (typeof src.effort === 'string' && EFFORT_LEVELS.includes(src.effort as EffortLevel)) {
    out.effort = src.effort as EffortLevel;
  }
  if (typeof src.serviceTier === 'string') out.serviceTier = src.serviceTier;
  return out;
}

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  const refusal = mainChatReplacementRefusal(actorFromRequest(request.headers));
  if (refusal) return reply({ error: refusal }, { status: 403 });
  const { id } = rpcInput.params;
  let body: unknown;
  try {
    body = rpcInput.body;
  } catch {
    body = {};
  }
  const override = parseOverride((body ?? {}) as {
    providerId?: unknown;
    model?: unknown;
    variant?: unknown;
    effort?: unknown; serviceTier?: unknown;
  });

  try {
    const current = getChatSessionWithExecution(id);
    if (!current) return reply({ error: 'Session not found' }, { status: 404 });
    if (!current.executionId) {
      return reply({ error: 'Not an execution chat' }, { status: 400 });
    }
    if (rpcInput.body.forApp === true) {
      const newest = listExecutionChatIds(current.executionId).map(getChatSessionWithExecution)
        .filter((chat) => chat && chat.status === 'active' && chat.surfaceKind !== 'result_review').at(-1);
      if (newest && !getLastChatEventBySource(newest.id, 'user')) return reply({ session: newest });
    }

    // Resolve one provider-bound tuple before archiving the current chat. A
    // plain new chat carries its tuple forward. A provider switch starts from
    // the destination model + effort supplied by the picker.
    const providerId = override.providerId ?? current.harness;
    const permissions = permissionsForNewChat(providerId, current);
    const switchingProvider = providerId !== current.harness;
    const cwd = current.worktreePath ?? undefined;
    const homePolicy = await siblingChatPolicy(getRequestKey(request.headers), id, { harness: providerId, model: override.model ?? (switchingProvider ? undefined : current.model), modelVariant: override.variant ?? (switchingProvider ? undefined : current.modelVariant), effort: override.effort ?? (switchingProvider ? undefined : current.effort), serviceTier: override.serviceTier ?? (switchingProvider || (override.model && override.model !== current.model) ? undefined : current.serviceTier) });
    const selection = homePolicy?.selection ?? (switchingProvider
      ? await resolveStartSelection({ ...override, providerId }, { cwd })
      : await resolveHarnessSelection(providerId, {
        model: override.model ?? current.model,
        variant: override.variant ?? current.modelVariant,
        effort: override.effort ?? current.effort,
        serviceTier: override.serviceTier ?? (!override.model || override.model === current.model ? current.serviceTier : null),
      }, { cwd, repairInvalidModel: override.model === undefined }));
    homePolicy?.verify();

    // The execution's title is what the header shows and must not depend on
    // which chat is being viewed. New executions carry it on the execution
    // row, but legacy ones (named before the title moved off chat_sessions)
    // only have it on the chat — promote it now so a blank sibling doesn't
    // leave the header "Untitled".
    if (!current.execution?.label && current.label) {
      setExecutionLabel(current.executionId, current.label);
    }

    const session = createExecutionChat({
      ...permissions,
      ...(homePolicy?.permissionMode ? { permissionMode: homePolicy.permissionMode, prePlanMode: homePolicy.prePlanMode ?? null } : {}),
      executionId: current.executionId,
      harness: selection.providerId,
      model: selection.model,
      modelVariant: selection.variant,
      effort: selection.effort,
      createdByMemberId: homePolicy?.memberId ?? null,
      surfaceKind: homePolicy?.surfaceKind ?? null,
      serviceTier: selection.serviceTier,
    });
    if (!session) return reply({ error: 'Execution not found' }, { status: 404 });

    // Clean up an accidental blank chat: if the chat we started from never
    // received a single event, opening a new one almost certainly means
    // the blank was a misfire — delete it rather than strand an empty tab.
    // No-op the instant there's any transcript, so parallel chats with
    // real work are never touched. Guarded so we can't delete the chat we
    // just created (a fresh execution's first chat is momentarily empty).
    if (!homePolicy && session.id !== current.id) {
      deleteChatSessionIfEmpty(current.id);
    }

    // Return the same shape as `GET /api/sessions/:id` (execution state
    // flattened on) rather than the bare insert result. The client seeds this
    // straight into the `['session', id]` cache so the view can repoint
    // without a refetch, and a bare row would land there missing
    // `worktreePath` (the view would fall into its "setting up" state on a
    // worktree that's right there).
    const full = getChatSessionWithExecution(session.id);
    if (!full) return reply({ error: 'Chat not found after create' }, { status: 500 });
    return reply({ session: full });
  } catch (err) {
    const denied = executionOperationFailure(err);
    if (denied) return denied;
    console.error('[POST /api/sessions/:id/new-chat]', err);
    return reply({ error: String(err) }, { status: err instanceof HarnessDisabledError || err instanceof UnsupportedPermissionModeError ? 409 : 500 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({ "providerId": rpcZ.enum(["cursor", "antigravity", "claude", "codex", "opencode"]).optional(), "model": rpcZ.string().optional(), "variant": rpcZ.string().optional(), "serviceTier": rpcZ.string().trim().min(1).optional(), "effort": rpcZ.enum(["low", "medium", "high", "xhigh", "max", "ultra"]).optional(), "forApp": rpcZ.boolean().optional() }).strict().default({}) }).strict();
