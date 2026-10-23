import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiClient } from '@/lib/api/client';
import { createAppTRPCClient } from '@/lib/trpc/client';
import { createWebSocketContext } from '@/lib/trpc/ws-auth';
import { API_PROTOCOL } from '@/lib/releases/api-contract';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { preloadTeamRoutes, serveTeam } from '@/test/fixtures/team-home';
import { teamSessionCookieName } from '@/lib/team/credential';
import * as q from '@/lib/db/queries';
import { assertDocumentCredential } from './document-scope';
import { bindingFromHeaders, documentBindingMatches, documentCredential, DOCUMENT_HOME_HEADER, DOCUMENT_VIEWER_HEADER } from './document-binding';

let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>;
let client: ReturnType<typeof createAppTRPCClient>;
let cookie: string;
let scope: { riAuthority: string; riHome: string; riViewer: string };
const requests: Headers[] = [];
beforeEach(async () => {
  await preloadTeamRoutes(); fixture = await createTeamExecutionFixture();
  scope = { riAuthority: 'team', riHome: q.getHome()!.id, riViewer: fixture.owner.member.id };
  cookie = fixture.owner.token.plaintext;
  requests.length = 0;
  vi.stubGlobal('document', { documentElement: { dataset: scope }, addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {}, location: { hash: '', origin: 'http://team.test' }, localStorage: { getItem() { throw new Error('Storage denied'); } } });
  vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers); requests.push(headers);
    headers.set('cookie', `${teamSessionCookieName()}=${cookie}`); headers.set('origin', 'http://team.test');
    return serveTeam(url instanceof Request ? url.url : String(url), { ...init, headers });
  });
  client = createAppTRPCClient({ url: 'http://team.test/api/trpc', getMode: () => 'http', transport: new ApiClient() });
});
afterEach(async () => { await client?.closeTransport(); await fixture?.cleanup(); vi.unstubAllGlobals(); });

it('binds cookie-only HTTP writes to the original document even when storage is denied and another tab replaces the cookie', async () => {
  const made = await client.tasks.create.mutate({ title: 'Original author', rawInput: 'Original author', body: 'First body' });
  expect(requests[0].get('authorization')).toBeNull();
  expect(bindingFromHeaders(requests[0])).toEqual({ homeId: scope.riHome, viewerId: fixture.owner.member.id });
  const captured = documentCredential(null);
  cookie = fixture.member.token.plaintext;
  await expect(client.tasks.update.mutate({ id: made.id, patch: { body: 'Do not become another author' }, expectedBodyRevision: made.bodyRevision })).rejects.toMatchObject({ cause: { status: 403, body: { error: 'document_author_changed' } } });
  expect(q.getTask(made.id)?.body).toBe('First body');
  await expect(client.homeContext.query()).rejects.toMatchObject({ cause: { status: 403, body: { error: 'document_author_changed' } } });
  // A fresh document can use the other member, but the retained writer cannot.
  scope.riViewer = fixture.member.member.id;
  expect(() => assertDocumentCredential(captured, documentCredential(null))).toThrow(/original author/);
  expect(await client.tasks.update.mutate({ id: made.id, patch: { title: 'Explicit new member edit' } })).toMatchObject({ title: 'Explicit new member edit' });
});

it('refuses a cookie-only WebSocket reconnect into a different member while preserving the original socket principal', () => {
  const request = (token: string) => new Request('http://team.test/api/trpc/ws', { headers: { cookie: `${teamSessionCookieName()}=${token}`, origin: 'http://team.test' } });
  const params = { protocol: String(API_PROTOCOL), documentHome: scope.riHome, documentViewer: scope.riViewer };
  const original = createWebSocketContext(request(cookie), params);
  expect(original.key?.memberId).toBe(fixture.owner.member.id);
  expect(() => createWebSocketContext(request(fixture.member.token.plaintext), params)).toThrow(/original author/);
  original.authorize(); expect(original.key?.memberId).toBe(fixture.owner.member.id);
  q.revokeApiKey(fixture.owner.key.id, 'Fixture revoked'); expect(() => original.authorize()).toThrow();
});

it('treats Home/member headers as optional expectations without granting scope, and rejects partial or wrong bindings', async () => {
  const actual = { homeId: scope.riHome, viewerId: scope.riViewer };
  expect(documentBindingMatches(null, actual)).toBe(true);
  for (const expected of [{ homeId: 'another-home', viewerId: scope.riViewer }, { homeId: scope.riHome }, { homeId: '', viewerId: '' }]) expect(documentBindingMatches(expected, actual)).toBe(false);
  const transport = new ApiClient({ getToken: () => fixture.member.token.plaintext });
  await expect(transport.get('/tasks', { headers: { [DOCUMENT_HOME_HEADER]: scope.riHome, [DOCUMENT_VIEWER_HEADER]: fixture.owner.member.id } })).rejects.toMatchObject({ status: 403 });
  expect(q.getMember(fixture.member.member.id)?.role).toBe('member');
});
