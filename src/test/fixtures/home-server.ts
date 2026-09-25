/**
 * A real HTTP server in front of a test home: each request goes through the
 * real proxy (`src/proxy.ts`) and then the real route handler, and the
 * response streams back, event streams included. Tests of a connected
 * computer use it to talk to the home over actual HTTP, the way a worker or
 * CLI does, with no Next.js server.
 *
 * Only the routes listed here are served. Add a route when a test needs it.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { NextRequest } from 'next/server';

type Handler = (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response> | Response;
type RouteModule = Partial<Record<'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', Handler>>;

interface RouteEntry {
  pattern: RegExp;
  params?: string[];
  load: () => Promise<RouteModule>;
}

const ROUTES: RouteEntry[] = [
  { pattern: /^\/api\/health$/, load: () => import('@/app/api/health/route') as Promise<RouteModule> },
  { pattern: /^\/api\/home$/, load: () => import('@/app/api/home/route') as Promise<RouteModule> },
  { pattern: /^\/api\/workers\/grants$/, load: () => import('@/app/api/workers/grants/route') as Promise<RouteModule> },
  { pattern: /^\/api\/workers\/enroll$/, load: () => import('@/app/api/workers/enroll/route') as Promise<RouteModule> },
  { pattern: /^\/api\/workers\/me$/, load: () => import('@/app/api/workers/me/route') as Promise<RouteModule> },
  { pattern: /^\/api\/workers\/me\/stream$/, load: () => import('@/app/api/workers/me/stream/route') as Promise<RouteModule> },
  { pattern: /^\/api\/workers\/me\/heartbeat$/, load: () => import('@/app/api/workers/me/heartbeat/route') as Promise<RouteModule> },
  {
    pattern: /^\/api\/workers\/me\/requests\/([^/]+)\/result$/,
    params: ['id'],
    load: () => import('@/app/api/workers/me/requests/[id]/result/route') as Promise<RouteModule>,
  },
  { pattern: /^\/api\/workers\/me\/associations$/, load: () => import('@/app/api/workers/me/associations/route') as Promise<RouteModule> },
  {
    pattern: /^\/api\/workers\/me\/commands\/([^/]+)\/ack$/,
    params: ['id'],
    load: () => import('@/app/api/workers/me/commands/[id]/ack/route') as Promise<RouteModule>,
  },
  {
    pattern: /^\/api\/workers\/me\/attachments\/([^/]+)$/,
    params: ['fileName'],
    load: () => import('@/app/api/workers/me/attachments/[fileName]/route') as Promise<RouteModule>,
  },
  { pattern: /^\/api\/workers\/me\/events$/, load: () => import('@/app/api/workers/me/events/route') as Promise<RouteModule> },
  {
    pattern: /^\/api\/connectors\/(mcp)$/,
    params: ['transport'],
    load: () => import('@/app/api/connectors/[transport]/route') as Promise<RouteModule>,
  },
  {
    pattern: /^\/api\/orchestrator\/browser\/(mcp)$/,
    params: ['transport'],
    load: () => import('@/app/api/orchestrator/browser/[transport]/route') as Promise<RouteModule>,
  },
  {
    pattern: /^\/api\/sessions\/([^/]+)\/messages$/,
    params: ['id'],
    load: () => import('@/app/api/sessions/[id]/messages/route') as Promise<RouteModule>,
  },
  { pattern: /^\/api\/devices\/associate$/, load: () => import('@/app/api/devices/associate/route') as Promise<RouteModule> },
  { pattern: /^\/api\/devices\/([^/]+)$/, params: ['id'], load: () => import('@/app/api/devices/[id]/route') as Promise<RouteModule> },
  { pattern: /^\/api\/computers$/, load: () => import('@/app/api/computers/route') as Promise<RouteModule> },
  {
    pattern: /^\/api\/computers\/([^/]+)\/harnesses$/,
    params: ['id'],
    load: () => import('@/app/api/computers/[id]/harnesses/route') as Promise<RouteModule>,
  },
];

export interface HomeServer {
  url: string;
  close(): Promise<void>;
}

/** Request bodies as text: every route served here takes JSON. */
async function readBody(req: http.IncomingMessage): Promise<string | null> {
  if (req.method === 'GET' || req.method === 'HEAD') return null;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return chunks.length ? Buffer.concat(chunks).toString('utf8') : null;
}

/** The request the route sees: the headers the proxy set, none it removed. */
function forwardedRequest(url: string, method: string, proxied: Response, body: string | null, signal: AbortSignal): NextRequest {
  const headers = new Headers();
  const names = proxied.headers.get('x-middleware-override-headers')?.split(',') ?? [];
  for (const name of names) {
    const value = proxied.headers.get(`x-middleware-request-${name}`);
    if (value !== null) headers.set(name, value);
  }
  return new NextRequest(url, { method, headers, body: body ?? undefined, signal });
}

async function send(res: http.ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => {
    if (!name.startsWith('x-middleware-')) res.setHeader(name, value);
  });
  if (!response.body) {
    res.end();
    return;
  }
  res.flushHeaders();
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      if (res.destroyed) break;
      res.write(chunk);
    }
  } finally {
    res.end();
  }
}

export async function startHomeServer(): Promise<HomeServer> {
  const { proxy } = await import('@/proxy');
  const sockets = new Set<import('node:net').Socket>();
  const server = http.createServer(async (req, res) => {
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    try {
      const url = `http://127.0.0.1${req.url ?? '/'}`;
      const method = req.method ?? 'GET';
      const body = await readBody(req);
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') headers.set(name, value);
        else if (Array.isArray(value)) headers.set(name, value.join(', '));
      }
      const proxied = proxy(new NextRequest(url, { method, headers, body: body ?? undefined }));
      if (proxied.headers.get('x-middleware-next') !== '1') return await send(res, proxied);

      const pathname = new URL(url).pathname;
      const route = ROUTES.find((r) => r.pattern.test(pathname));
      if (!route) return await send(res, Response.json({ error: 'not_found' }, { status: 404 }));
      const handler = (await route.load())[method as keyof RouteModule];
      if (!handler) return await send(res, Response.json({ error: 'method_not_allowed' }, { status: 405 }));
      const match = route.pattern.exec(pathname)!;
      const params = Object.fromEntries((route.params ?? []).map((name, i) => [name, decodeURIComponent(match[i + 1]!)]));
      const response = await handler(forwardedRequest(url, method, proxied, body, controller.signal), {
        params: Promise.resolve(params),
      });
      await send(res, response);
    } catch (err) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: String(err) }));
      } else {
        res.end();
      }
    }
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
