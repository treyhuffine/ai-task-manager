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
 *   - `onUserInputRequest` routes through `pending-input.ts`. In `bypass`
 *     mode (the default for new sessions) we auto-allow without
 *     surfacing. In `default | accept_edits | plan` we pass the matching
 *     `--permission-mode` flag to Claude and surface every prompt that
 *     comes back through stdio. AskUserQuestion always surfaces.
 *
 * What this module does NOT do (yet):
 *   - SSE streaming back to the client (client polls).
 *   - Rollover handoff message generation when resume fails.
 *   - Cost / token tracking surfacing.
 *   - MCP elicitation.
 */

import { uuidv7 } from 'uuidv7';
import { getProvider } from '@agentex/agent';
import type { AgentSession, StreamEvent, UserInputRequest, UserInputResponse } from '@agentex/agent';
import {
  getChatSession,
  getAgent,
  getWorkspace,
  updateChatSession,
} from '@/lib/db/queries';
import type {
  ChatEventSource,
  CreateChatEventInput,
  ChatSessionRecord,
  PermissionMode,
  EffortLevel,
} from '@/db/types';
import { localEventWriter, type EventWriter } from './event-writer';
import { mapHarnessToProvider } from './harness';
import {
  classifyRequest,
  register as registerPending,
  rejectAllForSession,
  type PendingInput,
} from './pending-input';

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
      permissionMode: session.permission_mode,
      model: session.model,
      effort: session.effort,
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
  rejectAllForSession(chatSessionId, 'Session closed');
  if (handle) {
    try { await handle.close(); } catch { /* best-effort */ }
  }
}

/**
 * Drop the cached AgentSession without closing pending requests. Used
 * when the user changes `permission_mode` mid-session: the next dispatch
 * spawns a fresh CLI process with the new `--permission-mode` flag,
 * resuming the conversation via `external_session_id`. The Claude SDK
 * only reads the flag at startup — there's no in-protocol way to swap
 * modes without restarting the process.
 *
 * Best-effort close on the existing handle; we don't await it in case
 * the user is mid-stream (the runningSessions check at the route layer
 * already rejects send-while-running).
 */
export async function recycleForModeChange(chatSessionId: string): Promise<void> {
  const handle = agentSessions.get(chatSessionId);
  if (!handle) return;
  agentSessions.delete(chatSessionId);
  // Don't reject pending requests — a mode change shouldn't blow up
  // an in-flight permission prompt the user is about to answer.
  try { await handle.close(); } catch { /* best-effort */ }
}

// ─── Internal: agent session lifecycle ────────────────────────

interface EnsureArgs {
  chatSessionId: string;
  harness: string;
  cwd: string;
  existingExternalSessionId: string | null;
  permissionMode: PermissionMode;
  model: string | null;
  effort: EffortLevel | null;
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

  // Build the agentex ProviderConfig from session-level overrides. Each
  // field falls back to the harness default when unset, so a fresh
  // session with all-null overrides produces no extra CLI flags.
  const claudeMode = claudePermissionFlag(args.permissionMode);
  const config: Record<string, unknown> = {};
  if (claudeMode) config.extraArgs = ['--permission-mode', claudeMode];
  if (args.model) config.model = args.model;
  // Codex provider ignores `config.effort`; passing it is harmless.
  if (args.effort) config.effort = args.effort;

