/** Per-viewer state around the common conversation projection and actions. */
import type { RequestKey } from '@/lib/auth/request-key';
import * as q from '@/lib/db/queries';
import { executionCatalogAuthority, sessionAuthority } from '@/lib/workspaces/access';

export function conversationViews<T extends { id: string; executionId?: string | null; execution?: object | null }>(key: RequestKey | null, rows: readonly T[]): T[] {
  const authority = executionCatalogAuthority(key);
  return authority ? q.projectMemberWorkViews(rows, authority.member.id) : [...rows];
}

export function markConversationRead(key: RequestKey | null, chatId: string, read: boolean) {
  const authority = sessionAuthority(key, chatId, 'read');
  return authority ? q.setMemberChatRead(chatId, authority.member.id, read) : read ? q.markSessionRead(chatId) : q.markSessionUnread(chatId);
}
export function pinConversation(key: RequestKey | null, chatId: string, pinned: boolean) {
  const authority = sessionAuthority(key, chatId, 'read');
  return authority ? q.setMemberSessionPinned(chatId, authority.member.id, pinned) : q.setSessionPinned(chatId, pinned);
}
