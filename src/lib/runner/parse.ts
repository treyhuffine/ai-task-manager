/**
 * Provider stream events to `chat_events` rows. Pure: the runner parses on
 * the computer that ran the harness, so each row's id is minted there, and
 * a replay of the same event produces the same row.
 */

import { uuidv7 } from 'uuidv7';
import type { StreamEvent } from '@agentex/agent';
import type { ChatEventSource, CreateChatEventInput } from '@/db/types';
import { decodeBackgroundTaskEvent, isActiveBackgroundTaskEvent } from '@/lib/executor/background-task-event';

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
 * Map an agentex `StreamEvent` to a `chat_events` insert input. See the
 * mapping table in `docs/executor-wiring-spec.md` for the full
 * source-discriminator semantics.
 *
 * `externalEventId` is the provider's wire-level event id when present
 * (Claude exposes a stable uuid per event; Codex doesn't). Using the wire
 * id means a row written via the live stream and the same row re-derived
 * during a JSONL replay collide on the partial unique index — replay is
 * idempotent at the DB level without us having to track anything extra.
 * When the provider doesn't surface an id, we mint a uuidv7 so the row
 * still has a stable identifier; replay-dedup for those providers falls
 * back to byte-offset cursoring.
 */
/**
 * Provider identity fields every row carries, regardless of which branch of
 * `parseStreamEvent` builds it.
 *
 * Factored out because three branches construct their own base object, and a
 * field added to only one of them means the column's real meaning becomes
 * "was written by a code path that happened to include it" — the adapter and
 * a `raw`-derived backfill would then permanently disagree on those rows.
 */
function attributionFields(event: StreamEvent): {
  externalMessageId: string | null;
  externalTurnId: string | null;
  externalParentToolCallId: string | null;
} {
  return {
    // Provider-native message id. Claude emits `msg_01...` per assistant
    // message; Codex reuses `item_N` per turn, so it is not a unique key —
    // stored for correlation only, never as an identity.
    externalMessageId: event.messageId ?? null,
    // Provider-native turn id (Codex app-server only; null for Claude). Codex
    // reconcile reads it back to learn which turns the live stream already
    // wrote, so it can skip them when replaying the on-disk rollout.
    externalTurnId: event.turnId ?? null,
    // Nested-actor attribution: the tool_use id of the call that produced
    // this event. See src/lib/executions/subagent.ts for what depends on it.
    externalParentToolCallId: event.parentToolCallId ?? null,
  };
}

/**
 * Whether this event comes from a stream that distinguishes a task's result
 * delivery from a bare state change.
 *
 * Presence of the field is the signal — a `null` report on a stream that has
 * the concept means "this record delivered nothing", while its absence means
 * the provider never says. Read off the event rather than tracked per session
 * so a single record is enough to decide.
 */
function providerReportsDeliveries(event: StreamEvent): boolean {
  return 'report' in (event as unknown as Record<string, unknown>);
}

export function parseStreamEvent(
  chatSessionId: string,
  event: StreamEvent,
): CreateChatEventInput | null {
  const externalEventId = event.eventId ?? uuidv7();
  const createdAt = event.timestamp || new Date().toISOString();
  const isOpenCodePart = event.providerType === 'opencode' && Boolean(event.eventId);
  const cumulativeText = isOpenCodePart
    && event.raw
    && typeof event.raw === 'object'
    && typeof (event.raw as Record<string, unknown>).text === 'string'
    ? (event.raw as Record<string, unknown>).text as string
    : null;
  const base = {
    sessionId: chatSessionId,
    externalEventId: externalEventId,
    raw: event as unknown as Record<string, unknown>,
    createdAt,
    ...attributionFields(event),
    ...(isOpenCodePart ? { sourcePartIndex: event.type === 'tool_result' ? 1 : 0 } : {}),
  };

  // Agentex 0.0.33+ lifecycle metadata. Active updates stay as filtered system
  // rows. Terminal updates become compact, visible outcomes so a detached
  // child's summary remains discoverable and reaches Needs Review.
  if ((event as { type: string }).type === 'background_task') {
    const backgroundTask = decodeBackgroundTaskEvent(event);
    // A completion arrives as two records: a state patch and a result
    // delivery. Both are terminal, so keying visibility on terminality alone
    // rendered every finished task twice — once with its summary and once
    // empty. `report` marks the one that actually handed the result back.
    //
    // Falls back to terminality for providers and versions that do not report
    // one (agentex <= 0.0.36, and any provider that emits a single terminal
    // record), so nothing becomes invisible on an older stream.
    const delivered = backgroundTask?.report != null;
    const terminalRecord = backgroundTask !== null && !isActiveBackgroundTaskEvent(backgroundTask);
    const terminal = delivered
      || (terminalRecord && !providerReportsDeliveries(event));
    return {
      ...base,
      role: 'system',
      source: (terminal ? 'background_task' : 'system') satisfies ChatEventSource,
      content: terminal
        ? backgroundTask.summary
          ?? backgroundTask.description
          ?? 'Background task finished'
        : 'background_task',
      ...(terminal ? { toolIsError: backgroundTask.status === 'failed' } : {}),
    };
  }

  switch (event.type) {
    // Liveness signals. They drive the runtime running flag (see
    // `trackTurnBoundary`) and carry nothing a reader would want in the
    // transcript; persisting them would surface an `unknown` row per turn.
    case 'turn_start':
    case 'turn_end':
      return null;
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
        content: cumulativeText ?? event.text ?? null,
      };
    case 'thinking':
      return {
        ...base,
        role: 'assistant',
        source: 'thinking' satisfies ChatEventSource,
        content: cumulativeText ?? event.text ?? null,
      };
    case 'tool_call':
      return {
        ...base,
        role: 'assistant',
        source: 'tool_call' satisfies ChatEventSource,
        content: null,
        toolName: event.name,
        toolInput: (event.input ?? null) as Record<string, unknown> | null,
        externalToolCallId: event.toolCallId ?? null,
      };
    case 'tool_result':
      return {
        ...base,
        role: 'tool',
        source: 'tool_result' satisfies ChatEventSource,
        content: event.content ?? null,
        toolIsError: event.isError ?? false,
        externalToolCallId: event.toolCallId ?? null,
      };
    case 'result':
      // Claude packs the final agent message text into `event.result`,
      // which would duplicate the trailing `assistant` row's content if
      // we surfaced it. Keep the row for turn-boundary tracking + the
      // rich metadata (cost, usage, stopReason, terminalReason) in
      // `raw`, but don't render text. The UI filters this source out
      // of the transcript entirely — the composer re-enabling is the
      // visible "turn complete" signal.
      return {
        ...base,
        role: 'system',
        source: 'result' satisfies ChatEventSource,
        content: null,
        toolIsError: event.isError ?? false,
      };
    case 'auth_required': {
      // Provider can't reach its API because the user isn't authenticated
      // (OAuth expired, revoked, missing, scope, or disabled org). Surface
      // as its own chat_event source so the renderer can show an inline
      // "Log in" button rather than a generic red error pill. Recovery is
      // out-of-band via `claude auth login` — see /api/claude-auth/login.
      return {
        ...base,
        role: 'system',
        source: 'auth_required' satisfies ChatEventSource,
        content: event.message ?? 'Claude needs to log in again',
        toolInput: {
          httpStatus: event.httpStatus,
          reason: event.reason,
          loginCommand: event.loginCommand,
          providerType: event.providerType,
        } as Record<string, unknown>,
      };
    }
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
      return mapUnknownEvent(chatSessionId, event, externalEventId, createdAt);
    default: {
      // True forward-compat: a type we don't know about at all (not even
      // agentex's `unknown`). Persist with the type as content so the
      // user sees something readable.
      const fallback = event as { type?: string; timestamp?: string };
      return {
        sessionId: chatSessionId,
        externalEventId: externalEventId,
        role: 'system',
        source: 'unknown' satisfies ChatEventSource,
        content: fallback.type ?? null,
        raw: event as unknown as Record<string, unknown>,
        createdAt: fallback.timestamp ?? new Date().toISOString(),
        ...attributionFields(event),
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
 * Claude JSONL-only bookkeeping types (`ai-title`, `last-prompt`,
 * `attachment`, `progress`) never appear on stdout — only on disk.
 * They reach us exclusively through the transcript reconciler and
 * carry no transcript-worthy content (titles are UI metadata, the
 * last-prompt mirror is already covered by the `user` event, etc.).
 * Drop them outright.
 *
 * Anything we don't recognize keeps the `unknown` source but gains a
 * descriptive content string so the transcript no longer shows a bare
 * "[unknown]" line.
 */
const CLAUDE_DISK_ONLY_NOISE: ReadonlySet<string> = new Set([
  'ai-title',
  'last-prompt',
  'attachment',
  'progress',
]);


function mapUnknownEvent(
  chatSessionId: string,
  event: StreamEvent,
  externalEventId: string,
  createdAt: string,
): CreateChatEventInput | null {
  const ev = event as { subtype?: string; raw?: Record<string, unknown> };
  const claudeSubtype = typeof ev.raw?.['subtype'] === 'string' ? (ev.raw['subtype'] as string) : null;
  const codexMethod = typeof ev.raw?.['method'] === 'string' ? (ev.raw['method'] as string) : null;
  // Prefer Claude's inner subtype, then Codex's JSON-RPC method, then
  // agentex's outer subtype as a last resort.
  const subtype = claudeSubtype ?? codexMethod ?? ev.subtype ?? null;
  const rawContent = typeof ev.raw?.['content'] === 'string' ? (ev.raw['content'] as string) : null;

  const base = {
    sessionId: chatSessionId,
    externalEventId: externalEventId,
    raw: event as unknown as Record<string, unknown>,
    createdAt,
    ...attributionFields(event),
  };

  // Drop Claude's JSONL-only bookkeeping types up front. These never
  // appear in the live stream; they only reach us via the transcript
  // reconciler and carry no transcript-worthy content.
  if (subtype !== null && CLAUDE_DISK_ONLY_NOISE.has(subtype)) {
    return null;
  }

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
      // Pure telemetry — never useful in the transcript.
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
