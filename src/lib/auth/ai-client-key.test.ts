/**
 * A device-bound AI client is not a personal content credential. The proxy,
 * app connection and browser session all refuse it. Personal MCP credentials
 * have neither a device nor a member (external-ai/home-mcp.test.ts).
 */

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

let home: TestHome;
beforeEach(async () => { home = await createTestHome({ prefix: 'ri-ai-client-personal-' }); });
afterEach(async () => { await home.cleanup(); });

it('is refused by a personal home, where the same key as a sign-in is let through', async () => {
  const q = await import('@/lib/db/queries');
  const { proxy } = await import('@/proxy');
  const { createWebSocketContext } = await import('@/lib/trpc/ws-auth');
  const { POST: session } = await import('@/app/api/session/route');
  const device = q.pairDevice({ name: 'Laptop', kind: 'computer' });
  const signIn = device.token.plaintext;
  const stray = q.createApiKey({ name: 'stray', role: 'ai_client', deviceId: device.device.id }).token.plaintext;

  const call = (token: string) => proxy(new NextRequest('http://home.test/api/trpc/tasks.list', { headers: { authorization: `Bearer ${token}` } }));
  expect(call(signIn).headers.get('x-middleware-next')).toBe('1');
  expect(call(stray).status).toBe(401);

  const ws = (token: string) => createWebSocketContext(new Request('http://home.test/api/trpc', { headers: { authorization: `Bearer ${token}` } }), {});
  expect(() => ws(signIn)).not.toThrow();
  expect(() => ws(stray)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));

  const cookie = (token: string) => session(new NextRequest('http://home.test/api/session', { method: 'POST', headers: { authorization: `Bearer ${token}` } }));
  expect((await cookie(signIn)).status).toBe(200);
  expect((await cookie(stray)).status).toBe(401);
});
