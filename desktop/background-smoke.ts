/** Real packaged close/background/reopen/quit lifecycle in a temporary home.
 * OS alert presentation, browser speech capture and the native quit dialog
 * are controlled boundaries. No microphone, provider, real home or login job.
 * RI_DESKTOP_PACKAGE=... pnpm exec tsx desktop/background-smoke.ts */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Notification } from 'electron';
import type { DesktopNotificationStatus } from '../src/lib/notifications/desktop-contract';
import { serviceStatus } from '../src/lib/service/client';
import { acceptance, api, bounded, eventually } from './acceptance-fixture';

interface PresentationState {
  shown: { notification: Notification; hidden: boolean }[];
  dialogs: { message: string; buttons: string[] }[];
  quitResponse: number;
}
type NativeFixture = typeof globalThis & { riBackgroundAcceptance: PresentationState };

// Raw script avoids esbuild keepNames helpers crossing into the renderer.
// The real voice hook and active-input registry still run. No audio is opened.
const speechBoundary = `(() => {
  const state = window.riBackgroundSpeech = { starts: 0, stops: 0, current: null };
  window.SpeechRecognition = class {
    start() { state.starts++; state.current = this; }
    stop() { state.stops++; state.current = null; if (this.onend) this.onend(); }
    abort() { this.stop(); }
  };
  window.webkitSpeechRecognition = window.SpeechRecognition;
})();`;

