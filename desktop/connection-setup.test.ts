import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectionSetup, parseDesktopPairingLink, type ConnectionSetupStatus } from './connection-setup';
import { getDbPath, getConfigDir, getWorkerConfigPath, getWorkDir } from '../src/lib/config/paths';
import { readConnection, rememberDeviceId, rememberedDeviceId, writeConnection } from '../src/lib/connection/config';
import { readWorkerConfig, writeWorkerConfig } from '../src/lib/worker/config';
import { desktopHomeIntentPath, hasDesktopHomeIntent } from '../src/lib/service/desktop-role-intent';
import { acquireWorkerLock } from '../src/lib/worker/lock';
import { exclusiveDatabaseAccess } from '../src/lib/service/maintenance';
import { EventJournal, eventJournalPath } from '../src/lib/worker/event-journal';
import { CommandJournal, commandJournalPath } from '../src/lib/worker/command-journal';

vi.mock('../src/lib/home/device-name', () => ({ thisDeviceFacts: () => ({ name: 'This laptop', hostname: 'test-laptop', platform: 'darwin' }) }));
const development = { development: true };
const signIn = 'secret-sign-in-key';
const workerKey = 'secret-worker-key';
let root: string;
let origin: string;
let server: http.Server;
let handler: (url: string, body: unknown, response: http.ServerResponse) => void;
let calls: Array<{ url: string; body: unknown; authorization?: string }>;
let remoteHomeId: string;
let remoteDeviceId: string;
let otherDevices: Array<{ id: string; status: 'active' | 'revoked' }>;
const reply = (res: http.ServerResponse, body: unknown, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
function defaultHandler(url: string, body: unknown, res: http.ServerResponse) {
  if (url === '/api/home') return reply(res, { id: remoteHomeId, kind: 'personal', name: 'My Ri', host: { id: 'home-device', name: 'Mini', platform: 'darwin' } });
  if (url.startsWith('/api/devices')) return reply(res, [
    { id: remoteDeviceId, kind: 'computer', status: 'active', isHome: remoteDeviceId === 'home-device', keys: [{ role: 'sign_in', current: true }] },
    ...otherDevices.filter(device => device.id !== remoteDeviceId).map(device => ({ ...device, kind: 'computer', isHome: false, keys: [] })),
  ]);
  if (url.endsWith('/register_device')) {
    const preferred = (body as { deviceId?: string }).deviceId;
    if (preferred && otherDevices.some(device => device.id === preferred && device.status === 'active')) remoteDeviceId = preferred;
    return reply(res, { ok: true, result: { device: { id: remoteDeviceId } } });
  }
  if (url === '/api/workers/grants') return reply(res, { code: 'grant-once', device: { id: remoteDeviceId } }, 201);
  if (url === '/api/workers/enroll') return reply(res, { homeId: remoteHomeId, deviceId: remoteDeviceId, deviceName: 'This laptop', workerKey }, 201);
  return reply(res, {}, 404);
}
const connect = () => connectionSetup({ action: 'connect', pairingLink: `${origin}/#token=${signIn}` }, development);
beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString();
    const body: unknown = text ? JSON.parse(text) : null;
    calls.push({ url: req.url!, body, authorization: req.headers.authorization });
    handler(req.url!, body, res);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-desktop-setup-'));
  vi.stubEnv('RI_ROOT', root);
  for (const key of ['RI_CONFIG_DIR', 'RI_DB_PATH', 'RI_WORK_DIR']) vi.stubEnv(key, '');
  calls = []; remoteHomeId = 'home-1'; remoteDeviceId = 'laptop-device'; otherDevices = []; handler = defaultHandler;
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

describe('desktop setup trust', () => {
  it('accepts HTTPS pairing and enables loopback HTTP only for trusted development callers', () => {
    expect(parseDesktopPairingLink('https://ri.example/#token=abc')).toEqual({ homeUrl: 'https://ri.example', token: 'abc' });
    expect(() => parseDesktopPairingLink(`${origin}/#token=abc`)).toThrow(/HTTPS/);
    expect(parseDesktopPairingLink(`${origin}/#token=abc`, true).homeUrl).toBe(origin);
  });
  it.each([
    'file:///tmp/secret#token=abc', 'http://192.168.1.20/#token=abc',
    'https://user:pass@ri.example/#token=abc', 'https://ri.example/?token=abc',
    'https://ri.example/wrong#token=abc', 'https://ri.example/#token=abc&token=def',
    'https://ri.example/#token=abc&redirect=https://elsewhere', 'https://ri.example/#token=%0Aabc',
  ])('rejects unsafe or ambiguous pairing link %s before networking', (link) => {
    expect(() => parseDesktopPairingLink(link, true)).toThrow();
    expect(calls).toEqual([]);
  });
  it('does not follow a redirect carrying the sign-in credential', async () => {
    handler = (_url, _body, res) => { res.writeHead(302, { location: '/redirected' }); res.end(); };
    await expect(connect()).rejects.toThrow();
    expect(calls.map(call => call.url)).toEqual(['/api/home']);
    expect(readConnection()).toBeNull();
  });
  it('does not expose remote response bodies or persist rejected credentials', async () => {
    handler = (_url, _body, res) => reply(res, { message: signIn }, 400);
    await expect(connect()).rejects.toThrow(/HTTP 400/);
    expect(readConnection()).toBeNull();
    expect(fs.existsSync(getDbPath())).toBe(false);
  });
});

describe('installation role choice', () => {
  it('inspects an empty root without opening any database or writing any files', async () => {
    expect(await connectionSetup({ action: 'inspect' })).toMatchObject({ role: 'first-run', homeSelected: false, workerEnrolled: false });
    expect(fs.readdirSync(root)).toEqual([]);
    expect(calls).toEqual([]);
  });
  it('persists explicit Home choice as a private marker, without creating a Home', async () => {
    expect(await connectionSetup({ action: 'create-home' })).toMatchObject({ role: 'first-run', homeSelected: true });
    expect(hasDesktopHomeIntent()).toBe(true);
    expect(fs.statSync(desktopHomeIntentPath()).mode & 0o777).toBe(0o600);
    expect(fs.existsSync(getDbPath())).toBe(false);
  });
  it('refuses a public, invalid, or symlinked intent marker', () => {
    fs.mkdirSync(getConfigDir(), { recursive: true });
    fs.writeFileSync(desktopHomeIntentPath(), '{"version":1,"role":"home"}', { mode: 0o644 });
    expect(() => hasDesktopHomeIntent()).toThrow(/private file/);
    fs.chmodSync(desktopHomeIntentPath(), 0o600);
    fs.writeFileSync(desktopHomeIntentPath(), '{"version":2,"role":"home"}');
    expect(() => hasDesktopHomeIntent()).toThrow(/not supported/);
    fs.unlinkSync(desktopHomeIntentPath());
    const target = path.join(root, 'somewhere');
    fs.writeFileSync(target, '{"version":1,"role":"home"}', { mode: 0o600 });
    fs.symlinkSync(target, desktopHomeIntentPath());
    expect(() => hasDesktopHomeIntent()).toThrow(/private file/);
  });
  it('refuses to replace an existing database, even if it is empty', async () => {
    fs.writeFileSync(getDbPath(), 'preserved');
    await expect(connect()).rejects.toThrow(/already has/);
    await expect(connectionSetup({ action: 'create-home' })).rejects.toThrow(/Existing or retired/);
    expect(fs.readFileSync(getDbPath(), 'utf8')).toBe('preserved');
    expect(calls).toEqual([]);
  });
  it('a retired root can connect but cannot create a replacement Home', async () => {
    const dir = path.join(root, '.retired', 'previous'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'retired.json'), JSON.stringify({ version: 1, homeName: 'Previous Home', retiredAt: '2026-09-30', successor: 'Mini' }));
    await expect(connectionSetup({ action: 'create-home' })).rejects.toThrow(/Existing or retired/);
    expect(await connect()).toMatchObject({ role: 'viewer' });
    expect(fs.existsSync(path.join(dir, 'retired.json'))).toBe(true);
    expect(fs.existsSync(getDbPath())).toBe(false);
  });
  it('does not change roles while another setup or managed database owner holds access', async () => {
    const release = exclusiveDatabaseAccess();
    try { await expect(connect()).rejects.toThrow(/installation is busy/); }
    finally { release(); }
    expect(calls).toEqual([]);
    expect(readConnection()).toBeNull();
  });
});

