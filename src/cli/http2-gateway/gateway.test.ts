import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import http2 from 'node:http2';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import getPort from 'get-port';
import { startHttp2Gateway, type Http2GatewayHandle } from './index';
import type { TlsMaterial } from '@/lib/config/tls';

/** A fixture HTTP/1.1 upstream standing in for the Next server. */
function createUpstream(): Promise<{
  server: http.Server;
  port: number;
  sawSlowSseClose: () => boolean;
  sawSlowUpgradeClose: () => boolean;
}> {
  let slowSseClosed = false;
  let slowUpgradeClosed = false;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    switch (url.pathname) {
      case '/api/health':
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, app: 'flow', port: 0 }));
        return;
      case '/sse': {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-store',
          connection: 'keep-alive', // must be stripped before HTTP/2
        });
        let n = 0;
        const timer = setInterval(() => {
          n += 1;
          res.write(`event: tick\ndata: ${n}\n\n`);
          if (n >= 3) {
            clearInterval(timer);
            res.end();
          }
        }, 20);
        return;
      }
      case '/slow-sse': {
        res.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive' });
        res.write('event: open\ndata: hi\n\n');
        const keep = setInterval(() => res.write(': keepalive\n\n'), 25);
        req.on('close', () => {
          slowSseClosed = true;
          clearInterval(keep);
        });
        return;
      }
      case '/echo-upload': {
        let bytes = 0;
        req.on('data', (c) => (bytes += c.length));
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'text/plain' });
          res.end(String(bytes));
        });
        return;
      }
      case '/headers-test':
        res.writeHead(200, {
          'content-type': 'text/plain',
          connection: 'keep-alive',
          'set-cookie': ['a=1; Path=/', 'b=2; Path=/'],
          location: `http://127.0.0.1:${(server.address() as AddressInfo).port}/next?q=1#f`,
        });
        res.end('ok');
        return;
      default:
        res.writeHead(404);
        res.end('not found');
    }
  });

  server.on('upgrade', (req, socket, head) => {
    if (req.url === '/slow-upgrade') {
      // Delay the 101 so a client can cancel mid-handshake; record if the
      // upstream connection is torn down (i.e. the gateway aborted the in-flight
      // request). Fully close on the gateway's FIN, like a normal server would.
      const t = setTimeout(() => {
        socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
      }, 500);
      socket.on('end', () => socket.destroy());
      socket.on('close', () => {
        slowUpgradeClosed = true;
        clearTimeout(t);
      });
      socket.on('error', () => {});
      return;
    }
    if (req.url === '/reject-upgrade') {
      // Decline the upgrade with a normal (chunked) HTTP response instead of 101,
      // to exercise the gateway's re-framing of a decoded chunked body.
      socket.write(
        'HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\n' +
          'Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n' +
          '6\r\ndenied\r\n0\r\n\r\n',
      );
      socket.end();
      return;
    }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\nConnection: Upgrade\r\n\r\n',
    );
    if (head?.length) socket.write(head);
    socket.on('data', (chunk) => socket.write(chunk)); // echo
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        port: (server.address() as AddressInfo).port,
        sawSlowSseClose: () => slowSseClosed,
        sawSlowUpgradeClose: () => slowUpgradeClosed,
      });
    });
  });
}

let tlsDir: string;
let tls: TlsMaterial;
let upstream: Awaited<ReturnType<typeof createUpstream>>;
let gateway: Http2GatewayHandle;
let publicPort: number;
let baseUrl: string;

function h2get(pathName: string, headers: Record<string, string> = {}): Promise<{
  status: number;
  headers: http2.IncomingHttpHeaders;
  body: string;
  protocol: string | null;
}> {
  return new Promise((resolve, reject) => {
    const client = http2.connect(`https://127.0.0.1:${publicPort}`, {
      ca: tls.probeCa,
      servername: 'localhost',
      ALPNProtocols: ['h2'],
    });
    client.on('error', reject);
    client.on('connect', (session) => {
      const protocol = (session.socket as { alpnProtocol?: string | false }).alpnProtocol || null;
      const req = client.request({ ':path': pathName, ':method': 'GET', ...headers });
      let status = 0;
      let respHeaders: http2.IncomingHttpHeaders = {};
      let body = '';
      req.on('response', (h) => {
        status = Number(h[':status']);
        respHeaders = h;
      });
      req.setEncoding('utf8');
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        client.close();
        resolve({ status, headers: respHeaders, body, protocol });
      });
      req.on('error', reject);
      req.end();
    });
  });
}

