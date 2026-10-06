/** The service's ordinary-Node HTTP boundary. Next remains the application. */
import http from 'node:http';
import next from 'next';
import { beginActivity, readMaintenance } from '@/lib/service/maintenance';
import './watchdog';
import { isTrpcDrainSave } from '@/lib/trpc/admission';
import { listRunningSessions, listBackgroundTaskSessions, listSessionsWithPending } from '@/lib/executor/status-snapshot';
import { TRPC_WS_PATH } from '@/lib/trpc/ws-runtime';
import { DEFAULT_PORT } from '@/lib/auth/port';
import { beginPerfScope, stopPerfRecorder } from '@/lib/perf/recorder';
import { startServerPerfLog } from '@/lib/perf/server';
import { requestLabel } from '@/lib/perf/labels';
import { pinServedRelease } from '@/lib/releases/runtime-identity';

process.env.RI_TRPC_WS_HOST = '1';
Object.assign(process.env, { NODE_ENV: process.env.RI_DESKTOP_MODE === 'development' ? 'development' : 'production' });
const port = Number(process.env.PORT || DEFAULT_PORT);
const hostname = process.env.RI_HTTP_HOST || '127.0.0.1';
// Next attaches its own router/HMR upgrade listener on the first HTTP request.
// Give it an unbound server as its registration target, then dispatch explicitly.
// Registering it on our listening server would handle a socket twice and let
// Next consume tRPC upgrades or bypass the maintenance gate.
const nextUpgrades = http.createServer();
const application = next({ dev: process.env.RI_DESKTOP_MODE === 'development', hostname, port, dir: process.cwd(), httpServer: nextUpgrades,
  ...(process.env.RI_NEXT_BUNDLER === 'webpack' ? { webpack: true } : process.env.RI_NEXT_BUNDLER === 'turbopack' ? { turbopack: true } : {}),
});
const handle = application.getRequestHandler();

