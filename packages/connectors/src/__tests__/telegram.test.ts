/**
 * Telegram connector — proves path-embedded auth (token injected into the URL path via the
 * `custom` strategy + `setUrl`), the `{ ok, result }` envelope handling, and the send_message
 * delivery verb. Connected via `connectDirect` with a `custom` (bot token) credential.
 */
import { describe, it, expect } from 'vitest';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { registerTelegram } from '../providers/telegram';
import { staticAuthConfigs } from '../auth-configs';
import { inMemoryStore, plaintextSecretBox, fakeHttp } from '../testing';
import type { FakeHttpCall } from '../testing';

function setup() {
  const calls: FakeHttpCall[] = [];
  const http = fakeHttp(async (call) => {
    calls.push(call);
    if (call.url.includes('/getMe')) return { json: { ok: true, result: { id: 4242, username: 'flow_bot' } } };
    if (call.url.includes('/sendMessage')) return { json: { ok: true, result: { message_id: 7, chat: { id: 99 } } } };
    return { json: { ok: true, result: {} } };
  });
  const registry = createRegistry();
  registerTelegram(registry);
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

describe('telegram', () => {
  it('connects via bot token, injecting it into the URL path', async () => {
    const s = setup();
    const conn = await s.runtime.connectDirect('telegram', { credential: { type: 'custom', values: { token: 'BOTTOKEN' } } });
    expect(conn.accountId).toBe('4242'); // from getMe
    expect(conn.label).toBe('flow_bot');
    // identify hit /botBOTTOKEN/getMe (path-embedded auth)
    expect(s.calls.some((c) => c.url === 'https://api.telegram.org/botBOTTOKEN/getMe')).toBe(true);
  });

  it('send_message posts to /bot<token>/sendMessage with the chat payload', async () => {
    const s = setup();
    await s.runtime.connectDirect('telegram', { credential: { type: 'custom', values: { token: 'BOTTOKEN' } } });
    const out = await s.runtime.runAction('telegram.send_message', { chatId: 99, text: 'hello' });
    expect(out.ok).toBe(true);
    expect((out as { result: { messageId: number } }).result.messageId).toBe(7);
    const send = s.calls.find((c) => c.url.includes('/sendMessage'));
    expect(send?.url).toBe('https://api.telegram.org/botBOTTOKEN/sendMessage');
    expect(JSON.parse(send?.body as string)).toMatchObject({ chat_id: 99, text: 'hello' });
  });

  it('surfaces a Telegram { ok: false } envelope as a provider error', async () => {
    const calls: FakeHttpCall[] = [];
    const http = fakeHttp(async (call) => {
      calls.push(call);
      if (call.url.includes('/getMe')) return { json: { ok: true, result: { id: 1, username: 'b' } } };
      return { json: { ok: false, description: 'chat not found' } };
    });
    const registry = createRegistry();
    registerTelegram(registry);
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
    await runtime.connectDirect('telegram', { credential: { type: 'custom', values: { token: 'T' } } });
    const out = await runtime.runAction('telegram.send_message', { chatId: 1, text: 'x' });
    expect(out).toMatchObject({ ok: false, reason: 'error', code: 'provider_error' });
  });
});
