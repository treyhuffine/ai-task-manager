/**
 * Regression tests for the `connectOverCDP` wedge documented in
 * docs/browser-cdp-connect-wedge-findings.md.
 *
 * Hermetic: no browser, no real network. A fake CDP endpoint reproduces the
 * exact incident symptom — GET /json/version answers healthy and the DevTools
 * WebSocket completes its upgrade ("<ws connected>"), then the server never
 * sends a CDP frame, so the handshake stalls forever. Runs in the default
 * `pnpm test`.
 */
import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { connectWithTimeout } from './session';
import { respondsWithin } from './runtime';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

interface FakeCdp {
  endpoint: string;
  close: () => Promise<void>;
}

/** A CDP endpoint whose /json/version is healthy but whose DevTools WebSocket
 * upgrades and then goes silent — the wedge from the findings doc. */
function startStallingCdp(): Promise<FakeCdp> {
  return new Promise((resolve) => {
    const held: Duplex[] = [];
    const server = http.createServer((req, res) => {
      if ((req.url ?? '').replace(/\/$/, '') === '/json/version') {
        const { port } = server.address() as AddressInfo;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            Browser: 'FakeChrome/147.0.0.0',
            webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/wedge`,
          }),
        );
        return;
      }
      res.statusCode = 404;
      res.end();
    });

    // Complete the WS upgrade so the client reaches "connected", then stall.
    server.on('upgrade', (req, socket) => {
      const key = req.headers['sec-websocket-key'] ?? '';
      const accept = crypto
        .createHash('sha1')
        .update(key + WS_GUID)
        .digest('base64');
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      held.push(socket);
      // Never respond to any CDP message.
    });

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        endpoint: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((r) => {
            for (const s of held) s.destroy();
            server.close(() => r());
          }),
      });
    });
  });
}

describe('connectWithTimeout: CDP wedge recovery', () => {
  let server: FakeCdp | null = null;

  afterEach(async () => {
    await server?.close();
    server = null;
  });

  it(
    'reproduces the wedge: a stalled handshake stays pending, it does not settle on its own',
    async () => {
      server = await startStallingCdp();
      // Generous timeout stands in for Playwright's 30s default (pre-fix behavior).
      const connect = connectWithTimeout(server.endpoint, 20_000);
      connect.catch(() => {}); // it rejects when afterEach tears the socket down
      const outcome = await Promise.race([
        connect.then(() => 'settled').catch(() => 'settled'),
        new Promise<string>((r) => setTimeout(() => r('still-hanging'), 1_000)),
      ]);
      expect(outcome).toBe('still-hanging');
    },
    10_000,
  );

  it(
    'surfaces the stall fast with a bounded timeout instead of hanging',
    async () => {
      server = await startStallingCdp();
      const t0 = Date.now();
      await expect(connectWithTimeout(server.endpoint, 800)).rejects.toThrow(/Timeout/i);
      const elapsed = Date.now() - t0;
      expect(elapsed).toBeGreaterThanOrEqual(700);
      expect(elapsed).toBeLessThan(5_000);
    },
    10_000,
  );
});

describe('respondsWithin: cached-session liveness ping', () => {
  it('true when the probe resolves in time', async () => {
    await expect(respondsWithin(Promise.resolve('ok'), 1_000)).resolves.toBe(true);
  });

  it('false when the probe rejects (dead transport)', async () => {
    await expect(respondsWithin(Promise.reject(new Error('dead')), 1_000)).resolves.toBe(false);
  });

  it('false when the probe never settles (wedged transport), bounded by the deadline', async () => {
    const t0 = Date.now();
    await expect(respondsWithin(new Promise(() => {}), 300)).resolves.toBe(false);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(3_000);
  });
});