describe('pairing and local execution are distinct', () => {
  it('connects a viewer, verifies identity and sign-in access, and saves no worker or task database', async () => {
    const status = await connect();
    expect(status).toMatchObject({ role: 'viewer', home: { id: 'home-1', name: 'My Ri' }, deviceId: 'laptop-device', workerEnrolled: false });
    expect(JSON.stringify(status)).not.toContain(signIn);
    expect(readConnection()).toMatchObject({ homeId: 'home-1', credential: signIn, deviceId: 'laptop-device' });
    expect(readWorkerConfig()).toBeNull();
    expect(fs.existsSync(getDbPath())).toBe(false);
    expect(calls.every(call => call.authorization === `Bearer ${signIn}`)).toBe(true);
  });
  it('enrolls the same remembered device only after separate explicit consent', async () => {
    rememberDeviceId('home-1', 'remembered-laptop');
    otherDevices = [{ id: 'remembered-laptop', status: 'active' }];
    await connect();
    expect((calls.find(call => call.url.endsWith('/register_device'))!.body as { deviceId: string }).deviceId).toBe('remembered-laptop');
    await expect(connectionSetup({ action: 'enable-worker' }, development)).rejects.toThrow(/Invalid/);
    expect(readWorkerConfig()).toBeNull();
    expect(await connectionSetup({ action: 'enable-worker', consent: true }, development)).toMatchObject({ role: 'worker', deviceId: 'remembered-laptop', workerEnrolled: true });
    const grant = calls.find(call => call.url === '/api/workers/grants');
    expect(grant?.body).toEqual({ deviceId: 'remembered-laptop' });
    expect(readWorkerConfig()).toMatchObject({ homeId: 'home-1', deviceId: 'remembered-laptop', workerKey });
    expect(fs.statSync(getWorkerConfigPath()).mode & 0o777).toBe(0o600);
    expect(readConnection()?.credential).toBe(signIn);
    expect(fs.existsSync(getDbPath())).toBe(false);
    const grantsBefore = calls.filter(call => call.url === '/api/workers/grants').length;
    await connectionSetup({ action: 'enable-worker', consent: true }, development);
    expect(calls.filter(call => call.url === '/api/workers/grants')).toHaveLength(grantsBefore);
  });
  it('preserves an existing worker instead of switching its Home', async () => {
    writeWorkerConfig({ homeId: 'old-home', deviceId: 'old-device', deviceName: 'Old laptop', workerKey: 'preserved', enrolledAt: 'then' });
    await expect(connect()).rejects.toThrow(/another Ri/);
    expect(readConnection()).toBeNull();
    expect(readWorkerConfig()?.workerKey).toBe('preserved');
  });
  it('refuses a copied Home-host key instead of marking this laptop as the Home computer', async () => {
    remoteDeviceId = 'home-device';
    await expect(connect()).rejects.toThrow(/belongs to the computer running your Ri/);
    expect(readConnection()).toBeNull();
    expect(calls.some(call => call.url.endsWith('/register_device'))).toBe(false);
  });
  it('does not duplicate or replace a remembered device when registration refuses its identity', async () => {
    rememberDeviceId('home-1', 'remembered-laptop');
    otherDevices = [{ id: 'remembered-laptop', status: 'active' }];
    handler = (url, body, res) => url.endsWith('/register_device') ? reply(res, { ok: true, result: { device: { id: 'unexpected' } } }) : defaultHandler(url, body, res);
    await expect(connect()).rejects.toThrow(/existing device identity/);
    expect(readConnection()).toBeNull();
  });
  it('refuses mismatched worker enrollment and retains its viewer connection', async () => {
    await connect();
    handler = (url, body, res) => url === '/api/workers/enroll' ? reply(res, { homeId: 'other', deviceId: 'laptop-device', workerKey }) : defaultHandler(url, body, res);
    await expect(connectionSetup({ action: 'enable-worker', consent: true }, development)).rejects.toThrow(/different device/);
    expect(readWorkerConfig()).toBeNull();
    expect(readConnection()?.homeId).toBe('home-1');
  });
  it('checks saved Home identity before every private viewer session and enrollment', async () => {
    await connect();
    expect(await connectionSetup({ action: 'session' }, development)).toEqual({ homeUrl: origin, homeId: 'home-1', homeName: 'My Ri', deviceId: 'laptop-device', signInKey: signIn });
    remoteHomeId = 'different-home';
    await expect(connectionSetup({ action: 'session' }, development)).rejects.toThrow(/different Ri/);
    await expect(connectionSetup({ action: 'enable-worker', consent: true }, development)).rejects.toThrow(/different Ri/);
    expect(readConnection()?.homeId).toBe('home-1');
    expect(readWorkerConfig()).toBeNull();
  });
  it('inspects role conflict without attempting to read or migrate the database', async () => {
    await connect(); fs.writeFileSync(getDbPath(), 'not a database');
    const result = await connectionSetup({ action: 'inspect' }) as ConnectionSetupStatus;
    expect(result.role).toBe('conflict');
    expect(result.reason).toMatch(/both a Ri database/);
    expect(fs.readFileSync(getDbPath(), 'utf8')).toBe('not a database');
  });
  it('refuses stored HTTP remote URLs without making a request', async () => {
    writeConnection({ homeId: 'home-1', homeName: 'My Ri', homeUrl: 'http://192.168.1.2', credential: signIn, homeHostName: null, connectedAt: 'then' });
    await expect(connectionSetup({ action: 'session' }, development)).rejects.toThrow(/HTTPS/);
    expect(calls).toEqual([]);
  });
});

