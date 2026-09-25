/** Real Electron + real Next app. No certificate-bypass flag or mock frontend. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import https from 'node:https';
import net from 'node:net';
import { once } from 'node:events';
import electron from 'electron';
import { _electron, type ElectronApplication } from 'playwright-core';
import { generateCaPair, generateLeafPair } from '../src/lib/config/tls-x509';
import { bundledCliCommand, demoEnvironment } from './config';
import { mockMcp } from './mock-mcp';
import { installTerminalCommand, removeTerminalCommand } from './cli-install';
import { isProcessAlive, readServerRuntime } from '../src/lib/server-runtime/record';

const repo = path.resolve(__dirname, '..');
const artifacts = path.join(repo, '.electron-demo');
fs.mkdirSync(artifacts, { recursive: true });
const root = fs.mkdtempSync(path.join(artifacts, 'smoke-'));
const packageSource = process.env.RI_DESKTOP_PACKAGE;
let packaged: string | undefined;
if (packageSource) {
  packaged = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-relocated-')), 'Ri.app');
  fs.cpSync(path.resolve(packageSource), packaged, { recursive: true, verbatimSymlinks: true });
}
const mode = packaged || process.env.RI_DESKTOP_MODE === 'production' ? 'production' : 'development';
const env = demoEnvironment(repo, { ...process.env, RI_DESKTOP_ROOT: root }, mode);
for (const key of ['RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_WORK_DIR']) delete process.env[key];
Object.assign(process.env, env);
const launch = () => _electron.launch({ executablePath: packaged ? path.join(packaged, 'Contents/MacOS/Ri') : electron as unknown as string, args: packaged ? [] : [path.join(repo, 'dist/desktop/main.cjs')], cwd: packaged ? os.tmpdir() : repo,
  env: { ...env, ...(packaged ? { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' } : { RI_DESKTOP_NODE: process.execPath }), RI_DESKTOP_SMOKE: '1' }, timeout: 240_000 });
let app: ElectronApplication | undefined;
let rogue: https.Server | undefined;
let oauthFixture: Awaited<ReturnType<typeof mockMcp>> | undefined;
const protocols = new Set<string>();

function portIsClosed(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(false); });
    socket.once('error', (error: NodeJS.ErrnoException) => resolve(error.code === 'ECONNREFUSED'));
    socket.setTimeout(2000, () => { socket.destroy(); resolve(false); });
  });
}

async function ready(instance: ElectronApplication) {
  instance.process().stdout?.on('data', (chunk) => process.stdout.write(chunk));
  instance.process().stderr?.on('data', (chunk) => process.stderr.write(chunk));
  const page = await instance.firstWindow();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  cdp.on('Network.responseReceived', ({ response }) => {
    if (response.protocol && response.url.startsWith('https://localhost:') && response.url.includes('/api/')) protocols.add(response.protocol);
  });
  await page.waitForURL((url) => url.protocol === 'https:' && url.pathname === '/welcome', { timeout: 240_000 });
  await page.getByText('Welcome to Ri', { exact: true }).waitFor({ timeout: 60_000 });
  return page;
}

async function main() {
try {
  app = await launch();
  const page = await ready(app);
  const origin = new URL(page.url()).origin;
  assert.equal(await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require), 'undefined');
  assert.equal(await page.evaluate(() => window.isSecureContext), true);
  const auth = await page.evaluate(async () => (await fetch('/api/user-state')).status);
  assert.equal(auth, 200);
  const cookie = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const cookies = await win.webContents.session.cookies.get({ url: win.webContents.getURL() });
    const cookie = cookies.find((c) => c.name.endsWith('_session'));
    return { secure: cookie?.secure, httpOnly: cookie?.httpOnly };
  });
  assert.deepEqual(cookie, { secure: true, httpOnly: true });

  // Eight persistent streams exceed the usual HTTP/1.1 per-origin pool.
  const streams = await page.evaluate(async () => {
    const sources: EventSource[] = [];
    try {
      await Promise.all(Array.from({ length: 8 }, (_, i) => new Promise<void>((resolve, reject) => {
        const source = new EventSource(`/api/sessions/stream?desktop-smoke=${i}`);
        sources.push(source);
        const timer = setTimeout(() => reject(new Error('SSE ready timed out')), 60_000);
        source.addEventListener('ready', () => { clearTimeout(timer); resolve(); }, { once: true });
        source.onerror = () => { clearTimeout(timer); reject(new Error('SSE connection failed')); };
      })));
      const before = performance.now();
      const response = await fetch('/api/health?desktop-smoke=streams', { signal: AbortSignal.timeout(5000) });
      return { status: response.status, open: sources.filter((s) => s.readyState === EventSource.OPEN).length, requestMs: Math.round(performance.now() - before) };
    } finally { sources.forEach((s) => s.close()); }
  });
  assert.equal(streams.open, 8);
  assert.equal(streams.status, 200);
  assert(protocols.has('h2'), `Expected h2 in Chromium, saw ${[...protocols]}`);
  assert(!protocols.has('http/1.1'), 'An app API request fell back to HTTP/1.1');

  const ca = await generateCaPair({ years: 1, clockSkewMs: 1000 });
  const bad = await generateLeafPair({ caCertPem: ca.certPem, caKeyPem: ca.keyPem, sans: [{ type: 'dns', value: 'localhost' }], days: 1, clockSkewMs: 1000 });
  rogue = https.createServer({ key: bad.keyPem, cert: bad.certPem }, (_req, res) => res.end('wrong certificate'));
  rogue.listen(0, '127.0.0.1');
  await once(rogue, 'listening');
  const roguePort = (rogue.address() as { port: number }).port;
  const rejected = await app.evaluate(async ({ BrowserWindow }, url) => {
    try { await BrowserWindow.getAllWindows()[0].webContents.session.fetch(url); return false; }
    catch { return true; }
  }, `https://localhost:${roguePort}/`);
  assert(rejected, 'Electron accepted an unpinned local certificate');
  const normalNodeRejected = await new Promise<boolean>((resolve) => {
    const request = https.get(`${origin}/api/health`, (response) => { response.resume(); resolve(false); });
    request.on('error', () => resolve(true));
  });
  assert(normalNodeRejected, 'The demo certificate unexpectedly passed normal Node trust');

  const noteId = await page.evaluate(async () => {
    const response = await fetch('/api/notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: 'Electron demo persistence smoke check.' }) });
    if (response.status !== 201) throw new Error('Could not save a note through the real API');
    return (await response.json()).id as string;
  });
  assert.equal(await page.evaluate(() => window.riDesktop?.platform), process.platform);
  assert.equal(await page.locator('html').getAttribute('data-ri-desktop'), process.platform);
  assert.deepEqual(await page.evaluate(async () => (await fetch('/api/harness/skills/global')).json()), { enabled: false, configured: true, appOnly: true });
  assert.equal(await page.evaluate(async () => (await fetch('/api/harness/skills/global', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }) })).status), 200);
  const screenshot = path.join(artifacts, packaged ? 'packaged-onboarding.png' : 'smoke-onboarding.png');
  await page.screenshot({ path: screenshot });
  // Real MCP OAuth discovery, DCR, state, PKCE exchange, encrypted persistence,
  // and the browser callback all run through production Next and Electron.
  await page.evaluate(async () => fetch('/api/user-state', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ onboardedAt: new Date().toISOString() }) }));
  oauthFixture = await mockMcp();
  const connect = await page.evaluate(async (url) => {
    const response = await fetch('/api/connectors/mcp-servers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Desktop OAuth smoke', url, auth: { kind: 'oauth' } }) });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return body;
  }, oauthFixture.url);
  assert(connect.desktopFlowId && connect.authUrl, 'MCP did not create a desktop authorization flow');
  const authorization = new URL(connect.authUrl);
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  assert(authorization.searchParams.get('state'));
  const redirect = authorization.searchParams.get('redirect_uri')!;
  assert.match(redirect, /^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/);
  assert.equal((await fetch(`${redirect}?state=wrong&code=wrong`)).status, 400);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  assert.equal((await fetch(connect.authUrl)).status, 200);
  await page.waitForURL((url) => url.pathname === '/' && url.searchParams.get('settings') === 'connectors', { timeout: 60_000 });
  await page.locator('p').filter({ hasText: /^Connected$/ }).waitFor({ timeout: 60_000 });
  assert.equal(oauthFixture.exchanges, 1);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()), false);
  const stored = fs.readFileSync(path.join(root, '.config/connectors/mcp-servers.json'), 'utf8');
  assert(!stored.includes(oauthFixture.token), 'OAuth token was stored unencrypted');
  assert.equal(await page.evaluate(async (id) => {
    const response = await fetch('/api/connectors/mcp-servers');
    const { servers } = await response.json();
    return servers.find((s: { id: string }) => s.id === id)?.lastStatus;
  }, connect.entry.id), 'ok');
  // Retry the same connection through the custom-protocol return path.
  const again = await page.evaluate(async (id) => (await (await fetch(`/api/connectors/mcp-servers/${id}`, { method: 'POST' })).json()), connect.entry.id);
  assert(again.authUrl, JSON.stringify(again));
  const consent = await fetch(again.authUrl, { redirect: 'manual' });
  const callback = new URL(consent.headers.get('location')!);
  const deepLink = `ri://oauth/callback?${callback.searchParams.toString()}`;
  if (packaged) execFileSync('/usr/bin/open', ['-a', packaged, deepLink]);
  else await app.evaluate(({ app }, url) => { app.emit('open-url', { preventDefault() {} }, url); }, deepLink);
  const deadline = Date.now() + 30_000;
  while (oauthFixture.exchanges < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(oauthFixture.exchanges, 2, 'Custom protocol did not finish the second authorization');
  await page.locator('p').filter({ hasText: /^Connected$/ }).waitFor();
  await app.evaluate(({ app }, url) => { app.emit('open-url', { preventDefault() {} }, url); }, deepLink);
  // Replaying a consumed callback must be rejected by the authenticated endpoint.
  assert.equal(await page.evaluate(async (params) => (await fetch('/api/desktop/oauth/complete', { method: 'POST', body: params })).status, callback.searchParams.toString()), 400);
  assert.equal(oauthFixture.exchanges, 2);
  // The integrated header remains usable after hiding the native strip.
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const header = page.locator('[data-desktop-titlebar]');
  await header.waitFor();
  assert.equal(await header.evaluate((el) => getComputedStyle(el).getPropertyValue('app-region')), 'drag');
  assert.equal(await header.locator('button').first().evaluate((el) => getComputedStyle(el).getPropertyValue('app-region')), 'no-drag');
  await page.screenshot({ path: path.join(artifacts, packaged ? 'packaged-dashboard.png' : 'smoke-dashboard.png') });
  if (packaged) {
    const resources = path.join(packaged, 'Contents/Resources');
    const installation = { node: path.join(resources, 'node/bin/node'), cli: path.join(resources, 'server/dist/cli/index.mjs'), root, server: path.join(resources, 'server') };
    const command = path.join(root, 'bin/ri-desktop');
    installTerminalCommand(command, installation);
    const help = execFileSync(command, ['--help'], { env: { NODE_ENV: 'production', PATH: '/usr/bin:/bin', RI_DESKTOP_ROOT: root }, encoding: 'utf8' });
    assert(help.includes('agent'));
    const paths = execFileSync(command, ['agent', 'describe_paths'], { env: { NODE_ENV: 'production', PATH: '/usr/bin:/bin', RI_DESKTOP_ROOT: root }, encoding: 'utf8' });
    assert(paths.includes(root), 'Packaged CLI did not use the desktop home');
    const agentNotes = execFileSync('/bin/sh', ['-c', `${bundledCliCommand(installation.node, installation.server, root)} agent list_notes --limit 1`], { cwd: os.tmpdir(), env: { NODE_ENV: 'production', PATH: '/usr/bin:/bin' }, encoding: 'utf8' });
    assert(agentNotes.includes('Electron demo persistence smoke check.'), 'Bundled CLI failed outside the app directory');
    removeTerminalCommand(command, installation);
    assert(!fs.existsSync(command));
  }
  // Reset only the disposable fixture's onboarding gate for the relaunch helper.
  await page.evaluate(async () => fetch('/api/user-state', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ onboardedAt: null }) }));
  const runtime = readServerRuntime();
  assert(runtime, 'The demo did not publish its managed server record');
  await app.close();
  app = undefined;
  assert(await portIsClosed(runtime.publicPort), 'The gateway still listens after quitting');
  assert(await portIsClosed(Number(new URL(runtime.privateUpstreams.next).port)), 'Next still listens after quitting');
  assert(!isProcessAlive(runtime.launcherPid), 'The backend process survived quitting');
  assert.equal(readServerRuntime(), null, 'The runtime record survived quitting');
  app = await launch();
  const reopened = await ready(app);
  assert.equal(await reopened.evaluate(async (id) => (await (await fetch(`/api/notes/${id}`)).json()).body, noteId), 'Electron demo persistence smoke check.');
  await app.close();
  app = undefined;
  console.info(JSON.stringify({ ok: true, mode, packaged: packaged ?? false, oauthPkceVerified: true, protocols: [...protocols], streams, wrongCertificateRejected: rejected, ordinaryTrustRejected: normalNodeRejected, persistedAfterRelaunch: true, screenshot, dataRoot: root }, null, 2));
} finally {
  await app?.close().catch(() => {});
  rogue?.closeAllConnections();
  rogue?.close();
  oauthFixture?.close();
}
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
