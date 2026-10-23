import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import * as q from './queries';

let home: TestHome;
beforeEach(async () => { home = await createTestHome(); });
afterEach(async () => { await home.cleanup(); });
function chats() {
  return [q.createChatSession({ harness: 'claude', type: 'content' }), q.createChatSession({ harness: 'claude', type: 'content' })];
}
function send(source: ReturnType<typeof q.createChatSession>, target: ReturnType<typeof q.createChatSession>, kind: 'question' | 'message' = 'question', status: 'queued' | 'awaiting_approval' = 'queued', id = 'activity') {
  return q.createInitiatingAgentDelivery({ id, source, sourceRunId: null, address: `session:${target.id}`, targetSessionId: target.id, requestKey: id, parentRequestId: null, kind, content: 'Please review.', options: null, eventId: `${id}-event`, prompt: 'Please review.', status });
}

it('shows approved unfinished work on both sides, excluding proposals and completed history', () => {
  const [a, b] = chats();
  send(a, b, 'question', 'awaiting_approval');
  expect(q.activeCoordinationChats(a.id)).toMatchObject({ chatIds: [], starting: false });
  expect(q.activeCoordinationChats(b.id)).toMatchObject({ chatIds: [], assignmentsWaiting: 0 });
  q.decideAgentDelivery('activity', 'allow');
  expect(q.activeCoordinationChats(a.id).chatIds).toEqual([b.id]);
  expect(q.activeCoordinationChats(b.id)).toMatchObject({ chatIds: [a.id], assignmentsWaiting: 1 });
  q.updateAgentDelivery('activity', { status: 'accepted' });
  q.updateAgentRequest('activity', { status: 'waiting' });
  expect(q.activeCoordinationChats(a.id).chatIds).toEqual([b.id]);
  q.updateAgentRequest('activity', { status: 'completed' });
  expect(q.activeCoordinationChats(a.id).chatIds).toEqual([]);
  expect(q.activeCoordinationChats(b.id)).toMatchObject({ chatIds: [], assignmentsWaiting: 0 });
});

it('tracks one-way deliveries through native work and continuation, then clears them', () => {
  const [a, b] = chats();
  send(a, b, 'message');
  const accepted = q.createRun({ harness: 'claude', triggerKind: 'manual', chatSessionId: b.id, status: 'running' });
  q.updateAgentDelivery('activity', { status: 'accepted', acceptedByRunId: accepted.id });
  expect(q.activeCoordinationChats(a.id).chatIds).toEqual([b.id]);
  expect(q.activeCoordinationChats(b.id).chatIds).toEqual([a.id]);
  q.updateRun(accepted.id, { status: 'completed' });
  expect(q.activeCoordinationChats(a.id).chatIds).toEqual([]);
  const continuation = q.createRun({ harness: 'claude', triggerKind: 'manual', chatSessionId: b.id, status: 'queued' });
  q.updateAgentDelivery('activity', { continuationRunId: continuation.id });
  expect(q.activeCoordinationChats(b.id).chatIds).toEqual([a.id]);
  q.updateRun(continuation.id, { status: 'cancelled' });
  expect(q.activeCoordinationChats(b.id).chatIds).toEqual([]);
});

it('keeps a pending return visible after its request completes, without reviving it from history', () => {
  const [a, b] = chats();
  send(a, b);
  q.updateAgentDelivery('activity', { status: 'accepted' });
  q.finishAgentRequest('activity', 'completed', 'Review finished.');
  const answer = q.terminalAgentDelivery('activity')!;
  expect(q.activeCoordinationChats(a.id).chatIds).toEqual([b.id]);
  expect(q.activeCoordinationChats(b.id).chatIds).toEqual([a.id]);
  q.updateAgentDelivery(answer.id, { status: 'accepted' });
  expect(q.activeCoordinationChats(a.id).chatIds).toEqual([]);
  expect(q.activeCoordinationChats(b.id).chatIds).toEqual([]);
});

it('excludes failed and denied sends, and shows an authorized new chat before it has an id', () => {
  const [a, b] = chats();
  send(a, b, 'message', 'awaiting_approval', 'denied');
  q.decideAgentDelivery('denied', 'deny');
  send(a, b, 'message', 'queued', 'failed');
  q.updateAgentDelivery('failed', { status: 'failed' });
  expect(q.activeCoordinationChats(a.id).chatIds).toEqual([]);
  q.createInitiatingAgentDelivery({ id: 'new-chat', source: a, sourceRunId: null, address: 'agent:project', targetSessionId: null, requestKey: 'new-chat', parentRequestId: null, kind: 'delegation', content: 'Please review.', options: {workspaceId:'project'}, eventId: 'new-chat-event', prompt: 'Please review.', status: 'queued' });
  expect(q.activeCoordinationChats(a.id)).toMatchObject({ chatIds: [], starting: true });
});