describe('same-Home repair', () => {
  it.each(['revoked', 'missing'] as const)('replaces a %s remembered identity with the fresh pairing identity', async status => {
    rememberDeviceId('home-1', 'deleted-laptop');
    if (status === 'revoked') otherDevices = [{ id: 'deleted-laptop', status }];
    expect(await connect()).toMatchObject({ role: 'viewer', deviceId: 'laptop-device' });
    expect(rememberedDeviceId('home-1')).toBe('laptop-device');
    expect(await connectionSetup({ action: 'session' }, development)).toMatchObject({ deviceId: 'laptop-device' });
    expect(calls.find(call => call.url.endsWith('/register_device'))?.body).toMatchObject({ deviceId: 'laptop-device' });
    expect(readWorkerConfig()).toBeNull();
    expect(fs.existsSync(getDbPath())).toBe(false);
  });
  it('reconnects a deleted viewer without losing its original connection date', async () => {
    await connect();
    const connectedAt = readConnection()!.connectedAt;
    otherDevices = [{ id: remoteDeviceId, status: 'revoked' }];
    remoteDeviceId = 'replacement-laptop';
    expect(await connect()).toMatchObject({ role: 'viewer', deviceId: 'replacement-laptop' });
    expect(readConnection()).toMatchObject({ deviceId: 'replacement-laptop', connectedAt });
  });
  it('preserves deleted worker records separately before enrolling the new identity', async () => {
    await connect();
    await connectionSetup({ action: 'enable-worker', consent: true }, development);
    const enrollment = fs.readFileSync(getWorkerConfigPath(), 'utf8');
    const events = new EventJournal('home-1');
    events.append({ kind: 'chat_event', eventId: 'old-event', chatSessionId: 'old-chat', occurredAt: new Date().toISOString(), generation: null, cumulative: false, chatEvent: { role: 'assistant', source: 'agent', content: 'Saved reply' } });
    events.ack(1);
    events.append({ kind: 'chat_event', eventId: 'pending-event', chatSessionId: 'old-chat', occurredAt: new Date().toISOString(), generation: null, cumulative: false, chatEvent: { role: 'assistant', source: 'agent', content: 'Undelivered reply' } });
    const eventBytes = fs.readFileSync(eventJournalPath('home-1'), 'utf8');
    const commands = new CommandJournal('home-1');
    commands.received({ id: 'old-command', seq: 20, kind: 'send', target: { executionId: null, chatSessionId: 'old-chat', generation: null }, actor: { source: 'human' }, issuedAt: new Date().toISOString(), payload: { turnId: 'old-turn' } });
    const commandBytes = fs.readFileSync(commandJournalPath('home-1'), 'utf8');
    otherDevices = [{ id: remoteDeviceId, status: 'revoked' }];
    remoteDeviceId = 'replacement-laptop';

    expect(await connect()).toMatchObject({ role: 'viewer', deviceId: 'replacement-laptop', workerEnrolled: false });
    expect(readWorkerConfig()).toBeNull();
    expect(fs.existsSync(eventJournalPath('home-1'))).toBe(false);
    expect(fs.existsSync(commandJournalPath('home-1'))).toBe(false);
    const retainedFiles = fs.readdirSync(path.join(getWorkDir(), 'retired-workers'), { recursive: true })
      .map(file => path.join(getWorkDir(), 'retired-workers', String(file))).filter(file => fs.statSync(file).isFile());
    const retainedBytes = retainedFiles.map(file => fs.readFileSync(file, 'utf8'));
    expect(retainedBytes).toEqual(expect.arrayContaining([enrollment, eventBytes, commandBytes]));
    expect(retainedFiles.every(file => (fs.statSync(file).mode & 0o777) === 0o600)).toBe(true);
    expect(calls.filter(call => call.url === '/api/workers/enroll')).toHaveLength(1);

    expect(await connectionSetup({ action: 'enable-worker', consent: true }, development)).toMatchObject({ role: 'worker', deviceId: 'replacement-laptop' });
    expect(readWorkerConfig()?.deviceId).toBe('replacement-laptop');
    expect(new EventJournal('home-1').pending()).toEqual([]);
    expect(new EventJournal('home-1').lastPosition()).toBe(0);
    expect(new CommandJournal('home-1').cursor()).toBe(0);
    expect(new CommandJournal('home-1').get('old-command')).toBeNull();
  });
  it('leaves a deleted worker unchanged while its journal is owned by a running worker', async () => {
    await connect();
    await connectionSetup({ action: 'enable-worker', consent: true }, development);
    const connection = readConnection();
    const enrollment = fs.readFileSync(getWorkerConfigPath(), 'utf8');
    otherDevices = [{ id: remoteDeviceId, status: 'revoked' }];
    remoteDeviceId = 'replacement-laptop';
    calls = [];
    const lock = await acquireWorkerLock();
    try { await expect(connect()).rejects.toThrow(/Stop.*worker|Stop local execution/); }
    finally { lock.release(); }
    expect(readConnection()).toEqual(connection);
    expect(fs.readFileSync(getWorkerConfigPath(), 'utf8')).toBe(enrollment);
    expect(calls.some(call => call.url.endsWith('/register_device'))).toBe(false);
  });
  it('refuses an unrelated registration identity when replacing a removed device', async () => {
    rememberDeviceId('home-1', 'deleted-laptop');
    otherDevices = [{ id: 'deleted-laptop', status: 'revoked' }];
    handler = (url, body, res) => url.endsWith('/register_device') ? reply(res, { ok: true, result: { device: { id: 'unrelated' } } }) : defaultHandler(url, body, res);
    await expect(connect()).rejects.toThrow(/device identity/);
    expect(readConnection()).toBeNull();
    expect(rememberedDeviceId('home-1')).toBe('deleted-laptop');
  });
  it('preserves enrollment and journals if sign-in identity changes after replacement registration', async () => {
    await connect();
    await connectionSetup({ action: 'enable-worker', consent: true }, development);
    const connection = readConnection();
    const enrollment = fs.readFileSync(getWorkerConfigPath(), 'utf8');
    const events = new EventJournal('home-1');
    events.append({ kind: 'chat_event', eventId: 'old-event', chatSessionId: 'old-chat', occurredAt: new Date().toISOString(), generation: null, cumulative: false, chatEvent: { role: 'assistant', source: 'agent', content: 'Saved reply' } });
    const journalBytes = fs.readFileSync(eventJournalPath('home-1'), 'utf8');
    otherDevices = [{ id: remoteDeviceId, status: 'revoked' }];
    remoteDeviceId = 'replacement-laptop';
    handler = (url, body, res) => {
      defaultHandler(url, body, res);
      if (url.endsWith('/register_device')) remoteDeviceId = 'different-device';
    };
    await expect(connect()).rejects.toThrow(/device identity changed/);
    expect(readConnection()).toEqual(connection);
    expect(fs.readFileSync(getWorkerConfigPath(), 'utf8')).toBe(enrollment);
    expect(fs.readFileSync(eventJournalPath('home-1'), 'utf8')).toBe(journalBytes);
    expect(fs.existsSync(path.join(getWorkDir(), 'retired-workers'))).toBe(false);
  });
  it('renews the sign-in key without rotating worker enrollment or losing device identity', async () => {
    await connect(); await connectionSetup({ action: 'enable-worker', consent: true }, development);
    const before = fs.readFileSync(getWorkerConfigPath(), 'utf8');
    const connectedAt = readConnection()!.connectedAt;
    const lock = await acquireWorkerLock();
    let status;
    try { status = await connectionSetup({ action: 'connect', pairingLink: `${origin}/#token=replacement-sign-in` }, development); }
    finally { lock.release(); }
    expect(status).toMatchObject({ role: 'worker', deviceId: 'laptop-device' });
    expect(readConnection()).toMatchObject({ credential: 'replacement-sign-in', connectedAt });
    expect(fs.readFileSync(getWorkerConfigPath(), 'utf8')).toBe(before);
    expect(calls.filter(call => call.url === '/api/workers/enroll')).toHaveLength(1);
  });
  it('refuses to replace the saved Home identity when repairing access', async () => {
    await connect(); const before = readConnection(); remoteHomeId = 'different';
    await expect(connect()).rejects.toThrow(/different Ri/);
    expect(readConnection()).toEqual(before);
  });
  it('refuses to change the address while a foreground worker owns its journal', async () => {
    await connect(); await connectionSetup({ action: 'enable-worker', consent: true }, development);
    const saved = readConnection()!;
    writeConnection({ ...saved, homeUrl: 'https://previous.example' });
    const lock = await acquireWorkerLock();
    try { await expect(connect()).rejects.toThrow(/Stop the worker/); }
    finally { lock.release(); }
    expect(readConnection()?.homeUrl).toBe('https://previous.example');
    await connect();
    expect(readConnection()?.homeUrl).toBe(origin);
    expect(readWorkerConfig()?.workerKey).toBe(workerKey);
  });
});

