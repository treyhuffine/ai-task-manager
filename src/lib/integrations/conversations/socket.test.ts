import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import * as q from '@/lib/db/queries';
import { conversationHash, saveConversationSecrets } from './secrets';
import { refreshSlackSockets, closeSlackSockets } from './slack';

const transport = vi.hoisted(() => ({ sockets: [] as Array<EventEmitter & { acknowledgments: string[] }> }));
vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events');
  return { default: class extends EventEmitter {
    acknowledgments: string[] = [];
    constructor() { super(); transport.sockets.push(this); }
    send(text: string) { expect(q.dueConversationInputs()).toHaveLength(1); this.acknowledgments.push(text); }
    close() { this.emit('close'); }
  } };
});
vi.mock('./service', async original => ({ ...await original<object>(), drainConversations: vi.fn(async () => {}) }));
let home: TestHome;
beforeEach(async () => { home = await createTestHome(); transport.sockets.length = 0; });
afterEach(async () => { closeSlackSockets(); vi.unstubAllGlobals(); await home.cleanup(); });

it('accepts an event durably before acknowledging Socket Mode and acknowledges a retry without another input', async () => {
  const connection = q.createConversationConnection({ id: uuidv7(), provider: 'slack', name: 'Ri', workspaceId: null, enabled: true, externalWorkspaceId: 'T001', externalAgentId: 'UBOT', channels: ['C001'] });
  const key = q.pairDevice({ name: 'Owner', kind: 'computer' }).key;
  const code = 'a'.repeat(48);
  q.createConversationLink({ connectionId: connection.id, apiKeyId: key.id, memberId: null, codeHash: conversationHash(code) });
  q.consumeConversationLink(connection.id, 'U001', conversationHash(code));
  await saveConversationSecrets(connection.id, { appToken: 'xapp-fixture', botToken: 'xoxb-fixture' });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true, url: 'wss://wss-primary.slack.com/fixture' })));
  await refreshSlackSockets();
  expect(transport.sockets).toHaveLength(1);
  const socket = transport.sockets[0];
  const packet = { type: 'events_api', envelope_id: 'envelope-1', payload: { team_id: 'T001', event_id: 'event-1', event: { type: 'app_mention', channel: 'C001', user: 'U001', ts: '100.000001', text: '<@UBOT> Hello' } } };
  socket.emit('message', Buffer.from(JSON.stringify(packet)));
  socket.emit('message', Buffer.from(JSON.stringify({ ...packet, envelope_id: 'envelope-2' })));
  expect(q.dueConversationInputs()).toHaveLength(1);
  expect(socket.acknowledgments.map(item => JSON.parse(item).envelope_id)).toEqual(['envelope-1', 'envelope-2']);
  q.updateConversationConnection(connection.id, { enabled: false });
  await refreshSlackSockets();
});
