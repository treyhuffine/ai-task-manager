import {
  listChatSessions,
  createChatSession,
  archiveChatSession,
  getOrCreateDefaultOrchestrator,
  getUserState,
  updateUserState,
  ensureAgentHarnessSettings,
} from '@/lib/db/queries';
import type { ProviderId } from '@/lib/agent-options';
import { EFFORT_LEVELS, type ChatSessionWithExecution, type EffortLevel } from '@/db/types';
import { resolveAgentSelection } from '@/lib/agent-model-discovery';
import { isHarnessId } from '@/lib/agents/registry';
import { withCompression } from '@/lib/api/compression';

/** Optional per-chat provider/model override (the composer's "switch provider"). */
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

/**
 * The dashboard's interactive orchestrator chat session (harness modes).
 *
 * One active interactive orchestration session at a time:
 *   GET  → return it, creating one if none exists ("ensure" semantics —
 *          same pattern as the dev scratch route).
 *   POST → start fresh: archive the current one (closing its cached
 *          harness process) and create a new session. Used by the
 *          "New chat" affordance and by mode switches — mode flags are
 *          read at process spawn, so a new session is the clean cut.
 *
 * Scheduled orchestrator fires also create `type='orchestration'` chats;
 * those carry `createdByRunId` and are excluded here — this route only
 * manages the user-facing chat.
 */

function findCurrent(): ChatSessionWithExecution | null {
  const sessions = listChatSessions({ type: 'orchestration', status: 'active' });
  return sessions.find((s) => s.createdByRunId === null) ?? null;
}

async function createInteractiveSession(override: ChatOverride = {}) {
  const userState = getUserState();
  const providerId = override.providerId
    ?? userState?.defaultAgentHarness
    ?? 'claude';
  const savedTupleMatchesProvider = userState?.defaultAgentHarness === providerId;
  const harnessSettings = ensureAgentHarnessSettings(providerId);
  const requestedModel = override.model
    ?? (savedTupleMatchesProvider ? userState?.defaultAgentModel : null)
    ?? harnessSettings.defaultModel;
  const selection = await resolveAgentSelection(providerId, {
    model: requestedModel,
    variant: override.variant
      ?? (requestedModel === harnessSettings.defaultModel ? harnessSettings.defaultVariant : null),
    effort: override.effort
      ?? (savedTupleMatchesProvider ? userState?.defaultAgentEffort : null)
      ?? harnessSettings.defaultEffort,
  }, { repairInvalidModel: override.model === undefined });
  const agent = getOrCreateDefaultOrchestrator(selection.harness);
  const session = createChatSession({
    type: 'orchestration',
    agentId: agent.id,
    model: selection.model,
    modelVariant: selection.variant,
    effort: selection.effort,
    // Label stays null until the first send — the messages route's
    // `deriveAndSetSessionLabel` (haiku-via-harness, same pipeline that
    // names executions) only fires on unlabeled sessions. A hardcoded
    // placeholder here would permanently block the generated title.
    label: null,
    status: 'active',
  });
  updateUserState({
    defaultAgentHarness: selection.providerId,
    defaultAgentModel: selection.model,
    defaultAgentEffort: selection.effort,
  });
  return session;
}

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET() {
  try {
    const session = findCurrent() ?? await createInteractiveSession();
    return Response.json({ session });
  } catch (err) {
    console.error('[GET /api/orchestrator-chat]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
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
    const current = findCurrent();
    if (current) {
      // Tear down the cached AgentSession so the archived chat's process
      // doesn't linger; the next dispatch on the new session spawns fresh
      // with the current mode's flags.
      const { close } = await import('@/lib/executor/adapter');
      await close(current.id).catch(() => {});
      archiveChatSession(current.id);
      // Archive is the one moment a thread's whole arc is known — title it
      // retrospectively (fire-and-forget; history shows a snippet until the
      // summary lands, or forever if the call fails).
      const { deriveRetrospectiveLabel } = await import('@/lib/sessions/derive-label');
      void deriveRetrospectiveLabel(current.id);
    }
    const session = await createInteractiveSession(override);
    return Response.json({ session });
  } catch (err) {
    console.error('[POST /api/orchestrator-chat]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
