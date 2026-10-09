import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import { applyWSSHandler } from '@trpc/server/adapters/ws';
import type { AnyRouter } from '@trpc/server';
import { createWebSocketContext, permitsWebSocketOrigin } from './ws-auth';
import { TRPC_WS_PATH, liveApplicationRouter, type WebSocketRuntime } from './ws-runtime';
import { readMaintenance } from '@/lib/service/maintenance-state';

function upgradeRequest(req: IncomingMessage): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const part of value) headers.append(name, part);
    else if (value !== undefined) headers.set(name, value);
  }
  // Host survives the trusted gateway. Never use x-forwarded-host for origin admission.
  const scheme = headers.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  return new Request(`${scheme}://${headers.get('host') ?? 'localhost'}${req.url}`, { headers });
}

export function createWebSocketServer(router: AnyRouter): WebSocketRuntime {
  // App resources are bounded self-contained HTML, transported through tRPC.
  // Keep queued output bounded while allowing one qualified resource response.
  const outgoingLimit = 16 * 1024 * 1024;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024, perMessageDeflate: false });
  const authorized = new Map<WebSocket, () => void>();
  // Bound queued output and idle unauthenticated connections. Authentication is
  // checked on every procedure and periodically for long-lived subscriptions.
  wss.on('connection', client => {
    const send = client.send;
    client.send = function (this: WebSocket, ...args: Parameters<WebSocket['send']>) {
      const data = args[0];
      const bytes = typeof data === 'string' ? Buffer.byteLength(data) : Buffer.isBuffer(data) ? data.length : 0;
      if (client.bufferedAmount + bytes > outgoingLimit) { client.terminate(); return; }
      Reflect.apply(send, this, args);
    } as WebSocket['send'];
    const deadline = setTimeout(() => { if (!authorized.has(client)) client.close(4401, 'Authentication required'); }, 5_000);
    deadline.unref();
    client.once('close', () => { clearTimeout(deadline); authorized.delete(client); });
  });
  const handler = applyWSSHandler({
    wss, router,
    keepAlive: { enabled: true, pingMs: 25_000, pongWaitMs: 5_000 },
    createContext({ req, res, info }) {
      const ctx = createWebSocketContext(upgradeRequest(req), info.connectionParams);
      authorized.set(res, ctx.authorize);
      return ctx;
    },
  });
  const sweep = setInterval(() => {
    for (const client of wss.clients) {
      if (client.bufferedAmount > outgoingLimit) { client.terminate(); continue; }
      try { authorized.get(client)?.(); } catch { client.close(4401, 'Connection authorization expired'); }
    }
  }, 1_000);
  sweep.unref();
  let closing = false;
  return {
    upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
      let request: Request;
      try { request = upgradeRequest(req); } catch { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); return; }
      const path = new URL(request.url).pathname;
      const refused = closing || process.env.RI_TRPC_WS_DISABLED === '1' || process.env.RI_SERVICE_VALIDATING === '1' || readMaintenance()?.phase === 'offline';
      if (path !== TRPC_WS_PATH || refused || !permitsWebSocketOrigin(request)) {
        socket.end(`HTTP/1.1 ${refused ? '503 Service Unavailable' : '403 Forbidden'}\r\nConnection: close\r\n\r\n`);
        return;
      }
      wss.handleUpgrade(req, socket, head, client => wss.emit('connection', client, req));
    },
    async close() {
      if (closing) return;
      closing = true;
      clearInterval(sweep);
      handler.broadcastReconnectNotification();
      for (const client of wss.clients) client.close(1012, 'Home is restarting');
      const force = setTimeout(() => { for (const client of wss.clients) client.terminate(); }, 1_000);
      force.unref();
      await new Promise<void>(resolve => wss.close(() => resolve()));
      clearTimeout(force);
    },
  };
}

export async function registerWebSocketRuntime() {
  if (process.env.RI_TRPC_WS_HOST !== '1' || process.env.RI_TRPC_WS_DISABLED === '1' || globalThis.__riTRPCWebSocket) return;
  const { appRouter } = await import('./router');
  globalThis.__riTRPCWebSocket = createWebSocketServer(liveApplicationRouter(appRouter));
}