  const handle = await provider.createSession({
    cwd: args.cwd,
    sessionParams: args.existingExternalSessionId
      ? { sessionId: args.existingExternalSessionId }
      : undefined,
    config: Object.keys(config).length > 0 ? config : undefined,
    onUserInputRequest: (req) => handleUserInputRequest(args.chatSessionId, args.writer, req),
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
 * Map our internal permission mode to Claude's `--permission-mode` flag
 * value. Returns null for `bypass` — we don't pass the flag and the
 * callback below auto-allows everything (matches the legacy behavior
 * where Flow never prompted).
 */
function claudePermissionFlag(mode: PermissionMode): string | null {
  switch (mode) {
    case 'bypass': return null;
    case 'default': return 'default';
    case 'accept_edits': return 'acceptEdits';
    case 'plan': return 'plan';
  }
}

/**
 * Translate an agentex tool-permission request into pending-input state +
 * a transcript event, then await the user's answer. Called once per tool
 * call that needs approval (every mutating tool in default mode, Bash in
 * accept_edits mode, etc.) and once per AskUserQuestion.
 *
 * In `bypass` mode we short-circuit. The current chat_session row is
 * read fresh each time so a mid-conversation mode change takes effect on
 * the next prompt without restarting the CLI.
 */
async function handleUserInputRequest(
  chatSessionId: string,
  writer: EventWriter,
  req: UserInputRequest,
): Promise<UserInputResponse> {
  const session = getChatSession(chatSessionId);
  const mode: PermissionMode = session?.permission_mode ?? 'bypass';

  const pending = classifyRequest(chatSessionId, req);

  // Bypass: only AskUserQuestion still needs UI. Auto-allowing a question
  // returns empty answers to Claude and the agent stalls — surface it.
  //
  // updatedInput must be present on every allow response. Claude's
  // PermissionAllowResultSchema requires it as a record; an empty object
  // is treated as "use original input" but the field still has to exist.
  // Without it Claude raises a Zod error and the tool call fails as if
  // we'd denied — except the agent reads it as a tool failure and retries.
  if (mode === 'bypass' && pending.kind === 'permission') {
    return { allow: true, updatedInput: req.input };
  }

  // Persist a transcript row so the request is visible in chat history
  // (alongside the live overlay). Idempotent — if the same toolUseId
  // shows up twice (retry), the unique index drops the duplicate.
  try {
    await writer.write(buildPendingRequestEvent(chatSessionId, pending));
  } catch (err) {
    console.error(`[executor] failed to persist pending event for ${chatSessionId}:`, err);
  }

  const response = await registerPending(pending);

  try {
    await writer.write(buildPendingResponseEvent(chatSessionId, pending, response));
  } catch (err) {
    console.error(`[executor] failed to persist response event for ${chatSessionId}:`, err);
  }

  // Auto-revert plan mode on ExitPlanMode allow. Claude transitions
  // its own internal mode when the tool call succeeds; we mirror that
  // in our session row so the UI flips back to whatever the user had
  // before plan (or `bypass` if they came in fresh). No CLI recycle
  // needed — the running process already exited plan internally; we
  // just want subsequent renders + future recycles to show the new
  // mode.
  if (
    pending.kind === 'permission' &&
    pending.toolName === 'ExitPlanMode' &&
    response.allow
  ) {
    revertFromPlanMode(chatSessionId);
  }

  return response;
}

function revertFromPlanMode(chatSessionId: string): void {
  const session = getChatSession(chatSessionId);
  if (!session || session.permission_mode !== 'plan') return;
  const target: PermissionMode = (session.pre_plan_mode as PermissionMode | null) ?? 'bypass';
  try {
    updateChatSession(chatSessionId, {
      permission_mode: target,
      pre_plan_mode: null,
    });
  } catch (err) {
    console.error(`[executor] failed to revert plan mode for ${chatSessionId}:`, err);
  }
}

function buildPendingRequestEvent(
  chatSessionId: string,
  pending: PendingInput,
): CreateChatEventInput {
  const base = {
    session_id: chatSessionId,
    external_event_id: uuidv7(),
    external_tool_call_id: pending.toolUseId,
    role: 'system',
    created_at: pending.createdAt,
  };
  if (pending.kind === 'question') {
    return {
      ...base,
      source: 'question_request' satisfies ChatEventSource,
      content: null,
      tool_input: { questions: pending.questions } as Record<string, unknown>,
      raw: { kind: 'question', questions: pending.questions },
    };
  }
  return {
    ...base,
    source: 'permission_request' satisfies ChatEventSource,
    content: pending.title ?? pending.description ?? null,
    tool_name: pending.toolName,
    tool_input: pending.input,
    raw: {
      kind: 'permission',
      title: pending.title,
      description: pending.description,
    },
  };
}

function buildPendingResponseEvent(
  chatSessionId: string,
  pending: PendingInput,
  response: UserInputResponse,
): CreateChatEventInput {
  const base = {
    session_id: chatSessionId,
    external_event_id: uuidv7(),
    external_tool_call_id: pending.toolUseId,
    role: 'system',
    created_at: new Date().toISOString(),
  };
  if (pending.kind === 'question') {
    const answers = (response.updatedInput?.answers ?? null) as Record<string, string> | null;
    return {
      ...base,
      source: 'question_response' satisfies ChatEventSource,
      content: answers ? formatAnswerSummary(answers) : 'declined',
      tool_input: { answers, allow: response.allow } as Record<string, unknown>,
      raw: { allow: response.allow, answers },
    };
  }
  return {
    ...base,
    source: 'permission_response' satisfies ChatEventSource,
    content: response.allow ? 'allowed' : (response.message ?? 'denied'),
    tool_name: pending.toolName,
    tool_is_error: !response.allow,
    raw: {
      allow: response.allow,
      message: response.message ?? null,
    },
  };
}

function formatAnswerSummary(answers: Record<string, string>): string {
  return Object.entries(answers).map(([q, a]) => `${q}: ${a}`).join('\n');
}

/** Render a rate_limit event's content as a human sentence. */
function formatRateLimitContent(
  status: string,
  limitType: string | null,
  resetAt: string | null,
): string {
  // limitType comes through as snake_case (e.g. `five_hour`,
  // `monthly_overage`). Surface it humanized.
  const window = limitType ? limitType.replace(/_/g, ' ') : null;
  const resetTime = resetAt ? formatResetTime(resetAt) : null;
  const lead = status === 'exceeded'
    ? 'Rate limit hit'
    : status === 'blocked'
      ? 'Request blocked'
      : `Rate limit (${status})`;
  const parts = [lead, window ? `· ${window}` : null, resetTime ? `· resets ${resetTime}` : null];
  return parts.filter(Boolean).join(' ');
}

function formatResetTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  // Local time, no seconds. e.g. "10:30 PM" or "Mon 10:30 PM" if not today.
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return time;
  const day = date.toLocaleDateString(undefined, { weekday: 'short' });
  return `${day} ${time}`;
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
    case 'rate_limit': {
      // Claude emits rate_limit events on every turn with the current
      // window status. Only surface actual throttling — the user
      // doesn't want a transcript pill for "you have quota" or "you're
      // approaching the limit." The whitelist below is intentionally
      // narrow: anything we haven't seen before drops too, on the
      // theory that an unfamiliar status is more likely to be benign
      // than a missed real-throttle event.
      const ev = event as { status?: string; limitType?: string | null; resetAt?: string | null };
      const status = (ev.status ?? '').toLowerCase();
      const isThrottle =
        status === 'exceeded' ||
        status === 'blocked' ||
        status === 'limited' ||
        status === 'throttled';
      if (!isThrottle) return null;
      const friendly = formatRateLimitContent(status, ev.limitType ?? null, ev.resetAt ?? null);
      return {
        ...base,
        role: 'system',
        source: 'rate_limit' satisfies ChatEventSource,
        content: friendly,
      };
    }
    case 'unknown':
      return mapUnknownEvent(chatSessionId, event, externalEventId, created_at);
    default: {
      // True forward-compat: a type we don't know about at all (not even
      // agentex's `unknown`). Persist with the type as content so the
      // user sees something readable.
      const fallback = event as { type?: string; timestamp?: string };
      return {
        session_id: chatSessionId,
        external_event_id: externalEventId,
        role: 'system',
        source: 'unknown' satisfies ChatEventSource,
        content: fallback.type ?? null,
        raw: event as unknown as Record<string, unknown>,
        created_at: fallback.timestamp ?? new Date().toISOString(),
      };
    }
  }
}

/**
 * Map an agentex `unknown` StreamEvent to the right chat_events source.
 *
 * The agentex `unknown` type is its forward-compat fallback for provider
 * events it doesn't model first-class. The provider's outer event name
 * is in `event.subtype`; for Claude, the meaningful Claude-specific
 * subtype is in `raw.subtype`.
 *
 * Most Claude unknowns we care about:
 *   - `compact_boundary`  → conversation context was compacted; show as
 *                            recap so the existing recap divider renders.
 *   - `api_error`         → API-level error; show as error.
 *   - `turn_duration`     → timing telemetry; drop entirely.
 *   - `away_summary`      → resume summary; show as system divider with content.
 *   - `bridge_status`     → MCP / connection status; show as system divider.
 *
 * Anything we don't recognize keeps the `unknown` source but gains a
 * descriptive content string so the transcript no longer shows a bare
 * "[unknown]" line.
 */
function mapUnknownEvent(
  chatSessionId: string,
  event: StreamEvent,
  externalEventId: string,
  created_at: string,
): CreateChatEventInput | null {
  const ev = event as { subtype?: string; raw?: Record<string, unknown> };
  const claudeSubtype = typeof ev.raw?.['subtype'] === 'string' ? (ev.raw['subtype'] as string) : null;
  const codexMethod = typeof ev.raw?.['method'] === 'string' ? (ev.raw['method'] as string) : null;
  // Prefer Claude's inner subtype, then Codex's JSON-RPC method, then
  // agentex's outer subtype as a last resort.
  const subtype = claudeSubtype ?? codexMethod ?? ev.subtype ?? null;
  const rawContent = typeof ev.raw?.['content'] === 'string' ? (ev.raw['content'] as string) : null;

  const base = {
    session_id: chatSessionId,
    external_event_id: externalEventId,
    raw: event as unknown as Record<string, unknown>,
    created_at,
  };

  switch (subtype) {
    case 'compact_boundary':
      return {
        ...base,
        role: 'system',
        source: 'recap' satisfies ChatEventSource,
        content: 'Context compacted',
      };
    case 'api_error':
      return {
        ...base,
        role: 'system',
        source: 'error' satisfies ChatEventSource,
        content: rawContent ?? 'API error',
      };
    case 'turn_duration':
      // Pure telemetry — never useful in the transcript. Dropping it
      // here means the `unknown` events the user was seeing in normal
      // sessions disappear entirely.
      return null;
    case 'away_summary':
    case 'bridge_status':
    case null:
      return {
        ...base,
        role: 'system',
        source: 'system' satisfies ChatEventSource,
        content: rawContent ?? subtype ?? null,
      };
    default:
      // Unknown subtype: still surface as system rather than the
      // misleading "[unknown]" pill. Content carries the subtype so a
      // human can spot what's coming through.
      return {
        ...base,
        role: 'system',
        source: 'system' satisfies ChatEventSource,
        content: subtype,
      };
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

