/** Shared work belongs to the team, including work another member started. */
import * as q from '@/lib/db/queries';
import type { WorkerCommandActor } from '@/db/types';
import { authorizeTeamActorExecution } from './execution-authority';

export function teamArchiveAuthority(actor: WorkerCommandActor | undefined, chatId: string) {
  const authority = authorizeTeamActorExecution(actor, { operation: 'archive', chatId });
  const chat = authority.chat!;
  return { ...authority, chats: chat.executionId ? q.listChatSessions({ executionId: chat.executionId }) : [chat] };
}