it('does not attach a legacy device-less sign-in to another enrolled device', async () => {
  await connect();
  writeConnection({ ...readConnection()!, deviceId: null });
  writeWorkerConfig({ homeId: 'home-1', deviceId: 'another-laptop', deviceName: 'Another laptop', workerKey, enrolledAt: 'then' });
  await expect(connectionSetup({ action: 'session' }, development)).rejects.toThrow(/different device/);
  await expect(connectionSetup({ action: 'enable-worker', consent: true }, development)).rejects.toThrow(/different worker enrollment/);
  expect(readWorkerConfig()?.deviceId).toBe('another-laptop');
});


it('returns the verified device for a legacy viewer without changing its saved connection', async () => {
  await connect();
  writeConnection({ ...readConnection()!, deviceId: null });
  const before = readConnection();
  expect(await connectionSetup({ action: 'session' }, development)).toMatchObject({ deviceId: 'laptop-device', homeId: 'home-1' });
  expect(readConnection()).toEqual(before);
});


it.each(['phone', 'other'])('refuses a %s sign-in before it can reclassify an existing device', async kind => {
  handler = (url, body, res) => url.startsWith('/api/devices')
    ? reply(res, [{ id: 'existing-device', kind, status: 'active', isHome: false, keys: [{ role: 'sign_in', current: true }] }])
    : defaultHandler(url, body, res);
  await expect(connect()).rejects.toThrow(/separate computer pairing link/);
  expect(calls.map(call => call.url.split('?')[0])).toEqual(['/api/home', '/api/devices']);
  expect(readConnection()).toBeNull();
  expect(readWorkerConfig()).toBeNull();
});


it('refuses reconnect and session setup for a future connection format without touching its bytes or Home', async () => {
  await connect();
  const file = path.join(getConfigDir(), 'connection.json');
  const bytes = JSON.stringify({ ...readConnection()!, version: 2, future: { identity: 'preserve' } }, null, 2);
  fs.writeFileSync(file, bytes);
  calls = [];
  await expect(connect()).rejects.toThrow(/connection format/);
  await expect(connectionSetup({ action: 'session' }, development)).rejects.toThrow(/connection format/);
  expect(calls).toEqual([]);
  expect(fs.readFileSync(file, 'utf8')).toBe(bytes);
  expect(fs.existsSync(getDbPath())).toBe(false);
});
