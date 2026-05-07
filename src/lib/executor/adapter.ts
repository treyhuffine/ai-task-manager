/**
 * Executor adapter — bridge between `@agentex/agent` and our `chat_events`
 * table. Owns the per-session `AgentSession` lifecycle, parses
 * `StreamEvent`s into chat_events rows, and writes them through an
 * `EventWriter` (defaults to the local DB).
 *
 * Module-scope state is intentional: in this single-process Node server,
 * `agentSessions` is the in-memory cache of live AgentSession handles
 * keyed by our `chat_sessions.id`. `runningSessions` is the truth source
 * for "is this turn currently mid-stream"; the runtime-status endpoint
 * reads it. Process restart empties both maps; the next dispatch picks
 * up by passing the persisted `external_session_id` as `sessionParams`
 * so Claude Code resumes its on-disk JSONL session.
 *
 * Lifecycle assumptions:
 *   - `provider.createSession({ cwd, onEvent, sessionParams })` returns a
 *     handle whose `send(message)` resolves when the agent's turn ends.
 *   - `onEvent` fires for every `StreamEvent` across all turns; we parse
 *     and persist each.
 *   - `onUserInputRequest` is auto-allowed in v1 — permission UI is out
 *     of scope for this slice.
 *
 * What this module does NOT do (yet):
 *   - SSE streaming back to the client (client polls).
 *   - Rollover handoff message generation when resume fails.
 *   - Cost / token tracking surfacing.
 *   - MCP elicitation.
 */

import { uuidv7 } from 'uuidv7';
import { getProvider } from '@agentex/agent';
import type { AgentSession, StreamEvent } from '@agentex/agent';
import {
  getChatSession,
  getAgent,
  getWorkspace,
  updateChatSession,
} from '@/lib/db/queries';
import type { ChatEventSource, CreateChatEventInput, ChatSessionRecord } from '@/db/types';
import { localEventWriter, type EventWriter } from './event-writer';
import { mapHarnessToProvider } from './harness';

// ─── Public errors ────────────────────────────────────────────

export class ExecutorError extends Error {
  constructor(public code: 'not_found' | 'invalid_state' | 'unsupported' | 'already_running', message: string) {
    super(message);
    this.name = 'ExecutorError';
  }
}

// ─── Module state ─────────────────────────────────────────────
//
// Stashed on globalThis (with a Symbol key) so the maps survive Next.js
// module re-evaluation across route handlers. Each App Router route is
// bundled independently and may re-import this file with a fresh
// module scope; without globalThis the messages route's `runningSessions`
// would be a different Set than the runtime-status route's, and the UI
// would never see the running flag flip.
//
// Standard pattern — same shape Prisma/Drizzle docs recommend for the
// Next.js dev-mode HMR + bundling story.

interface ExecutorState {
  agentSessions: Map<string, AgentSession>;
  runningSessions: Set<string>;
}

const STATE_KEY = Symbol.for('@flow/executor-state');
const globalRef = globalThis as unknown as { [STATE_KEY]?: ExecutorState };

if (!globalRef[STATE_KEY]) {
  globalRef[STATE_KEY] = {
    agentSessions: new Map(),
    runningSessions: new Set(),
  };
}

const { agentSessions, runningSessions } = globalRef[STATE_KEY]!;

/** Test / dev escape hatch: drop everything. Not for production paths. */
export function _resetExecutorState(): void {
  agentSessions.clear();
  runningSessions.clear();
}

// ─── Public API ───────────────────────────────────────────────

export function isRunning(chatSessionId: string): boolean {
  return runningSessions.has(chatSessionId);
}

/**
 * Dispatch a user message into the agent. Fire-and-forget from the
 * route handler — the returned promise resolves when the agent's turn
 * completes, but the caller doesn't have to await it.
 *
 * Throws `ExecutorError('already_running', ...)` if a turn is already
 * in flight for this chat_session — the route surfaces that as 409 so
 * the client can decide how to recover.
 */
export async function dispatch(
  chatSessionId: string,
  userMessage: string,
  writer: EventWriter = localEventWriter,
): Promise<void> {
  if (runningSessions.has(chatSessionId)) {
    throw new ExecutorError('already_running', 'Session is already running');
  }

  const session = getChatSession(chatSessionId);
  if (!session) throw new ExecutorError('not_found', `Session not found: ${chatSessionId}`);

  const agent = getAgent(session.agent_id);
  if (!agent) throw new ExecutorError('not_found', `Agent not found: ${session.agent_id}`);

  const cwd = resolveCwd(session);
  if (!cwd) throw new ExecutorError('invalid_state', 'Session has no resolvable cwd');

  // Mark running BEFORE the agent-session spawn. ensureAgentSession's
  // first call to provider.createSession spawns the CLI process and
  // can take 1-3 seconds; without this, runtime-status returns false
  // during that window and the UI's ThinkingState doesn't render — the
  // user sees a frozen page. Flipping the flag immediately on dispatch
  // entry means "we're working on it" reflects the moment the request
  // arrives, not the moment the agent is finally ready.
  runningSessions.add(chatSessionId);
  try {
    const agentSession = await ensureAgentSession({
      chatSessionId,
      harness: agent.harness,
      cwd,
      existingExternalSessionId: session.external_session_id,
      writer,
    });
    await agentSession.send(userMessage);
  } finally {
    runningSessions.delete(chatSessionId);
  }
}

/**
 * Interrupt the current turn for a chat_session, if any. The agent
 * receives SIGTERM / equivalent and the in-flight `send()` promise
 * resolves (typically with a `result` event flagged as aborted).
 */
export async function abort(chatSessionId: string): Promise<void> {
  const handle = agentSessions.get(chatSessionId);
  if (!handle) return;
  await handle.interrupt();
}

