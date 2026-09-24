import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dispatchAction } from './dispatch';

/**
 * On a connected computer, `ri agent` and the trigger commands run on the
 * home, carrying the calling session's credential, and never fall back to
 * local data (docs/homes-spec.md §5.3).
 */

const keys = ['RI_ROOT', 'RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_WORK_DIR', 'RI_SESSION_CREDENTIAL'] as const;
let saved: [string, string | undefined][];
let root: string;

let seen: { path?: string; body?: string; headers?: http.IncomingHttpHeaders } = {};
let reply: (res: http.ServerResponse) => void;
let server: http.Server;
let url: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen = { path: req.url, body, headers: req.headers };
      reply(res);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  saved = keys.map((k) => [k, process.env[k]]);
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-dispatch-'));
  process.env.RI_ROOT = root;
  for (const k of keys.slice(1)) delete process.env[k];
  fs.mkdirSync(path.join(root, '.config'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.config', 'connection.json'),
    JSON.stringify({ homeId: 'h', homeName: 'My Ri', homeUrl: url, homeHostName: 'Mac Mini', credential: 'ri_live_laptop' }),
  );
});

afterEach(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

const envelope = (body: unknown) => (res: http.ServerResponse) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

describe('dispatchAction on a connected computer', () => {
  it('runs the action on the home with this computer key and the session credential', async () => {
    reply = envelope({ ok: true, action: 'create_task', result: { id: 't1', title: 'Buy milk' } });
    process.env.RI_SESSION_CREDENTIAL = 'chat-1.signature';
    const result = await dispatchAction('create_task', { title: 'Buy milk' });
    expect(result).toEqual({ ok: true, action: 'create_task', result: { id: 't1', title: 'Buy milk' } });
    expect(seen.path).toBe('/api/orchestrator/actions/create_task');
    expect(JSON.parse(seen.body!)).toEqual({ title: 'Buy milk' });
    expect(seen.headers?.authorization).toBe('Bearer ri_live_laptop');
    expect(seen.headers?.['x-ri-session']).toBe('chat-1.signature');
    expect(fs.existsSync(path.join(root, 'data.db'))).toBe(false);
  });

  it("passes the home's refusal through unchanged", async () => {
    reply = envelope({ ok: false, action: 'create_workspace', error: { code: 'unsupported', message: 'from another computer' } });
    const result = await dispatchAction('create_workspace', { name: 'x', cwd: '/tmp' });
    expect(result.error).toEqual({ code: 'unsupported', message: 'from another computer' });
  });

  it('fails plainly when the home is unreachable, and writes nothing here', async () => {
    fs.writeFileSync(
      path.join(root, '.config', 'connection.json'),
      JSON.stringify({ homeId: 'h', homeName: 'My Ri', homeUrl: 'http://127.0.0.1:1', homeHostName: 'Mac Mini', credential: 'k' }),
    );
    const result = await dispatchAction('create_task', { title: 'x' });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('unreachable');
    expect(result.error?.message).toMatch(/Cannot reach your Ri on Mac Mini/);
    expect(fs.existsSync(path.join(root, 'data.db'))).toBe(false);
  });

  it('explains an older home that has no actions route', async () => {
    reply = (res) => {
      res.writeHead(404);
      res.end();
    };
    const result = await dispatchAction('list_tasks', {});
    expect(result.error?.message).toMatch(/older version of Ri/);
  });
});
