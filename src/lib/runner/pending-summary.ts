import type { PendingInput } from './pending';

/**
 * What a blocked chat is waiting on, in one line: the question it asked, or
 * what it wants permission for. The rail shows it on an agent's row so you
 * can tell from there whether to go in, the way notifications word it.
 */
export function pendingSummary(pending: PendingInput, max = 140): string {
  const text =
    pending.kind === 'question'
      ? pending.questions[0]?.question || pending.questions[0]?.header || 'It has a question for you'
      : pending.title || pending.description || `Allow ${pending.toolName}?`;
  const plain = text.replace(/\s+/g, ' ').trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}
