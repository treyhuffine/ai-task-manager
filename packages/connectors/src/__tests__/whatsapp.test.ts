/**
 * WhatsApp connector — proves the access_token (Bearer) + phone_number_id (path-injected) custom
 * auth, identify resolving the business number, and the outbound send_message verb.
 */
import { describe, it, expect } from 'vitest';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { registerWhatsapp } from '../providers/whatsapp';
import { staticAuthConfigs } from '../auth-configs';
import { inMemoryStore, plaintextSecretBox, fakeHttp } from '../testing';
import type { FakeHttpCall } from '../testing';

function setup() {
  const calls: FakeHttpCall[] = [];
  const http = fakeHttp(async (call) => {
    calls.push(call);
    if (call.url.includes('/messages')) return { json: { messages: [{ id: 'wamid.X' }] } };
    return { json: { display_phone_number: '+1 555', verified_name: 'My Biz' } };
  });
  const registry = createRegistry();
  registerWhatsapp(registry);
  const store = inMemoryStore();
  const runtime = createConnectorRuntime({
    registry,
    store,
    authRequests: store,
    secretBox: plaintextSecretBox(),
    authConfigs: staticAuthConfigs([]),
    redactor: createRedactor(),
    approval: { async check() { return 'allow'; } },
    fetch: http.fetch,
  });
  return { runtime, store, http, calls };
}

const CRED = { type: 'custom', values: { access_token: 'TOKEN', phone_number_id: 'PHONEID' } } as const;

describe('whatsapp', () => {
  it('connects via access_token + phone_number_id; identify hits the path-injected number', async () => {
    const s = setup();
    const conn = await s.runtime.connectDirect('whatsapp', { credential: CRED });
    expect(conn.accountId).toBe('+1 555');
    expect(conn.label).toBe('My Biz');
    expect(s.calls.some((c) => c.url.startsWith('https://graph.facebook.com/v21.0/PHONEID?'))).toBe(true);
  });

  it('send_message POSTs to /v21.0/{phone_number_id}/messages with a Bearer header', async () => {
    const s = setup();
    await s.runtime.connectDirect('whatsapp', { credential: CRED });
    const out = await s.runtime.runAction('whatsapp.send_message', { to: '15551234567', body: 'hi' });
    expect(out.ok).toBe(true);
    expect((out as { result: { messageId: string } }).result.messageId).toBe('wamid.X');
    const send = s.calls.find((c) => c.url.includes('/messages'));
    expect(send?.url).toBe('https://graph.facebook.com/v21.0/PHONEID/messages');
    expect(send?.headers.authorization).toBe('Bearer TOKEN');
    expect(JSON.parse(send?.body as string)).toMatchObject({ messaging_product: 'whatsapp', to: '15551234567' });
  });
});
