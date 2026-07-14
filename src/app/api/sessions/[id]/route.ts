import type { NextRequest } from 'next/server';
import {
  getChatSessionWithExecution,
  getAgent,
  updateChatSession,
  updateUserState,
  setExecutionPR,
  setExecutionLabel,
} from '@/lib/db/queries';
import { PERMISSION_MODES, EFFORT_LEVELS, type PermissionMode, type EffortLevel } from '@/db/types';
import * as executor from '@/lib/executor/adapter';
import { explicitAgentSelection, providerIdForHarness } from '@/lib/agent-options';
import { getAgentModelCatalog } from '@/lib/agent-model-discovery';
import { getHarnessRuntime } from '@/lib/agents/runtime';
import { getAppRoot } from '@/lib/config/paths';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const row = getChatSessionWithExecution(id);
    if (!row) return Response.json({ error: 'Session not found' }, { status: 404 });
    // Sidecar `agentHarness` so the composer can pick the right model
    // catalog without a second round-trip. Cheap join; the agent row is
    // immutable for the session's lifetime.
    const agent = getAgent(row.agentId);
    return Response.json({ ...row, agentHarness: agent?.harness ?? null });
  } catch (err) {
    console.error('[GET /api/sessions/:id]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

interface PatchBody {
  label?: string | null;
  /**
   * The execution's stable title (shown in the header). Lives on the
   * execution, not the chat — so renaming here survives a "new chat" on
   * the same execution. `null`/empty clears it. Distinct from `label`,
   * which is the per-chat title in the history dropdown.
   */
  executionLabel?: string | null;
  permissionMode?: PermissionMode;
  /** Explicit provider model id. */
  model?: string;
  /** Provider-native variant, separate from reasoning effort. */
  modelVariant?: string | null;
  /** Explicit provider reasoning effort. */
  effort?: EffortLevel | null;
  /** Explicit PR link. `null` clears the link. */
  prNumber?: number | null;
}

function selectionChangeWhileRunningResponse(): Response {
  return Response.json({
    error: 'selection_change_while_running',
    reason: 'Wait for the active turn to finish before changing its model, variant, effort, or mode.',
  }, { status: 409 });
}

/**
 * Updates a small whitelist of session fields. Label is freeform; other
 * mutations have dedicated routes (`/view`, `/archive`, etc.) so this is
 * intentionally narrow rather than a generic "update session".
 *
 * `permissionMode` change behavior: the row is updated, then the
 * cached AgentSession (if any) is closed via `executor.recycleForModeChange`.
 * The next dispatch reopens the CLI with the new `--permission-mode`
 * flag and resumes the conversation via `externalSessionId`. We don't
 * await the close — the route returns as soon as the row update lands.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body: PatchBody = await request.json();

    const existing = getChatSessionWithExecution(id);
    if (!existing) return Response.json({ error: 'Session not found' }, { status: 404 });

    const updates: PatchBody = {};
    if ('label' in body) {
      const trimmed = typeof body.label === 'string' ? body.label.trim() : null;
      updates.label = trimmed || null;
    }
    // Track whether any executor-relevant field changed; if so, recycle
    // the cached AgentSession so the next dispatch spawns a fresh CLI
    // process with the new --permission-mode / --model / --effort flags.
    let executorChanged = false;
    if ('permissionMode' in body) {
      const mode = body.permissionMode;
      if (!mode || !PERMISSION_MODES.includes(mode)) {
        return Response.json(
          { error: `Invalid permissionMode. Expected one of ${PERMISSION_MODES.join(', ')}.` },
          { status: 400 },
        );
      }
      if (mode !== existing.permissionMode && executor.isRunning(id)) {
        return selectionChangeWhileRunningResponse();
      }
      const agent = getAgent(existing.agentId);
      const providerId = providerIdForHarness(agent?.harness);
      const cwd = executor.resolveCwd(existing) ?? getAppRoot();
      const runtime = await getHarnessRuntime(providerId, { cwd });
      if (mode === 'plan' && !runtime.capabilities.planMode.supported) {
        return Response.json(
          { error: runtime.capabilities.planMode.reason ?? 'Plan mode is unavailable for this harness' },
          { status: 409 },
        );
      }
      if ((mode === 'default' || mode === 'accept_edits') && !runtime.capabilities.permissionRequests.supported) {
        return Response.json(
          { error: runtime.capabilities.permissionRequests.reason ?? 'Permission prompts are unavailable for this harness' },
          { status: 409 },
        );
      }
      if (mode === 'accept_edits' && providerId === 'opencode') {
        return Response.json(
          { error: 'Accept edits mode is not available for OpenCode' },
          { status: 409 },
        );
      }
      if (mode !== existing.permissionMode) {
        updates.permissionMode = mode;
        executorChanged = true;
        // Track prior mode on plan entry so ExitPlanMode can revert.
        // Cleared on any non-plan transition. Mirrors Claude Code's
        // ToolPermissionContext.prePlanMode behavior.
        if (mode === 'plan' && existing.permissionMode !== 'plan') {
          (updates as Record<string, unknown>).prePlanMode = existing.permissionMode;
        } else if (mode !== 'plan' && existing.prePlanMode) {
          (updates as Record<string, unknown>).prePlanMode = null;
        }
      }
    }
    let nextSelection: ReturnType<typeof explicitAgentSelection> | null = null;
    if ('model' in body || 'modelVariant' in body || 'effort' in body) {
      const agent = getAgent(existing.agentId);
      const providerId = providerIdForHarness(agent?.harness);
      const cwd = executor.resolveCwd(existing) ?? getAppRoot();
      const [catalog, runtime] = await Promise.all([
        getAgentModelCatalog(providerId, { cwd }),
        getHarnessRuntime(providerId, { cwd }),
      ]);
      const requestedModel = 'model' in body ? body.model?.trim() : existing.model;
      if ('model' in body && (!requestedModel || !catalog.some((model) => model.id === requestedModel))) {
        return Response.json(
          { error: `Invalid model for ${providerId}. Pick a model from that provider's catalog.` },
          { status: 400 },
        );
      }

      const requestedVariant = 'modelVariant' in body
        ? (typeof body.modelVariant === 'string' ? body.modelVariant.trim() || null : null)
        : existing.modelVariant;
      const requestedEffort = 'effort' in body ? body.effort : existing.effort;
      if ('effort' in body && (!requestedEffort || !EFFORT_LEVELS.includes(requestedEffort))) {
        return Response.json(
          { error: `Invalid effort. Expected one of ${EFFORT_LEVELS.join(', ')}.` },
          { status: 400 },
        );
      }

      nextSelection = explicitAgentSelection(
        providerId,
        { model: requestedModel, variant: requestedVariant, effort: requestedEffort },
        catalog,
      );
      if ('modelVariant' in body && nextSelection.variant !== requestedVariant) {
        return Response.json(
          { error: `Variant ${requestedVariant ?? 'default'} is not supported by model ${nextSelection.model}.` },
          { status: 400 },
        );
      }
      if ('effort' in body && nextSelection.effort !== requestedEffort) {
        return Response.json(
          { error: `Effort ${requestedEffort} is not supported by model ${nextSelection.model}.` },
          { status: 400 },
        );
      }
      if (
        executor.isRunning(id)
        && (
          nextSelection.model !== existing.model
          || nextSelection.variant !== existing.modelVariant
          || nextSelection.effort !== existing.effort
        )
      ) {
        return selectionChangeWhileRunningResponse();
      }
      if (nextSelection.model !== existing.model) {
        if (!runtime.capabilities.sessionModelChange.supported) {
          return Response.json({
            error: 'selection_requires_new_chat',
            reason: runtime.capabilities.sessionModelChange.reason,
          }, { status: 409 });
        }
        updates.model = nextSelection.model;
        executorChanged = true;
      }
      if (nextSelection.variant !== existing.modelVariant) {
        if (!runtime.capabilities.sessionVariantChange.supported) {
          return Response.json({
            error: 'selection_requires_new_chat',
            reason: runtime.capabilities.sessionVariantChange.reason,
          }, { status: 409 });
        }
        updates.modelVariant = nextSelection.variant;
        executorChanged = true;
      }
      if (nextSelection.effort !== existing.effort) {
        if (!runtime.capabilities.sessionEffortChange.supported) {
          return Response.json({
            error: 'selection_requires_new_chat',
            reason: runtime.capabilities.sessionEffortChange.reason,
          }, { status: 409 });
        }
        updates.effort = nextSelection.effort;
        executorChanged = true;
      }
    }
    // prNumber was lifted off chat_sessions onto the execution. Route it
    // to the execution row rather than the chat update below.
    let prChanged = false;
    if ('prNumber' in body) {
      const num = body.prNumber;
      if (num !== null && (typeof num !== 'number' || !Number.isInteger(num) || num <= 0)) {
        return Response.json(
          { error: 'Invalid prNumber. Expected a positive integer or null.' },
          { status: 400 },
        );
      }
      if (existing.executionId && num !== existing.prNumber) {
        setExecutionPR(existing.executionId, num ?? null);
        prChanged = true;
      }
    }

    // executionLabel is the execution's stable header title — also on the
    // execution row, so route it there (same pattern as prNumber). The
    // chat's own `label` above is untouched, keeping the two titles
    // independent.
    let executionChanged = false;
    if ('executionLabel' in body && existing.executionId) {
      const trimmed = typeof body.executionLabel === 'string' ? body.executionLabel.trim() : null;
      const next = trimmed || null;
      if (next !== (existing.execution?.label ?? null)) {
        setExecutionLabel(existing.executionId, next);
        executionChanged = true;
      }
    }

    // No-op when nothing on the chat row changed (e.g. PATCH with
    // permissionMode matching the current value). Drizzle's update()
    // throws "No values to set" with an empty patch, so short-circuit. A
    // prNumber/executionLabel-only change is applied to the execution
    // above, so reload the flattened row to reflect it.
    if (nextSelection) {
      updateUserState({
        defaultAgentHarness: nextSelection.providerId,
        defaultAgentModel: nextSelection.model,
        defaultAgentEffort: nextSelection.effort,
      });
    }
    if (Object.keys(updates).length === 0) {
      return Response.json(prChanged || executionChanged ? getChatSessionWithExecution(id) : existing);
    }

    const row = updateChatSession(id, updates);
    if (!row) return Response.json({ error: 'Session not found' }, { status: 404 });

    if (executorChanged) {
      // Fire-and-forget: a fresh CLI process spawns on the next message.
      executor.recycleForModeChange(id).catch((err) => {
        console.error(`[PATCH /api/sessions/:id] recycleForModeChange failed for ${id}:`, err);
      });
    }

    // Return the flattened row so the client sees worktree/branch/pr state
    // sourced from the execution, consistent with GET.
    return Response.json(getChatSessionWithExecution(id));
  } catch (err) {
    console.error('[PATCH /api/sessions/:id]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
