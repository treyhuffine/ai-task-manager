/**
 * Optional browser-facing HTTP/2 gateway (see docs/optional-http2.md §5/§6).
 *
 * A TLS listener that negotiates `h2` (or HTTPS/1.1 via `allowHTTP1`) on the
 * public port and relays to the normal Next server over HTTP/1.1 on a private
 * loopback port. It does NOT import the executor, database, or event bus, and
 * does NOT parse domain payloads — it is a streaming reverse proxy plus header
 * translation. Next keeps its supported HTTP/1.1 interfaces; HTTP/2 request
 * objects are never fed into Next.
 *
 * Loaded only on the `--http2` path (lazy dynamic import from the launcher), so
 * this module and its TLS deps never initialize on the default HTTP startup.
 */

import http from 'node:http';
import http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import {
  buildUpstreamRequestHeaders,
  buildDownstreamResponseHeaders,
  privateAuthoritiesFor,
  type HeaderTranslationConfig,
} from './headers';
import { probeHttp2, type Http2ProbeResult } from './probe';
import type { TlsMaterial } from '@/lib/config/tls';

export { probeHttp2 };
export type { Http2ProbeResult };

// ─── Bounded pool budgets (see §5 "Retain bounded ... request limits") ──────
//
// Separate upstream pools so long-lived SSE streams can never occupy the
// sockets reserved for ordinary API calls. Each pool is independent, so N open
// SSE streams leave the normal pool fully available.
const NORMAL_MAX_SOCKETS = 64;
const STREAM_MAX_SOCKETS = 512;
/** Allow many concurrent multiplexed streams per session (SSE + normal). */
const MAX_CONCURRENT_STREAMS = 256;

export interface Http2GatewayOptions {
  /** Public port to bind (the app port the browser connects to). */
  publicPort: number;
  /** Bind address for the public listener. Loopback by default. */
  bindHost?: string;
  /** Canonical public origin, e.g. `https://localhost:4224`. No trailing slash. */
  publicBaseUrl: string;
  /** Private loopback host the Next server listens on. */
  upstreamHost: string;
  /** Private port the Next server listens on. */
  upstreamPort: number;
  /** TLS material (generated CA/leaf or a supplied pair). */
  tls: TlsMaterial;
  onLog?: (message: string) => void;
}

export interface Http2GatewayHandle {
  /** The bound public port (equals the requested port). */
  port: number;
  /** Number of active HTTP/2 sessions. */
  sessionCount(): number;
  /** Run the readiness probe (real h2 negotiation + health) against this gateway. */
  probe(caOverride?: string | string[]): Promise<Http2ProbeResult>;
  /** Gracefully close: stop accepting, GOAWAY sessions, then destroy after a deadline. */
  close(deadlineMs?: number): Promise<void>;
}

function isSseRequest(headers: http.IncomingHttpHeaders): boolean {
  const accept = headers['accept'];
  const value = Array.isArray(accept) ? accept.join(',') : accept;
  return !!value && value.includes('text/event-stream');
}

