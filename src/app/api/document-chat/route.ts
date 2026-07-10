import {
  listChatSessions,
  createChatSession,
  archiveChatSession,
  getOrCreateDefaultOrchestrator,
  getUserState,
  updateUserState,
} from '@/lib/db/queries';
import type { ProviderId } from '@/lib/agent-options';
import { EFFORT_LEVELS, type ChatSessionWithExecution, type EffortLevel } from '@/db/types';
import { resolveAgentSelection } from '@/lib/agent-model-discovery';

/** Optional per-chat provider/model override (the composer's "switch provider"). */
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

/**
 * The in-document (note/task) chat session — a focused `type='content'`
 * harness session, scoped to one entity via `surfaceKind`/`surfaceRef`.
 *
 * This replaced the old direct-to-OpenAI copilot: the in-document chat now
 * runs on the same harness as the orchestrator (Claude Code today, via the
 * user's subscription), acting through the orchestrator action surface — so
 * its edits flow through `queries.ts` (embeddings, mirror, attachment
 * derivation, and change versioning) instead of bypassing it. See
 * `ensureAgentSession`'s `content` branch in `src/lib/executor/adapter.ts`
 * for how the per-entity focus is installed.
 *
 * One active session per entity at a time:
 *   GET  ?entityType=task|note&entityId=<id> → return it, creating one if
 *        none exists ("ensure" semantics — same pattern as orchestrator-chat).
 *        Persistent: reopening the doc resumes the same thread.
 *   POST { entityType, entityId } → start fresh: archive the current session
 *        (closing its harness process) and create a new one. The "New chat"
 *        affordance in the slideout.
 *
 * Messages are sent and streamed through the shared per-session transport
 * (`/api/sessions/[id]/messages` + `/api/sessions/[id]/stream`), identical to
 * the orchestrator and execution chats.
 */

type SurfaceKind = 'task' | 'note';

interface EntityRef {
  entityType: SurfaceKind;
  entityId: string;
}

function parseEntity(source: { entityType?: unknown; entityId?: unknown }): EntityRef | null {
  const { entityType, entityId } = source;
  if ((entityType !== 'task' && entityType !== 'note') || typeof entityId !== 'string' || !entityId) {
    return null;
  }
  return { entityType, entityId };
}

/** The active, user-opened content session for an entity (excludes scheduled/run-created chats). */
function findCurrent(ref: EntityRef): ChatSessionWithExecution | null {
  const sessions = listChatSessions({ type: 'content', status: 'active' });
  return (
    sessions.find(
      (s) =>
        s.surfaceKind === ref.entityType &&
        s.surfaceRef === ref.entityId &&
        s.createdByRunId === null,
    ) ?? null
  );
}

async function createFocusedSession(ref: EntityRef, override: ChatOverride = {}) {
  const userState = getUserState();
  const providerId = override.providerId
    ?? (userState?.defaultAgentHarness === 'codex' ? 'codex' : 'claude');
  const savedTupleMatchesProvider = userState?.defaultAgentHarness === providerId;
  const selection = await resolveAgentSelection(providerId, {
    model: override.model
      ?? (savedTupleMatchesProvider ? userState?.defaultAgentModel : null),
    effort: override.effort
      ?? (savedTupleMatchesProvider ? userState?.defaultAgentEffort : null),
  });
  const agent = getOrCreateDefaultOrchestrator(selection.harness);
  const session = createChatSession({
    type: 'content',
    agentId: agent.id,
    // Pins the harness session to this one entity (see harness-surface's
    // renderContentFocusPrompt + the adapter's content branch).
    surfaceKind: ref.entityType,
    surfaceRef: ref.entityId,
    model: selection.model,
    effort: selection.effort,
    // Label stays null until the first send — the messages route's label
    // derivation only fires on unlabeled sessions.
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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ref = parseEntity({
    entityType: searchParams.get('entityType') ?? undefined,
    entityId: searchParams.get('entityId') ?? undefined,
  });
  if (!ref) {
    return Response.json({ error: 'entityType (task|note) and entityId are required' }, { status: 400 });
  }
  try {
    const session = findCurrent(ref) ?? await createFocusedSession(ref);
    return Response.json({ session });
  } catch (err) {
    console.error('[GET /api/document-chat]', err);
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
  const src = (body ?? {}) as {
    entityType?: unknown;
    entityId?: unknown;
    providerId?: unknown;
    model?: unknown;
    effort?: unknown;
  };
  const ref = parseEntity(src);
  if (!ref) {
    return Response.json({ error: 'entityType (task|note) and entityId are required' }, { status: 400 });
  }
  const override = parseOverride(src);
  try {
    const current = findCurrent(ref);
    if (current) {
      // Tear down the cached AgentSession so the archived chat's process
      // doesn't linger; the next dispatch on the new session spawns fresh.
      const { close } = await import('@/lib/executor/adapter');
      await close(current.id).catch(() => {});
      archiveChatSession(current.id);
      // Title the closed thread retrospectively (fire-and-forget).
      const { deriveRetrospectiveLabel } = await import('@/lib/sessions/derive-label');
      void deriveRetrospectiveLabel(current.id);
    }
    const session = await createFocusedSession(ref, override);
    return Response.json({ session });
  } catch (err) {
    console.error('[POST /api/document-chat]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
