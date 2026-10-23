import { chatEventInsertionCursor } from '@/lib/db/queries';
/** Compatibility projection for retained restricted chats, shared by snapshots and live feeds. */
import type { ChatEventRecord, ChatSessionRecord } from '@/db/types';
import { toChatEventDTO, type ChatEventDTO } from '@/lib/api/dto/chat-event';

export const LEGACY_TEAM_EVENT_SOURCES: ReadonlySet<string> = new Set(['user', 'agent', 'tool_call', 'tool_result', 'error']);

export function legacyTeamEventDTO(event: ChatEventRecord): ChatEventDTO | null {
  if (!LEGACY_TEAM_EVENT_SOURCES.has(event.source)) return null;
  return { ...toChatEventDTO(event), raw: null, rawSubtype: null, rawModel: null, rawUsage: null };
}

export function chatEventProjector(chat?: Pick<ChatSessionRecord, 'surfaceKind' | 'workspaceId'> & Partial<Pick<ChatSessionRecord, 'createdByMemberId'>> | null) {
  const project = chat?.surfaceKind === 'team_chat' && !chat.workspaceId ? legacyTeamEventDTO : toChatEventDTO;
  if (chat?.surfaceKind !== 'team_chat' || chat.createdByMemberId != null) return project;
  return (event: ChatEventRecord): ChatEventDTO | null => {
    const dto = project(event);
    if (!dto) return null;
    const cursor = dto.insertionCursor ?? chatEventInsertionCursor(event.sessionId, event.id);
    return cursor == null ? dto : { ...dto, insertionCursor: cursor };
  };
}