export function startHttp2Gateway(opts: Http2GatewayOptions): Promise<Http2GatewayHandle> {
  const bindHost = opts.bindHost ?? '127.0.0.1';
  const publicUrl = new URL(opts.publicBaseUrl);
  const cfg: HeaderTranslationConfig = {
    publicBaseUrl: opts.publicBaseUrl.replace(/\/+$/, ''),
    publicHostHeader: publicUrl.host,
    publicPort: opts.publicPort,
    privateAuthorities: privateAuthoritiesFor(opts.upstreamHost, opts.upstreamPort),
  };
  const log = opts.onLog ?? (() => {});

  // Two independent upstream pools — SSE cannot starve ordinary requests.
  const normalAgent = new http.Agent({ keepAlive: true, maxSockets: NORMAL_MAX_SOCKETS });
  const streamAgent = new http.Agent({ keepAlive: true, maxSockets: STREAM_MAX_SOCKETS });

  const server = http2.createSecureServer({
    key: opts.tls.key,
    cert: opts.tls.cert,
    allowHTTP1: true,
    // RFC 8441 extended CONNECT is deliberately NOT advertised in V1; HMR is
    // forwarded over a separate HTTPS/1.1 Upgrade instead.
    settings: { enableConnectProtocol: false, maxConcurrentStreams: MAX_CONCURRENT_STREAMS },
  });

  // ── Ordinary request proxy (compat API serves both h2 streams and h1 reqs) ──
  server.on('request', (req, res) => {
    const headers = buildUpstreamRequestHeaders(req.headers, cfg, {
      remoteAddress: req.socket.remoteAddress ?? undefined,
    });
    const agent = isSseRequest(req.headers) ? streamAgent : normalAgent;

    // Held so cancellation can tear down the response socket, not just the
    // request. For a live SSE stream the response is already flowing, so
    // destroying only the ClientRequest would leave the upstream socket open.
    let upstreamRes: http.IncomingMessage | null = null;
    // Whether the upstream response completed on its own. A cancelled h2 stream
    // reports `res.writableFinished === true` (the cancel destroys the writable
    // side), so that flag can't distinguish completion from cancellation —
    // upstream stream state can.
    let upstreamEnded = false;

    const upstream = http.request(
      {
        host: opts.upstreamHost,
        port: opts.upstreamPort,
        method: req.method,
        path: req.url,
        headers,
        agent,
      },
      (uRes) => {
        upstreamRes = uRes;
        const status = uRes.statusCode ?? 502;
        const outHeaders = buildDownstreamResponseHeaders(uRes.headers, cfg);
        try {
          res.writeHead(status, outHeaders);
        } catch (err) {
          log(`response head error: ${(err as Error).message}`);
          uRes.destroy();
          res.destroy();
          return;
        }
        // Stream with backpressure. Node's HTTP/2 flow control pauses `uRes`
        // when the client window fills; SSE chunks flush as they arrive with
        // no whole-response accumulation.
        uRes.pipe(res);
        uRes.on('end', () => {
          upstreamEnded = true;
        });
        uRes.on('error', () => res.destroy());
      },
    );

    upstream.on('error', (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain' });
        res.end(`Upstream error: ${err.message}`);
      } else {
        res.destroy();
      }
    });

    // Cancellation: if the client cancels THIS stream (SSE disconnect, nav
    // away, reset), abort only this upstream request/response. Other streams,
    // agents, and terminals are untouched.
    res.on('close', () => {
      if (upstreamEnded) return; // upstream already completed — nothing to cancel
      if (upstreamRes) upstreamRes.destroy();
      upstream.destroy();
    });

    // Stream the request body upstream with backpressure (uploads).
    req.pipe(upstream);
    req.on('error', () => upstream.destroy());
  });

  // ── HTTP/1.1 Upgrade forwarding (development HMR WebSocket) ──
  // Track upgraded client sockets so shutdown can tear them down: they are raw
  // TCP connections, not HTTP/2 sessions, so the session drain does not cover them.
  const upgradeSockets = new Set<Duplex>();
  server.on('upgrade', (req, clientSocket, head) => {
    upgradeSockets.add(clientSocket);
    clientSocket.on('close', () => upgradeSockets.delete(clientSocket));

    const headers = buildUpstreamRequestHeaders(req.headers, cfg, {
      remoteAddress: req.socket.remoteAddress ?? undefined,
      keepUpgrade: true,
    });
    // A dedicated connection (no pooling): an upgraded socket is hijacked for
    // the WebSocket's lifetime and must never return to the keep-alive pool, and
    // a dedicated socket is torn down cleanly when we abort a pending handshake.
    const upstreamReq = http.request({
      host: opts.upstreamHost,
      port: opts.upstreamPort,
      method: req.method,
      path: req.url,
      headers,
      agent: false,
    });

    // Upstream declined the upgrade (any non-101 response): relay the plain
    // response and close, so the client sees the rejection instead of hanging
    // on a socket that never gets a reply.
    upstreamReq.on('response', (uRes) => {
      const lines = [`HTTP/1.1 ${uRes.statusCode ?? 502} ${uRes.statusMessage || ''}`];
      for (const [k, v] of Object.entries(uRes.headers)) {
        const lk = k.toLowerCase();
        // Node has already decoded any chunked body, so forwarding the upstream
        // framing headers would misframe the relayed bytes. Drop them and
        // delimit the body by closing the connection instead.
        if (lk === 'transfer-encoding' || lk === 'content-length' || lk === 'connection' || lk === 'keep-alive') {
          continue;
        }
        if (Array.isArray(v)) v.forEach((vv) => lines.push(`${k}: ${vv}`));
        else if (v !== undefined) lines.push(`${k}: ${v}`);
      }
      lines.push('Connection: close');
      clientSocket.write(lines.join('\r\n') + '\r\n\r\n');
      uRes.on('data', (c) => clientSocket.write(c));
      uRes.on('end', () => clientSocket.end());
      uRes.on('error', () => clientSocket.destroy());
    });

    let upgraded = false;
    // Capture the raw upstream socket so a pre-handshake cancellation can force
    // it fully closed — destroying the request alone only half-closes it.
    let pendingUpstreamSocket: Duplex | null = null;
    upstreamReq.on('socket', (s) => {
      pendingUpstreamSocket = s as unknown as Duplex;
    });
    upstreamReq.on('upgrade', (uRes, upstreamSocket, upstreamHead) => {
      upgraded = true;
      const statusLine = `HTTP/1.1 ${uRes.statusCode ?? 101} ${uRes.statusMessage || 'Switching Protocols'}`;
      const lines = [statusLine];
      for (const [k, v] of Object.entries(uRes.headers)) {
        if (Array.isArray(v)) v.forEach((vv) => lines.push(`${k}: ${vv}`));
        else if (v !== undefined) lines.push(`${k}: ${v}`);
      }
      clientSocket.write(lines.join('\r\n') + '\r\n\r\n');
      if (upstreamHead?.length) clientSocket.write(upstreamHead);
      if (head?.length) upstreamSocket.write(head);

      upstreamSocket.pipe(clientSocket);
      clientSocket.pipe(upstreamSocket);

      const drop = () => {
        upstreamSocket.destroy();
        clientSocket.destroy();
      };
      upstreamSocket.on('error', drop);
      clientSocket.on('error', drop);
      upstreamSocket.on('close', () => clientSocket.destroy());
      clientSocket.on('close', () => upstreamSocket.destroy());
    });

    upstreamReq.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => {
      upstreamReq.destroy();
      pendingUpstreamSocket?.destroy();
    });
    // If the client goes away before the handshake completes (normal close, not
    // just an error), abort the in-flight upstream request AND force its socket
    // fully closed so the upstream connection does not leak.
    clientSocket.on('close', () => {
      if (!upgraded) {
        upstreamReq.destroy();
        pendingUpstreamSocket?.destroy();
      }
    });
    upstreamReq.end();
  });

  // ── Session + connection tracking for graceful shutdown ──
  const sessions = new Set<http2.ServerHttp2Session>();
  server.on('session', (session) => {
    sessions.add(session);
    session.on('close', () => sessions.delete(session));
    session.on('error', (err) => log(`session error: ${err.message}`));
  });
  // Track every accepted TLS connection. `Http2SecureServer` has no
  // `closeAllConnections()`, so shutdown must destroy lingering ordinary
  // HTTPS/1.1 connections (which are neither HTTP/2 sessions nor upgrades)
  // through this set, or they would keep serving after shutdown.
  const connections = new Set<Duplex>();
  server.on('secureConnection', (socket) => {
    connections.add(socket);
    socket.on('close', () => connections.delete(socket));
  });
  // A malformed HTTP/1.1 request must not leak its socket. Overriding this event
  // removes Node's default 400-and-close, so do it explicitly.
  server.on('clientError', (err, socket) => {
    log(`client error: ${err.message}`);
    const sock = socket as Duplex & { destroyed?: boolean; writable?: boolean };
    if (sock && !sock.destroyed) {
      try {
        if (sock.writable) sock.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      } catch {
        /* ignore */
      }
      sock.destroy();
    }
  });

  return new Promise((resolve, reject) => {
    const onListenError = (err: Error) => reject(err);
    server.once('error', onListenError);
    server.listen(opts.publicPort, bindHost, () => {
      server.off('error', onListenError);
      server.on('error', (err) => log(`server error: ${err.message}`));
      const port = (server.address() as AddressInfo).port;
      log(`HTTP/2 gateway listening on https://${bindHost}:${port} → ${opts.upstreamHost}:${opts.upstreamPort}`);

      resolve({
        port,
        sessionCount: () => sessions.size,
        probe: (caOverride?: string | string[]) =>
          probeHttp2({
            host: '127.0.0.1',
            port,
            servername: publicUrl.hostname,
            ca: caOverride ?? opts.tls.probeCa,
          }),
        close: (deadlineMs = 5000) =>
          closeGateway(server, sessions, upgradeSockets, connections, [normalAgent, streamAgent], deadlineMs),
      });
    });
  });
}

