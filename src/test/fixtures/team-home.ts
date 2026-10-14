/**
 * A team space in this test process (docs/homes-spec.md §9), reached through
 * the real proxy and route handlers: in-process with `serve`, or over real
 * HTTP with `listen`, for a client in another process (the MCP of a real
 * Claude Code binary).
 *
 * Test files mock what they need themselves (vi.mock is per file): the
 * `ai`/one-shot entry points they watch, and the personal workstream.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { NextRequest } from 'next/server';
import { ApiClient } from '@/lib/api/client';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

type Handler = (req: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response> | Response;
type RouteModule = Partial<Record<'GET' | 'POST' | 'DELETE', Handler>>;

export const TEAM_ROUTES: Array<[RegExp, () => Promise<RouteModule>]> = [
  [/^\/api\/trpc\//, () => import('@/app/api/trpc/[trpc]/route') as unknown as Promise<RouteModule>],
  [/^\/api\/team\/mcp$/, () => import('@/app/api/team/mcp/route') as unknown as Promise<RouteModule>],
  [/^\/api\/attachments$/, () => import('@/app/api/attachments/route') as unknown as Promise<RouteModule>],
  [/^\/api\/attachments\/([^/]+)$/, () => import('@/app/api/attachments/[fileName]/route') as unknown as Promise<RouteModule>],
  [/^\/api\/team\/public\/join$/, () => import('@/app/api/team/public/join/route') as unknown as Promise<RouteModule>],
  [/^\/api\/team\/host\/owner$/, () => import('@/app/api/team/host/owner/route') as unknown as Promise<RouteModule>],
  [/^\/api\/team\/host\/status$/, () => import('@/app/api/team/host/status/route') as unknown as Promise<RouteModule>],
  [/^\/api\/session$/, () => import('@/app/api/session/route') as unknown as Promise<RouteModule>],
];

/** Load the proxy, routes and tRPC stack once per file. */
export async function preloadTeamRoutes(): Promise<void> {
  await Promise.all([import('@/proxy'), import('@/lib/trpc/client'), ...TEAM_ROUTES.map(([, load]) => load())]);
}

/** One request through the real proxy and, when it lets it through, the real route. */
export async function serveTeam(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const source = input instanceof Request ? input : null;
  const request = new NextRequest(source ? source.url : String(input), {
    method: init?.method ?? source?.method,
    headers: init?.headers ?? source?.headers,
    body: init?.body ?? (source && source.method !== 'GET' && source.method !== 'HEAD' ? await source.arrayBuffer() : undefined),
    signal: init?.signal ?? undefined,
  });
  const { proxy } = await import('@/proxy');
  const auth = proxy(request);
  if (auth.headers.get('x-middleware-next') !== '1') return auth;
  const headers = new Headers(request.headers);
  for (const [name, value] of auth.headers) {
    if (name.startsWith('x-middleware-request-')) headers.set(name.slice('x-middleware-request-'.length), value);
  }
  const path = new URL(request.url).pathname;
  const route = TEAM_ROUTES.find(([pattern]) => pattern.test(path));
  if (!route) return Response.json({ error: 'no route in this test' }, { status: 599 });
  const mod = await route[1]();
  const handler = mod[request.method as 'GET' | 'POST' | 'DELETE'];
  if (!handler) return Response.json({ error: 'method' }, { status: 405 });
  const params = Promise.resolve({ fileName: route[0].exec(path)?.[1] ?? '' });
  return handler(new NextRequest(request, { headers }), { params });
}

/** The same, over real HTTP on a free port. */
export async function listenTeam(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') headers.set(name, value);
        else if (Array.isArray(value)) headers.set(name, value.join(', '));
      }
      const address = server.address() as AddressInfo;
      const response = await serveTeam(`http://127.0.0.1:${address.port}${req.url}`, {
        method: req.method,
        headers,
        body: chunks.length ? Buffer.concat(chunks) : undefined,
      });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(String(err));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}

export const TEAM_BASE = 'http://team.test';

export async function teamPost(path: string, body: unknown, token?: string): Promise<Response> {
  return serveTeam(`${TEAM_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

export async function teamTrpc(token: string) {
  const { createAppTRPCClient } = await import('@/lib/trpc/client');
  return createAppTRPCClient({ url: `${TEAM_BASE}/api/trpc`, transport: new ApiClient({ getToken: () => token, onUnauthorized: () => {} }) });
}

export interface TeamTestHome {
  home: TestHome;
  hostToken: string;
  owner: { token: string; id: string };
  joinAs(name: string): Promise<{ token: string; id: string }>;
  cleanup(): Promise<void>;
}

/** A team named Acme, with its owner Trey signed in. `fetch` reaches it in-process. */
export async function createTeamTestHome(prefix = 'ri-team-'): Promise<TeamTestHome> {
  const home = await createTestHome({ prefix, openDb: false });
  const { writeTeamIntent } = await import('@/lib/home/team-intent');
  writeTeamIntent({ creationId: 'team-create-1', name: 'Acme' });
  const { resetHomeIdentityCache, ensureHomeIdentity } = await import('@/lib/home/identity');
  const { resetAuthorityCache } = await import('@/lib/home/authority');
  resetHomeIdentityCache();
  resetAuthorityCache();
  ensureHomeIdentity();
  const { ensureLocalToken } = await import('@/lib/auth/bootstrap');
  const hostToken = ensureLocalToken().plaintext;
  const made = await teamPost('/api/team/host/owner', { creationId: 'team-create-1', ownerName: 'Trey' }, hostToken);
  if (made.status !== 200) throw new Error(`team owner: ${made.status}`);
  const body = (await made.json()) as { token: string; member: { id: string } };
  const owner = { token: body.token, id: body.member.id };
  return {
    home,
    hostToken,
    owner,
    async joinAs(name) {
      const link = (await (await teamTrpc(owner.token)).team.invitations.create.mutate()).link;
      const response = await teamPost('/api/team/public/join', { secret: new URL(link).hash.split('=')[1], name });
      if (response.status !== 200) throw new Error(`join: ${response.status}`);
      const joined = (await response.json()) as { token: string; member: { id: string } };
      return { token: joined.token, id: joined.member.id };
    },
    async cleanup() {
      (await import('@/lib/home/identity')).resetHomeIdentityCache();
      (await import('@/lib/home/authority')).resetAuthorityCache();
      await home.cleanup();
    },
  };
}
