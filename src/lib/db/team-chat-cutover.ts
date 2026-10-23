import { getDb } from '@/lib/db';
import * as q from './queries';
import type { ChatSessionRecord } from '@/db/types';

export function bindLegacyTeamChat(input: { chatId: string; workspaceId: string; apiKeyId: string;
  selection: Pick<ChatSessionRecord, 'harness' | 'model' | 'modelVariant' | 'effort' | 'permissionMode' | 'prePlanMode'> & Partial<Pick<ChatSessionRecord, 'serviceTier'>>;
}) {
  return getDb().transaction(() => {
    const member = q.memberForApiKey(input.apiKeyId);
    if (!member) throw new q.TeamError('not_allowed', 'This sign-in is no longer active.');
    const chat = q.getTeamChat(input.chatId);
    const workspace = q.getWorkspace(input.workspaceId);
    if (!chat || chat.executionId) throw new q.TeamError('not_found', 'Choose an existing shared conversation.');
    if (!workspace || workspace.status !== 'active') throw new q.TeamError('not_allowed', 'Choose an active team agent.');
    if (chat.workspaceId) {
      if (chat.workspaceId !== workspace.id) throw new q.TeamError('conflict', 'This chat already belongs to another agent.');
      return chat;
    }
    q.finishQueuedTeamChatTurns(chat.id, 'cancelled', 'The previous Team AI engine was retired. Send a new message to continue.');
    return q.updateChatSession(chat.id, { ...input.selection, workspaceId: workspace.id, deviceId: q.getHome()!.hostDeviceId,
      externalSessionId: null, externalProviderType: null, externalTranscriptPath: null, externalSyncOffset: null,
      externalSyncLastEventId: null, externalHistoryCheckpoint: null })!;
  }, { behavior: 'immediate' });
}
