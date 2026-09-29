/** Packaged service + a fresh ordinary Chromium profile. No real push provider.
 * Only Notification/PushManager OS boundaries and one failed HTTP request are
 * injected. Service worker, UI, authentication, routes and SQLite stay real.
 * RI_DESKTOP_PACKAGE=... RI_BROWSER_EXECUTABLE_PATH=... pnpm exec tsx desktop/browser-notifications-smoke.ts
 */
import assert from 'node:assert/strict';
import { createHash, X509Certificate } from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import Database from 'better-sqlite3';
import { chromium, type Browser, type BrowserContext, type Page, type Route } from 'playwright-core';
import type { NotificationChannelRecord, NotificationDeliveryRecord } from '../src/db/types';
import type { NotificationHistoryResponse, NotificationHistoryStatus } from '../src/lib/notifications/history';
import { SESSION_COOKIE_NAME } from '../src/lib/auth/session';
import { AUTH_TOKEN_STORAGE_KEY } from '../src/lib/api/client';
import { acceptance, api, bounded, eventually } from './acceptance-fixture';

const browserExecutable = process.env.RI_BROWSER_EXECUTABLE_PATH;
const endpoint = 'https://push.invalid/ri-browser-notifications-smoke';
const otherEndpoint = 'https://push.invalid/ri-other-profile-smoke';
const sensitive = 'private-notification-history-fixture';
interface BrowserBoundaryState { unsubscribeMode: 'success' | 'false' | 'reject'; subscribeCalls: number; unsubscribeCalls: number; permissionCalls: number }
type BoundaryWindow = Window & { riPushAcceptance: BrowserBoundaryState };

async function anonymousStatus(origin: string, ca: Buffer, route: string, method: 'GET' | 'POST') {
  return bounded(new Promise<number | undefined>((resolve, reject) => {
    const request = https.request(new URL(route, origin), { method, ca, headers: method === 'POST' ? { 'content-type': 'application/json' } : {} }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject); request.setTimeout(5000, () => request.destroy(new Error('Anonymous notification request timed out')));
    request.end(method === 'POST' ? '{}' : undefined);
  }), `anonymous ${method} ${route}`, 6000);
}

// A raw script deliberately avoids esbuild's keepNames/__name helpers inside
// functions serialized into another JavaScript realm. State survives reloads.
const browserBoundaryScript = `(() => {
  const key = 'ri:push-acceptance-subscription';
  const endpoint = ${JSON.stringify(endpoint)};
  const state = window.riPushAcceptance = { unsubscribeMode: 'success', subscribeCalls: 0, unsubscribeCalls: 0, permissionCalls: 0 };
  Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'granted' });
  Notification.requestPermission = async () => { state.permissionCalls++; return 'granted'; };
  const subscription = () => ({
    endpoint,
    expirationTime: null,
    options: { userVisibleOnly: true, applicationServerKey: null },
    getKey: () => new Uint8Array(16).buffer,
    toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: 'smoke-browser-public-key', auth: 'smoke-browser-auth' } }),
    unsubscribe: async () => {
      state.unsubscribeCalls++;
      if (state.unsubscribeMode === 'reject') throw new Error('Injected browser push removal rejection');
      if (state.unsubscribeMode === 'false') return false;
      sessionStorage.removeItem(key);
      return true;
    }
  });
  PushManager.prototype.getSubscription = async function () { return sessionStorage.getItem(key) ? subscription() : null; };
  PushManager.prototype.subscribe = async function () { state.subscribeCalls++; sessionStorage.setItem(key, '1'); return subscription(); };
})();`;

/** Controlled data fixtures only. This DB belongs to AcceptanceFixture. No
 * notify(), provider adapters, desktop consumer or actual send is invoked. */