void acceptance('background-smoke', async fixture => {
  fixture.env.NOTIFIER_USER_ID = 'local';
  const page = await fixture.launch(); const app = fixture.app!;
  const initialService = await serviceStatus(); assert.equal(initialService?.phase, 'running');
  const runtimeErrors: string[] = []; page.on('pageerror', error => runtimeErrors.push(error.message));
  const database = path.join(fixture.root, 'data.db');
  const note = await api<{ id: string }>(page, '/api/notes', 'POST', { title: 'Background lifecycle fixture', body: 'Temporary acceptance note.' });
  const readNote = () => {
    const db = new Database(database, { readonly: true, fileMustExist: true });
    try { return db.prepare('SELECT title, body FROM notes WHERE id = ?').get(note.id) as { title: string; body: string }; }
    finally { db.close(); }
  };
  const delivery = () => {
    const db = new Database(database, { readonly: true, fileMustExist: true });
    try { return db.prepare('SELECT status, attempts FROM notification_deliveries ORDER BY id DESC LIMIT 1').get() as { status: string; attempts: number } | undefined; }
    finally { db.close(); }
  };
  const state = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({ id: window.id, visible: window.isVisible(), minimized: window.isMinimized(), destroyed: window.isDestroyed() })));
  const initial = await state(); assert.equal(initial.length, 1); const windowId = initial[0].id;
  const menu = (id: string) => bounded(app.evaluate(({ Menu, BrowserWindow }, id) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id);
    if (!item || !item.enabled) throw new Error(`Missing or disabled background command: ${id}`);
    item.click(item, BrowserWindow.getAllWindows()[0], {} as never);
  }, id), `native ${id}`, 10_000);
  const background = async () => {
    await eventually(async () => {
      const windows = await state();
      return windows.length === 1 && windows[0].id === windowId && !windows[0].destroyed && (process.platform === 'darwin' ? !windows[0].visible : windows[0].minimized);
    }, 'existing window retained in background');
  };
  const foreground = async () => {
    await eventually(async () => {
      const windows = await state(); return windows.length === 1 && windows[0].id === windowId && windows[0].visible && !windows[0].minimized;
    }, 'same native window restored');
    await page.waitForFunction(() => !document.body.inert);
  };
  const closeWindow = () => bounded(app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()), 'native window close', 10_000);
  const unchangedDocument = async (timeOrigin: number) => {
    assert.equal(page.isClosed(), false);
    const renderer = await page.evaluate(() => ({ timeOrigin: performance.timeOrigin, inert: document.body.inert }));
    assert.equal(renderer.timeOrigin, timeOrigin, 'Background transition reloaded the renderer');
    assert.equal(renderer.inert, false, 'Background transition froze the renderer');
  };
  assert.deepEqual(await app.evaluate(({ Menu }) => ['ri-show-window', 'ri-hide-window', 'ri-notifications', 'ri-quit'].filter(id => !Menu.getApplicationMenu()?.getMenuItemById(id))), [], 'Packaged application lacks background commands');

  // No real OS notification appears. Only presentation/permission/history are
  // stubbed, leaving the shared service outbox, claims, timer and ACKs real.
  await app.evaluate(({ Notification, BrowserWindow, dialog }) => {
    const state: PresentationState = { shown: [], dialogs: [], quitResponse: 0 };
    (globalThis as NativeFixture).riBackgroundAcceptance = state;
    Notification.isSupported = () => true;
    Notification.getHistory = async () => [];
    Notification.prototype.show = function () {
      const window = BrowserWindow.getAllWindows()[0];
      state.shown.push({ notification: this, hidden: !window.isVisible() || window.isMinimized() });
      queueMicrotask(() => this.emit('show'));
    };
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = args.at(-1) as { message?: string; buttons?: string[] };
      state.dialogs.push({ message: options.message ?? '', buttons: options.buttons ?? [] });
      return { response: state.quitResponse, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  });

  try {
    await fixture.navigate(`/note/${note.id}`);
    const title = page.locator('textarea.note-title'); await title.waitFor();
    const baseline = await page.evaluate(() => performance.timeOrigin);
    const hiddenTitle = 'Dirty note saved while the window is hidden';
    const hiddenBody = 'The real editor stays mounted and its pending document save completes in the background.';
    await title.fill(hiddenTitle);
    await page.locator('.rich-editor-body[contenteditable="true"]').fill(hiddenBody);
    await closeWindow(); await background();
    await eventually(async () => readNote().title === hiddenTitle && readNote().body.includes(hiddenBody), 'hidden dirty note persisted');
    await unchangedDocument(baseline);
    await closeWindow(); await closeWindow(); await background(); await unchangedDocument(baseline);
    assert.equal((await serviceStatus())?.runId, initialService!.runId);
    fixture.check('Dirty-note close and repeated close retain one live renderer, save title/body, and preserve the service');

    await menu('ri-show-window'); await foreground(); await unchangedDocument(baseline);
    assert.equal(await title.inputValue(), hiddenTitle);
    await menu('ri-hide-window'); await background(); await unchangedDocument(baseline);
    await menu('ri-show-window'); await foreground(); await unchangedDocument(baseline);
    fixture.check('Shared application-menu hide/show restores the same document without inert state');

    await closeWindow(); await background();
    await app.evaluate(({ app }) => { app.emit('activate', {}, false); });
    await foreground(); await unchangedDocument(baseline);
    await closeWindow(); await background();
    const second = spawn(fixture.executable, [], { cwd: fixture.base, env: { ...fixture.env, NODE_ENV: 'production' }, stdio: 'ignore' });
    try {
      const [code, signal] = await bounded(once(second, 'exit'), 'second packaged instance exit', 30_000);
      assert.equal(signal, null); assert.equal(code, 0);
      await foreground(); await unchangedDocument(baseline);
    } finally { if (second.exitCode === null && second.signalCode === null) second.kill('SIGKILL'); }
    fixture.check('Activate event and real second-instance launch reveal the existing window without another renderer');

    await menu('ri-hide-window'); await background();
    await menu('ri-notifications');
    await page.waitForURL(url => url.pathname === '/' && url.searchParams.get('settings') === 'notifications'); await foreground();
    await page.getByRole('button', { name: 'Enable desktop notifications', exact: true }).click();
    await page.getByRole('button', { name: 'Disable desktop notifications', exact: true }).waitFor();
    const enabled = await page.evaluate(() => window.riDesktop!.notifications('status')) as DesktopNotificationStatus;
    assert(enabled.enabled && enabled.channelId);
    await fixture.navigate(`/note/${note.id}`); await title.waitFor();
    const notificationDocument = await page.evaluate(() => performance.timeOrigin);
    await closeWindow(); await background();
    // Calling the real HTTP route enqueues only. Do not call the bridge's test
    // action here: its immediate pump would not prove the hidden timer works.
    await api(page, '/api/desktop/notifications', 'POST', { action: 'test' });
    await eventually(async () => delivery()?.status === 'sent', 'background native polling acknowledges notification', 20_000);
    assert.equal(delivery()?.attempts, 1);
    const shown = await app.evaluate(() => (globalThis as NativeFixture).riBackgroundAcceptance.shown.map(item => ({ hidden: item.hidden, title: item.notification.title })));
    assert.deepEqual(shown, [{ hidden: true, title: 'Ri notifications are ready' }]);
    await background(); await unchangedDocument(notificationDocument);
    fixture.check('Notification-settings menu restores the window and native notification polling delivers while it is hidden');

    await menu('ri-show-window'); await foreground();
    const clickTitle = 'Notification click retained the latest editor input';
    await title.fill(clickTitle);
    await closeWindow(); await background();
    await app.evaluate(() => {
      (globalThis as NativeFixture).riBackgroundAcceptance.shown[0].notification.emit('click');
    });
    await page.waitForURL(url => url.pathname === '/' && url.searchParams.get('settings') === 'notifications'); await foreground();
    assert.equal(readNote().title, clickTitle);
    assert.equal((await app.evaluate(() => (globalThis as NativeFixture).riBackgroundAcceptance.shown.length)), 1);
    await page.screenshot({ path: path.join(fixture.base, 'background-notification-restored.png') });
    fixture.check('A hidden native notification click restores the same window and uses the save guard before navigation');

    const priorVoice = await api<{ voiceModel: string | null }>(page, '/api/user-state');
    await api(page, '/api/user-state', 'PATCH', { voiceModel: 'web/speech-recognition' });
    await page.addInitScript({ content: speechBoundary });
    await fixture.navigate('/?background-smoke=capture');
    // The desktop bridge initializes before the dashboard's keyboard effect.
    // Wait for its mounted editor and use the real visible, idempotent control.
    // Keyboard behavior is already covered by interaction-smoke.
    await page.locator('aside:visible').first().waitFor();
    await page.locator('[contenteditable="true"][aria-label]:visible').first().waitFor();
    await page.getByRole('button', { name: 'Quick capture', exact: true }).click();
    const capture = page.getByRole('dialog', { name: 'Quick Capture', exact: true }); await capture.waitFor();
    await capture.getByPlaceholder("What's on your mind?").fill('Temporary unsent voice fixture');
    await capture.getByRole('button', { name: 'Voice capture', exact: true }).click();
    await capture.getByPlaceholder('Listening…', { exact: true }).waitFor();
    await closeWindow();
    await eventually(async () => (await app.evaluate(() => (globalThis as NativeFixture).riBackgroundAcceptance.dialogs.length)) === 1, 'active-input close warning');
    const closeWarning = await app.evaluate(() => (globalThis as NativeFixture).riBackgroundAcceptance.dialogs[0]);
    assert.equal(closeWarning.message, 'Keep Ri visible while voice input is active');
    assert.deepEqual(closeWarning.buttons, ['Keep open']);
    await foreground(); await capture.getByPlaceholder('Listening…', { exact: true }).waitFor();
    await menu('ri-quit');
    await eventually(async () => (await app.evaluate(() => (globalThis as NativeFixture).riBackgroundAcceptance.dialogs.length)) === 2, 'active-input quit warning');
    const dialogs = await app.evaluate(() => (globalThis as NativeFixture).riBackgroundAcceptance.dialogs);
    assert.deepEqual(dialogs[1], { message: 'Some changes have not finished saving', buttons: ['Keep open', 'Quit anyway'] });
    await foreground(); await capture.getByPlaceholder('Listening…', { exact: true }).waitFor();
    await capture.getByRole('button', { name: 'Close', exact: true }).click();
    await capture.waitFor({ state: 'hidden' });
    await api(page, '/api/user-state', 'PATCH', { voiceModel: priorVoice.voiceModel });
    fixture.check('Close keeps active voice visible and explicit Quit can be cancelled without freezing the renderer');

    await fixture.navigate(`/note/${note.id}`); await title.waitFor();
    const recoveryDocument = await page.evaluate(() => performance.timeOrigin);
    const [recoveryPage] = await Promise.all([app.waitForEvent('window', { timeout: 15_000 }), menu('ri-recovery')]);
    recoveryPage.on('pageerror', error => runtimeErrors.push(error.message));
    await recoveryPage.getByRole('heading', { name: 'Local installation', exact: true }).waitFor();
    const recoveryId = await app.evaluate(({ BrowserWindow }, mainId) => {
      const secondary = BrowserWindow.getAllWindows().find(candidate => candidate.id !== mainId);
      if (!secondary || secondary.getTitle() !== 'Ri local installation') throw new Error('Recovery secondary window did not open');
      secondary.focus(); return secondary.id;
    }, windowId);
    await bounded(Promise.all([
      recoveryPage.waitForEvent('close', { timeout: 10_000 }),
      app.evaluate(({ Menu, BrowserWindow }, secondaryId) => {
        const secondary = BrowserWindow.fromId(secondaryId);
        const item = Menu.getApplicationMenu()?.getMenuItemById('ri-hide-window');
        if (!secondary || !item?.enabled) throw new Error('Recovery Close Window command is unavailable');
        // Use the native focused-window argument. The ordinary helper above
        // intentionally supplies the primary window for its other checks.
        item.click(item, secondary, {} as never);
      }, recoveryId),
    ]), 'focused Recovery window close', 15_000);
    await foreground(); await unchangedDocument(recoveryDocument);
    assert.equal(await title.inputValue(), readNote().title);
    fixture.check('Close Window targets the focused Recovery window and leaves the primary visible with the same document');

    await page.screenshot({ path: path.join(fixture.base, 'background-before-quit.png') });
    const finalTitle = 'Explicit Quit saved this final note'; await title.fill(finalTitle);
    await bounded(Promise.all([app.waitForEvent('close', { timeout: 30_000 }), menu('ri-quit')]), 'explicit menu Quit', 35_000);
    fixture.app = undefined; fixture.page = undefined;
    assert.equal(readNote().title, finalTitle);
    const afterQuit = await serviceStatus(); assert.equal(afterQuit?.phase, 'running'); assert.equal(afterQuit?.runId, initialService!.runId);
    assert.deepEqual(runtimeErrors, []);
    fixture.check('Explicit menu Quit saves the final edit and exits the viewer while its shared service remains running');
    fixture.report.limits = ['Application-menu callbacks and a dispatched activate event exercise shared tray/Dock logic. Physical menu-bar/tray icon appearance and OS Dock clicks still require platform qualification.', 'Native Notification.show/history/support, browser SpeechRecognition and the quit confirmation response are mocked OS boundaries. No real alert, microphone or provider was used.'];
    fixture.report.windowId = windowId;
    fixture.report.closeBehavior = process.platform === 'darwin' ? 'hidden' : 'minimized-taskbar-fallback';
  } finally {
    fixture.report.runtimeErrors = runtimeErrors;
    // If an assertion interrupts the controlled active-input scenario, allow
    // AcceptanceFixture's explicit Quit to clean up without a real OS dialog.
    if (fixture.app) await bounded(app.evaluate(() => { (globalThis as NativeFixture).riBackgroundAcceptance.quitResponse = 1; }), 'cleanup quit dialog response', 5000).catch(() => {});
  }
}).catch(error => { console.error(error); process.exitCode = 1; });
