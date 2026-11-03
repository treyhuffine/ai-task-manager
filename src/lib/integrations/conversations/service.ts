import * as q from '@/lib/db/queries';
import type { ConversationConnection, ConversationIdentity, ConversationInput, ConversationThread } from '@/db/types';
import type { RequestKey } from '@/lib/auth/request-key';
import { API_KEY_ID_HEADER, API_KEY_SCOPE_HEADER, MEMBER_ID_HEADER, MEMBER_ROLE_HEADER } from '@/lib/auth/request-key';
import { withExecutionRequest } from '@/lib/home/execution-request';
import { processState } from '@/lib/process-state';
import { perfScope } from '@/lib/perf/recorder';
import { conversationHash } from './secrets';

export function conversationPrincipal(identity: Pick<ConversationIdentity, 'apiKeyId' | 'memberId'>): RequestKey {
  const key = q.getApiKey(identity.apiKeyId);
  if (!key || key.revokedAt || (key.expiresAt && key.expiresAt <= new Date().toISOString())) throw new Error('The linked Ri sign-in is no longer active. Link your identity again in Ri.');
  const member = identity.memberId ? q.memberForApiKey(identity.apiKeyId) : null;
  if (q.getHome()?.kind === 'team' && (!member || member.id !== identity.memberId)) throw new Error('The linked team membership is no longer active.');
  if (q.getHome()?.kind !== 'team' && identity.memberId) throw new Error('This identity belongs to another Ri destination.');
  return { apiKeyId: key.id, scope: member ? 'member' : 'viewer', memberId: member?.id, memberRole: member?.role,
    location: 'elsewhere', sessionChatId: null, workerDeviceId: null };
}

export function acceptExternalConversation(input: { connectionId: string; channelId: string; threadId: string; externalEventId: string; externalUserId: string; content: string; direct?: boolean; mentioned?: boolean; stop?: boolean }) {
  const connection = q.getConversationConnection(input.connectionId);
  if (!connection?.enabled) return { accepted: false, reason: 'This connection is disabled.' };
  if (input.direct && q.getHome()?.kind === 'team') return { accepted: false, reason: 'Use a connected team channel. Team chats are visible to the team.' };
  if ((connection.provider === 'buzz' || !input.direct) && !connection.channels.includes(input.channelId)) return { accepted: false, reason: 'This channel is not connected to Ri.' };
  const link = input.content.trim().match(/^(?:link|\/link)\s+([a-f0-9]{48})$/i);
  if (link) {
    const identity = q.consumeConversationLink(connection.id, input.externalUserId, conversationHash(link[1]));
    if (!identity) return { accepted: false, reason: 'This link code is invalid or expired.' };
    try { conversationPrincipal(identity); } catch (error) { return { accepted: false, reason: error instanceof Error ? error.message : 'Link your Ri sign-in again.' }; }
    return { accepted: false, linked: true, reason: 'Your identity is linked. Send your message again to begin.' };
  }
  const identity = q.conversationIdentity(connection.id, input.externalUserId);
  if (!identity) return { accepted: false, reason: 'Link your identity first: open Conversations in Ri and create a link code.' };
  try { conversationPrincipal(identity); } catch (error) { return { accepted: false, reason: error instanceof Error ? error.message : 'Link your Ri sign-in again.' }; }
  const prior = q.findConversationThread(connection.id, input.channelId, input.threadId);
  if (!input.direct && !input.mentioned && !prior) return { accepted: false, reason: 'Mention this Ri agent to start a thread.' };
  if (!input.content.trim() && !input.stop) return { accepted: false, reason: 'Write a message first.' };
  if (input.content.length > 20_000) return { accepted: false, reason: 'Keep a message under 20,000 characters.' };
  const thread = prior ?? q.ensureConversationThread(connection.id, input.channelId, input.threadId);
  const accepted = q.acceptConversationInput({ threadId: thread.id, identityId: identity.id, externalEventId: input.externalEventId,
    content: input.content.trim(), kind: input.stop || input.content.trim().toLowerCase() === 'stop' ? 'stop' : 'message' });
  return { accepted: true, inputId: accepted.id, threadId: thread.id, sessionId: thread.sessionId };
}

async function threadSession(thread: ConversationThread, connection: ConversationConnection, key: RequestKey) {
  if (thread.sessionId) {
    const chat = q.getChatSession(thread.sessionId);
    if (!chat || chat.status !== 'active') throw new Error('This Ri chat is closed. Start a new external thread.');
    return chat;
  }
  const { addMainChat } = await import('@/lib/sessions/main-chat');
  const chat = await withExecutionRequest(key, () => addMainChat(connection.workspaceId));
  q.updateChatSession(chat.id, { label: `${connection.name}: ${thread.channelId}` });
  q.bindConversationThread(thread.id, chat.id);
  return chat;
}

function requestContext(key: RequestKey, chatId: string) {
  const headers = new Headers({ [API_KEY_ID_HEADER]: key.apiKeyId, [API_KEY_SCOPE_HEADER]: key.scope });
  if (key.memberId) headers.set(MEMBER_ID_HEADER, key.memberId);
  if (key.memberRole) headers.set(MEMBER_ROLE_HEADER, key.memberRole);
  const url = new URL(`http://localhost/api/sessions/${chatId}/messages`);
  return { headers, url: url.toString(), nextUrl: url, signal: new AbortController().signal };
}

