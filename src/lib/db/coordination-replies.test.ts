import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import * as q from './queries';
import type { AgentDeliveryRecord } from '@/db/types';

let home: TestHome;
beforeEach(async () => { home = await createTestHome(); });
afterEach(async () => { await home.cleanup(); });

const statuses: AgentDeliveryRecord['status'][] = ['awaiting_approval', 'queued', 'delivered', 'accepted', 'denied', 'failed', 'cancelled'];
const senders: AgentDeliveryRecord['senderKind'][] = ['agent', 'human', 'system'];
it.each(statuses.flatMap(status => senders.map(senderKind => ({ status, senderKind }))))('reply authority for a $status delivery from $senderKind', ({ status, senderKind }) => {
  const sender = q.createChatSession({ type: 'content', harness: 'claude' });
  const receiver = q.createChatSession({ type: 'content', harness: 'claude' });
  const third = q.createChatSession({ type: 'content', harness: 'claude' });
  q.createAgentDelivery({ id: 'message', kind: 'message', senderKind, sourceSessionId: sender.id, targetAddress: `session:${receiver.id}`, targetSessionId: receiver.id, eventId: 'input', payload: { version: 1, content: 'Review this.', prompt: 'Review this.', attachments: [] }, status });

  expect(q.hasAgentReplyAuthorization(receiver.id, sender.id)).toBe(['delivered', 'accepted'].includes(status) && senderKind !== 'system');
  expect(q.hasAgentReplyAuthorization(receiver.id, third.id)).toBe(false);
  expect(q.hasAgentReplyAuthorization(third.id, sender.id)).toBe(false);
  expect(q.hasAgentReplyAuthorization(sender.id, receiver.id)).toBe(false);
});
