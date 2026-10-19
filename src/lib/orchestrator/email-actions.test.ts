import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import * as q from '@/lib/db/queries';
import { proxy } from '@/proxy';
import { sessionCredential, SESSION_CREDENTIAL_HEADER } from './session-credential';
import { dispatchEmailOperation } from './email-actions';
import { subscribe, sessionChannel, type SessionStreamMessage } from '@/lib/realtime/bus';
import { POST } from '@/app/api/email/action/route';
import { API_KEY_ID_HEADER, API_KEY_SCOPE_HEADER, CALLER_LOCATION_HEADER } from '@/lib/auth/request-key';

/** Exercise signed CLI forwarding through the real auth proxy and protocol endpoint. */
vi.mock('./server-client', async importOriginal => {
  const original = await importOriginal<typeof import('./server-client')>();
  return { ...original, serverFetch: async (path: string, init: RequestInit) => {
    const { readAuthConfig } = await import('@/lib/auth/config-file');
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${readAuthConfig()!.localToken}`);
    const request = new NextRequest(`http://localhost/api${path}`, { ...init, signal: init.signal ?? undefined, headers });
    const auth = proxy(request);
    if (auth.headers.get('x-middleware-next') !== '1') throw new Error(`Unexpected auth refusal ${auth.status}`);
    const forwarded = new Headers(request.headers);
    for (const [name, value] of auth.headers) if (name.startsWith('x-middleware-request-')) forwarded.set(name.slice('x-middleware-request-'.length), value);
    const response = await POST(new Request(request, { headers: forwarded }));
    if (!response.ok) throw new original.ServerResponseError(response.status, await response.text(), 'Email endpoint refused the operation');
    return response.json();
  } };
});

let home: TestHome;
beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-email-action-' });
  (await import('@/lib/auth/bootstrap')).ensureLocalToken();
});
afterEach(async () => { await home.cleanup(); });

describe('signed email protocol', () => {
  it('forwards CLI creation and updates to the server, preserving chat identity and live revisions', async () => {
    const sessionId = q.createChatSession({ harness: 'codex', type: 'execution', userId: 'local' }).id;
    const ctx = { remote: false, actor: { source: 'ai' as const, sessionId } };
    const messages: SessionStreamMessage[] = [];
    const off = subscribe(sessionChannel(sessionId), message => messages.push(message));
    const first = await dispatchEmailOperation(ctx, 'create', { request_id: 'request', to: 'alex@example.com', body: 'AI draft' }) as { id: string; sessionId: string };
    expect(first.sessionId).toBe(sessionId);
    await dispatchEmailOperation(ctx, 'update', { id: first.id, expected_revision: 0, patch: { body: 'Revised by AI' } });
    expect(q.getEmailDraft(first.id, sessionId).draft).toMatchObject({ body: 'Revised by AI', revision: 1 });
    await expect(dispatchEmailOperation(ctx, 'update', { id: first.id, expected_revision: 0, patch: { body: 'Stale text' } })).rejects.toMatchObject({ code: 'conflict' });
    off();
    expect(messages.filter(message => message.kind === 'chat_event')).toHaveLength(2);
  });

  it('rejects unsigned and reviewer callers, a supplied chat id, and any send operation', async () => {
    const sessionId = q.createChatSession({ harness: 'codex', type: 'execution', userId: 'local' }).id;
    const request = async (operation: string, input: unknown, signed = true, callerId = sessionId) => {
      const headers = new Headers({ [API_KEY_ID_HEADER]: 'viewer', [API_KEY_SCOPE_HEADER]: 'viewer', [CALLER_LOCATION_HEADER]: 'home' });
      if (signed) headers.set(SESSION_CREDENTIAL_HEADER, sessionCredential(callerId)!);
      return POST(new Request('http://localhost/api/email/action', { method: 'POST', headers, body: JSON.stringify({ operation, input }) }));
    };
    expect((await request('create', { request_id: 'r' }, false)).status).toBe(403);
    expect((await request('send', { id: 'any', expectedRevision: 0 })).status).toBe(422);
    expect((await request('create', { request_id: 'r', sessionId: 'another-chat' })).status).toBe(422);
    const reviewer = q.createChatSession({ harness: 'codex', type: 'execution', userId: 'local', surfaceKind: 'result_review', surfaceRef: 'review' });
    expect((await request('create', { request_id: 'r' }, true, reviewer.id)).status).toBe(403);
    expect(q.listChatEvents(sessionId)).toHaveLength(0);
  });
});
