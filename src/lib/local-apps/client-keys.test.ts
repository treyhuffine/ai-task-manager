/**
 * An app's outside client holds a key that adds links and does nothing else. The
 * proxy, the app connection, the session cookie and the capability gate all hold that line.
 */
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ValidatedArtifact } from '@ri/app-kit/build';
import type { InstalledArtifact } from '@ri/app-kit/runtime';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { appClientMayReach } from './client-policy';

vi.mock('@/lib/service/maintenance', async (original) => ({ ...await original<object>(), beginActivity: () => () => {} }));

let home: TestHome;
beforeEach(async () => { process.env.RI_LOCAL_APPS = '1'; home = await createTestHome({ prefix: 'ri-app-client-' }); });
afterEach(async () => { delete process.env.RI_LOCAL_APPS; await home.cleanup(); vi.restoreAllMocks(); });

const INSTANCE = '019a0000-0000-7000-8000-000000000001';

describe('what the key reaches', () => {
  it('reaches only an action on the client route', () => {
    expect(appClientMayReach('/api/local-apps/client/save_bookmarks', 'POST')).toBe(true);
    for (const [path, method] of [
      ['/api/local-apps/client/save_bookmarks', 'GET'], ['/api/local-apps/client/', 'POST'], ['/api/local-apps/client/a/b', 'POST'], ['/api/local-apps/client/../action', 'POST'], ['/api/local-apps/client/SAVE', 'POST'],
      ['/api/local-apps/action', 'POST'], ['/api/trpc/localApps.invoke', 'POST'], ['/api/trpc/tasks.list', 'GET'], ['/api/orchestrator/mcp', 'POST'], ['/api/attachments/x', 'GET'],
    ]) expect(appClientMayReach(path, method), `${method} ${path}`).toBe(false);
  });
  it('passes the proxy for its route alone, marked as what it is', async () => {
    const q = await import('@/lib/db/queries');
    const { proxy } = await import('@/proxy');
    const { token } = q.createAppClientKey(INSTANCE, 'Chrome');
    const call = (path: string, method = 'POST', forged?: string) => proxy(new NextRequest(`http://home.test${path}`, { method, headers: { authorization: `Bearer ${token.plaintext}`, ...(forged ? { 'x-ri-api-key-scope': forged } : {}) } }));
    const ok = call('/api/local-apps/client/save_bookmarks');
    expect(ok.headers.get('x-middleware-next')).toBe('1');
    expect(ok.headers.get('x-middleware-request-x-ri-api-key-scope')).toBe('app_client');
    expect(ok.headers.get('x-middleware-request-x-ri-caller-location')).toBe('elsewhere');
    expect(call('/api/local-apps/client/save_bookmarks', 'POST', 'viewer').headers.get('x-middleware-request-x-ri-api-key-scope')).toBe('app_client');
    for (const path of ['/api/trpc/tasks.list', '/api/local-apps/action', '/api/trpc/localApps.invoke', '/api/orchestrator/mcp', '/api/workers/me', '/api/attachments/x']) expect(call(path).status, path).toBe(403);
    expect(call('/api/local-apps/client/save_bookmarks', 'GET').status).toBe(403);
  });
  it('is no sign-in anywhere else, while a sign-in key is', async () => {
    const q = await import('@/lib/db/queries');
    const { createWebSocketContext } = await import('@/lib/trpc/ws-auth');
    const { POST: session } = await import('@/app/api/session/route');
    const { pageViewerKey } = await import('@/lib/auth/page-key');
    const client = q.createAppClientKey(INSTANCE, 'Chrome').token.plaintext;
    const signIn = q.pairDevice({ name: 'Laptop', kind: 'computer' }).token.plaintext;
    const ws = (token: string) => createWebSocketContext(new Request('http://home.test/api/trpc', { headers: { authorization: `Bearer ${token}` } }), {});
    expect(() => ws(signIn)).not.toThrow();
    expect(() => ws(client)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    const cookie = (token: string) => session(new NextRequest('http://home.test/api/session', { method: 'POST', headers: { authorization: `Bearer ${token}` } }));
    expect((await cookie(signIn)).status).toBe(200);
    expect((await cookie(client)).status).toBe(401);
    expect(pageViewerKey(new Headers({ authorization: `Bearer ${signIn}` }))).toBeTruthy();
    expect(pageViewerKey(new Headers({ authorization: `Bearer ${client}` }))).toBeNull();
  });
  it('stops working when revoked or when its app is removed, and names no other key', async () => {
    const q = await import('@/lib/db/queries');
    const { proxy } = await import('@/proxy');
    const first = q.createAppClientKey(INSTANCE, 'One');
    const second = q.createAppClientKey(INSTANCE, 'Two');
    const other = q.createAppClientKey('019a0000-0000-7000-8000-000000000002', 'Elsewhere');
    const signIn = q.pairDevice({ name: 'Laptop', kind: 'computer' });
    const call = (token: string) => proxy(new NextRequest('http://home.test/api/local-apps/client/save_bookmarks', { method: 'POST', headers: { authorization: `Bearer ${token}` } })).status;
    expect(q.listAppClientKeys(INSTANCE).map(key => key.name).sort()).toEqual(['One', 'Two']);
    // A key from elsewhere, or a sign-in key, can't be revoked through this app.
    q.revokeAppClientKeys(INSTANCE, other.key.id);
    q.revokeAppClientKeys(INSTANCE, signIn.key.id);
    expect(call(other.token.plaintext)).toBe(200);
    expect(q.getApiKey(signIn.key.id)?.revokedAt).toBeNull();
    q.revokeAppClientKeys(INSTANCE, first.key.id);
    q.revokeAppClientKeys(INSTANCE, first.key.id);
    expect(call(first.token.plaintext)).toBe(401);
    expect(call(second.token.plaintext)).toBe(200);
    q.revokeAppClientKeys(INSTANCE);
    expect(call(second.token.plaintext)).toBe(401);
    expect(call(other.token.plaintext)).toBe(200);
  });
  it('refuses another of the personal keys on the client route', async () => {
    const q = await import('@/lib/db/queries');
    const { POST } = await import('@/app/api/local-apps/client/[action]/route');
    const { API_KEY_ID_HEADER, API_KEY_SCOPE_HEADER } = await import('@/lib/auth/request-key');
    const signIn = q.pairDevice({ name: 'Laptop', kind: 'computer' });
    const params = Promise.resolve({ action: 'save_bookmarks' });
    expect((await POST(new Request('http://home.test/x', { method: 'POST', body: '{}', headers: { [API_KEY_ID_HEADER]: signIn.key.id, [API_KEY_SCOPE_HEADER]: 'viewer' } }), { params })).status).toBe(403);
    expect((await POST(new Request('http://home.test/x', { method: 'POST', body: '{}' }), { params })).status).toBe(403);
  });
});

describe('the app service', () => {
  function fixture(clientActions: string[] | undefined) {
    const artifact = {
      digest: 'a'.repeat(64), packageDir: '/nonexistent', files: [], sourceDigest: 'b'.repeat(64), contractDigest: 'c'.repeat(64),
      manifest: { name: 'ri-bookmarks', version: '0.1.0', extensions: { 'com.ri': { requests: { integrations: [], riActions: [], ...(clientActions ? { clientActions } : {}) } } } },
      contract: { actions: [] },
    } as unknown as ValidatedArtifact;
    return artifact;
  }
  async function service(clientActions?: string[]) {
    const { LocalAppsService } = await import('./service');
    const apps = new LocalAppsService();
    const artifact = fixture(clientActions);
    vi.spyOn(apps, 'artifact').mockResolvedValue(artifact);
    const call = vi.spyOn(apps, 'call').mockResolvedValue({ saved: 1, invalid: 0 });
    vi.spyOn(apps, 'instance').mockReturnValue({ id: INSTANCE, slug: 'bookmarks', digest: 'a'.repeat(64) } as never);
    vi.spyOn(apps, 'grant').mockReturnValue({ id: 'g', revision: 1, riActions: [], connections: [], actions: [] } as never);
    return { apps, artifact, call };
  }
  it('runs a declared action as the owner and refuses anything else', async () => {
    const { apps, call } = await service(['save_bookmarks']);
    await expect(apps.clientCall(INSTANCE, 'save_bookmarks', { via: 'extension', items: [] })).resolves.toEqual({ saved: 1, invalid: 0 });
    expect(call).toHaveBeenCalledWith(INSTANCE, 'save_bookmarks', { via: 'extension', items: [] }, { kind: 'owner-ui', id: 'owner' }, expect.any(String), undefined);
    call.mockClear();
    for (const action of ['list_bookmarks', 'get_bookmark', 'delete_bookmark', 'export_bookmarks', 'connect_client']) await expect(apps.clientCall(INSTANCE, action, {}), action).rejects.toMatchObject({ code: 'forbidden' });
    expect(call).not.toHaveBeenCalled();
    const undeclared = await service();
    await expect(undeclared.apps.clientCall(INSTANCE, 'save_bookmarks', {})).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('lets only the owner of an app with client actions manage its keys', async () => {
    const { apps, artifact } = await service(['save_bookmarks']);
    const installed = { ...artifact, instanceId: INSTANCE } as unknown as InstalledArtifact;
    const context = (principal: { kind: string; id: string }) => ({ id: randomUUID(), principal, audience: 'user', grantRevision: 1, deadline: Date.now() + 30_000, packageDigest: 'a'.repeat(64) }) as never;
    const signal = new AbortController().signal;
    const owner = context({ kind: 'owner-ui', id: 'owner' });
    const call = (name: string, input: unknown = {}, as = owner) => apps.dispatchCapability(installed, as, { callId: randomUUID(), name, input }, signal);
    const made = await call('create_client_key', { name: 'Chrome' }) as { token: string; key: { id: string }; homeUrl: string; appUrl: string };
    expect(made.token).toMatch(/^ri_/);
    expect(made.appUrl).toBe(`${made.homeUrl}/apps/bookmarks`);
    const q = await import('@/lib/db/queries');
    expect(q.getApiKey(made.key.id)).toMatchObject({ role: 'app_client', client: INSTANCE, deviceId: null, memberId: null });
    expect(await call('list_client_keys')).toMatchObject({ keys: [{ id: made.key.id, name: 'Chrome', lastUsedAt: null }] });
    for (const principal of [{ kind: 'chat', id: 'c' }, { kind: 'job', id: 'j' }, { kind: 'workspace', id: 'w' }]) await expect(call('create_client_key', { name: 'x' }, context(principal)), principal.kind).rejects.toMatchObject({ code: 'forbidden' });
    await expect(call('create_client_key', { name: '' })).rejects.toThrow();
    expect(await call('revoke_client_key', { id: made.key.id })).toEqual({ revoked: true });
    expect(await call('list_client_keys')).toMatchObject({ keys: [] });
    const none = await service();
    const plain = { ...none.artifact, instanceId: INSTANCE } as unknown as InstalledArtifact;
    await expect(none.apps.dispatchCapability(plain, owner, { callId: randomUUID(), name: 'create_client_key', input: { name: 'x' } }, signal)).rejects.toMatchObject({ code: 'forbidden' });
  });
});
