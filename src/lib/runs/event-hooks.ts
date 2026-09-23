/**
 * Run telemetry that piggybacks on the executor's `StreamEvent` pipe, keyed off
 * the run currently in flight for the chat session (see `artifact-bucket.ts`):
 *
 *   1. Cost capture (task #13). On a `result` event, sum the model's usage
 *      into the run row. If multiple result events arrive (e.g. a subagent),
 *      they accumulate.
 *   2. Summary auto-extract (task #15). On `result`, walk recent assistant
 *      events and capture the first ~200 chars of the last one, as plaintext.
 *
 * What a run changed (`runs.artifactRefs`) is NOT read from this stream: it is
 * recorded where the action runs (`src/lib/runs/artifact-refs.ts`), which sees
 * the real action name, input, and result.
 *
 * Hooked from the executor adapter's `onEvent` callback.
 */

import type { StreamEvent } from '@agentex/agent';
import { getRun, updateRun, listRecentChatEvents } from '@/lib/db/queries';
import { captureFromResultEvent } from '@/lib/pricing/models';
import { HEARTBEAT_QUIET_REASON } from '@/lib/heartbeat/constants';
import { getActiveRunForSession } from './artifact-bucket';

/**
 * Public entry point. Wire this from the executor adapter's `onEvent`
 * callback. Idempotent and defensive: a malformed event is just ignored.
 */
export async function handleRunStreamEvent(
  chatSessionId: string,
  event: StreamEvent,
): Promise<void> {
  const runId = getActiveRunForSession(chatSessionId);
  if (!runId) return;
  if (event.type === 'result') await handleResultEvent(runId, chatSessionId, event);
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
  // A quiet heartbeat check-in already carries its settled summary; a late
  // result event must not put the raw reply token back.
  const summary =
    current.statusReason === HEARTBEAT_QUIET_REASON
      ? current.summary
      : extractSummaryFromChat(chatSessionId) ?? current.summary;
  updateRun(runId, {
    model: current.model ?? usage.model,
    inputTokens: sumPositive(current.inputTokens, usage.inputTokens),
    outputTokens: sumPositive(current.outputTokens, usage.outputTokens),
    cachedInputTokens: sumPositive(current.cachedInputTokens, usage.cachedInputTokens),
    cacheCreationInputTokens: sumPositive(current.cacheCreationInputTokens, usage.cacheCreationInputTokens),
    costUsd: sumPositive(current.costUsd, usage.costUsd),
    summary,
  });
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
      return summarizeText(evt.content);
    }
  }
  return null;
}

/** One line of plain text, at most 200 chars, for run lists. */
export function summarizeText(text: string): string {
  return truncate(stripMarkdown(text), 200);
}

function stripMarkdown(text: string): string {
  return text
    // Entity references render as chips in the transcript but are raw ids in
    // a one-line summary. Drop them; the chat has the chips.
    .replace(/\[\[(?:task|note|area|deck|execution|file|scratchpad):[^\]]*\]\]/g, ' ')
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
