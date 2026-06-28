import {
  listChatSessions,
  createChatSession,
  archiveChatSession,
  getOrCreateDefaultOrchestrator,
  getUserState,
} from '@/lib/db/queries';
import { providerHarnessKey, type ProviderId } from '@/lib/agent-options';
import type { ChatSessionWithExecution } from '@/db/types';

/** Optional per-chat provider/model override (the composer's "switch provider"). */
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

/** user_state.defaultAgentHarness ('claude' | 'codex') → agents.harness vocabulary. */
function defaultHarness(): string {
  const pref = getUserState()?.defaultAgentHarness;
  return pref === 'codex' ? 'codex' : 'claude_code';
}

function createFocusedSession(ref: EntityRef, override: ChatOverride = {}) {
  // Provider: the explicit override (composer "switch provider") wins;
  // otherwise the user's default harness.
  const harness = override.providerId ? providerHarnessKey(override.providerId) : defaultHarness();
  const agent = getOrCreateDefaultOrchestrator(harness);
  const userState = getUserState();
  // Model: an explicit override (even null) wins; else the user's default.
  const model = override.model !== undefined ? override.model : userState?.defaultAgentModel ?? null;
  return createChatSession({
    type: 'content',
    agentId: agent.id,
    // Pins the harness session to this one entity (see harness-surface's
    // renderContentFocusPrompt + the adapter's content branch).
    surfaceKind: ref.entityType,
    surfaceRef: ref.entityId,
    model,
    // Effort: seeded from the user's default (last composer pick). Null =
    // harness default. Overridable per-session in the composer.
    effort: userState?.defaultAgentEffort ?? null,
    // Label stays null until the first send — the messages route's label
    // derivation only fires on unlabeled sessions.
    label: null,
    status: 'active',
  });
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
    const session = findCurrent(ref) ?? createFocusedSession(ref);
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
  const src = (body ?? {}) as { entityType?: unknown; entityId?: unknown; providerId?: unknown; model?: unknown };
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
    const session = createFocusedSession(ref, override);
    return Response.json({ session });
  } catch (err) {
    console.error('[POST /api/document-chat]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
