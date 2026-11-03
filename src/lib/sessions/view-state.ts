/** Per-viewer state around the common conversation projection and actions. */
import type { RequestKey } from '@/lib/auth/request-key';
import * as q from '@/lib/db/queries';
import { executionCatalogAuthority, sessionAuthority } from '@/lib/workspaces/access';

export function conversationViews<T extends { id: string; executionId?: string | null; execution?: object | null }>(key: RequestKey | null, rows: readonly T[]): T[] {
  const authority = executionCatalogAuthority(key);
  return authority ? q.projectMemberWorkViews(rows, authority.member.id) : [...rows];
}

/**
 * Read or unread, for whoever is looking. `dismiss` also clears the chat's
 * status line (an explicit Mark as read, docs/chat-status-lines.md). Status
 * lines belong to personal chats, so a team member's read leaves it alone.
 */
export function markConversationRead(key: RequestKey | null, chatId: string, read: boolean, options: { dismiss?: boolean } = {}) {
  const authority = sessionAuthority(key, chatId, 'read');
  if (authority) return q.setMemberChatRead(chatId, authority.member.id, read);
  if (!read) return q.markSessionUnread(chatId);
  if (options.dismiss) q.clearChatTurnStatus(chatId);
  return q.markSessionRead(chatId);
}
export function pinConversation(key: RequestKey | null, chatId: string, pinned: boolean) {
  const authority = sessionAuthority(key, chatId, 'read');
  return authority ? q.setMemberSessionPinned(chatId, authority.member.id, pinned) : q.setSessionPinned(chatId, pinned);
}
