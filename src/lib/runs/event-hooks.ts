/**
 * Run telemetry that piggybacks on the executor's `StreamEvent` pipe.
 * Three responsibilities, all keyed off the run currently in flight for
 * the chat session (see `artifact-bucket.ts`):
 *
 *   1. Cost capture (task #13). On a `result` event, sum the model's
 *      usage into the run row. If multiple result events arrive (e.g.
 *      a subagent), they accumulate.
 *   2. Artifact-ref accumulator (task #14). On a successful
 *      `tool_result` for a mutating registry action, push the resulting
 *      entity ref into the run's bucket. Flushed to the run row at
 *      terminal.
 *   3. Summary auto-extract (task #15). On `result`, walk recent
 *      assistant events and capture the first ~200 chars of the last
 *      one. Stripped to plaintext.
 *
 * Hooked from the executor adapter's `onEvent` callback. Doesn't
 * touch its own writer or queries layer — uses the same path the rest
 * of dispatch goes through.
 */

import type { StreamEvent } from '@agentex/agent';
import { getRun, updateRun, listRecentChatEvents } from '@/lib/db/queries';
import { captureFromResultEvent } from '@/lib/pricing/models';
import { getActiveRunForSession, peekArtifactRefs, pushArtifactRef } from './artifact-bucket';
import type { RunArtifactRef } from '@/db/types';

/**
 * Map a mutating-action tool name to the entity kind the action affects.
 * Hand-curated — adding a new mutating action means adding a row here.
 * `null` means "don't accumulate" (action doesn't produce a single
 * addressable entity).
 */
/**
 * UUIDv7 format check used by `extractEntityIdFromToolResult`. The
 * orchestrator's mutating actions all mint ids via `uuidv7()`, so
 * matching this exact shape is the right narrow filter.
 */
const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MUTATION_TOOL_TO_KIND: Record<string, RunArtifactRef['kind'] | null> = {
  create_task: 'task',
  update_task: 'task',
  complete_task: 'task',
  create_note: 'note',
  update_note: 'note',
  create_workspace: 'workspace',
  archive_workspace: 'workspace',
  // Memory edits land on a single sentinel; multiple per run dedupe.
  update_memory: 'memory',
};

/**
 * Public entry point. Wire this from the executor adapter's `onEvent`
 * callback (we'll thread the chatSessionId in already). Idempotent and
 * defensive — a malformed event is just ignored.
 */
export async function handleRunStreamEvent(
  chatSessionId: string,
  event: StreamEvent,
): Promise<void> {
  const runId = getActiveRunForSession(chatSessionId);
  if (!runId) return;

  switch (event.type) {
    case 'tool_result':
      handleToolResult(runId, event);
      return;
    case 'result':
      await handleResultEvent(runId, chatSessionId, event);
      return;
    default:
      return;
  }
}

function handleToolResult(runId: string, event: StreamEvent): void {
  if (event.type !== 'tool_result') return;
  if (event.isError) return;
  // `tool_result` events from agentex don't carry the tool name —
  // only the `toolCallId` of the matching `tool_call`. We resolve the
  // name via the in-process cache populated by `registerToolCallName`
  // (called from the adapter's `onEvent` callback). Cache miss = the
  // matching `tool_call` was never registered (rare provider edge
  // case); we silently skip artifact attribution for this result.
  // Proposal #2 in docs/agentex-feedback.md would let us drop this
  // cache once `tool_result.toolName` lands upstream.
  const toolName = consumeToolCallName(event.toolCallId);
  if (!toolName) return;
  const kind = MUTATION_TOOL_TO_KIND[toolName];
  if (!kind) return;
  const id = extractEntityIdFromToolResult(event, kind);
  if (!id) return;
  pushArtifactRef(runId, { kind, id });
}

async function handleResultEvent(
  runId: string,
  chatSessionId: string,
  event: StreamEvent,
): Promise<void> {
  if (event.type !== 'result') return;
  const usage = captureFromResultEvent(event as unknown);

  // Accumulate cost across multiple result events in the same run
  // (subagents). Read-modify-write is safe here — same-process, no
  // concurrent updates to a single run row.
  const current = getRun(runId);
  if (!current) return;
  const sumPositive = (a: number | null | undefined, b: number) => (a ?? 0) + b;
  // Summary tracks the latest assistant message at the time of *this*
  // result event. Subagents fire their own result events mid-turn; if
  // we held the first one (sub-agent's last message) the parent's
  // final response would never overwrite. Re-extracting per result
  // event lets the parent's final message win when it lands. Falls
  // back to the prior value if the chat has no assistant events yet
  // (e.g. tool-only turn before the agent text).
  const summary = extractSummaryFromChat(chatSessionId) ?? current.summary;
  updateRun(runId, {
    model: current.model ?? usage.model,
    inputTokens: sumPositive(current.inputTokens, usage.inputTokens),
    outputTokens: sumPositive(current.outputTokens, usage.outputTokens),
    cachedInputTokens: sumPositive(current.cachedInputTokens, usage.cachedInputTokens),
    cacheCreationInputTokens: sumPositive(current.cacheCreationInputTokens, usage.cacheCreationInputTokens),
    costUsd: sumPositive(current.costUsd, usage.costUsd),
    summary,
    artifactRefs: peekArtifactRefs(runId),
  });
}

