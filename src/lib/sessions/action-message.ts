/** One action-bar prompt admission path, using the same member queue as a typed message. */
import { uuidv7 } from 'uuidv7';
import { createHash } from 'node:crypto';
import { getRequestKey } from '@/lib/auth/request-key';
import { actorFromRequest } from '@/lib/auth/actor';
import * as q from '@/lib/db/queries';
import { sessionAuthority } from '@/lib/workspaces/access';
import { withSenderLabel } from '@/lib/sessions/sender';
import { dispatch } from '@/lib/executor/adapter';
import { sendToTeamAi } from '@/lib/team/ai/chat';

function intentHash(intent: object) {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
  return createHash('sha256').update(JSON.stringify(canonical(intent))).digest('hex');
}

/** Reconcile the original intent before rebuilding a diff, checking AI availability or starting work. */
export function replayActionMessage(headers: Headers, chatId: string, requestId: string | undefined, intent: object) {
  const key = getRequestKey(headers);
  const authority = sessionAuthority(key, chatId, 'read');
  if (!requestId) return null;
  const saved = authority ? q.findTeamChatSend(chatId, authority.member.id, requestId) : null;
  const previous = authority ? saved?.message : q.getChatEventById(requestId);
  if (!previous) return null;
  if (previous.sessionId !== chatId || previous.source !== 'user' || (previous.raw as { actionIntentHash?: string } | null)?.actionIntentHash !== intentHash(intent)) throw new q.TeamError('conflict', 'This action request already belongs to different work.');
  return { eventId: previous.id, turnId: saved?.turn.id ?? null, replayed: true };
}

export async function submitActionMessage(headers: Headers, chatId: string, text: string, requestId: string | undefined, intent: object) {
  if (q.getChatSession(chatId)?.surfaceKind === 'result_review') throw new q.TeamError('conflict', 'An assigned background reviewer cannot receive ordinary continuation messages. Use the result actions for another review, or answer its pending question through the existing input controls.');
  const replay = replayActionMessage(headers, chatId, requestId, intent);
  if (replay) return replay;
  requestId ??= uuidv7();
  const key = getRequestKey(headers);
  const authority = sessionAuthority(key, chatId, 'send');
  const actionIntentHash = intentHash(intent);
  if (authority) {
    const sent = await sendToTeamAi({ chatId, text, clientSendId: requestId, actionIntentHash,
      memberId: authority.member.id, requestingApiKeyId: key!.apiKeyId, senderSessionId: key!.sessionChatId ?? undefined });
    return { eventId: sent.message.id, turnId: sent.turn.id, replayed: !sent.created };
  }
  const sender = actorFromRequest(headers);
  const event = q.insertChatEvent({ senderSessionId: sender.sessionId, id: requestId, sessionId: chatId, role: 'user', source: 'user', content: text, raw: { actionIntentHash }, createdAt: new Date().toISOString() });
  if (!event) throw new q.TeamError('conflict', 'This action could not be recorded. Refresh the chat and try again.');
  void dispatch(chatId, withSenderLabel(text, sender.sessionId), { sourceEventId: event.id, actor: sender }).catch(error => {
    q.insertChatEvent({ sessionId: chatId, source: 'error', role: 'system', content: error instanceof Error ? error.message : 'This action could not start.' });
  });
  return { eventId: event.id, turnId: null, replayed: false };
}
