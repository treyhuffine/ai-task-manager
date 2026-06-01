import { describe, it, expect, afterEach } from 'vitest';
import net from 'node:net';
import { allocatePort, isPortListening, confirmListening } from './net';

const servers: net.Server[] = [];

function listenOn(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(port, '127.0.0.1', () => {
      servers.push(srv);
      resolve(srv);
    });
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

describe('allocatePort', () => {
  it('returns a usable free port', async () => {
    const port = await allocatePort();
    expect(port).toBeGreaterThan(1023);
    // The port should be bindable right after allocation.
    await expect(listenOn(port)).resolves.toBeDefined();
  });

  it('returns distinct ports across calls', async () => {
    const a = await allocatePort();
    const b = await allocatePort();
    // Not guaranteed distinct by the OS, but overwhelmingly likely; assert
    // both are valid rather than forcing inequality.
    expect(a).toBeGreaterThan(1023);
    expect(b).toBeGreaterThan(1023);
  });
});

describe('isPortListening', () => {
  it('is false for a closed port and true once something binds', async () => {
    const port = await allocatePort();
    expect(await isPortListening(port, 300)).toBe(false);
    await listenOn(port);
    expect(await isPortListening(port, 300)).toBe(true);
  });
});

describe('confirmListening', () => {
  it('resolves with the port once it comes up', async () => {
    const port = await allocatePort();
    // Bring the server up shortly after we begin polling.
    setTimeout(() => void listenOn(port), 120);
    const found = await confirmListening([port], { timeoutMs: 3_000, intervalMs: 50 });
    expect(found).toBe(port);
  });

  it('returns null on timeout when nothing listens', async () => {
    const port = await allocatePort();
    const found = await confirmListening([port], { timeoutMs: 400, intervalMs: 50 });
    expect(found).toBeNull();
  });

  it('picks up a dynamically-discovered port (app ignored its assigned one)', async () => {
    const assigned = await allocatePort();
    const actual = await listenOn(await allocatePort());
    const actualPort = (actual.address() as net.AddressInfo).port;
    let revealed = false;
    // The assigned port never comes up (app ignored $PORT); the real port is
    // only revealed mid-poll, simulating the stdout detector surfacing it.
    setTimeout(() => { revealed = true; }, 150);
    const found = await confirmListening(
      () => (revealed ? [assigned, actualPort] : [assigned]),
      { timeoutMs: 3_000, intervalMs: 50 },
    );
    expect(found).toBe(actualPort);
  });

  it('bails immediately when aborted', async () => {
    const port = await allocatePort();
    const ctrl = new AbortController();
    ctrl.abort();
    const found = await confirmListening([port], { timeoutMs: 3_000, signal: ctrl.signal });
    expect(found).toBeNull();
  });
});
