/** One-chat retirement, shared by the tab strip and compatibility Team APIs. */
import * as q from '@/lib/db/queries';
import { retireChatForHome } from './home-policy';

export async function closeExecutionChat(id: string) {
  const current = q.getChatSessionWithExecution(id);
  if (!current) return { error: 'not_found' as const, message: 'Session not found', status: 404 };
  if (!current.executionId) return { error: 'not_execution' as const, message: 'Not an execution chat', status: 400 };
  if (current.status === 'archived') return { ok: true as const };
  if (!q.listChatSessions({ executionId: current.executionId }).some(chat => chat.id !== id && chat.status === 'active')) return { error: 'last_chat' as const, message: 'This is the only open chat. Archive the execution instead.', status: 409 };
  if (await retireChatForHome(id)) {
    void (await import('./derive-label')).deriveRetrospectiveLabel(id).catch(error => console.warn('[close-chat] retrospective label failed:', error));
  }
  return { ok: true as const };
}