// ── Tool-call name cache ─────────────────────────────────────
//
// `tool_result` events carry only the toolCallId, not the tool name. We
// remember the name from the earlier `tool_call` event so the dispatch
// path can attribute success without a DB round-trip per tool. Keyed
// globally on toolCallId because the cache survives within the chat's
// short turn lifetime; clearing happens implicitly on consume.

const STATE_KEY = Symbol.for('@flow/tool-call-name-cache');
const globalRef = globalThis as unknown as { [STATE_KEY]?: Map<string, string> };
if (!globalRef[STATE_KEY]) globalRef[STATE_KEY] = new Map();
const toolCallNames = globalRef[STATE_KEY]!;

/** Register a tool name when the matching `tool_call` event lands. */
export function registerToolCallName(toolCallId: string, toolName: string): void {
  toolCallNames.set(toolCallId, toolName);
}

function consumeToolCallName(toolCallId: string | null | undefined): string | null {
  if (!toolCallId) return null;
  const name = toolCallNames.get(toolCallId);
  if (name) toolCallNames.delete(toolCallId);
  return name ?? null;
}

/**
 * Pull the entity id out of a tool_result. The orchestrator's mutating
 * actions return `{ id: '...' }` envelopes; we accept either the raw
 * id-as-string content or a JSON object with an `id` field.
 */
function extractEntityIdFromToolResult(
  event: Extract<StreamEvent, { type: 'tool_result' }>,
  kind: RunArtifactRef['kind'],
): string | null {
  // For the memory sentinel we don't need to parse anything.
  if (kind === 'memory') return 'MEMORY.md';
  const content = event.content;
  if (!content) return null;
  // Sometimes the content is `[Object]` or JSON-stringified — try both.
  if (typeof content === 'string') {
    const trimmed = content.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && 'id' in parsed && typeof parsed.id === 'string') {
          return parsed.id;
        }
      } catch {
        // Fall through.
      }
    }
    // Bare id as content. Tighten to the actual UUIDv7 shape every
    // orchestrator action returns — a lenient `[a-z0-9_-]{8,}` regex
    // claimed plain tool outputs like "completed" or "successful" as
    // entity ids, polluting `runs.artifactRefs` with non-existent
    // refs. UUIDv7: 8-4-7xxx-yxxx-12 hex; variant nibble in [89ab].
    if (UUID_V7_RE.test(trimmed)) return trimmed;
    return null;
  }
  // Some providers structure content as an array of parts.
  if (Array.isArray(content)) {
    for (const part of content as Array<{ text?: string }>) {
      const text = part?.text;
      if (typeof text === 'string') {
        return extractEntityIdFromToolResult(
          { ...event, content: text } as unknown as Extract<StreamEvent, { type: 'tool_result' }>,
          kind,
        );
      }
    }
  }
  return null;
}

/**
 * Render a one-line plaintext summary from the most recent assistant
 * message in the chat. The full markdown stays in chat_events; the
 * summary is for run lists where only ~200 chars fit.
 */
export function extractSummaryFromChat(chatSessionId: string): string | null {
  const events = listRecentChatEvents(chatSessionId, 50);
  // Newest first per the existing query order; walk forward to find the
  // most recent `assistant` event with non-empty text.
  for (const evt of events) {
    if (evt.role === 'assistant' && evt.source === 'agent' && evt.content) {
      const plain = stripMarkdown(evt.content);
      return truncate(plain, 200);
    }
  }
  return null;
}

function stripMarkdown(text: string): string {
  return text
    // Code fences and inline code → keep contents.
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    // Headings.
    .replace(/^#+\s+/gm, '')
    // Bold/italic emphasis.
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    // Links: keep label, drop url.
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // List bullets.
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    // Newlines → single space, collapse.
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trim() + '…';
}
