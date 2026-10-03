import {
  listChatSessions,
  createChatSession,
  archiveChatSession,
  getUserState,
  ensureHarnessSettings,
} from '@/lib/db/queries';
import type { ProviderId } from '@/lib/harness/options';
import { EFFORT_LEVELS, type ChatSessionWithExecution, type EffortLevel } from '@/db/types';
import { resolveHarnessSelection } from '@/lib/harness/model-discovery';
import { assertHarnessEnabled, DEFAULT_HARNESS, HarnessDisabledError, isKnownHarnessId } from '@/lib/harness/registry';
import { withCompression } from '@/lib/api/compression';
import { findSkill } from '@/lib/skills/locations';
import { permissionsForNewChat, UnsupportedPermissionModeError } from '@/lib/executor/permission-map';

/** Optional per-chat provider/model override (the composer's "switch provider"). */
interface ChatOverride {
  providerId?: ProviderId;
  model?: string;
  variant?: string;
  effort?: EffortLevel;
}

function parseOverride(src: { providerId?: unknown; model?: unknown; variant?: unknown; effort?: unknown }): ChatOverride {
  const out: ChatOverride = {};
  if (isKnownHarnessId(src.providerId)) out.providerId = src.providerId;
  if (typeof src.model === 'string' && src.model.trim()) out.model = src.model.trim();
  if (typeof src.variant === 'string' && src.variant.trim()) out.variant = src.variant.trim();
  if (typeof src.effort === 'string' && EFFORT_LEVELS.includes(src.effort as EffortLevel)) {
    out.effort = src.effort as EffortLevel;
  }
  return out;
}

/**
 * The in-document (note/task) chat session — a focused `type='content'`
 * harness session, scoped to one entity via `surfaceKind`/`surfaceRef`. A
 * skill's builder and try chats are the same kind of session (see
 * SURFACE_KINDS below).
 *
 * This replaced the old direct-to-OpenAI copilot: the in-document chat now
 * runs on the same harness as the orchestrator (Claude Code today, via the
 * user's subscription), acting through the orchestrator action surface — so
 * its edits flow through `queries.ts` (embeddings, mirror, attachment
 * derivation, and change versioning) instead of bypassing it. See
 * `ensureHarnessSession`'s `content` branch in `src/lib/executor/adapter.ts`
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

/**
 * What a focused chat can be about. Besides a task or note, a skill has two
 * (docs/skills.md): its builder chat ('skill', briefed to write the skill,
 * see src/lib/skills/builder-brief.ts) and its try chat ('skill-try', an
 * ordinary chat that gets the skill, wherever it lives). For both, the id
 * is the skill's ref (src/lib/skills/locations.ts).
 */
const SURFACE_KINDS = ['task', 'note', 'skill', 'skill-try'] as const;
type SurfaceKind = (typeof SURFACE_KINDS)[number];

interface EntityRef {
  entityType: SurfaceKind;
  entityId: string;
}

function isSurfaceKind(value: unknown): value is SurfaceKind {
  return typeof value === 'string' && (SURFACE_KINDS as readonly string[]).includes(value);
}

function parseEntity(source: { entityType?: unknown; entityId?: unknown }): EntityRef | null {
  const { entityType, entityId } = source;
  if (!isSurfaceKind(entityType) || typeof entityId !== 'string' || !entityId) {
    return null;
  }
  return { entityType, entityId };
}

/** A skill chat needs its skill. Tasks and notes are checked by the chat's own reads. */
function missingSkill(ref: EntityRef): Response | null {
  if (ref.entityType !== 'skill' && ref.entityType !== 'skill-try') return null;
  if (findSkill(ref.entityId)) return null;
  return Response.json({ error: "There's no such skill." }, { status: 404 });
}

const BAD_ENTITY = 'entityType (task|note|skill|skill-try) and entityId are required';

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

async function createFocusedSession(
  ref: EntityRef,
  override: ChatOverride = {},
  permissions?: Pick<ChatSessionWithExecution, 'permissionMode' | 'prePlanMode'>,
) {
  const userState = getUserState();
  const providerId = override.providerId
    ?? userState?.defaultHarness
    ?? DEFAULT_HARNESS;
  const savedTupleMatchesProvider = userState?.defaultHarness === providerId;
  const harnessSettings = ensureHarnessSettings(providerId);
  const requestedModel = override.model
    ?? (savedTupleMatchesProvider ? userState?.defaultModel : null)
    ?? harnessSettings.defaultModel;
  const selection = await resolveHarnessSelection(providerId, {
    model: requestedModel,
    variant: override.variant
      ?? (requestedModel === harnessSettings.defaultModel ? harnessSettings.defaultVariant : null),
    effort: override.effort
      ?? (savedTupleMatchesProvider ? userState?.defaultEffort : null)
      ?? harnessSettings.defaultEffort,
  }, { repairInvalidModel: override.model === undefined });
  const session = createChatSession({
    ...permissions,
    type: 'content',
    harness: selection.providerId,
    // Pins the harness session to this one entity (see harness-surface's
    // renderContentFocusPrompt + the adapter's content branch).
    surfaceKind: ref.entityType,
    surfaceRef: ref.entityId,
    model: selection.model,
    modelVariant: selection.variant,
    effort: selection.effort,
    // Label stays null until the first send — the messages route's label
    // derivation only fires on unlabeled sessions.
    label: null,
    status: 'active',
  });
  return session;
}

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ref = parseEntity({
    entityType: searchParams.get('entityType') ?? undefined,
    entityId: searchParams.get('entityId') ?? undefined,
  });
  if (!ref) {
    return Response.json({ error: BAD_ENTITY }, { status: 400 });
  }
  const missing = missingSkill(ref);
  if (missing) return missing;
  try {
    const session = findCurrent(ref) ?? await createFocusedSession(ref);
    return Response.json({ session });
  } catch (err) {
    console.error('[GET /api/document-chat]', err);
    return Response.json({ error: String(err) }, { status: err instanceof HarnessDisabledError || err instanceof UnsupportedPermissionModeError ? 409 : 500 });
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
    variant?: unknown;
    effort?: unknown;
  };
  const ref = parseEntity(src);
  if (!ref) {
    return Response.json({ error: BAD_ENTITY }, { status: 400 });
  }
  const missing = missingSkill(ref);
  if (missing) return missing;
  const override = parseOverride(src);
  try {
    const harness = override.providerId ?? getUserState()?.defaultHarness ?? DEFAULT_HARNESS;
    assertHarnessEnabled(harness);
    const current = findCurrent(ref);
    const permissions = permissionsForNewChat(harness, current);
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
    const session = await createFocusedSession(ref, override, permissions);
    return Response.json({ session });
  } catch (err) {
    console.error('[POST /api/document-chat]', err);
    return Response.json({ error: String(err) }, { status: err instanceof HarnessDisabledError || err instanceof UnsupportedPermissionModeError ? 409 : 500 });
  }
}
