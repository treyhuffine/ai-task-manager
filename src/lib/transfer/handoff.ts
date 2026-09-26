/**
 * The handoff a continuation starts from (docs/homes-spec.md §8.3, P4.3).
 * The destination starts a fresh harness session: the native context window
 * doesn't move, the conversation stays at the home, and this is what the new
 * session is told. Always a deterministic part (the task, the checkpoint, the
 * latest messages, and where the earlier conversation is), and a summary on
 * top when the background harness can write one.
 */

import type { ChatEventRecord } from '@/db/types';

export interface HandoffInput {
  executionLabel: string | null;
  agentName: string;
  fromComputer: string;
  toComputer: string;
  checkpoint: { branch: string; sha: string; files: string[] };
  /** Recent messages, oldest first, across the execution's chats. */
  messages: Array<Pick<ChatEventRecord, 'role' | 'source' | 'content' | 'sessionId' | 'createdAt'>>;
  chatSessionIds: string[];
  targetWorktree: string;
}

const MESSAGE_CHARS = 600;
const MESSAGES = 10;

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** What the person and the agent said last, the part of the transcript a summary is written from. */
export function recentConversation(input: HandoffInput, count = MESSAGES): string[] {
  return input.messages
    .filter((m) => (m.role === 'user' && m.source === 'user') || (m.role === 'assistant' && m.source === 'agent'))
    .filter((m) => m.content?.trim())
    .slice(-count)
    .map((m) => `${m.role === 'user' ? 'Person' : 'Agent'}: ${clip(m.content ?? '', MESSAGE_CHARS)}`);
}

/** The part that never depends on a model. */
export function deterministicHandoff(input: HandoffInput): string {
  const lines: string[] = [];
  lines.push(`This work was continued here on ${input.toComputer}, from ${input.fromComputer}.`);
  lines.push(
    'You are starting a fresh session: you have not seen the earlier one. What it was doing is below, and its whole conversation is at the home.',
  );
  lines.push('');
  lines.push(`Task: ${input.executionLabel ?? `work in ${input.agentName}`}`);
  lines.push(`Checkpoint: branch ${input.checkpoint.branch} at ${input.checkpoint.sha}, now checked out in ${input.targetWorktree}.`);
  if (input.checkpoint.files.length > 0) {
    const shown = input.checkpoint.files.slice(0, 30);
    lines.push(`Files the checkpoint commit took: ${shown.join(', ')}${input.checkpoint.files.length > shown.length ? `, and ${input.checkpoint.files.length - shown.length} more` : ''}.`);
  }
  const recent = recentConversation(input);
  if (recent.length > 0) {
    lines.push('');
    lines.push('The latest messages:');
    for (const line of recent) lines.push(`- ${line}`);
  }
  lines.push('');
  lines.push(
    `The earlier conversation: read it with the get_session_messages action for chat ${input.chatSessionIds.join(', ')}.`,
  );
  return lines.join('\n');
}

export function summaryPrompt(input: HandoffInput): string {
  return [
    'Write a handoff for an AI coding agent that is about to continue this work in a fresh session on another computer.',
    'Use short labeled lines: Goal, Done so far, Key decisions, Next action, Open questions. At most 180 words. No preamble.',
    `Task: ${input.executionLabel ?? `work in ${input.agentName}`}`,
    `Checkpoint: ${input.checkpoint.branch} at ${input.checkpoint.sha.slice(0, 12)}`,
    '',
    'Conversation (oldest first):',
    ...recentConversation(input, 24),
  ].join('\n');
}

/** The handoff: a summary when one was written, and always the deterministic part. */
export function composeHandoff(deterministic: string, summary: string | null): string {
  if (!summary?.trim()) return deterministic;
  return `${summary.trim()}\n\n${deterministic}`;
}

/** The preamble a destination session's first message carries. */
export function handoffPreamble(handoff: string): string {
  return `<continuation>\n${handoff}\n</continuation>`;
}