async function closeGateway(
  server: http2.Http2SecureServer,
  sessions: Set<http2.ServerHttp2Session>,
  upgradeSockets: Set<Duplex>,
  connections: Set<Duplex>,
  agents: http.Agent[],
  deadlineMs: number,
): Promise<void> {
  // Stop accepting new connections.
  server.close();
  // Ask every active session to close gracefully (GOAWAY).
  for (const session of sessions) {
    try {
      session.close();
    } catch {
      /* already closing */
    }
  }
  // Wait until sessions drain or the bounded deadline elapses — persistent SSE
  // streams must not block shutdown indefinitely.
  const deadline = Date.now() + deadlineMs;
  while (sessions.size > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
  // Destroy whatever remains — HTTP/2 sessions and any upgraded WebSocket
  // sockets (HMR), which are raw TCP connections outside the session set and
  // would otherwise survive shutdown.
  for (const session of sessions) {
    try {
      session.destroy();
    } catch {
      /* best-effort */
    }
  }
  // Destroy every remaining TLS connection — upgraded sockets and any lingering
  // ordinary HTTPS/1.1 request or idle keep-alive that `server.close()` alone
  // would wait on forever. `Http2SecureServer` has no `closeAllConnections()`,
  // so this explicit sweep is what actually frees the listener.
  for (const socket of upgradeSockets) {
    try {
      socket.destroy();
    } catch {
      /* best-effort */
    }
  }
  for (const socket of connections) {
    try {
      socket.destroy();
    } catch {
      /* best-effort */
    }
  }
  for (const agent of agents) agent.destroy();
}