function seedHistory(databaseFile: string, webPushChannel: string) {
  const db = new Database(databaseFile, { fileMustExist: true });
  db.pragma('busy_timeout = 5000');
  const desktopChannel = 'history-smoke-desktop'; const connectorChannel = 'history-smoke-connector';
  const cases: { title: string; status: NotificationDeliveryRecord['status']; historyStatus: NotificationHistoryStatus; channelId: string; attempts: number; receipt?: string; error?: string }[] = [
    { title: 'History browser queued', status: 'pending', historyStatus: 'queued', channelId: webPushChannel, attempts: 0 },
    { title: 'History browser accepted', status: 'sent', historyStatus: 'sent', channelId: webPushChannel, attempts: 1, receipt: sensitive },
    { title: 'History connector failed', status: 'failed', historyStatus: 'failed', channelId: connectorChannel, attempts: 1, error: `network timeout ${sensitive}` },
    { title: 'History desktop uncertain', status: 'skipped', historyStatus: 'uncertain', channelId: desktopChannel, attempts: 1, receipt: `desktop:${sensitive}`, error: sensitive },
    { title: 'History desktop expired', status: 'skipped', historyStatus: 'expired', channelId: desktopChannel, attempts: 0, error: 'This desktop alert expired while the app was closed.' },
    { title: 'History connector skipped', status: 'skipped', historyStatus: 'skipped', channelId: connectorChannel, attempts: 0, error: sensitive },
  ];
  try {
    db.transaction(() => {
      const insertChannel = db.prepare('INSERT INTO notification_channels (id, user_id, kind, label, provider_id, connection_id, config, events, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      insertChannel.run(desktopChannel, 'local', 'in_app', 'History desktop', null, null, JSON.stringify({ surface: 'desktop', private: sensitive }), '[]', 0);
      insertChannel.run(connectorChannel, 'local', 'connector', 'History Telegram', 'telegram', sensitive, JSON.stringify({ chatId: sensitive }), '[]', 0);
      const insert = db.prepare('INSERT INTO notification_deliveries (id, user_id, event_type, dedupe_key, channel_id, status, attempts, event, rendered, provider_message_id, last_error, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const [index, item] of cases.entries()) {
        const id = `history-smoke-${index}`;
        const event = { type: 'execution.finished', userId: 'local', dedupeKey: id, title: item.title, body: sensitive, url: `https://push.invalid/${sensitive}` };
        insert.run(id, 'local', event.type, id, item.channelId, item.status, item.attempts, JSON.stringify(event), JSON.stringify({ title: item.title, body: sensitive, url: event.url }), item.receipt ?? null, item.error ?? null, item.status === 'sent' ? new Date().toISOString() : null);
      }
    })();
    return { cases, desktopChannel, connectorChannel };
  } finally { db.close(); }
}

void acceptance('browser-notifications-smoke', async fixture => {
  fixture.env.NOTIFIER_USER_ID = 'local';
  await fixture.launch();
  const origin = fixture.origin!;
  const databaseFile = path.join(fixture.root, 'data.db');
  const ca = fs.readFileSync(path.join(fixture.root, '.config/tls/ca/ca.crt'));
  assert.equal(await anonymousStatus(origin, ca, '/api/notifications/deliveries', 'GET'), 401);
  assert.equal(await anonymousStatus(origin, ca, '/api/notifications/web-push/status', 'POST'), 401);
  fixture.check('Cookie-free independent clients cannot read notification history or browser registration state');
  const subscriptions = () => {
    const db = new Database(databaseFile, { readonly: true, fileMustExist: true });
    try { return db.prepare('SELECT endpoint FROM web_push_subscriptions WHERE user_id = ? ORDER BY endpoint').all('local') as { endpoint: string }[]; }
    finally { db.close(); }
  };
  const leafRoot = path.join(fixture.root, '.config/tls/leaf');
  const manifest = JSON.parse(fs.readFileSync(path.join(leafRoot, 'manifest.json'), 'utf8')) as { current: string };
  assert.equal(path.basename(manifest.current), manifest.current);
  const leaf = new X509Certificate(fs.readFileSync(path.join(leafRoot, 'versions', manifest.current, 'leaf.crt')));
  const spki = createHash('sha256').update(leaf.publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
  let browser: Browser | undefined; let context: BrowserContext | undefined; let page: Page | undefined;
  const runtimeErrors: string[] = []; const consoleErrors: { text: string; url: string }[] = [];
  const unexpectedResponses: { path: string; status: number }[] = []; const requests: Record<string, number> = {};
  let injectedFailures = 0;
  const failedSubscribe = async (route: Route) => {
    if (route.request().method() !== 'POST') return route.continue();
    injectedFailures++;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Injected registration failure. Try again.' }) });
  };
  try {
    browser = await chromium.launch({ executablePath: browserExecutable, headless: true, env: fixture.env, args: [`--ignore-certificate-errors-spki-list=${spki}`] });
    context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, serviceWorkers: 'allow' });
    context.setDefaultTimeout(15_000); context.setDefaultNavigationTimeout(30_000);
    await context.addInitScript({ content: browserBoundaryScript });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return /^https?:$/.test(url.protocol) && url.origin !== origin ? route.abort() : route.continue();
    });
    page = await context.newPage();
    const browserPage = page;
    browserPage.on('pageerror', error => runtimeErrors.push(error.message));
    browserPage.on('console', message => { if (message.type() === 'error') consoleErrors.push({ text: message.text(), url: message.location().url }); });
    browserPage.on('request', request => {
      const url = new URL(request.url());
      if (url.origin === origin && url.pathname.startsWith('/api/notifications/')) {
        const key = `${request.method()} ${url.pathname}`; requests[key] = (requests[key] ?? 0) + 1;
      }
    });
    browserPage.on('response', response => {
      const url = new URL(response.url());
      if (url.origin === origin && url.pathname.startsWith('/api/notifications/') && response.status() >= 400 && !(url.pathname.endsWith('/web-push/subscribe') && response.status() === 503 && injectedFailures === 1)) unexpectedResponses.push({ path: url.pathname, status: response.status() });
    });
    const channels = async () => (await api<{ channels: NotificationChannelRecord[] }>(browserPage, '/api/notifications/channels')).channels;
    const webPushChannel = async () => {
      const channel = (await channels()).find(item => item.kind === 'web_push'); assert(channel, 'Browser push channel was not persisted'); return channel;
    };
    // Pair an ordinary device through the same UI and real session endpoint a
    // phone uses. A cookie alone does not satisfy PairingBootstrap's client
    // state, and the browser must not inherit the desktop owner's capability.
    const pairing = await api<{ plaintext: string }>(fixture.page!, '/api/devices', 'POST', {
      name: 'Browser notification acceptance', kind: 'computer', expiresAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
    });
    assert.equal((await context.cookies(origin)).some(cookie => cookie.name === SESSION_COOKIE_NAME), false);
    try {
      await browserPage.goto(`${origin}/pair`, { waitUntil: 'domcontentloaded' });
      await browserPage.getByRole('heading', { name: 'Device Pairing', exact: true }).waitFor();
      const input = browserPage.getByRole('textbox');
      await eventually(async () => input.evaluate(element => document.activeElement === element), 'pairing form hydrated');
      await input.fill(pairing.plaintext);
      await Promise.all([
        browserPage.waitForResponse(response => response.url() === `${origin}/api/session` && response.request().method() === 'POST' && response.status() === 200),
        browserPage.getByRole('button', { name: 'Connect', exact: true }).click(),
      ]);
      await browserPage.waitForURL(url => url.origin === origin && url.pathname === '/');
    } catch (error) {
      // Playwright call logs can include fill arguments. Keep even a failed
      // pairing diagnostic free of the temporary device's credential.
      throw new Error(`Fixture browser pairing failed: ${String(error).replaceAll(pairing.plaintext, '[redacted fixture credential]')}`);
    }
    const pairedCookie = (await context.cookies(origin)).find(cookie => cookie.name === SESSION_COOKIE_NAME);
    assert(pairedCookie?.httpOnly && pairedCookie.secure, 'Real pairing did not set its secure session cookie');
    assert.equal(await browserPage.evaluate(key => !!localStorage.getItem(key), AUTH_TOKEN_STORAGE_KEY), true, 'Real pairing did not establish client authentication state');
    fixture.check('Fresh Chromium pairs an ordinary temporary device through the real pairing UI and secure session endpoint');
    await browserPage.goto(`${origin}/?settings=notifications`, { waitUntil: 'domcontentloaded' });
    assert.equal(await browserPage.evaluate(() => !!window.riDesktop), false, 'Browser fixture unexpectedly received the desktop bridge');
    const push = browserPage.getByRole('region', { name: 'Browser notifications', exact: true });
    await push.getByRole('button', { name: 'Enable browser push', exact: true }).waitFor();
    await push.getByText('Browser notifications are off', { exact: true }).waitFor();
    assert.deepEqual(await browserPage.evaluate(() => ({ subscribe: (window as unknown as BoundaryWindow).riPushAcceptance.subscribeCalls, permission: (window as unknown as BoundaryWindow).riPushAcceptance.permissionCalls })), { subscribe: 0, permission: 0 });
    fixture.check('Fresh Chromium uses only fixture authentication and the real packaged notification settings');

    await browserPage.route(`${origin}/api/notifications/web-push/subscribe`, failedSubscribe);
    try { await push.getByRole('button', { name: 'Enable browser push', exact: true }).click(); await push.getByRole('alert').filter({ hasText: 'Ri could not confirm this browser registration' }).waitFor(); }
    finally { await browserPage.unroute(`${origin}/api/notifications/web-push/subscribe`, failedSubscribe); }
    assert.equal(injectedFailures, 1);
    assert.equal(subscriptions().some(item => item.endpoint === endpoint), false);
    await push.getByRole('button', { name: 'Repair browser notifications', exact: true }).waitFor();
    await push.getByText('Browser notifications need repair', { exact: true }).waitFor();
    assert.equal(await push.getByText('Browser push on for this device', { exact: true }).count(), 0);
    await browserPage.screenshot({ path: path.join(fixture.base, 'browser-registration-failed.png') });
    fixture.check('Failed registration is visible and local permission alone is never reported as delivery readiness');

    await push.getByRole('button', { name: 'Repair browser notifications', exact: true }).click();
    await push.getByText('Browser push on for this device', { exact: true }).waitFor();
    await push.getByRole('button', { name: 'Turn off here', exact: true }).waitFor();
    await eventually(async () => subscriptions().some(item => item.endpoint === endpoint), 'browser registration persisted');
    let channel = await webPushChannel(); assert(channel.enabled);
    assert.equal(await browserPage.evaluate(() => (window as unknown as BoundaryWindow).riPushAcceptance.subscribeCalls), 1, 'Repair unnecessarily replaced the retained browser subscription');
    assert.equal(await browserPage.evaluate(async () => (await navigator.serviceWorker.getRegistration('/notifications-sw.js'))?.active?.state), 'activated');
    await api(browserPage, '/api/notifications/web-push/subscribe', 'POST', { endpoint: otherEndpoint, keys: { p256dh: 'smoke-other-key', auth: 'smoke-other-auth' } });
    fixture.check('Explicit repair succeeds through the real subscribe route and an activated service worker');

    // A different authenticated renderer changes the channel while this tab
    // still has its old parent props. Check again must trust fresh server data.
    await api(fixture.page!, `/api/notifications/channels/${channel.id}`, 'DELETE');
    await push.getByRole('button', { name: 'Check again', exact: true }).click();
    await push.getByText('Browser notifications need repair', { exact: true }).waitFor();
    assert.equal(await push.getByText('Browser push on for this device', { exact: true }).count(), 0);
    await push.getByRole('button', { name: 'Repair browser notifications', exact: true }).click();
    await push.getByText('Browser push on for this device', { exact: true }).waitFor();
    const recreated = await webPushChannel(); assert.notEqual(recreated.id, channel.id); channel = recreated;
    assert(subscriptions().some(item => item.endpoint === otherEndpoint));
    fixture.check('Check again detects a channel removed by another client despite stale parent state, then explicit repair recreates it');

    const selectedEvents = ['execution.needs_input'];
    await api(browserPage, `/api/notifications/channels/${channel.id}`, 'PATCH', { enabled: false, events: selectedEvents });
    await api(browserPage, '/api/notifications/web-push/unsubscribe', 'POST', { endpoint });
    await browserPage.reload({ waitUntil: 'domcontentloaded' });
    await push.getByRole('button', { name: 'Repair browser notifications', exact: true }).click();
    await push.getByText('Browser registered, delivery paused', { exact: true }).waitFor();
    await eventually(async () => subscriptions().some(item => item.endpoint === endpoint), 'lost server registration repaired');
    const preserved = await webPushChannel(); assert.equal(preserved.id, channel.id); assert.equal(preserved.enabled, false); assert.deepEqual(preserved.events, selectedEvents);
    assert(subscriptions().some(item => item.endpoint === otherEndpoint));
    await push.scrollIntoViewIfNeeded();
    await browserPage.screenshot({ path: path.join(fixture.base, 'browser-repaired-desktop.png') });
    await browserPage.setViewportSize({ width: 390, height: 844 });
    await push.scrollIntoViewIfNeeded();
    await browserPage.screenshot({ path: path.join(fixture.base, 'browser-repaired-narrow.png') });
    assert(await push.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Browser settings overflow the narrow viewport');
    await browserPage.setViewportSize({ width: 1440, height: 1080 });
    fixture.check('Repair after server registration loss preserves disabled channel, selected events, and other browser registration');

    for (const mode of ['false', 'reject'] as const) {
      await browserPage.evaluate(mode => { (window as unknown as BoundaryWindow).riPushAcceptance.unsubscribeMode = mode; }, mode);
      await push.getByRole('button', { name: 'Turn off here', exact: true }).click();
      await push.getByRole('alert').filter({ hasText: 'Ri has stopped sending here, but this browser could not remove its registration' }).waitFor();
      await push.getByRole('button', { name: 'Turn off here', exact: true }).waitFor();
      assert.equal(await browserPage.evaluate(async () => !!(await (await navigator.serviceWorker.getRegistration('/notifications-sw.js'))?.pushManager.getSubscription())), true);
      assert.equal(subscriptions().some(item => item.endpoint === endpoint), false, 'Server kept sending after claiming removal');
      assert(subscriptions().some(item => item.endpoint === otherEndpoint));
      await browserPage.evaluate(() => { (window as unknown as BoundaryWindow).riPushAcceptance.unsubscribeMode = 'success'; });
      await push.getByRole('button', { name: 'Turn off here', exact: true }).click();
      await push.getByRole('button', { name: 'Enable browser push', exact: true }).waitFor();
      await push.getByText('Browser notifications are off', { exact: true }).waitFor();
      assert.equal(subscriptions().some(item => item.endpoint === endpoint), false);
      assert(subscriptions().some(item => item.endpoint === otherEndpoint));
      assert.equal(await browserPage.evaluate(async () => !!(await (await navigator.serviceWorker.getRegistration('/notifications-sw.js'))?.pushManager.getSubscription())), false);
      if (mode === 'false') { await push.getByRole('button', { name: 'Enable browser push', exact: true }).click(); await push.getByText('Browser registered, delivery paused', { exact: true }).waitFor(); }
    }
    assert.deepEqual((await webPushChannel()).events, selectedEvents); assert.equal((await webPushChannel()).enabled, false);
    fixture.check('Browser unsubscribe false/rejection remains visible, explicit retry works, other browsers and preferences survive');

    const history = seedHistory(databaseFile, channel.id);
    const response = await api<NotificationHistoryResponse>(browserPage, '/api/notifications/deliveries');
    assert.equal(response.limit, 100); assert.equal(response.deliveries.length, history.cases.length);
    assert(!JSON.stringify(response).includes(sensitive), 'History API leaked private provider/event data');
    for (const item of history.cases) assert.equal(response.deliveries.find(row => row.title === item.title)?.status, item.historyStatus);
    const region = browserPage.getByRole('region', { name: 'Recent delivery history', exact: true });
    await region.getByRole('button', { name: 'Refresh history', exact: true }).click();
    const list = region.getByRole('list', { name: 'Recent notification deliveries' });
    await eventually(async () => (await list.getByRole('listitem').count()) === history.cases.length, 'seeded delivery history visible');
    assert(!(await region.innerText()).includes(sensitive));
    assert.equal(await list.getByRole('link').count(), 0, 'History must not expose event navigation or provider links');
    for (const item of history.cases) {
      await region.getByLabel('Status', { exact: true }).selectOption(item.historyStatus);
      await eventually(async () => (await list.getByRole('listitem').count()) === 1, `history ${item.historyStatus} filter`);
      assert((await list.innerText()).includes(item.title));
    }
    await region.getByLabel('Status', { exact: true }).selectOption('all');
    await region.getByLabel('Channel', { exact: true }).selectOption(history.desktopChannel);
    await eventually(async () => (await list.getByRole('listitem').count()) === 2, 'desktop channel history filter');
    await region.getByLabel('Channel', { exact: true }).selectOption('all');
    await region.scrollIntoViewIfNeeded();
    await browserPage.screenshot({ path: path.join(fixture.base, 'browser-history-desktop.png') });
    await browserPage.setViewportSize({ width: 390, height: 844 });
    await region.scrollIntoViewIfNeeded();
    await browserPage.screenshot({ path: path.join(fixture.base, 'browser-history-narrow.png') });
    assert(await region.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'History section overflows the narrow viewport');
    fixture.check('Shared history renders six truthful safe statuses with working filters at desktop and narrow widths');

    assert.deepEqual(runtimeErrors, [], 'Browser runtime errors');
    assert.deepEqual(unexpectedResponses, [], 'Unexpected notification API errors');
    const relevantConsoleErrors = consoleErrors.filter(item => (/\/notifications|hydration|react.*error/i.test(`${item.url} ${item.text}`)) && !(item.url === `${origin}/api/notifications/web-push/subscribe` && /503/.test(item.text)));
    assert.deepEqual(relevantConsoleErrors, [], 'Notification UI console errors');
    assert(Object.values(requests).every(count => count <= 50), 'Notification request loop exceeded the smoke bound');
    fixture.report.browserNotificationRequests = requests;
    fixture.report.browserConsoleErrors = consoleErrors;
    fixture.report.limits = ['Notification permission and PushManager provider operations are mocked. This does not qualify real push delivery, OS alerts, browser permission prompts or mobile Safari. History rows are controlled records in the isolated fixture DB.'];
  } catch (error) {
    if (page && !page.isClosed()) {
      fixture.report.browserFailure = await bounded(page.evaluate(() => ({ url: location.href, text: document.body.innerText.slice(0, 12_000) })), 'browser failure diagnostics', 5000).catch(() => undefined);
      await page.screenshot({ path: path.join(fixture.base, 'browser-failure.png'), mask: [page.locator('input')], timeout: 5000 }).catch(() => {});
    }
    throw error;
  } finally {
    fixture.report.browserRuntimeErrors = runtimeErrors;
    fixture.report.browserNotificationRequests = requests;
    try { await context?.unrouteAll({ behavior: 'ignoreErrors' }); }
    finally {
      try { await bounded(context?.close() ?? Promise.resolve(), 'browser context cleanup', 10_000); }
      finally { await bounded(browser?.close() ?? Promise.resolve(), 'browser process cleanup', 10_000); }
    }
  }
}).catch(error => { console.error(error); process.exitCode = 1; });
