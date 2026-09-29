/** Packaged native conveniences in one disposable installation. Actual OS
 * shortcut registration and macOS login jobs are mocked. Activity transport
 * is overridden only after testing the real endpoint. No power assertion,
 * harness, microphone, provider account or production home is used.
 * RI_DESKTOP_PACKAGE=... pnpm exec tsx desktop/native-features-smoke.ts */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { DesktopSettingsAction } from '../src/lib/client/desktop-settings';
import type { DesktopActivityData } from '../src/lib/sessions/desktop-activity-contract';
import type { AwakeStatus } from '../src/lib/service/awake-settings';
import { installedRuntime } from '../src/lib/service/runtime';
import { serviceStatus } from '../src/lib/service/client';
import { acceptance, api, bounded, eventually } from './acceptance-fixture';

interface NativeState {
  shortcuts: Map<string, () => void>;
  conflict: string | null;
  shortcutCalls: { action: string; accelerator: string }[];
  login: { openAtLogin: boolean; status: 'enabled' | 'not-registered' | 'requires-approval'; wasOpenedAtLogin: boolean };
  loginApproval: boolean;
  loginCalls: unknown[];
  activity: DesktopActivityData | 'disconnected' | null;
  activityRequests: number;
  dialogResponse: number;
  dialogs: { message: string; buttons: string[] }[];
  preventedReloads: number;
}
type NativeGlobal = typeof globalThis & { riNativeAcceptance: NativeState };

