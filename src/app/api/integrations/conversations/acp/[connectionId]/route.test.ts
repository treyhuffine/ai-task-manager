import { afterEach, beforeEach, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import * as q from '@/lib/db/queries';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { conversationHash, saveConversationSecrets } from '@/lib/integrations/conversations/secrets';
import { POST } from './route';

let home: TestHome;
beforeEach(async () => { home = await createTestHome(); });
afterEach(async () => { await home.cleanup(); });
async function connection(name: string, token: string) {
  const entry = q.createConversationConnection({ id: uuidv7(), provider: 'buzz', name, enabled: true, workspaceId: null, externalWorkspaceId: 'ws://localhost:3000', externalAgentId: uuidv7(), channels: ['allowed'] });
  await saveConversationSecrets(entry.id, { bridgeToken: token });
  const key = q.pairDevice({ name, kind: 'computer' }).key;
  q.createConversationLink({ connectionId: entry.id, apiKeyId: key.id, memberId: null, codeHash: conversationHash(token) });
  q.consumeConversationLink(entry.id, 'acp-host', conversationHash(token));
  return entry;
}
const token = 'a'.repeat(48);
const send = (id: string, body: object, bearer = token) => POST(new Request(`http://localhost/api/integrations/conversations/acp/${id}`, { method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', 'x-ri-api-key-scope': 'viewer' }, body: JSON.stringify(body) }), { params: Promise.resolve({ connectionId: id }) });

it('requires its connection bearer even with forged viewer headers, and refuses disabled connections', async () => {
  const entry = await connection('Buzz one', token);
  expect((await send(entry.id, { operation: 'hello' }, 'b'.repeat(48))).status).toBe(401);
  expect(await (await send(entry.id, { operation: 'hello' })).json()).toMatchObject({ name: 'Buzz one', relay: 'ws://localhost:3000' });
  q.updateConversationConnection(entry.id, { enabled: false });
  expect((await send(entry.id, { operation: 'hello' })).status).toBe(401);
});

it('keeps pending replies and acknowledgments inside the authorized connection', async () => {
  const one = await connection('Buzz one', token);
  const two = await connection('Buzz two', 'b'.repeat(48));
  const thread = q.ensureConversationThread(two.id, 'allowed', 'root');
  const message = q.acceptConversationInput({ threadId: thread.id, identityId: q.conversationIdentity(two.id, 'acp-host')!.id,
    externalEventId: 'first', content: 'Start this conversation', kind: 'message' });
  q.finishConversationInput(message.id, 'accepted');
  q.queueConversationOutput(thread.id, 'reply', 'Private to connection two');
  const output = q.conversationOutputsForConnection(two.id)[0];
  expect(await (await send(one.id, { operation: 'poll' })).json()).toMatchObject({ outputs: [] });
  expect((await send(one.id, { operation: 'poll', threadId: thread.id })).status).toBe(400);
  expect((await send(one.id, { operation: 'ack', outputId: output.id, part: 1, complete: true })).status).toBe(400);
  expect(q.getConversationOutput(output.id)?.status).toBe('pending');
  expect((await send(two.id, { operation: 'ack', outputId: output.id, part: 1, complete: true }, 'b'.repeat(48))).status).toBe(200);
  expect(q.getConversationOutput(output.id)?.status).toBe('sent');
});
