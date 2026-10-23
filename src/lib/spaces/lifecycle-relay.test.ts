/** Real HTTP relay with a slow Team response. No real Home or provider. */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { API_KEY_ID_HEADER, API_KEY_SCOPE_HEADER } from '@/lib/auth/request-key';
import { DOCUMENT_HOME_HEADER, DOCUMENT_VIEWER_HEADER } from '@/lib/home/document-binding';
import { teamRequest } from './remote';
const fixture = vi.hoisted(() => ({ id: '00000000-0000-4000-a000-000000000001', url: '', effects: 0 }));
vi.mock('@/lib/home/authority', async original => ({ ...await original<typeof import('@/lib/home/authority')>(), isTeamAuthority: () => false }));
vi.mock('./connect', () => ({ teamFor: async () => ({ token: 'fixture-member', connection: { id: fixture.id, memberId: 'member', name: 'Fixture Team', url: fixture.url } }), isCurrentTeam: () => true, recordTeamFailure: () => null }));
let server: http.Server;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    expect(req.headers.authorization).toBe('Bearer fixture-member');
    expect(req.headers.cookie).toBeUndefined();
    const timer = setTimeout(() => { fixture.effects++; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true })); }, 16_100);
    res.once('close', () => clearTimeout(timer));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  fixture.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
it('returns a completed archive through My Ri after the ordinary 15 second deadline', async () => {
  const { POST } = await import('@/app/api/space/[teamId]/[...path]/route');
  const headers = { [API_KEY_ID_HEADER]: 'personal', [API_KEY_SCOPE_HEADER]: 'viewer', [DOCUMENT_HOME_HEADER]: fixture.id, [DOCUMENT_VIEWER_HEADER]: 'member', cookie: 'personal-secret', 'content-type': 'application/json' };
  const started = Date.now();
  const response = await POST(new NextRequest(`http://my-ri.test/api/space/${fixture.id}/trpc/sessions.archivePost`, { method: 'POST', headers, body: '{}' }), { params: Promise.resolve({ teamId: fixture.id, path: ['trpc', 'sessions.archivePost'] }) });
  expect(response.status, await response.clone().text()).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  expect(Date.now() - started).toBeGreaterThan(15_000);
  expect(fixture.effects).toBe(1);
  // A caller's explicit timeout still wins and prevents the fixture effect.
  await expect(teamRequest(fixture.url + '/api/trpc/sessions.archivePost', { method: 'POST', token: 'fixture-member', timeoutMs: 30 })).rejects.toThrow();
  expect(fixture.effects).toBe(1);
}, 30_000);
