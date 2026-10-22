import type { ChatSessionRecord } from '@/db/types';

export function addressOf(chat: ChatSessionRecord): string {
  return chat.type === 'orchestration' && !chat.executionId && !chat.createdByRunId && (!chat.surfaceKind || chat.surfaceKind === 'main')
    ? chat.workspaceId ? `agent:${chat.workspaceId}` : 'orchestrator'
    : `session:${chat.id}`;
}
