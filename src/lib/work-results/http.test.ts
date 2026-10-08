import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { API_KEY_SCOPE_HEADER, SESSION_CHAT_HEADER } from '@/lib/auth/request-key';
import { SESSION_CREDENTIAL_HEADER, sessionCredential } from '@/lib/orchestrator/session-credential';
import { requestHasSessionAuthority } from '@/lib/orchestrator/mcp-caller';
import { workResultActorFromRequest } from './http';

let home: TestHome;
beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-result-http-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  identity.ensureHomeIdentity();
});
afterEach(async () => {
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup();
});
const request = (headers: Headers, path = '/api/results/reports', method = 'POST') => ({ headers, url: `http://127.0.0.1${path}`, method });

describe('result caller identity', () => {
  it('uses the proxy validated worker session and ignores an unsigned claimed chat', async () => {
    const q = await import('@/lib/db/queries');
    const session = q.createChatSession({ type: 'content', harness: 'claude' });
    const unsigned = new Headers({ [SESSION_CHAT_HEADER]: session.id });
    expect(requestHasSessionAuthority(unsigned)).toBe(false);
    expect(workResultActorFromRequest(request(unsigned))).toEqual({ userId: 'local', source: 'human' });
    const validated = new Headers({ [API_KEY_SCOPE_HEADER]: 'session', [SESSION_CHAT_HEADER]: session.id });
    expect(requestHasSessionAuthority(validated)).toBe(true);
    expect(workResultActorFromRequest(request(validated))).toMatchObject({ source: 'ai', sessionId: session.id });
    validated.set(SESSION_CHAT_HEADER, 'missing-chat');
    expect(() => workResultActorFromRequest(request(validated))).toThrow(/invalid|unavailable/);
  });

  it('requires a valid local signature and limits deleted-caller replay to an explicit option', async () => {
    const q = await import('@/lib/db/queries');
    const session = q.createChatSession({ type: 'content', harness: 'codex' });
    const headers = new Headers({ [SESSION_CREDENTIAL_HEADER]: sessionCredential(session.id, home.token)! });
    expect(workResultActorFromRequest(request(headers))).toMatchObject({ source: 'ai', sessionId: session.id });
    headers.set(SESSION_CREDENTIAL_HEADER, `${session.id}.forged`);
    expect(() => workResultActorFromRequest(request(headers))).toThrow(/invalid/);
    headers.set(SESSION_CREDENTIAL_HEADER, sessionCredential('deleted-chat', home.token)!);
    expect(() => workResultActorFromRequest(request(headers))).toThrow(/unavailable/);
    expect(workResultActorFromRequest(request(headers), { allowMissing: true })).toMatchObject({ source: 'ai', sessionId: 'deleted-chat' });
  });

  it('rejects foreign-owner sessions even when their signature is valid', async () => {
    const q = await import('@/lib/db/queries');
    const session = q.createChatSession({ type: 'content', harness: 'claude', userId: 'another-owner' });
    const headers = new Headers({ [SESSION_CREDENTIAL_HEADER]: sessionCredential(session.id, home.token)! });
    expect(() => workResultActorFromRequest(request(headers))).toThrow(/unavailable/);
  });

  it('never lets inbound forwarded headers impersonate a scoped worker at the proxy', async () => {
    const { proxy } = await import('@/proxy');
    const { SESSION_CHAT_HEADER, API_KEY_SCOPE_HEADER } = await import('@/lib/auth/request-key');
    const { pairDevice } = await import('@/lib/db/queries');
    const token = pairDevice({ name: 'Viewing device', kind: 'computer' }).token.plaintext;
    const response = proxy(new NextRequest('http://127.0.0.1/api/results', { headers: {
      authorization: `Bearer ${token}`, [API_KEY_SCOPE_HEADER]: 'session', [SESSION_CHAT_HEADER]: 'forged-chat',
    } }));
    expect(response.headers.get(`x-middleware-request-${API_KEY_SCOPE_HEADER}`)).toBe('viewer');
    expect(response.headers.get(`x-middleware-request-${SESSION_CHAT_HEADER}`)).toBeNull();
  });
});
