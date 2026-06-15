import {
  listChatSessions,
  createChatSession,
  archiveChatSession,
  getOrCreateDefaultOrchestrator,
  getUserState,
} from '@/lib/db/queries';
import type { ChatSessionWithExecution } from '@/db/types';

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

/** user_state.defaultAgentHarness ('claude' | 'codex') → agents.harness vocabulary. */
function defaultHarness(): string {
  const pref = getUserState()?.defaultAgentHarness;
  return pref === 'codex' ? 'codex' : 'claude_code';
}

function createInteractiveSession() {
  const agent = getOrCreateDefaultOrchestrator(defaultHarness());
  return createChatSession({
    type: 'orchestration',
    agentId: agent.id,
    // Label stays null until the first send — the messages route's
    // `deriveAndSetSessionLabel` (haiku-via-harness, same pipeline that
    // names executions) only fires on unlabeled sessions. A hardcoded
    // placeholder here would permanently block the generated title.
    label: null,
    status: 'active',
  });
}

export async function GET() {
  try {
    const session = findCurrent() ?? createInteractiveSession();
    return Response.json({ session });
  } catch (err) {
    console.error('[GET /api/orchestrator-chat]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST() {
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
    const session = createInteractiveSession();
    return Response.json({ session });
  } catch (err) {
    console.error('[POST /api/orchestrator-chat]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
