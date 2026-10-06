/** Real Electron + real Home routes in disposable roots.
 * Default: packaged first-run Home, source development companion over loopback HTTP.
 * --source-home runs both shells from the current build before packaging.
 * The HTTP proxy trusts only the disposable Home certificate. No OS trust edits,
 * packaged certificate bypass, production Home, login job or harness is used. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Page } from 'playwright-core';
import type { Notification } from 'electron';
import Database from 'better-sqlite3';
import { AcceptanceFixture, api, eventually } from './acceptance-fixture';
import { desktopPackageLayout } from './package-layout';
import { ensureServiceStatus, serviceRequest, serviceStatus, stopService, type ServiceSession } from '../src/lib/service/client';

const sourceHome = process.argv.includes('--source-home');
const home = new AcceptanceFixture('companion-home', { chooseHome: false, source: sourceHome });
const connected = new AcceptanceFixture('companion-worker', { chooseHome: false, source: true });
const report: Record<string, unknown> = { startedAt: new Date().toISOString(), home: home.base, connected: connected.base, sourceHome, package: home.report.package, runtimeId: home.report.runtimeId, asarSha256: home.report.asarSha256, checks: [] };
const passed = (name: string) => { (report.checks as string[]).push(name); console.info(`[companion] ${name}`); };
let proxy: http.Server | undefined;
let offline = false;
let proxyOrigin = '';
const seenCapabilities: string[] = [];
let failure: unknown;

async function companion(fixture: AcceptanceFixture) {
  let page: Page | undefined;
  await eventually(async () => {
    page = fixture.app?.windows().find(window => window.url().startsWith('data:') && window.url().includes('Ri%20on%20this%20device'));
    return !!page;
  }, 'trusted local companion window');
  await page!.locator('#heading').waitFor();
  return page!;
}
async function openCompanion(fixture: AcceptanceFixture) {
  await fixture.app!.evaluate(({ Menu, BrowserWindow }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('ri-desktop-preferences');
    if (!item?.enabled) throw new Error('The local companion menu is unavailable');
    item.click(item, BrowserWindow.getAllWindows()[0], {} as never);
  });
  return companion(fixture);
}
async function mainPage(fixture: AcceptanceFixture, origin?: string) {
  const page = fixture.page!;
  await page.waitForURL(url => origin ? url.origin === origin : url.protocol === 'https:', { timeout: 240_000 });
  await page.waitForFunction(() => window.riDesktop?.platform);
  fixture.origin = new URL(page.url()).origin;
  return page;
}
async function proxyToHome(session: ServiceSession) {
  const target = new URL(session.origin);
  proxy = http.createServer((request, response) => {
    if (request.headers['x-ri-desktop-client']) seenCapabilities.push(String(request.headers['x-ri-desktop-client']));
    if (offline) { response.writeHead(503); response.end('Fixture network unavailable'); return; }
    const headers = { ...request.headers, host: target.host };
    if (headers.origin === proxyOrigin) headers.origin = session.origin;
    if (headers.referer?.startsWith(`${proxyOrigin}/`)) headers.referer = headers.referer.replace(proxyOrigin, session.origin);
    const upstream = https.request(new URL(request.url!, session.origin), { method: request.method, headers,
      ca: session.certificate, allowPartialTrustChain: true, agent: false }, remote => {
      const output = { ...remote.headers };
      if (output.location?.startsWith(session.origin)) output.location = output.location.replace(session.origin, proxyOrigin);
      response.writeHead(remote.statusCode!, output); remote.pipe(response);
    });
    upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    response.on('close', () => upstream.destroy());
    request.pipe(upstream);
  });
  await new Promise<void>((resolve, reject) => { proxy!.once('error', reject); proxy!.listen(0, '127.0.0.1', resolve); });
  proxyOrigin = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
}
interface RemoteDelivery { id: string; status: string; attempts: number; receipt: string | null }
type NotificationFixtureGlobal = typeof globalThis & { companionAlerts: Notification[] };
function remoteDeliveries(deviceId: string): RemoteDelivery[] {
  const db = new Database(path.join(home.root, 'data.db'), { readonly: true, fileMustExist: true });
  try { return db.prepare('SELECT id, status, attempts, provider_message_id AS receipt FROM notification_deliveries WHERE channel_id = ? ORDER BY id').all(`desktop:device:${deviceId}`) as RemoteDelivery[]; }
  finally { db.close(); }
}
async function remoteNotificationConsent(page: Page, deviceId: string) {
  await connected.app!.evaluate(({ Notification }) => {
    const shown: Notification[] = [];
    (globalThis as NotificationFixtureGlobal).companionAlerts = shown;
    Notification.isSupported = () => true;
    Notification.getHistory = async () => [];
    Notification.prototype.show = function () { shown.push(this); queueMicrotask(() => this.emit('show')); };
  });
  const shown = () => connected.app!.evaluate(() => (globalThis as NotificationFixtureGlobal).companionAlerts.map(alert => ({ id: alert.id, title: alert.title })));
  const controls = await openCompanion(connected);
  await controls.locator('#notifications > summary').click();
  const consent = controls.locator('#native-notifications');
  assert.equal(await consent.isChecked(), false);
  await consent.check();
  const test = controls.getByRole('button', { name: 'Send test notification', exact: true });
  await test.click();
  await eventually(async () => remoteDeliveries(deviceId).length === 1 && remoteDeliveries(deviceId)[0].status === 'sent', 'remote native claim and acknowledgement');
  const first = remoteDeliveries(deviceId)[0];
  assert.equal(first.attempts, 1); assert(first.receipt);
  assert.deepEqual(await shown(), [{ id: `desktop:device:${deviceId}:${first.id}`, title: 'Ri notifications are ready' }]);
  passed('Local companion opt-in uses the Home per-device outbox, real claim and acknowledgement, and native presentation');

  await consent.uncheck();
  await eventually(async () => !(await consent.isChecked()) && await consent.isEnabled(), 'local notification consent disabled');
  // A Home-side routing change must never override this computer's consent.
  const channel = `desktop:device:${deviceId}`;
  await api(page, `/api/notifications/channels/${encodeURIComponent(channel)}`, 'PATCH', { enabled: true });
  await test.click();
  await eventually(async () => remoteDeliveries(deviceId).length === 2 && await test.isEnabled(), 'queued alert while local consent is disabled');
  assert.equal(remoteDeliveries(deviceId)[1].status, 'pending');
  assert.equal(remoteDeliveries(deviceId)[1].attempts, 0);
  assert.equal((await shown()).length, 1);
  assert.equal(await consent.isChecked(), false);
  passed('Home channel re-enable cannot override local native notification refusal');
}
async function consentToExecution(fixture: AcceptanceFixture) {
  await fixture.app!.evaluate(({ dialog }) => {
    const original = dialog.showMessageBox;
    dialog.showMessageBox = ((...args: unknown[]) => {
      const options = args.at(-1) as { message?: string };
      if (options.message === 'Run agents on this device?' || options.message === 'Stop execution on this device?') return Promise.resolve({ response: 1, checkboxChecked: false });
      return original(...args as Parameters<typeof original>);
    }) as typeof original;
  });
}
async function waitWorker(state: string) {
  connected.select();
  await eventually(async () => (await serviceStatus())?.worker?.state === state, `worker ${state}`, 60_000);
}

void (async () => {
  try {
    home.select();
    await home.launchRaw();
    const initial = await companion(home);
    await initial.screenshot({ path: path.join(home.base, 'first-run.png') });
    assert.equal(fs.existsSync(path.join(home.root, 'data.db')), false);
    assert.equal(await serviceStatus(), null);
    await initial.locator('#create-home').click();
    const homePage = await mainPage(home);
    await homePage.screenshot({ path: path.join(home.base, 'home.png') });
    assert.equal(await homePage.evaluate(() => typeof window.riDesktop?.settings), 'function');
    assert.equal((await serviceStatus())?.role, 'home');
    await api(homePage, '/api/user-state', 'PATCH', { onboardedAt: new Date().toISOString() });
    const pair = await api<{ plaintext: string; device: { id: string } }>(homePage, '/api/devices', 'POST', { name: 'Companion fixture laptop', kind: 'computer' });
    const sharedNote = await api<{ id: string }>(homePage, '/api/notes', 'POST', { title: 'Companion acceptance', body: 'Stored only on the disposable Home.' });
    const expectedHome = await api<{ id: string }>(homePage, '/api/home');
    const session = await serviceRequest<ServiceSession>('/session');
    passed(`${sourceHome ? 'Source' : 'Packaged'} first-run requires explicit Home choice before creating the task database`);
    await home.quit();
    assert.equal((await serviceStatus())?.runId, session.runId);
    passed('Quitting Home GUI leaves the shared Home service available');
    await proxyToHome(session);

    connected.env.RI_DESKTOP_MODE = 'development';
    connected.env.RI_DESKTOP_RECOVERY_SMOKE = '1';
    if (!sourceHome && process.env.RI_DESKTOP_PACKAGE) {
      const resources = desktopPackageLayout(process.env.RI_DESKTOP_PACKAGE).resources;
      connected.env.RI_DESKTOP_RESOURCES = resources;
      connected.env.RI_DESKTOP_NODE = path.join(resources, 'node/bin/node');
    }
    connected.select();
    if (sourceHome) {
      const empty = await ensureServiceStatus({ repo: path.resolve(__dirname, '..'), node: process.execPath, env: { ...connected.env, NODE_ENV: 'production' } });
      assert.equal(empty.role, 'first-run');
      assert.equal(fs.existsSync(path.join(connected.root, 'data.db')), false);
    }
    await connected.launchRaw();
    const setup = await companion(connected);
    assert.equal(fs.existsSync(path.join(connected.root, 'data.db')), false);
    assert.equal((await serviceStatus())?.role ?? null, sourceHome ? 'first-run' : null);
    if (sourceHome) passed('Existing unchosen control service still opens first-run setup without a database');
    // A remote Home using the local generated certificate must fail ordinary
    // Node trust before releasing the browser credential or starting a worker.
    await setup.locator('#choose-connect').click();
    await setup.getByLabel('Pairing link', { exact: true }).fill(`${session.origin}/#token=${pair.plaintext}`);
    await setup.getByRole('button', { name: 'Connect', exact: true }).click();
    await setup.getByRole('alert').filter({ hasText: /certificate.*trust/i }).waitFor();
    assert.equal(fs.existsSync(path.join(connected.root, '.config/connection.json')), false);
    passed('Remote Home pairing rejects an untrusted local TLS certificate without altering OS trust');
    await setup.getByLabel('Pairing link', { exact: true }).fill(`${proxyOrigin}/#token=${pair.plaintext}`);
    await setup.getByRole('button', { name: 'Connect', exact: true }).click();
    await setup.waitForFunction(() => !(document.getElementById('connect-home') as HTMLButtonElement)?.disabled, undefined, { timeout: 60_000 });
    assert.equal(await setup.getByRole('alert').textContent(), '', 'Home pairing must complete before remote navigation');
    const page = await mainPage(connected, proxyOrigin);
    assert.equal((await api<{ id: string }>(page, '/api/home')).id, expectedHome.id);
    assert.equal((await api<{ body: string }>(page, `/api/notes/${sharedNote.id}`)).body, 'Stored only on the disposable Home.');
    await page.locator('aside:visible').first().waitFor();
    await page.screenshot({ path: path.join(connected.base, 'viewer.png') });
    const bridge = await page.evaluate(() => ({ settings: typeof window.riDesktop?.settings, notifications: typeof window.riDesktop?.notifications,
      require: typeof (window as unknown as { require?: unknown }).require, companion: typeof (window as unknown as { riCompanion?: unknown }).riCompanion }));
    assert.deepEqual(bridge, { settings: 'undefined', notifications: 'undefined', require: 'undefined', companion: 'undefined' });
    assert.equal((await serviceStatus())?.role, 'viewer');
    assert.equal(fs.existsSync(path.join(connected.root, '.config/worker.json')), false);
    assert.equal(fs.existsSync(path.join(connected.root, 'data.db')), false);
    assert.deepEqual(seenCapabilities, []);
    passed('Connected viewer opens real Home UI with no local task database, worker, or privileged bridge');

    await remoteNotificationConsent(page, pair.device.id);

    // Control only the human consent dialog response. Enrollment, service,
    // worker stream, stop, persisted preference and reconnect are real.
    await consentToExecution(connected);
    const controls = await openCompanion(connected);
    await controls.locator('#execution > summary').click();
    await controls.getByRole('button', { name: 'Enable local execution', exact: true }).click();
    await waitWorker('connected');
    const worker = await serviceStatus();
    await (await openCompanion(connected)).screenshot({ path: path.join(connected.base, 'worker.png') });
    assert.equal(worker?.role, 'worker');
    const enrollment = JSON.parse(fs.readFileSync(path.join(connected.root, '.config/worker.json'), 'utf8'));
    assert.equal(enrollment.deviceId, pair.device.id);
    assert.equal(fs.existsSync(path.join(connected.root, 'data.db')), false);
    passed('Separate local consent enrolls the same device and starts one supervised worker');

    offline = true; proxy!.closeAllConnections();
    await waitWorker('disconnected');
    offline = false;
    await waitWorker('connected');
    passed('Worker survives temporary Home transport loss and reconnects');
    await connected.quit();
    assert.equal((await serviceStatus())?.runId, worker?.runId);
    assert.equal((await serviceStatus())?.worker?.pid, worker?.worker?.pid);
    passed('Quitting connected GUI leaves the same worker running');
    await connected.launchRaw();
    await mainPage(connected, proxyOrigin);
    await consentToExecution(connected);
    const reopened = await openCompanion(connected);
    await reopened.locator('#execution > summary').click();
    await reopened.getByRole('button', { name: 'Stop local execution', exact: true }).click();
    await waitWorker('stopped');
    const stopped = await serviceStatus();
    assert.equal(stopped?.worker?.enabled, false);
    await connected.quit();
    await stopService();
    const restarted = await ensureServiceStatus({ repo: stopped!.repo, node: stopped!.node!, env: { ...connected.env, NODE_ENV: 'production' } });
    assert.equal(restarted.worker?.enabled, false);
    assert.equal(restarted.worker?.state, 'stopped');
    home.select();
    assert.equal((await serviceStatus())?.runId, session.runId);
    assert.deepEqual(seenCapabilities, []);
    assert.equal(fs.existsSync(path.join(connected.root, 'data.db')), false);
    assert.equal(remoteDeliveries(pair.device.id)[1].status, 'pending');
    assert.equal(remoteDeliveries(pair.device.id)[1].attempts, 0);
    passed('Local stop survives controller restart without stopping Home or creating worker task data');
    report.limits = ['The connected journey uses the source Electron shell with explicit loopback development HTTP and a certificate-validating fixture proxy. Production trusted-HTTPS remote viewing still needs deployment qualification.', 'Native consent dialog answers and OS notification presentation/history/support are controlled. No OS login job, real harness, real account or production data was used.'];
  } catch (error) {
    failure = error;
    report.error = error instanceof Error ? error.stack : String(error);
    for (const fixture of [home, connected]) await fixture.page?.screenshot({ path: path.join(fixture.base, 'failure.png'), timeout: 3000 }).catch(() => {});
  } finally {
    offline = false;
    for (const fixture of [connected, home]) {
      try { fixture.select(); await fixture.cleanup(); }
      catch (error) { failure ??= error; ((report.cleanupErrors ??= []) as string[]).push(String(error)); }
    }
    proxy?.closeAllConnections();
    if (proxy) await new Promise<void>(resolve => proxy!.close(() => resolve()));
    report.passed = !failure; report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(home.base, 'companion-report.json'), JSON.stringify(report, null, 2));
    console.info(JSON.stringify(report, null, 2));
  }
  if (failure) process.exitCode = 1;
})();
