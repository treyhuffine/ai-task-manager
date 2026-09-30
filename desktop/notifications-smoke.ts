/** Real packaged bridge, owner route, notification outbox and preferences.
 * Only OS presentation is mocked. This does NOT qualify signed macOS alerts.
 * RI_DESKTOP_PACKAGE=release/desktop/mac-arm64/Ri.app pnpm exec tsx desktop/notifications-smoke.ts */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Notification } from 'electron';
import { acceptance, api, eventually } from './acceptance-fixture';
import { serviceRequest, type ServiceSession } from '../src/lib/service/client';

interface PresentationFixture { shown: Notification[]; mode: 'show' | 'fail' }
type FixtureGlobal = typeof globalThis & { riNotificationAcceptance: PresentationFixture };
interface Channel { id: string; enabled: boolean; events: string[] }
interface Delivery { id: string; status: string; attempts: number; receipt: string | null; lastError: string | null }

void acceptance('notifications-smoke', async fixture => {
  const page = await fixture.launch();
  const app = fixture.app!;
  assert.equal(await page.evaluate(() => typeof window.riDesktop?.notifications), 'function', 'Build a package containing the native notification bridge first');
  const hostSupported = await app.evaluate(({ Notification }) => Notification.isSupported());
  await app.evaluate(({ Notification }) => {
    const state: PresentationFixture = { shown: [], mode: 'show' };
    (globalThis as FixtureGlobal).riNotificationAcceptance = state;
    Notification.isSupported = () => true;
    // Keep native history private. The assertions below concern only alerts
    // created by this isolated installation during the test.
    Notification.getHistory = async () => [];
    Notification.prototype.show = function () {
      state.shown.push(this);
      queueMicrotask(() => state.mode === 'show' ? this.emit('show') : this.emit('failed', {}, 'Injected operating-system rejection'));
    };
  });
  const presented = () => app.evaluate(() => (globalThis as FixtureGlobal).riNotificationAcceptance.shown.map(notification => ({ id: notification.id, title: notification.title, body: notification.body })));
  const deliveries = (): Delivery[] => {
    const db = new Database(path.join(fixture.root, 'data.db'), { readonly: true, fileMustExist: true });
    try { return db.prepare('SELECT id, status, attempts, provider_message_id AS receipt, last_error AS lastError FROM notification_deliveries ORDER BY id').all() as Delivery[]; }
    finally { db.close(); }
  };
  const channel = async () => (await api<{ channels: Channel[] }>(page, '/api/notifications/channels')).channels.find(channel => channel.id.startsWith('desktop:'))!;

  // A normal owner client does not have the private desktop capability. The
  // trusted main frame receives that capability through session interception,
  // so use an independent pinned HTTPS client to test this boundary.
  const session = await serviceRequest<ServiceSession>('/session');
  const ownerOnlyStatus = await new Promise<number | undefined>((resolve, reject) => {
    const request = https.get(`${fixture.origin}/api/desktop/notifications`, {
      ca: fs.readFileSync(path.join(fixture.root, '.config/tls/ca/ca.crt')),
      headers: { authorization: `Bearer ${session.token}` },
    }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    request.on('error', reject);
    request.setTimeout(5000, () => request.destroy(new Error('Owner-only request timed out')));
  });
  assert.equal(ownerOnlyStatus, 403);
  assert.equal(await page.evaluate(async () => {
    try { await window.riDesktop!.notifications!('claim' as never); return 'accepted'; }
    catch { return 'rejected'; }
  }), 'rejected');
  fixture.check('Ordinary owner client cannot claim desktop delivery and renderer IPC actions are narrow');

  await fixture.navigate('/?settings=notifications');
  await page.getByRole('button', { name: 'Enable desktop notifications', exact: true }).click();
  await page.getByRole('button', { name: 'Disable desktop notifications', exact: true }).waitFor();
  const enabled = await channel();
  assert(enabled.enabled);
  assert(enabled.events.includes('execution.finished'));
  // Actual settings routing preference, persisted through the ordinary API.
  const finishedEvent = page.getByRole('row').filter({ hasText: 'Execution finished' }).getByRole('checkbox');
  await finishedEvent.click();
  await eventually(async () => !(await channel()).events.includes('execution.finished'), 'routing toggle saved');
  await eventually(async () => !(await finishedEvent.isChecked()), 'routing toggle reflected after settings refresh');
  const selectedEvents = (await channel()).events;
  assert.equal(await page.getByText('For alerts on your phone, enable browser push from Ri on that device.', { exact: true }).count(), 1);
  fixture.check('Settings opt-in, per-event preference, and separate phone push guidance');

  await page.getByRole('button', { name: 'Test', exact: true }).click();
  await eventually(async () => deliveries().length === 1 && deliveries()[0].status === 'sent', 'native show acknowledged in real durable outbox');
  const first = deliveries()[0];
  assert.equal(first.attempts, 1);
  assert(first.receipt);
  const shown = await presented();
  assert.equal(shown.length, 1);
  assert.equal(shown[0].id, `${enabled.id}:${first.id}`);
  assert.equal(shown[0].title, 'Ri notifications are ready');
  fixture.check('Real notify/render/outbox/claim/native-show/ack round trip');

  const history = page.getByRole('region', { name: 'Recent delivery history', exact: true });
  await history.getByRole('button', { name: 'Refresh history', exact: true }).click();
  await history.getByText('The operating system reported showing this alert. This does not confirm it was read.', { exact: true }).waitFor();
  const recorded = await api<{ deliveries: { id: string; status: string; attempts: number }[] }>(page, '/api/notifications/deliveries');
  assert.deepEqual(recorded.deliveries.map(row => ({ id: row.id, status: row.status, attempts: row.attempts })), [{ id: first.id, status: 'sent', attempts: 1 }]);
  assert(!JSON.stringify(recorded).includes(first.receipt!), 'Private presentation receipts must not appear in the history API');
  fixture.check('Native delivery appears in shared history with accurate OS confirmation and no private receipt');

  const note = await api<{ id: string }>(page, '/api/notes', 'POST', { title: 'Before notification click', body: 'Temporary notification fixture.' });
  await fixture.navigate(`/note/${note.id}`);
  const latest = 'Saved before the notification opened settings';
  await page.locator('textarea.note-title').fill(latest);
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].minimize();
    (globalThis as FixtureGlobal).riNotificationAcceptance.shown[0].emit('click');
  });
  await page.waitForURL(url => url.pathname === '/' && url.searchParams.get('settings') === 'notifications');
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()), false);
  assert.equal((await api<{ title: string }>(page, `/api/notes/${note.id}`)).title, latest);
  fixture.check('Notification click restores the window and saves pending editor input before navigation');

  await fixture.reload();
  await page.getByRole('button', { name: 'Disable desktop notifications', exact: true }).waitFor();
  // An explicit enable also pumps the real consumer. Old sent rows must not
  // be claimed again after renderer reload and preferences must survive.
  await page.evaluate(() => window.riDesktop!.notifications!('enable'));
  assert.equal((await presented()).length, 1);
  assert.deepEqual((await channel()).events, selectedEvents);
  await page.getByRole('button', { name: 'Disable desktop notifications', exact: true }).click();
  await page.getByRole('button', { name: 'Enable desktop notifications', exact: true }).waitFor();
  assert.equal((await channel()).enabled, false);
  await page.evaluate(async () => {
    let rejected = false;
    try { await window.riDesktop!.notifications!('test'); } catch { rejected = true; }
    if (!rejected) throw new Error('Disabled desktop channel accepted a test alert');
  });
  assert.equal(deliveries().length, 1);
  await page.getByRole('button', { name: 'Enable desktop notifications', exact: true }).click();
  await page.getByRole('button', { name: 'Disable desktop notifications', exact: true }).waitFor();
  assert.deepEqual((await channel()).events, selectedEvents);
  fixture.check('No duplicate delivery after renderer reload, durable disable, and preference preservation on re-enable');

  await app.evaluate(() => { (globalThis as FixtureGlobal).riNotificationAcceptance.mode = 'fail'; });
  await page.getByRole('button', { name: 'Test', exact: true }).click();
  await eventually(async () => deliveries().length === 2 && deliveries()[1].status === 'failed', 'OS failure acknowledged in durable outbox');
  assert.match(deliveries()[1].lastError ?? '', /Injected operating-system rejection/);
  const deliveryError = page.getByRole('alert').filter({ hasText: 'operating system could not show' });
  await deliveryError.waitFor();
  await history.getByRole('button', { name: 'Refresh history', exact: true }).click();
  await history.getByRole('list', { name: 'Recent notification deliveries' }).getByText('Failed', { exact: true }).waitFor();
  assert(!(await history.innerText()).includes('Injected operating-system rejection'), 'History must not display raw provider failures');
  await deliveryError.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(fixture.base, 'notification-failure.png') });
  fixture.check('OS rejection is persisted as failed and visible in settings');
  await page.getByRole('button', { name: 'Disable desktop notifications', exact: true }).click();
  await page.getByRole('button', { name: 'Enable desktop notifications', exact: true }).waitFor();
  fixture.report.hostReportedSupport = hostSupported;
  fixture.report.deliveryIds = deliveries().map(row => row.id);
  fixture.report.limits = ['Notification.show and OS history/support were mocked. Actual signed OS alert display, sound, notification-center history and OS click delivery still require platform qualification.'];
  await page.getByRole('heading', { name: 'Desktop notifications', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(fixture.base, 'notifications.png') });
}).catch(error => { console.error(error); process.exitCode = 1; });
