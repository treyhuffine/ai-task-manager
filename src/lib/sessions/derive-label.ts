/**
 * Compress a user's first message into something label-shaped — short,
 * single-line, headline-y. Used when an execution was created without
 * an explicit label so the row can become recognizable in the rail
 * after the first send.
 *
 * Two-tier strategy:
 *
 *   1. **AI summarization via the harness's CLI** (preferred). Routes
 *      through `@agentex/agent`'s `provider.execute({ model: 'haiku' /
 *      'gpt-5.4-mini' })` so it uses the user's existing CLI auth
 *      (subscription, login token, etc.) instead of a separate API
 *      key. Same harness as the actual agent — Claude executors get a
 *      Claude-flavored title; Codex executors get a Codex-flavored one.
 *
 *   2. **Truncation fallback**. If the CLI call fails, errors out, or
 *      returns nothing usable, fall back to single-line truncation.
 *      Predictable; always works; no external dependency.
 *
 * Fire-and-forget from the caller's perspective: the messages route
 * persists the user row + kicks dispatch + kicks this. The label
 * updates on the row whenever the summarization resolves; the client
 * invalidates the session query on send so the UI repaints with the
 * real label shortly after.
 */

import { getProvider } from '@agentex/agent';
import { CHEAPEST_MODEL, mapHarnessToProvider } from '@/lib/executor/harness';
import {
  updateChatSession,
  listChatEvents,
  getChatSession,
  getChatSessionWithExecution,
  setExecutionLabel,
  getAgent,
} from '@/lib/db/queries';

const MAX_LABEL_LENGTH = 60;

const TITLE_PROMPT = (content: string) =>
  `Summarize this user request as a short title (3-6 words). Output the title only: no quotes, no period, no prefix.

Message:
${content}

Title:`;

const RETROSPECTIVE_PROMPT = (transcript: string) =>
  `Below are excerpts from a conversation between a user and their personal productivity assistant, in order. Summarize what the conversation was about overall as a short retrospective title (3-6 words). If it covered several topics, name the dominant one or two. Output the title only: no quotes, no period, no prefix.

Excerpts:
${transcript}

Title:`;

/**
 * Synchronous truncation — fallback when the AI call fails. Also
 * useful in environments where no CLI harness is configured.
 */
export function truncateLabel(content: string): string {
  const cleaned = content.trim().replace(/\s+/g, ' ');
  if (cleaned.length === 0) return 'Untitled';
  if (cleaned.length <= MAX_LABEL_LENGTH) return cleaned;
  return cleaned.slice(0, MAX_LABEL_LENGTH - 1).trimEnd() + '…';
}

/**
 * Ask the harness's CLI (Claude/Codex/etc.) via agentex to summarize
 * the message. Returns null on any failure — caller falls back to
 * truncation. Wrapped in tight timeout/maxTurns config because this is
 * a one-shot summarization and we don't want it spending more than a
 * few seconds.
 */
