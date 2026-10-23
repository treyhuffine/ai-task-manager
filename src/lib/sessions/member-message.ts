/** Contextual send admission used by the normal chat operation. */
import { uuidv7 } from 'uuidv7';
import type { Attachment } from '@/db/types';
import type { RequestKey } from '@/lib/auth/request-key';
import * as q from '@/lib/db/queries';
import { sessionAuthority } from '@/lib/workspaces/access';
import { sendToTeamAi } from '@/lib/team/ai/chat';

export async function memberMessage(key: RequestKey | null, chatId: string, input: {
  content: string; id?: string; attachments?: Attachment[];
  appContext?: unknown; connectedAppContext?: unknown[]; fromApp?: unknown;
}) {
  const authority = sessionAuthority(key, chatId, 'send');
  if (!authority) return null;
  if (input.appContext || input.connectedAppContext?.length || input.fromApp) throw new q.TeamError('not_allowed', 'This shared chat has no app-context grant.');
  if (!authority.workspace && input.attachments?.length) throw new q.TeamError('not_allowed', 'This retained tool-only chat cannot open attached files. Choose a configured team agent.');
  const id = input.id ?? uuidv7();
  if (id.length < 8 || id.length > 100) throw new q.TeamChatError('invalid', 'Use a stable message id between 8 and 100 characters.');
  return sendToTeamAi({ chatId, memberId: authority.member.id, requestingApiKeyId: key!.apiKeyId,
    clientSendId: id, messageId: id, text: input.content, attachments: input.attachments,
    senderSessionId: key!.sessionChatId ?? undefined });
}