void acceptance('native-features-smoke', async fixture => {
  let page = await fixture.launch();
  await api(page, '/api/stream/autonomy', 'PUT', { mode: 'manual_only' });
  const note = await api<{ id: string }>(page, '/api/notes', 'POST', { title: 'Native feature fixture', body: 'Temporary note.' });
  const cwd = path.join(fixture.base, 'empty-agent'); fs.mkdirSync(cwd);
  const workspace = await api<{ id: string }>(page, '/api/workspaces', 'POST', { name: 'Native menu fixture', cwd, isGit: false, browserEnabled: false });
  // Creation does not dispatch a harness turn. The blank non-git execution is
  // a real, navigable destination without a provider or worktree side effect.
  const session = await api<{ id: string }>(page, `/api/workspaces/${workspace.id}/sessions`, 'POST', { label: 'Needs input acceptance session', harness: 'claude' });
  const originalService = await serviceStatus(); assert.equal(originalService?.phase, 'running');
  await fixture.quit();
  page = await fixture.launch(['--ri-background']); const app = fixture.app!;
  const runtimeErrors: string[] = []; page.on('pageerror', error => runtimeErrors.push(error.message));
  const database = path.join(fixture.root, 'data.db');
  const readNote = () => {
    const db = new Database(database, { readonly: true, fileMustExist: true });
    try { return db.prepare('SELECT title, body FROM notes WHERE id = ?').get(note.id) as { title: string; body: string }; }
    finally { db.close(); }
  };
  const state = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({ id: window.id, visible: window.isVisible(), minimized: window.isMinimized() })));
  const menu = (id: string) => bounded(app.evaluate(({ Menu, BrowserWindow }, id) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id);
    if (!item || !item.enabled) throw new Error(`Missing or disabled native command: ${id}`);
    item.click(item, BrowserWindow.getAllWindows()[0], {} as never);
  }, id), `native ${id}`, 10_000);
  const activityMenu = () => app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('ri-activity-menu')?.submenu?.items.map(item => ({ id: item.id, label: item.label, enabled: item.enabled })) ?? []);
  const settings = (action: DesktopSettingsAction) => bounded(page.evaluate(action => window.riDesktop!.settings(action), action), 'desktop settings IPC');
  const initial = await state(); assert.equal(initial.length, 1); const windowId = initial[0].id;
  const background = () => eventually(async () => {
    const rows = await state(); return rows.length === 1 && rows[0].id === windowId && (process.platform === 'darwin' ? !rows[0].visible : rows[0].minimized);
  }, 'desktop in background');
  const foreground = () => eventually(async () => {
    const rows = await state(); return rows.length === 1 && rows[0].id === windowId && rows[0].visible && !rows[0].minimized;
  }, 'same desktop window visible');

  await background(); await menu('ri-show-window'); await foreground();
  assert.equal((await serviceStatus())?.runId, originalService!.runId);
  fixture.check('Explicit background launch retains its local installation and service, then Show restores the same window');

  // Replace the native APIs before enabling any preference. Startup defaults
  // are off, and enabled preferences are always disabled before reopening.
  await app.evaluate(({ app, globalShortcut, BrowserWindow, dialog }) => {
    const state: NativeState = { shortcuts: new Map(), conflict: null, shortcutCalls: [],
      login: { openAtLogin: false, status: 'not-registered', wasOpenedAtLogin: false }, loginApproval: false, loginCalls: [],
      activity: null, activityRequests: 0, dialogResponse: 1, dialogs: [], preventedReloads: 0 };
    (globalThis as NativeGlobal).riNativeAcceptance = state;
    globalShortcut.register = (accelerator, callback) => {
      state.shortcutCalls.push({ action: 'register', accelerator });
      if (state.conflict === accelerator) return false;
      state.shortcuts.set(accelerator, callback); return true;
    };
    globalShortcut.unregister = accelerator => { state.shortcutCalls.push({ action: 'unregister', accelerator }); state.shortcuts.delete(accelerator); };
    globalShortcut.isRegistered = accelerator => state.shortcuts.has(accelerator);
    app.getLoginItemSettings = (() => ({ ...state.login })) as typeof app.getLoginItemSettings;
    app.setLoginItemSettings = options => {
      state.loginCalls.push(options);
      state.login = { openAtLogin: !!options.openAtLogin && !state.loginApproval,
        status: options.openAtLogin ? state.loginApproval ? 'requires-approval' : 'enabled' : 'not-registered', wasOpenedAtLogin: false };
    };
    // Avoid an interactive cleanup dialog if a later assertion interrupts a
    // save. Actual persistence is asserted independently before this cleanup.
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = args.at(-1) as { message?: string; buttons?: string[] };
      state.dialogs.push({ message: options.message ?? '', buttons: options.buttons ?? [] });
      return { response: state.dialogResponse, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
    const ses = BrowserWindow.getAllWindows()[0].webContents.session;
    const actualFetch = ses.fetch.bind(ses);
    ses.fetch = (input, init) => {
      if (new URL(typeof input === 'string' ? input : input.url).pathname === '/api/desktop/activity' && state.activity !== null) {
        state.activityRequests++;
        if (state.activity === 'disconnected') return Promise.reject(new Error('Controlled activity transport disconnect'));
        return Promise.resolve(new Response(JSON.stringify(state.activity), { headers: { 'content-type': 'application/json' } }));
      }
      return actualFetch(input, init);
    };
  });
  const profile = await app.evaluate(({ app }) => app.getPath('userData'));
  assert(profile.startsWith(fixture.root + path.sep), 'Desktop preferences must stay inside the fixture home');
  const shortcutFile = path.join(profile, 'capture-shortcut.json');

  try {
    const defaults = await settings({ type: 'status' }); assert.equal(defaults.shortcut.enabled, false);
    assert.equal(defaults.login.enabled, false);
    await fixture.navigate(`/note/${note.id}`);
    const title = page.locator('textarea.note-title:visible'); await title.waitFor();
    const url = page.url(); const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    const dirtyTitle = 'My note stays open during native capture';
    const dirtyBody = 'The native capture entry point must preserve this editor and its latest words.';
    await title.fill(dirtyTitle);
    await page.locator('.rich-editor-body[contenteditable="true"]:visible').fill(dirtyBody);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()); await background();
    await menu('ri-quick-capture'); await foreground();
    const capture = page.getByRole('dialog', { name: 'Quick Capture', exact: true }); await capture.waitFor();
    const captureText = 'Capture text through the native application menu.';
    await page.getByPlaceholder("What's on your mind?").fill(captureText);
    await menu('ri-quick-capture'); await menu('ri-quick-capture');
    assert.equal(await capture.count(), 1);
    assert.equal(await page.getByPlaceholder("What's on your mind?").inputValue(), captureText);
    assert.equal(page.url(), url);
    assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin);
    assert.equal(await title.inputValue(), dirtyTitle);
    assert((await page.locator('.rich-editor-body:visible').innerText()).includes(dirtyBody));
    await eventually(async () => readNote().title === dirtyTitle && readNote().body.includes(dirtyBody), 'native capture keeps pending document writes');
    await page.screenshot({ path: path.join(fixture.base, 'native-quick-capture.png') });
    fixture.check('Native capture restores a hidden full-page note without navigation or lost edits, and repeated requests preserve one capture draft');

    // Stage a tiny local image but remove it before submission. This verifies
    // preservation of both kinds of unsent input without invoking extraction.
    await capture.locator('input[type="file"]').setInputFiles({ name: 'native-capture-fixture.png', mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMw7nj3HwAFRAKpaXmUKgAAAABJRU5ErkJggg==', 'base64') });
    await capture.getByRole('img', { name: 'native-capture-fixture.png', exact: true }).waitFor();
    await capture.getByText('Draft saved on this device.', { exact: true }).waitFor();
    await capture.getByRole('button', { name: 'Close', exact: true }).click();
    await capture.waitFor({ state: 'hidden' });
    await menu('ri-quick-capture'); await capture.waitFor();
    assert.equal(await capture.locator('textarea').inputValue(), captureText);
    assert.equal(await capture.getByRole('img', { name: 'native-capture-fixture.png', exact: true }).count(), 1);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()); await background();
    await menu('ri-quick-capture'); await foreground();
    assert.equal(await capture.count(), 1); assert.equal(await capture.locator('textarea').inputValue(), captureText);
    assert.equal(await capture.getByRole('img', { name: 'native-capture-fixture.png', exact: true }).count(), 1);
    assert.equal(page.url(), url); assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin);
    await capture.getByRole('button', { name: 'Remove image', exact: true }).click();
    await capture.getByRole('img', { name: 'native-capture-fixture.png', exact: true }).waitFor({ state: 'hidden' });
    fixture.check('Saved capture text and a staged image survive modal close and close-to-background/reopen without freezing the editor');

    await capture.getByRole('button', { name: 'Capture', exact: true }).click();
    await capture.waitFor({ state: 'hidden' });
    await app.evaluate(() => { (globalThis as NativeGlobal).riNativeAcceptance.dialogResponse = 1; });
    await eventually(async () => {
      const db = new Database(database, { readonly: true, fileMustExist: true });
      try { return (db.prepare('SELECT COUNT(*) AS total FROM stream WHERE raw_text = ? AND source = ? AND media = ?').get(captureText, 'capture', 'text') as { total: number }).total === 1; }
      finally { db.close(); }
    }, 'native capture persisted exactly once through the existing stream pipeline');
    assert.equal(page.url(), url); assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin);
    fixture.check('Text capture submits once through the existing stream API and SQLite with automatic triage disabled');

    const firstShortcut = 'CommandOrControl+Shift+J'; const alternateShortcut = 'CommandOrControl+Alt+J';
    await app.evaluate((_, accelerator) => { (globalThis as NativeGlobal).riNativeAcceptance.conflict = accelerator; }, firstShortcut);
    await assert.rejects(settings({ type: 'shortcut', enabled: true, accelerator: firstShortcut }), /could not be registered|used by another app/i);
    assert.equal((await settings({ type: 'status' })).shortcut.enabled, false);
    await app.evaluate(() => { (globalThis as NativeGlobal).riNativeAcceptance.conflict = null; });
    assert.equal((await settings({ type: 'shortcut', enabled: true, accelerator: firstShortcut })).shortcut.state, 'active');
    assert.deepEqual(JSON.parse(fs.readFileSync(shortcutFile, 'utf8')), { enabled: true, accelerator: firstShortcut });
    await app.evaluate((_, accelerator) => { const callback = (globalThis as NativeGlobal).riNativeAcceptance.shortcuts.get(accelerator); if (!callback) throw new Error('No registered capture callback'); callback(); callback(); }, firstShortcut);
    await capture.waitFor(); assert.equal(await capture.count(), 1);
    assert.equal(page.url(), url); assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin);
    await capture.getByRole('button', { name: 'Close', exact: true }).click();
    const changed = await settings({ type: 'shortcut', enabled: true, accelerator: alternateShortcut });
    assert.equal(changed.shortcut.accelerator, alternateShortcut);
    assert.deepEqual(await app.evaluate(() => [...(globalThis as NativeGlobal).riNativeAcceptance.shortcuts.keys()]), [alternateShortcut]);
    assert.equal((await settings({ type: 'shortcut', enabled: false, accelerator: alternateShortcut })).shortcut.state, 'off');
    assert.deepEqual(await app.evaluate(() => [...(globalThis as NativeGlobal).riNativeAcceptance.shortcuts.keys()]), []);
    assert.deepEqual(JSON.parse(fs.readFileSync(shortcutFile, 'utf8')), { enabled: false, accelerator: alternateShortcut });
    fixture.check('Shortcut conflict is reported without changing preferences, accepted configuration persists, captured native callback opens once, and change/disable unregisters it');

    await menu('ri-quick-capture'); await capture.waitFor();
    const recoveredText = 'This unsent native capture is retained across navigation.';
    await capture.locator('textarea').fill(recoveredText);
    await capture.getByText('Draft saved on this device.', { exact: true }).waitFor();
    await app.evaluate(() => { const state = (globalThis as NativeGlobal).riNativeAcceptance; state.dialogs = []; });
    await menu('ri-desktop-preferences');
    await page.waitForURL(url => url.pathname === '/' && url.searchParams.get('settings') === 'general');
    await page.getByRole('heading', { name: 'Desktop', exact: true }).waitFor();
    await page.waitForFunction(() => !document.body.inert);
    assert.equal((await app.evaluate(() => (globalThis as NativeGlobal).riNativeAcceptance.dialogs)).length, 0);
    await menu('ri-quick-capture'); await capture.waitFor();
    assert.equal(await capture.locator('textarea').inputValue(), '');
    await capture.getByRole('button', { name: 'Restore capture', exact: true }).click();
    await eventually(async () => await capture.locator('textarea').inputValue() === recoveredText, 'native navigation retains a recoverable draft');
    const db = new Database(database, { readonly: true, fileMustExist: true });
    try { assert.equal((db.prepare('SELECT COUNT(*) AS total FROM stream WHERE raw_text = ?').get(recoveredText) as { total: number }).total, 0); }
    finally { db.close(); }
    await capture.getByRole('button', { name: 'Discard capture', exact: true }).click();
    await eventually(async () => await capture.locator('textarea').inputValue() === '', 'explicit discard clears capture');
    await capture.getByRole('button', { name: 'Close', exact: true }).click();
    await fixture.reload();
    await menu('ri-quick-capture'); await capture.waitFor();
    assert.equal(await capture.getByRole('button', { name: 'Restore capture', exact: true }).count(), 0);
    await capture.getByRole('button', { name: 'Close', exact: true }).click();
    fixture.check('Durable capture allows native navigation without a discard prompt, recovers explicitly without submission, and explicit discard survives reload');

    assert.equal((await settings({ type: 'login', enabled: true })).login.enabled, true);
    if (process.platform === 'darwin') {
      await app.evaluate(() => { (globalThis as NativeGlobal).riNativeAcceptance.loginApproval = true; });
      assert.equal((await settings({ type: 'login', enabled: true })).login.state, 'requires-approval');
      await app.evaluate(() => { (globalThis as NativeGlobal).riNativeAcceptance.loginApproval = false; });
    } else {
      const entry = path.join(fixture.env.XDG_CONFIG_HOME, 'autostart/app.ri.desktop.autostart.desktop');
      assert(entry.startsWith(fixture.base + path.sep));
      const contents = fs.readFileSync(entry, 'utf8'); assert(contents.includes('--ri-background')); assert(contents.includes('Hidden=false'));
    }
    assert.equal((await settings({ type: 'login', enabled: false })).login.enabled, false);
    await fixture.navigate('/?settings=general');
    await page.getByRole('heading', { name: 'Desktop', exact: true }).waitFor();
    const shortcutSwitch = page.getByRole('switch', { name: 'Global Quick Capture', exact: true });
    await shortcutSwitch.waitFor();
    assert.equal(await shortcutSwitch.getAttribute('aria-checked'), 'false');
    assert.equal(await page.getByLabel('Keyboard shortcut', { exact: true }).inputValue(), alternateShortcut);
    assert.equal(await page.getByRole('switch', { name: 'Open Ri at login', exact: true }).getAttribute('aria-checked'), 'false');
    await shortcutSwitch.click();
    await eventually(async () => (await shortcutSwitch.getAttribute('aria-checked')) === 'true' && !(await shortcutSwitch.isDisabled()), 'General settings enables the global shortcut');
    assert.equal((await settings({ type: 'status' })).shortcut.state, 'active');
    await page.getByLabel('Keyboard shortcut', { exact: true }).fill('Invalid unsaved shortcut text');
    await shortcutSwitch.click();
    await eventually(async () => (await shortcutSwitch.getAttribute('aria-checked')) === 'false' && !(await shortcutSwitch.isDisabled()), 'Global shortcut can be disabled despite an invalid unsaved field');
    assert.equal((await settings({ type: 'status' })).shortcut.state, 'off');
    assert.deepEqual(await app.evaluate(() => [...(globalThis as NativeGlobal).riNativeAcceptance.shortcuts.keys()]), []);
    assert.deepEqual(JSON.parse(fs.readFileSync(shortcutFile, 'utf8')), { enabled: false, accelerator: alternateShortcut });
    assert.equal(await page.getByLabel('Keyboard shortcut', { exact: true }).inputValue(), alternateShortcut);
    await page.screenshot({ path: path.join(fixture.base, 'native-desktop-settings.png') });
    fixture.check('GUI login supports enable/readback/approval/disable, and General settings can enable then disable the shortcut even with an invalid unsaved shortcut edit');

    const realActivity = await api<DesktopActivityData>(page, '/api/desktop/activity');
    assert.deepEqual({ running: realActivity.running, needsInput: realActivity.needsInput, unread: realActivity.unread }, { running: 0, needsInput: 0, unread: 0 });
    const synthetic: DesktopActivityData = { running: 2, needsInput: 1, unread: 1, attention: 2,
      targets: [{ sessionId: session.id, label: 'Review acceptance session', state: 'needsInput' }, { sessionId: 'unread-fixture', label: 'Unread fixture', state: 'unread' }] };
    await app.evaluate((_, activity) => { (globalThis as NativeGlobal).riNativeAcceptance.activity = activity; }, synthetic);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()); await background();
    await eventually(async () => (await activityMenu()).some(item => item.id === `ri-activity-${session.id}` && item.enabled), 'hidden main-process poll populates activity menu');
    let items = await activityMenu(); assert(items.some(item => item.label.includes('2') && /running/.test(item.label)));
    if (process.platform === 'darwin') assert.equal(await app.evaluate(({ app }) => app.dock!.getBadge()), '2');
    await app.evaluate(() => { (globalThis as NativeGlobal).riNativeAcceptance.activity = 'disconnected'; });
    await eventually(async () => !(await activityMenu()).some(item => item.id === `ri-activity-${session.id}`), 'disconnected activity removes stale targets');
    items = await activityMenu(); assert(items.some(item => /unavailable|unreachable|reconnect|disconnected/i.test(item.label)));
    if (process.platform === 'darwin') assert.equal(await app.evaluate(({ app }) => app.dock!.getBadge()), '');
    await app.evaluate((_, activity) => { (globalThis as NativeGlobal).riNativeAcceptance.activity = activity; }, synthetic);
    await eventually(async () => (await activityMenu()).some(item => item.id === `ri-activity-${session.id}`), 'activity recovers after transport interruption');
    fixture.check('Real owner activity endpoint is readable, hidden main-process polling updates native menu and Dock, disconnect clears stale counts/targets, and reconnect recovers');

    await menu('ri-show-window'); await foreground(); await fixture.navigate(`/note/${note.id}`);
    const finalTitle = 'Activity navigation saved the newest edit'; await page.locator('textarea.note-title:visible').fill(finalTitle);
    await menu(`ri-activity-${session.id}`);
    await page.waitForURL(url => url.pathname === '/' && url.searchParams.get('session') === session.id);
    await eventually(async () => readNote().title === finalTitle, 'activity target navigation saves dirty document');
    assert.equal(new URL(page.url()).origin, fixture.origin);
    assert.equal(await page.evaluate(() => document.body.inert), false);
    fixture.check('Native activity action reaches a real local session through guarded navigation and saves the latest note edit');

    const initialAwake = await api<{ awake: AwakeStatus }>(page, '/api/service/awake');
    assert.equal(initialAwake.awake.enabled, false); assert.equal(initialAwake.awake.phase, 'off');
    const disabledAwake = await api<{ awake: AwakeStatus }>(page, '/api/service/awake', 'PATCH', { enabled: false });
    assert.equal(disabledAwake.awake.enabled, false); assert.equal(disabledAwake.awake.phase, 'off');
    const rejected = await page.evaluate(async () => {
      const response = await fetch('/api/service/awake', { method: 'PATCH', headers: { authorization: 'Bearer invalid-owner', 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) });
      return response.status;
    });
    assert([401, 403].includes(rejected), `Untrusted awake request returned ${rejected}`);
    await fixture.navigate('/?settings=devices');
    await page.getByRole('heading', { name: 'Host availability', exact: true }).waitFor();
    const awakeSwitch = page.getByRole('switch', { name: 'Keep the host awake while plugged in', exact: true });
    await awakeSwitch.waitFor();
    await eventually(async () => !(await awakeSwitch.isDisabled()), 'owner host availability status loads');
    assert.equal(await awakeSwitch.getAttribute('aria-checked'), 'false');
    const runtime = installedRuntime(); assert(runtime);
    const cliEnv: NodeJS.ProcessEnv = { ...fixture.env, NODE_ENV: 'production' };
    const cliState = JSON.parse(execFileSync(runtime.launcher, ['cli', 'service', 'awake', 'status'], { env: cliEnv, encoding: 'utf8', timeout: 30_000 }));
    assert.equal(cliState.awake.enabled, false); assert.equal(cliState.awake.phase, 'off');
    const cliOff = JSON.parse(execFileSync(runtime.launcher, ['cli', 'service', 'awake', 'off'], { env: cliEnv, encoding: 'utf8', timeout: 30_000 }));
    assert.equal(cliOff.awake.enabled, false); assert.equal(cliOff.awake.phase, 'off');
    await page.screenshot({ path: path.join(fixture.base, 'native-host-availability.png') });
    fixture.check('Owner host-availability API, Devices control and packaged CLI agree on off, reject an untrusted request, and disabling never acquires a sleep assertion');

    await fixture.quit();
    assert.equal((await serviceStatus())?.runId, originalService!.runId);
    page = await fixture.launch(['--ri-background']);
    const reopened = await page.evaluate(() => window.riDesktop!.settings({ type: 'status' }));
    assert.equal(reopened.shortcut.enabled, false);
    assert.equal(reopened.shortcut.accelerator, alternateShortcut);
    assert.equal(reopened.shortcut.state, 'off');
    assert.equal(reopened.login.enabled, false);
    assert.equal((await api<{ awake: AwakeStatus }>(page, '/api/service/awake')).awake.phase, 'off');
    assert.equal((await serviceStatus())?.runId, originalService!.runId);
    fixture.check('Explicit Quit and background reopen retain disabled native preferences and the same independently running service');
    assert.deepEqual(runtimeErrors, []);
    fixture.report.limits = [
      'The real capture renderer/API/SQLite pipeline and service/CLI availability readback run in a temporary home. Stream automatic triage is disabled and no harness message is sent.',
      'Global shortcut methods and macOS login APIs are mocked before enabling. Linux only writes an autostart entry in the isolated XDG directory, then disables it. No OS login job is installed.',
      'Native activity uses the real endpoint first, then a narrow main-process fetch override to verify presentation, failure/recovery and navigation without starting a provider. Unit/API tests cover authoritative pending/running/unread classification.',
      'No real sleep inhibitor is enabled. Physical global key delivery, login launching, tray appearance, and power-policy behavior require separate platform qualification.',
    ];
  } finally {
    fixture.report.runtimeErrors = runtimeErrors;
    if (fixture.app) await bounded(fixture.app.evaluate(() => {
      const state = (globalThis as Partial<NativeGlobal>).riNativeAcceptance;
      if (state) state.dialogResponse = 1;
    }), 'cleanup native confirmation response', 5000).catch(() => {});
    // Never leave an enabled shortcut preference for a subsequent fixture
    // reopen after a failed assertion. This is inside the temporary profile.
    if (fs.existsSync(shortcutFile)) {
      const saved = JSON.parse(fs.readFileSync(shortcutFile, 'utf8')) as { enabled: boolean; accelerator: string };
      fs.writeFileSync(shortcutFile, JSON.stringify({ ...saved, enabled: false }), { mode: 0o600 });
    }
  }
}).catch(error => { console.error(error); process.exitCode = 1; });