async function dispatchInput(input: ConversationInput) {
  if (q.getConversationInput(input.id)?.status !== 'queued') return;
  const thread = q.getConversationThread(input.threadId);
  const connection = thread && q.getConversationConnection(thread.connectionId);
  try {
    if (!thread || !connection?.enabled) throw new Error('This connection is no longer enabled.');
    const identity = q.getConversationIdentity(input.identityId);
    if (!identity?.externalUserId) throw new Error('The sender is no longer linked.');
    const key = conversationPrincipal(identity);
    const chat = await threadSession(thread, connection, key);
    const runtime = await import('@/lib/executor/adapter');
    if (input.kind === 'stop') {
      const running = runtime.isRunning(chat.id) || runtime.hasBackgroundTasks(chat.id);
      q.cancelQueuedConversationInputs(input);
      await withExecutionRequest(key, () => runtime.abort(chat.id, { source: 'human', apiKeyId: key.apiKeyId, memberId: key.memberId }));
      q.finishConversationInput(input.id, 'accepted');
      if (!running) q.queueConversationOutput(thread.id, `stop:${input.id}`, 'There is no running work in this conversation. Earlier queued messages were stopped.');
      return;
    }
    // Pending runtime questions need their resolver, rather than a queued ordinary send.
    const { listForSession } = await import('@/lib/executor/live-state');
    const pending = listForSession(chat.id)[0];
    if (pending?.kind === 'question') {
      const { answerPrompt } = await import('@/lib/executor/answer-prompt');
      const result = withExecutionRequest(key, () => answerPrompt(chat.id, pending.requestId, { allow: true,
        answers: Object.fromEntries(pending.questions.map(question => [question.question, input.content])) },
      { source: 'human', apiKeyId: key.apiKeyId, memberId: key.memberId }));
      if (!result.ok) throw new Error(result.message);
      q.finishConversationInput(input.id, 'accepted');
      return;
    }
    if (pending?.kind === 'permission') {
      q.queueConversationOutput(thread.id, `permission:${input.id}`, 'A permission needs your approval in Ri. Open the linked chat and use its approval controls.', 'question');
      q.finishConversationInput(input.id, 'accepted');
      return;
    }
    if (runtime.isRunning(chat.id) || runtime.hasBackgroundTasks(chat.id)) return;
    // An already accepted event after a restart is never treated as permission to redo work.
    if (q.getChatEventById(input.eventId)) {
      const run = q.getRunForSourceEvent(input.eventId);
      if (!run) q.queueConversationOutput(thread.id, `interrupted:${input.id}`, 'Ri restarted before this send could be confirmed. Inspect its chat before asking to repeat the work.', 'error');
      q.finishConversationInput(input.id, 'accepted');
      return;
    }
    const { POST } = await import('@/lib/server/operations/sessions/[id]/messages');
    if (connection.provider === 'slack') {
      void (await import('./slack')).slackSessionStatus(connection, { ...thread, sessionId: chat.id }, 'processing').catch(() => {});
    }
    const result = await withExecutionRequest(key, () => POST({ params: { id: chat.id }, body: { id: input.eventId, content: input.content } }, requestContext(key, chat.id)));
    if (!result.ok) throw new Error(JSON.stringify(result.body));
    q.finishConversationInput(input.id, 'accepted');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The message could not be sent.';
    q.finishConversationInput(input.id, 'failed', message);
    if (thread) q.queueConversationOutput(thread.id, `failure:${input.id}`, message, 'error');
  }
}

/** Delivery is separate from dispatch. The ACP adapter claims only its configured thread. */
export function authorizedConversationThread(connectionId: string, threadId: string) {
  const connection = q.getConversationConnection(connectionId);
  const thread = q.getConversationThread(threadId);
  if (!connection?.enabled || !thread || thread.connectionId !== connectionId) throw new Error('This conversation is unavailable.');
  const people = q.conversationThreadIdentities(threadId);
  if (!people.some(person => { try { conversationPrincipal(person); return true; } catch { return false; } })) throw new Error('No linked Ri sign-in is active.');
  if (!(connection.provider === 'slack' && thread.channelId.startsWith('D')) && !connection.channels.includes(thread.channelId)) throw new Error('This channel is no longer connected.');
  return { connection, thread };
}

const state = processState('integrations.conversations', () => ({ timer: null as ReturnType<typeof setInterval> | null, draining: null as Promise<void> | null }));
export function drainConversations(): Promise<void> {
  if (state.draining) return state.draining;
  state.draining = perfScope('timer:conversations', async () => {
    for (const thread of q.conversationRunsToReconcile()) {
      const run = q.getRun(thread.lastRunId!);
      if (run && ['completed', 'failed', 'cancelled'].includes(run.status)) q.settleConversationRun(run.id, { ok: run.status === 'completed', errorMessage: run.errorMessage ?? 'Interrupted by a restart.' });
    }
    for (const input of q.dueConversationInputs()) await dispatchInput(input);
    const { deliverSlackOutputs, refreshSlackSockets } = await import('./slack');
    await refreshSlackSockets();
    await deliverSlackOutputs();
  }).catch(error => console.warn('[conversations]', error instanceof Error ? error.message : 'Delivery failed')).finally(() => { state.draining = null; });
  return state.draining;
}
export function startConversations() {
  if (state.timer) return;
  void drainConversations();
  state.timer = setInterval(() => { void drainConversations(); }, 1000);
  state.timer.unref?.();
}
export async function stopConversations() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  await state.draining;
  (await import('./slack')).closeSlackSockets();
}
