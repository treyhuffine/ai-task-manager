import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readConnection } from './config';
import { assertSecureAddress, ConnectError, connectToHome, parsePairingLink } from './connect';

describe('parsePairingLink', () => {
  it('reads the address and key from the link a pairing QR opens', () => {
    expect(parsePairingLink('https://ri-trey.beamd.run/#token=ri_live_abc')).toEqual({
      homeUrl: 'https://ri-trey.beamd.run',
      token: 'ri_live_abc',
    });
    expect(parsePairingLink('  http://127.0.0.1:42251/#token=k  ')).toEqual({ homeUrl: 'http://127.0.0.1:42251', token: 'k' });
  });

  it('explains a link without a key, or text that is not a link', () => {
    expect(() => parsePairingLink('https://ri-trey.beamd.run/')).toThrow(/no pairing key/);
    expect(() => parsePairingLink('ri_live_abc')).toThrow(/isn't a link/);
  });
});

describe('assertSecureAddress', () => {
  it('accepts HTTPS anywhere and HTTP only on this computer', () => {
    expect(() => assertSecureAddress('https://ri.example.com')).not.toThrow();
    expect(() => assertSecureAddress('http://127.0.0.1:4224')).not.toThrow();
    expect(() => assertSecureAddress('http://localhost:4224')).not.toThrow();
    expect(() => assertSecureAddress('http://192.168.1.20:4224')).toThrow(ConnectError);
    expect(() => assertSecureAddress('http://192.168.1.20:4224', { allowInsecureHttp: true })).not.toThrow();
  });
});

describe('connectToHome', () => {
  let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;
  let server: http.Server;
  let url: string;
  let configDir: string;
  const saved = process.env.RI_CONFIG_DIR;

  beforeAll(async () => {
    server = http.createServer((req, res) => handler(req, res));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });
  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-connect-'));
    process.env.RI_CONFIG_DIR = configDir;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.RI_CONFIG_DIR;
    else process.env.RI_CONFIG_DIR = saved;
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  const reply = (status: number, body: unknown) => (_req: http.IncomingMessage, res: http.ServerResponse) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  it("saves the home's id, name and computer once the home accepts the key", async () => {
    let auth: string | undefined;
    handler = (req, res) => {
      auth = req.headers.authorization;
      reply(200, { id: 'home-1', kind: 'personal', name: 'My Ri', host: { id: 'c', name: 'Mac Mini', platform: 'darwin' } })(req, res);
    };
    const { home } = await connectToHome({ homeUrl: url, token: 'ri_live_k' });
    expect(auth).toBe('Bearer ri_live_k');
    expect(home.name).toBe('My Ri');
    expect(readConnection()).toMatchObject({ homeId: 'home-1', homeName: 'My Ri', homeHostName: 'Mac Mini', homeUrl: url, credential: 'ri_live_k' });
  });

  it('saves nothing when the key is refused, the home is too old, or it is not a home', async () => {
    handler = reply(401, { error: 'unauthorized' });
    await expect(connectToHome({ homeUrl: url, token: 'bad' })).rejects.toThrow(/didn't accept that pairing key/);
    handler = reply(404, {});
    await expect(connectToHome({ homeUrl: url, token: 'k' })).rejects.toThrow(/older version of Ri/);
    handler = reply(200, { hello: 'world' });
    await expect(connectToHome({ homeUrl: url, token: 'k' })).rejects.toThrow(/didn't answer like a Ri home/);
    expect(readConnection()).toBeNull();
  });

  it('refuses a plain HTTP address that is not this computer before sending the key', async () => {
    let called = false;
    handler = (req, res) => {
      called = true;
      reply(200, {})(req, res);
    };
    await expect(connectToHome({ homeUrl: 'http://10.0.0.5:4224', token: 'k' })).rejects.toThrow(/isn't HTTPS/);
    expect(called).toBe(false);
  });
});