async function start() {
  // Before Next loads, so boot's own statements are timed too. A validating
  // server is a rehearsal and would only add noise to the Home's log.
  if (process.env.RI_SERVICE_VALIDATING !== '1') startServerPerfLog();
  // Before Next reads BUILD_ID, so /version names the build actually served.
  pinServedRelease();
  await application.prepare();
  const server = http.createServer((request, response) => {
    let pathname: string;
    try { pathname = new URL(request.url ?? '/', 'http://localhost').pathname; }
    catch {
      response.writeHead(400, { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain' }).end('Invalid request target');
      return;
    }
    const gate = readMaintenance();
    // Readiness is private to the local controller. During validation the
    // public gateway is still closed, including to ordinary read requests.
    if (pathname === '/__ri_ready' || pathname === '/__ri_activity' || pathname === '/__ri_prepare' || pathname === '/__ri_compatibility') {
      if (!process.env.RI_SERVICE_CONTROL_TOKEN || request.headers['x-ri-service-control'] !== process.env.RI_SERVICE_CONTROL_TOKEN) { response.writeHead(404).end(); return; }
      if (pathname === '/__ri_compatibility') {
        if (request.method !== 'POST') { response.writeHead(405).end(); return; }
        void (async () => {
          let body = '';
          for await (const chunk of request) { body += chunk; if (body.length > 16_384) throw new Error('Request too large'); }
          const { repo } = JSON.parse(body) as { repo?: string };
          if (typeof repo !== 'string' || !repo.startsWith('/')) throw new Error('Invalid runtime path');
          const { homeUpdateCompatibility } = await import('@/lib/workers/update-compatibility');
          response.setHeader('content-type', 'application/json');
          response.end(JSON.stringify({ reasons: homeUpdateCompatibility(repo) }));
        })().catch(() => { if (!response.headersSent) response.writeHead(409); response.end(); });
        return;
      }
      if (pathname === '/__ri_prepare') {
        const prepare = (globalThis as typeof globalThis & { __riPrepareIdle?: () => Promise<void> }).__riPrepareIdle;
        if (!prepare) { response.writeHead(503).end(); return; }
        void prepare().then(() => response.end('{}')).catch(() => response.writeHead(409).end());
        return;
      }
      if (pathname === '/__ri_activity') {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ executions: listRunningSessions().length, background: listBackgroundTaskSessions().length, permissions: listSessionsWithPending().length }));
        return;
      }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ ready: true, validation: process.env.RI_SERVICE_VALIDATING === '1', pid: process.pid, repo: process.cwd() }));
      return;
    }
    const workerCompletion = request.method === 'POST' && /^\/api\/workers\/me\/(?:heartbeat|events|commands\/[^/]+\/ack|requests\/[^/]+\/result)$/.test(pathname);
    const saving = workerCompletion || isTrpcDrainSave(request.method, pathname) || request.method === 'PATCH' && /^\/api\/(tasks|notes|areas)\/[^/]+$/.test(pathname);
    const safeRead = request.method === 'GET' || request.method === 'HEAD';
    if (process.env.RI_SERVICE_VALIDATING === '1' || gate?.phase === 'offline' || (gate && !saving && !safeRead)) {
      response.writeHead(503, { 'Retry-After': '5', 'Cache-Control': 'no-store', 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'maintenance', message: 'Ri is preparing an update. Please retry shortly.' }));
      return;
    }
    let release: () => void;
    try { release = beginActivity(undefined, saving || safeRead); }
    catch {
      response.writeHead(503, { 'Retry-After': '5' }).end('Ri is preparing an update');
      return;
    }
    let done = false;
    let handlerDone = false;
    let responseDone = false;
    // One perf-log scope per request (src/lib/perf/recorder.ts), so what the
    // handler runs is attributed to its route or tRPC procedure.
    const perf = beginPerfScope(requestLabel(request.method, pathname));
    const finish = (passive = false) => { if (!done && (passive || (handlerDone && responseDone))) { done = true; release(); } };
    const responseEnded = () => { responseDone = true; perf.end(); finish(); };
    response.once('finish', responseEnded);
    response.once('close', responseEnded);
    // A passive SSE subscriber does not keep an otherwise idle Home busy.
    // Its producer's actual work has its own admission lease.
    const writeHead = response.writeHead;
    response.writeHead = function (status: number, message?: string | http.OutgoingHttpHeaders | http.OutgoingHttpHeader[], headers?: http.OutgoingHttpHeaders | http.OutgoingHttpHeader[]) {
      const result = Reflect.apply(writeHead, this, [status, message, headers]) as ReturnType<typeof writeHead>;
      if (safeRead && String(this.getHeader('content-type')).includes('text/event-stream')) { perf.end(); finish(true); }
      return result;
    };
    void perf.run(() => handle(request, response)).then(() => { handlerDone = true; finish(); }).catch(error => {
      handlerDone = true; finish();
      console.error('[service] Request failed', error instanceof Error ? error.name : 'Error');
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  server.on('upgrade', (request, socket, head) => {
    let pathname: string;
    try { pathname = new URL(request.url ?? '/', 'http://localhost').pathname; } catch { socket.destroy(); return; }
    if (pathname === TRPC_WS_PATH) {
      const runtime = globalThis.__riTRPCWebSocket;
      if (runtime) runtime.upgrade(request, socket, head);
      else socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      return;
    }
    if (readMaintenance()) { socket.destroy(); return; }
    if (process.env.RI_DESKTOP_MODE === 'development' && pathname === '/_next/webpack-hmr' && nextUpgrades.listenerCount('upgrade') > 0) {
      nextUpgrades.emit('upgrade', request, socket, head);
    } else socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, hostname, resolve); });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    stopPerfRecorder();
    server.close();
    void (async () => { await globalThis.__riTRPCWebSocket?.close(); await application.close(); })().finally(() => process.exit(0));
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  process.send?.({ type: 'listening', port });
  if (!process.send) console.info(`[server] ready on http://${hostname}:${port}`);
}
void start().catch(error => { console.error('[service] HTTP startup failed', error); process.exit(1); });