/**
 * Tear down the cached AgentSession for a chat_session — used when we
 * archive the chat_session or want to force resume on next dispatch.
 */
export async function close(chatSessionId: string): Promise<void> {
  const handle = agentSessions.get(chatSessionId);
  agentSessions.delete(chatSessionId);
  runningSessions.delete(chatSessionId);
  if (handle) {
    try { await handle.close(); } catch { /* best-effort */ }
  }
}

// ─── Internal: agent session lifecycle ────────────────────────

interface EnsureArgs {
  chatSessionId: string;
  harness: string;
  cwd: string;
  existingExternalSessionId: string | null;
  writer: EventWriter;
}

async function ensureAgentSession(args: EnsureArgs): Promise<AgentSession> {
  const cached = agentSessions.get(args.chatSessionId);
  if (cached) return cached;

  const providerType = mapHarnessToProvider(args.harness);
  const provider = getProvider(providerType);
  if (!provider.createSession) {
    throw new ExecutorError(
      'unsupported',
      `Provider "${providerType}" does not implement multi-turn createSession`,
    );
  }

  const handle = await provider.createSession({
    cwd: args.cwd,
    sessionParams: args.existingExternalSessionId
      ? { sessionId: args.existingExternalSessionId }
      : undefined,
    onUserInputRequest: async () => ({ allow: true }),
    onEvent: async (event) => {
      try {
        await persistStreamEvent(args.chatSessionId, event, args.writer);
        capturePromotedSessionId(args.chatSessionId, event);
      } catch (err) {
        // One bad event shouldn't crash the whole turn — log and keep going.
        console.error(`[executor] failed to persist event for ${args.chatSessionId}:`, err);
      }
    },
  });

  agentSessions.set(args.chatSessionId, handle);
  return handle;
}

/**
 * Claude Code (and most providers) emit a `system` event near the start
 * of a session whose `sessionId` is the CLI's own session id. Capture it
 * the first time we see it and write it back to the chat_session row so
 * future resumes work.
 */
function capturePromotedSessionId(chatSessionId: string, event: StreamEvent): void {
  if (event.type !== 'system') return;
  if (!event.sessionId) return;
  const session = getChatSession(chatSessionId);
  if (!session || session.external_session_id === event.sessionId) return;
  updateChatSession(chatSessionId, { external_session_id: event.sessionId });
}

// ─── Stream event → chat_events row ───────────────────────────

async function persistStreamEvent(
  chatSessionId: string,
  event: StreamEvent,
  writer: EventWriter,
): Promise<void> {
  const row = parseStreamEvent(chatSessionId, event);
  if (!row) return;
  await writer.write(row);
}

/**
 * Map an agentex `StreamEvent` to a `chat_events` insert input. See the
 * mapping table in `docs/executor-wiring-spec.md` for the full
 * source-discriminator semantics.
 *
 * `external_event_id` is a fresh uuidv7 per event — agentex StreamEvents
 * don't surface the underlying CLI's per-row id (that lives in `raw`),
 * and for app-spawned sessions we only consume the stream once, so a
 * locally-minted id is enough for idempotency under the partial unique
 * index (and gives downstream code something stable to reference).
 */
export function parseStreamEvent(
  chatSessionId: string,
  event: StreamEvent,
): CreateChatEventInput | null {
  const externalEventId = uuidv7();
  const created_at = event.timestamp || new Date().toISOString();
  const base = {
    session_id: chatSessionId,
    external_event_id: externalEventId,
    raw: event as unknown as Record<string, unknown>,
    created_at,
  };

  switch (event.type) {
    case 'system':
      return {
        ...base,
        role: 'system',
        source: 'system' satisfies ChatEventSource,
        content: event.subtype ?? null,
      };
    case 'assistant':
      return {
        ...base,
        role: 'assistant',
        source: 'agent' satisfies ChatEventSource,
        content: event.text ?? null,
      };
    case 'thinking':
      return {
        ...base,
        role: 'assistant',
        source: 'thinking' satisfies ChatEventSource,
        content: event.text ?? null,
      };
    case 'tool_call':
      return {
        ...base,
        role: 'assistant',
        source: 'tool_call' satisfies ChatEventSource,
        content: null,
        tool_name: event.name,
        tool_input: (event.input ?? null) as Record<string, unknown> | null,
        external_tool_call_id: event.toolCallId ?? null,
      };
    case 'tool_result':
      return {
        ...base,
        role: 'tool',
        source: 'tool_result' satisfies ChatEventSource,
        content: event.content ?? null,
        tool_is_error: event.isError ?? false,
        external_tool_call_id: event.toolCallId ?? null,
      };
    case 'result':
      return {
        ...base,
        role: 'system',
        source: 'result' satisfies ChatEventSource,
        content: event.text ?? null,
        tool_is_error: event.isError ?? false,
      };
    default: {
      // Forward-compat: unknown types still get logged.
      const unknownEvent = event as { timestamp?: string };
      return {
        session_id: chatSessionId,
        external_event_id: externalEventId,
        role: 'system',
        source: 'unknown' satisfies ChatEventSource,
        content: null,
        raw: event as unknown as Record<string, unknown>,
        created_at: unknownEvent.timestamp ?? new Date().toISOString(),
      };
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────

/**
 * For git workspaces: the worktree path. For non-git: the workspace's
 * cwd directly. Returns null if the chat_session has no workspace.
 */
function resolveCwd(session: ChatSessionRecord): string | null {
  if (session.worktree_path) return session.worktree_path;
  if (!session.workspace_id) return null;
  const workspace = getWorkspace(session.workspace_id);
  return workspace?.cwd ?? null;
}

