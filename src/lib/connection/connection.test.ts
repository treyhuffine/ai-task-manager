import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConnectionConfigError, normalizeHomeUrl, readConnection, removeConnection, writeConnection } from './config';
import { checkHome, homeFetch, HomeRequestError, type HomeProblem } from './home-client';

const saved = process.env.RI_CONFIG_DIR;
let configDir: string;

beforeEach(() => {
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-connection-'));
  process.env.RI_CONFIG_DIR = configDir;
});

afterEach(() => {
  if (saved === undefined) delete process.env.RI_CONFIG_DIR;
  else process.env.RI_CONFIG_DIR = saved;
  fs.rmSync(configDir, { recursive: true, force: true });
});

describe('connection record', () => {
  const base = {
    homeId: 'home-1',
    homeName: 'My Ri',
    homeUrl: 'ri-trey.beamd.run/',
    homeHostName: 'Mac Mini',
    credential: 'ri_live_secret',
    connectedAt: '2026-09-24T00:00:00.000Z',
  };

  it('round-trips, privately, with a normalized address', () => {
    writeConnection(base);
    const file = path.join(configDir, 'connection.json');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(readConnection()).toMatchObject({ ...base, homeUrl: 'https://ri-trey.beamd.run', version: 1 });
    expect(removeConnection()).toBe(true);
    expect(readConnection()).toBeNull();
  });

  it('rejects a record missing what a reconnect needs', () => {
    fs.writeFileSync(path.join(configDir, 'connection.json'), JSON.stringify({ homeUrl: 'https://x' }));
    expect(() => readConnection()).toThrow(ConnectionConfigError);
  });

  it('keeps http for a local address and drops paths', () => {
    expect(normalizeHomeUrl('http://127.0.0.1:42251/some/path')).toBe('http://127.0.0.1:42251');
    expect(normalizeHomeUrl('https://ri.example.com')).toBe('https://ri.example.com');
  });
});

/** A stand-in home: answers like the real routes, per test. */
let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;
let server: http.Server;
let url: string;

beforeAll(async () => {
  server = http.createServer((req, res) => handler(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const connection = () => ({
  version: 1,
  homeId: 'home-1',
  homeName: 'My Ri',
  homeUrl: url,
  homeHostName: 'Mac Mini',
  credential: 'ri_live_good',
  connectedAt: 'x',
});

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function problemOf(p: Promise<unknown>): Promise<HomeProblem> {
  try {
    await p;
  } catch (err) {
    if (err instanceof HomeRequestError) return err.problem;
    throw err;
  }
  throw new Error('expected a HomeRequestError');
}

describe('homeFetch and checkHome', () => {
  it('sends the credential and confirms the home by id', async () => {
    let auth: string | undefined;
    handler = (req, res) => {
      auth = req.headers.authorization;
      json(res, 200, { id: 'home-1', kind: 'personal', name: 'My Ri', host: { id: 'c', name: 'Mac Mini', platform: 'darwin' } });
    };
    const home = await checkHome(connection());
    expect(home.host.name).toBe('Mac Mini');
    expect(auth).toBe('Bearer ri_live_good');
  });

  it('names each failure the way the spec asks', async () => {
    handler = (_req, res) => json(res, 401, { error: 'unauthorized' });
    expect(await problemOf(checkHome(connection()))).toBe('unauthorized');

    handler = (_req, res) => json(res, 503, { error: 'home_not_active' });
    expect(await problemOf(checkHome(connection()))).toBe('not_active');

    handler = (_req, res) => json(res, 200, { id: 'someone-else', name: 'Other', host: { name: 'x' } });
    expect(await problemOf(checkHome(connection()))).toBe('wrong_home');

    handler = (_req, res) => json(res, 404, {});
    const older = await checkHome(connection()).catch((e) => e as HomeRequestError);
    expect(older.message).toMatch(/older version of Ri/);
  });

  it('reports an unreachable home without a local fallback', async () => {
    const closed = { ...connection(), homeUrl: 'http://127.0.0.1:1' };
    const err = await homeFetch(closed, '/api/home').catch((e) => e as HomeRequestError);
    expect(err.problem).toBe('unreachable');
    expect(err.message).toBe('Cannot reach your Ri on Mac Mini. Check that it is awake and online, then try again.');
  });

  it('times out a home that accepts but never answers', async () => {
    handler = () => {
      /* never respond */
    };
    const err = await homeFetch(connection(), '/api/home', { timeoutMs: 100 }).catch((e) => e as HomeRequestError);
    expect(err.problem).toBe('unreachable');
  });
});
