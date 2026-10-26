/**
 * What a finished run said, read from its chat: the agent's last message in the turn that just
 * ended, as notification text. `runs.summary` is a one-line cut of the same message for run
 * lists. A notification starts from the whole reply and lets each channel take what fits.
 */
import { getArea, getChatSession, getNote, getTask, getWorkspace, listRecentChatEvents } from '@/lib/db/queries';
import { messageText, type NameEntity } from './message-text';

/** How far back to look. A turn's reply sits just before its result and a few status events. */
const TURN_TAIL = 50;

/** The final message of the chat's latest turn, as written. Null when that turn wrote none. */
export function turnReply(chatSessionId: string): string | null {
  for (const event of listRecentChatEvents(chatSessionId, TURN_TAIL)) {
    // Back at the message that started the turn: it wrote no reply, and an older one isn't this run's.
    if (event.role === 'user') return null;
    // A subagent's text (it has a parent tool call) is the subagent's answer, not the turn's.
    if (event.role === 'assistant' && event.source === 'agent' && !event.externalParentToolCallId && event.content?.trim()) {
      return event.content;
    }
  }
  return null;
}

/** An entity marker read as its chip's name. Files and scratchpads have no name worth sending. */
export const nameEntity: NameEntity = (kind, id) => {
  if (!/^[0-9a-f-]{8,}$/i.test(id)) return null;
  switch (kind) {
    case 'task':
      return getTask(id)?.title;
    case 'note':
      return getNote(id)?.title;
    case 'area':
      return getArea(id)?.name;
    case 'execution':
      return getChatSession(id)?.label;
    case 'agent':
      return getWorkspace(id)?.name;
    case 'deck':
      return 'Deck';
    default:
      return null;
  }
};

/** The latest turn's reply as notification text, or null when it wrote nothing to send. */
export function turnReplyText(chatSessionId: string): string | null {
  const reply = turnReply(chatSessionId);
  return (reply && messageText(reply, nameEntity)) || null;
}