async function summarizeViaHarness(content: string, harness: string): Promise<string | null> {
  const providerType = mapHarnessToProvider(harness);
  const model = CHEAPEST_MODEL[providerType];
  if (!model) return null;

  try {
    const provider = getProvider(providerType);
    const result = await provider.execute({
      prompt: TITLE_PROMPT(content),
      model,
      config: {
        timeoutSec: 30,
        maxTurns: 1,
        skipPermissions: true,
      },
    });

    if (result.status !== 'completed' || !result.summary) return null;

    const cleaned = result.summary
      .trim()
      // Strip a single layer of wrapping quotes the model sometimes adds.
      .replace(/^["'`]+|["'`]+$/g, '')
      // Strip trailing punctuation.
      .replace(/[.,;:!?]+$/, '')
      .trim();
    if (!cleaned) return null;
    if (cleaned.length > MAX_LABEL_LENGTH) {
      return cleaned.slice(0, MAX_LABEL_LENGTH - 1).trimEnd() + '…';
    }
    return cleaned;
  } catch (err) {
    console.error('[derive-label] AI summarization failed:', err);
    return null;
  }
}

/**
 * Set the label on a session asynchronously: try CLI summarization,
 * fall back to truncation. Writes the result to the chat_sessions row
 * when resolved. Designed to be `void`-called from a route handler.
 */
export async function deriveAndSetSessionLabel(
  sessionId: string,
  content: string,
  harness: string,
): Promise<void> {
  const aiTitle = await summarizeViaHarness(content, harness);
  const label = aiTitle ?? truncateLabel(content);
  try {
    updateChatSession(sessionId, { label });
    // The first conversation to produce a message also names the execution
    // itself — its stable header title. Later chats on the same execution
    // (started via "new chat") derive only their own per-chat label and
    // leave the execution title in place, so it never gets wiped.
    const session = getChatSessionWithExecution(sessionId);
    if (session?.executionId && !session.execution?.label) {
      setExecutionLabel(session.executionId, label);
    }
  } catch (err) {
    console.error(`[derive-label] failed to persist label for ${sessionId}:`, err);
  }
}

// ─── Retrospective titling (long-running threads) ─────────────

/** How many trailing events to sample, and how much of each. */
const RETRO_TAIL_EVENTS = 60;
const RETRO_EXCERPT_MAX = 240;
const RETRO_MAX_EXCERPTS = 10;

/**
 * Build a compact sample of a conversation: the opening user message plus
 * the last few user/agent exchanges. Enough signal to name the arc without
 * shipping a whole transcript to the titling model.
 */
export function buildRetrospectiveSample(sessionId: string): string | null {
  const tail = listChatEvents(sessionId, { limit: RETRO_TAIL_EVENTS });
  const prose = tail.filter(
    (e) => (e.source === 'user' || e.source === 'agent') && e.content?.trim(),
  );
  if (prose.length === 0) return null;

  const excerpt = (e: (typeof prose)[number]) => {
    const text = e.content!.trim().replace(/\s+/g, ' ');
    const clipped =
      text.length <= RETRO_EXCERPT_MAX ? text : text.slice(0, RETRO_EXCERPT_MAX - 1).trimEnd() + '…';
    return `${e.source === 'user' ? 'User' : 'Assistant'}: ${clipped}`;
  };

  const opening = prose[0];
  const recent = prose.slice(-(RETRO_MAX_EXCERPTS - 1)).filter((e) => e !== opening);
  return [excerpt(opening), ...recent.map(excerpt)].join('\n');
}

/**
 * Title a thread retrospectively — called when an orchestration chat is
 * archived, the one moment its whole arc is known. Relationship-shaped
 * threads are deliberately NOT titled from their first message (see the
 * `type !== 'orchestration'` gate in the messages route); while live they
 * render as time + last-message snippet, and this upgrades the archived
 * row to a real summary.
 *
 * On any failure the label stays as-is (usually null) — the history UI's
 * snippet fallback covers it. No truncation fallback here: a wrong/stale
 * title is worse than the snippet. Re-archiving a resumed thread re-runs
 * this and overwrites (the arc changed); labels never change outside
 * archive transitions.
 */
export async function deriveRetrospectiveLabel(sessionId: string): Promise<void> {
  try {
    const sample = buildRetrospectiveSample(sessionId);
    if (!sample) return;
    const session = getChatSession(sessionId);
    if (!session) return;
    const harness = getAgent(session.agentId)?.harness ?? 'claude_code';

    const providerType = mapHarnessToProvider(harness);
    const model = CHEAPEST_MODEL[providerType];
    if (!model) return;

    const provider = getProvider(providerType);
    const result = await provider.execute({
      prompt: RETROSPECTIVE_PROMPT(sample),
      model,
      config: { timeoutSec: 30, maxTurns: 1, skipPermissions: true },
    });
    if (result.status !== 'completed' || !result.summary) return;

    const cleaned = result.summary
      .trim()
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/[.,;:!?]+$/, '')
      .trim();
    if (!cleaned) return;

    updateChatSession(sessionId, {
      label: cleaned.length > MAX_LABEL_LENGTH
        ? cleaned.slice(0, MAX_LABEL_LENGTH - 1).trimEnd() + '…'
        : cleaned,
    });
  } catch (err) {
    console.error(`[derive-label] retrospective titling failed for ${sessionId}:`, err);
  }
}
