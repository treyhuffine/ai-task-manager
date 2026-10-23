import { processState } from '@/lib/process-state';

export class LifecycleConflictError extends Error {
  readonly code = 'conflict';
}
const state = processState('execution:lifecycle-admission', () => new Set<string>());
export function executionLifecycleClosing(executionId: string | null | undefined) { return Boolean(executionId && state.has(executionId)); }
export function closeExecutionAdmission(executionId: string | null | undefined) {
  if (!executionId) return () => {};
  if (state.has(executionId)) throw new LifecycleConflictError('This execution is already being archived.');
  state.add(executionId);
  return () => { state.delete(executionId); };
}

const chats = processState('chat:lifecycle-admission', () => new Map<string, string>());
export function chatLifecycleClosing(chatId: string) { return chats.has(chatId); }
export function chatLifecycleReason(chatId: string) { return chats.get(chatId); }
export function closeChatAdmission(chatId: string, reason = 'This chat is being closed. Your draft is kept.') {
  if (chats.has(chatId)) throw new LifecycleConflictError('This chat is already being closed.');
  chats.set(chatId, reason);
  return () => { chats.delete(chatId); };
}
