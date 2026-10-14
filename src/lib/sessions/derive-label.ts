/** Ri owns naming policy and fallback content. Native-first selection belongs to agentex. */
import { backgroundHarnessUnavailableReason } from '@/lib/executor/harness';
import type { HarnessId } from '@/lib/harness/registry';
import { getChatSession, listChatEvents } from '@/lib/db/queries';
import { runnerFor } from '@/lib/executor/placement';
import { isImportMirror } from '@/lib/import/mirror';
import type { TitleRequest } from '@/lib/runner/types';

const MAX_LABEL_LENGTH = 60;
const TITLE_PROMPT = (content: string) =>
  `Summarize this user request as a short title (3-6 words). Output the title only: no quotes, no period, no prefix, no long dashes or semicolons.\n\nMessage:\n${content}\n\nTitle:`;
const RETROSPECTIVE_PROMPT = (transcript: string) =>
  `Below are excerpts from a conversation between a user and their personal productivity assistant, in order. Summarize what the conversation was about overall as a short retrospective title (3-6 words). If it covered several topics, name the dominant one or two. Output the title only: no quotes, no period, no prefix, no long dashes or semicolons.\n\nExcerpts:\n${transcript}\n\nTitle:`;

export function truncateLabel(content: string): string {
  const cleaned = content.trim().replace(/\s+/g, ' ');
  if (!cleaned) return 'Untitled';
  return cleaned.length <= MAX_LABEL_LENGTH ? cleaned : cleaned.slice(0, MAX_LABEL_LENGTH - 1).trimEnd() + '…';
}

export async function deriveAndSetSessionLabel(sessionId: string, content: string, harness: HarnessId): Promise<void> {
  const session = getChatSession(sessionId);
  if (!session || session.label !== null || session.labelSource === 'manual' || session.type === 'orchestration' || isImportMirror(session)) return;
  const request: TitleRequest = {
    harness, description: content, fallbackPrompt: TITLE_PROMPT(content), fallbackModel: session.model,
    expectedRevision: session.labelRevision, reuseExisting: true, truncateOnFailure: true,
  };
  try { await runnerFor(sessionId).generateTitle?.(sessionId, request); }
  catch (error) { console.warn('[chat-title] could not request title:', error); }
}

/** Renaming in Ri succeeds immediately. Native synchronization is best effort for a live runner. */
export async function syncSessionTitle(sessionId: string, options: { syncNative?: boolean } = {}): Promise<void> {
  const session = getChatSession(sessionId);
  if (!session || isImportMirror(session)) return;
  try { await runnerFor(sessionId).setTitle?.(sessionId, options.syncNative === false ? null : session.label, session.labelRevision); }
  catch (error) { console.warn('[chat-title] could not sync native title:', error); }
}

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
    (e) =>
      (e.source === 'user' || e.source === 'agent') &&
      e.content?.trim() &&
      // A subagent narrating to its caller says nothing about what this
      // session is *for*, and a fan-out can easily supply every row in the
      // tail — titling off "Let me read the core files" names the wrong arc.
      !e.externalParentToolCallId,
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

/** Archive requests a fresh suggestion, never reuses a first-message name or overwrites a manual name. */
export async function deriveRetrospectiveLabel(sessionId: string): Promise<void> {
  const session = getChatSession(sessionId);
  if (!session || session.labelSource === 'manual' || (session.labelSource === null && session.label !== null)
    || isImportMirror(session) || backgroundHarnessUnavailableReason(session.harness)) return;
  const sample = buildRetrospectiveSample(sessionId);
  if (!sample) return;
  const request: TitleRequest = {
    harness: session.harness, description: `Name this conversation retrospectively:\n${sample}`,
    fallbackPrompt: RETROSPECTIVE_PROMPT(sample), fallbackModel: session.model,
    expectedRevision: session.labelRevision, reuseExisting: false, truncateOnFailure: false,
  };
  try { await runnerFor(sessionId).generateTitle?.(sessionId, request); }
  catch (error) { console.warn('[chat-title] could not request retrospective title:', error); }
}