beforeAll(async () => {
  tlsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-gw-'));
  process.env.FLOW_CONFIG_DIR = path.join(tlsDir, '.config');
  const tlsMod = await import('@/lib/config/tls');
  tls = await tlsMod.ensureGeneratedTls();

  upstream = await createUpstream();
  publicPort = await getPort();
  baseUrl = `https://localhost:${publicPort}`;
  gateway = await startHttp2Gateway({
    publicPort,
    publicBaseUrl: baseUrl,
    upstreamHost: '127.0.0.1',
    upstreamPort: upstream.port,
    tls,
  });
}, 30_000);

afterAll(async () => {
  await gateway?.close(1000);
  upstream?.server.close();
  if (tlsDir) fs.rmSync(tlsDir, { recursive: true, force: true });
});

describe('http2 gateway', () => {
  it('negotiates h2 and proxies a normal request', async () => {
    const res = await h2get('/api/health');
    expect(res.protocol).toBe('h2');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
  });

  it('readiness probe confirms real h2 negotiation + health', async () => {
    const probe = await gateway.probe();
    expect(probe.ok).toBe(true);
    expect(probe.negotiatedProtocol).toBe('h2');
    expect(probe.status).toBe(200);
  });

  it('streams SSE over h2 in order with the hop-by-hop header stripped', async () => {
    const res = await h2get('/sse', { accept: 'text/event-stream' });
    expect(res.status).toBe(200);
    expect(res.headers['connection']).toBeUndefined();
    expect(res.headers['content-type']).toContain('text/event-stream');
    const ticks = [...res.body.matchAll(/data: (\d+)/g)].map((m) => m[1]);
    expect(ticks).toEqual(['1', '2', '3']);
  });

  it('strips hop-by-hop, preserves multiple Set-Cookie, rewrites private Location', async () => {
    const res = await h2get('/headers-test');
    expect(res.headers['connection']).toBeUndefined();
    expect(res.headers['transfer-encoding']).toBeUndefined();
    expect(res.headers['set-cookie']).toEqual(['a=1; Path=/', 'b=2; Path=/']);
    expect(res.headers['location']).toBe(`${baseUrl}/next?q=1#f`);
  });

  it('streams a large upload with backpressure', async () => {
    const size = 5 * 1024 * 1024; // 5 MiB
    const body = Buffer.alloc(size, 0x61);
    const received = await new Promise<string>((resolve, reject) => {
      const client = http2.connect(`https://127.0.0.1:${publicPort}`, {
        ca: tls.probeCa,
        servername: 'localhost',
        ALPNProtocols: ['h2'],
      });
      client.on('error', reject);
      const req = client.request({ ':path': '/echo-upload', ':method': 'POST' });
      let out = '';
      req.setEncoding('utf8');
      req.on('data', (c) => (out += c));
      req.on('end', () => {
        client.close();
        resolve(out);
      });
      req.on('error', reject);
      req.end(body);
    });
    expect(Number(received)).toBe(size);
  });

  it('lets a normal request complete while 12 SSE streams stay open (pressure gate)', async () => {
    const client = http2.connect(`https://127.0.0.1:${publicPort}`, {
      ca: tls.probeCa,
      servername: 'localhost',
      ALPNProtocols: ['h2'],
    });
    await new Promise((r) => client.on('connect', r));
    const streams: http2.ClientHttp2Stream[] = [];
    for (let i = 0; i < 12; i += 1) {
      const s = client.request({ ':path': '/slow-sse', accept: 'text/event-stream' });
      s.on('data', () => {});
      s.on('error', () => {});
      streams.push(s);
    }

    const status = await new Promise<number>((resolve, reject) => {
      const req = client.request({ ':path': '/api/health', ':method': 'GET' });
      const timer = setTimeout(() => reject(new Error('normal request stalled behind SSE')), 5000);
      req.on('response', (h) => {
        clearTimeout(timer);
        resolve(Number(h[':status']));
      });
      req.on('error', reject);
      req.resume();
      req.end();
    });
    expect(status).toBe(200);

    for (const s of streams) s.close();
    client.close();
  });

  it('cancels only the disconnected stream upstream', async () => {
    const client = http2.connect(`https://127.0.0.1:${publicPort}`, {
      ca: tls.probeCa,
      servername: 'localhost',
      ALPNProtocols: ['h2'],
    });
    await new Promise((r) => client.on('connect', r));
    const s = client.request({ ':path': '/slow-sse', accept: 'text/event-stream' });
    s.on('data', () => {});
    s.on('error', () => {});
    await new Promise((r) => setTimeout(r, 80)); // let upstream establish
    s.close(http2.constants.NGHTTP2_CANCEL);

    await new Promise((r) => setTimeout(r, 200));
    expect(upstream.sawSlowSseClose()).toBe(true);

    // The session is still usable for other requests.
    const health = await new Promise<number>((resolve, reject) => {
      const req = client.request({ ':path': '/api/health', ':method': 'GET' });
      req.on('response', (h) => resolve(Number(h[':status'])));
      req.on('error', reject);
      req.resume();
      req.end();
    });
    expect(health).toBe(200);
    client.close();
  });

  it('serves an HTTPS/1.1 client through the same listener', async () => {
    const result = await new Promise<{ status: number; protocol: string | null }>(
      (resolve, reject) => {
        const req = https.request(
          {
            host: '127.0.0.1',
            port: publicPort,
            path: '/api/health',
            method: 'GET',
            ca: tls.probeCa,
            servername: 'localhost',
            ALPNProtocols: ['http/1.1'],
          } as https.RequestOptions,
          (res) => {
            const protocol = (res.socket as { alpnProtocol?: string | false }).alpnProtocol || null;
            res.resume();
            res.on('end', () => resolve({ status: res.statusCode ?? 0, protocol }));
          },
        );
        req.on('error', reject);
        req.end();
      },
    );
    expect(result.status).toBe(200);
    expect(result.protocol).toBe('http/1.1');
  });

  it('forwards an HTTP/1.1 Upgrade (HMR-style WebSocket) end to end', async () => {
    const echoed = await new Promise<string>((resolve, reject) => {
      const req = https.request({
        host: '127.0.0.1',
        port: publicPort,
        path: '/hmr',
        method: 'GET',
        ca: tls.probeCa,
        servername: 'localhost',
        ALPNProtocols: ['http/1.1'],
        headers: { Connection: 'Upgrade', Upgrade: 'websocket' },
      } as https.RequestOptions);
      req.on('upgrade', (_res, socket) => {
        socket.on('data', (chunk) => {
          resolve(chunk.toString());
          socket.destroy();
        });
        socket.write('ping');
      });
      req.on('error', reject);
      req.end();
    });
    expect(echoed).toBe('ping');
  });

  it('relays a rejected (chunked) upgrade with correct framing instead of hanging', async () => {
    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('rejected upgrade hung')), 3000);
      const req = https.request(
        {
          host: '127.0.0.1',
          port: publicPort,
          path: '/reject-upgrade',
          method: 'GET',
          ca: tls.probeCa,
          servername: 'localhost',
          ALPNProtocols: ['http/1.1'],
          headers: { Connection: 'Upgrade', Upgrade: 'websocket' },
        } as https.RequestOptions,
        (res) => {
          clearTimeout(timer);
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        },
      );
      req.on('upgrade', () => reject(new Error('unexpected upgrade')));
      req.on('error', reject);
      req.end();
    });
    expect(result.status).toBe(403);
    // The client parsed the body cleanly — no leftover chunk framing.
    expect(result.body).toBe('denied');
  });

  it('aborts the upstream when the client cancels an upgrade before the handshake', async () => {
    const req = https.request({
      host: '127.0.0.1',
      port: publicPort,
      path: '/slow-upgrade',
      method: 'GET',
      ca: tls.probeCa,
      servername: 'localhost',
      ALPNProtocols: ['http/1.1'],
      headers: { Connection: 'Upgrade', Upgrade: 'websocket' },
    } as https.RequestOptions);
    req.on('upgrade', () => {});
    req.on('error', () => {});
    req.end();
    await new Promise((r) => setTimeout(r, 120)); // let the gateway open the upstream
    req.destroy(); // cancel before the upstream's delayed 101

    // The gateway must abort the in-flight upstream request, closing the fixture socket.
    const deadline = Date.now() + 2000;
    while (!upstream.sawSlowUpgradeClose() && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(upstream.sawSlowUpgradeClose()).toBe(true);
  });

  it('destroys an idle keep-alive HTTPS/1.1 connection on gateway shutdown', async () => {
    const p5 = await getPort();
    const gw = await startHttp2Gateway({
      publicPort: p5,
      publicBaseUrl: `https://localhost:${p5}`,
      upstreamHost: '127.0.0.1',
      upstreamPort: upstream.port,
      tls,
    });
    const agent = new https.Agent({ keepAlive: true });
    const closed = await new Promise<boolean>((resolve, reject) => {
      const req = https.request(
        {
          host: '127.0.0.1',
          port: p5,
          path: '/api/health', // completes; the socket then sits idle keep-alive
          method: 'GET',
          ca: tls.probeCa,
          servername: 'localhost',
          ALPNProtocols: ['http/1.1'],
          agent,
        } as https.RequestOptions,
        (res) => {
          const sock = res.socket;
          res.resume();
          res.on('end', () => {
            // No active proxying now — only the shutdown connection sweep can close this.
            sock.on('close', () => resolve(true));
            gw.close(500).catch(reject);
          });
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(closed).toBe(true);
    agent.destroy();
  });

  it('tears down ordinary HTTPS/1.1 connections on gateway shutdown', async () => {
    const p4 = await getPort();
    const gw = await startHttp2Gateway({
      publicPort: p4,
      publicBaseUrl: `https://localhost:${p4}`,
      upstreamHost: '127.0.0.1',
      upstreamPort: upstream.port,
      tls,
    });
    const closed = await new Promise<boolean>((resolve, reject) => {
      const req = https.request(
        {
          host: '127.0.0.1',
          port: p4,
          path: '/slow-sse', // long-lived HTTPS/1.1 stream, neither h2 nor upgrade
          method: 'GET',
          ca: tls.probeCa,
          servername: 'localhost',
          ALPNProtocols: ['http/1.1'],
          headers: { accept: 'text/event-stream' },
        } as https.RequestOptions,
        (res) => {
          res.on('data', () => {});
          res.on('error', () => {}); // ignore reset on teardown
          res.on('close', () => resolve(true));
          setTimeout(() => gw.close(500).catch(reject), 100);
        },
      );
      req.on('error', () => {}); // socket reset on shutdown is expected
      req.end();
    });
    expect(closed).toBe(true);
  });

  it('tears down upgraded WebSocket sockets on gateway shutdown', async () => {
    const p2 = await getPort();
    const gw = await startHttp2Gateway({
      publicPort: p2,
      publicBaseUrl: `https://localhost:${p2}`,
      upstreamHost: '127.0.0.1',
      upstreamPort: upstream.port,
      tls,
    });
    const closed = await new Promise<boolean>((resolve, reject) => {
      const req = https.request({
        host: '127.0.0.1',
        port: p2,
        path: '/ws',
        method: 'GET',
        ca: tls.probeCa,
        servername: 'localhost',
        ALPNProtocols: ['http/1.1'],
        headers: { Connection: 'Upgrade', Upgrade: 'websocket' },
      } as https.RequestOptions);
      req.on('upgrade', (_res, socket) => {
        socket.on('error', () => {}); // ignore reset on teardown
        socket.on('close', () => resolve(true));
        gw.close(500).catch(reject); // shutdown must destroy this upgraded socket
      });
      req.on('error', reject);
      req.end();
    });
    expect(closed).toBe(true);
  });

  it('validates a supplied CA-signed cert chain via the probe CA list', async () => {
    const tlsMod = await import('@/lib/config/tls');
    // The generated leaf is CA-signed; simulate a supplied full-chain bundle.
    const bundlePath = path.join(tlsDir, 'supplied.crt');
    const keyPathS = path.join(tlsDir, 'supplied.key');
    fs.writeFileSync(bundlePath, `${tls.cert}\n${tls.probeCa}`); // leaf + issuing CA
    fs.writeFileSync(keyPathS, tls.key);
    const supplied = await tlsMod.loadSuppliedTls(bundlePath, keyPathS);
    expect(supplied.source).toBe('supplied');

    const p3 = await getPort();
    const gw = await startHttp2Gateway({
      publicPort: p3,
      publicBaseUrl: `https://localhost:${p3}`,
      upstreamHost: '127.0.0.1',
      upstreamPort: upstream.port,
      tls: supplied,
    });
    // Trusting the supplied bundle (leaf + CA) validates the chain and negotiates h2.
    const okProbe = await gw.probe(supplied.probeCa);
    expect(okProbe.ok).toBe(true);
    expect(okProbe.negotiatedProtocol).toBe('h2');
    // A bare leaf without its issuer cannot be validated — this is exactly why
    // startup appends the system roots and treats a supplied-cert probe failure
    // as non-fatal rather than aborting.
    const badProbe = await gw.probe(tls.cert);
    expect(badProbe.ok).toBe(false);
    await gw.close(500);
  });
});
