/** Packaged keyboard, editor, navigation, attachment download and reload check.
 * RI_DESKTOP_PACKAGE=release/desktop/mac-arm64/Ri.app pnpm exec tsx desktop/interaction-smoke.ts */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Attachment } from '../src/db/types';
import { acceptance, api, eventually, hotkey } from './acceptance-fixture';

interface NativeDownloadState { phase: string; fileName?: string; totalBytes?: number; receivedBytes?: number; url?: string }
type DownloadFixtureGlobal = typeof globalThis & { riDownloadAcceptance: NativeDownloadState };

void acceptance('interaction-smoke', async fixture => {
  const page = await fixture.launch();
  const app = fixture.app!;

  await hotkey(page, 'search');
  // cmdk's dialog wrapper has no box. Its fixed-position input is the
  // visible control, so checking wrapper dimensions would be misleading.
  await page.getByRole('combobox').waitFor();
  await page.getByRole('combobox').fill('> Create note');
  await page.getByRole('option', { name: 'Create note' }).click();
  const title = page.locator('textarea.note-title');
  await title.waitFor();
  const initialTitle = 'Desktop acceptance keyboard note';
  await title.fill(initialTitle);
  const body = 'A real editor change saved while navigating from the slideout.';
  await page.locator('.rich-editor-body[contenteditable="true"]').fill(body);
  // Navigate before the 500ms debounce. The destination must retain both
  // patches across the slideout unmount and full-page editor mount.
  await hotkey(page, 'openFullPage');
  await page.waitForURL(url => /^\/note\/[^/]+$/.test(url.pathname));
  const id = new URL(page.url()).pathname.split('/').at(-1)!;
  await eventually(async () => {
    const note = await api<{ title: string; body: string }>(page, `/api/notes/${id}`);
    return note.title === initialTitle && note.body.includes(body);
  }, 'slideout title/body persisted after full-page shortcut');
  assert.equal(await title.inputValue(), initialTitle);
  assert((await page.locator('.rich-editor-body').innerText()).includes(body));
  fixture.check('Search palette, create note, editor body, and open-full-page shortcut save');

  // Exercise the native reload operation used by the View menu, including its
  // beforeunload save guard. Chromium may cancel the first reload while a save
  // is pending. A clean second reload must still display the acknowledged edit.
  const reloadTitle = 'Saved across the native Reload menu';
  await title.fill(reloadTitle);
  assert(await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.some(item => item.submenu?.items.some(child => child.role === 'reload'))), 'Native Reload menu item missing');
  // Playwright's CDP keyboard driver does not dispatch macOS menu selectors.
  // Calling the BrowserWindow operation retains Electron's native unload path.
  const nativeReload = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.reload());
  await nativeReload();
  await eventually(async () => (await api<{ title: string }>(page, `/api/notes/${id}`)).title === reloadTitle, 'pending native reload edit saved');
  await page.waitForFunction(() => !Object.keys(localStorage).some(key => key.startsWith('ri:document-draft:v1:')));
  const previousDocument = await page.evaluate(() => performance.timeOrigin);
  await nativeReload();
  await page.waitForFunction(prior => performance.timeOrigin !== prior, previousDocument);
  await page.waitForFunction(platform => document.documentElement.dataset.riDesktop === platform, process.platform);
  await title.waitFor();
  assert.equal(await title.inputValue(), reloadTitle);
  fixture.check('Native BrowserWindow reload retains the most recent title and reloads after save');

  await page.locator('[contenteditable="true"][aria-label]').waitFor();
  await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows()[0].show(); if (process.platform === 'darwin') app.focus({ steal: true }); BrowserWindow.getAllWindows()[0].focus(); });
  await page.evaluate(() => {
    const events: unknown[] = [];
    (window as unknown as { acceptanceKeys: unknown[] }).acceptanceKeys = events;
    document.addEventListener('keydown', event => events.push({ phase: 'capture', key: event.key, meta: event.metaKey, ctrl: event.ctrlKey, shift: event.shiftKey, prevented: event.defaultPrevented, target: (event.target as HTMLElement)?.tagName }), { capture: true });
    window.addEventListener('keydown', event => events.push({ phase: 'window-bubble', key: event.key, meta: event.metaKey, ctrl: event.ctrlKey, shift: event.shiftKey, prevented: event.defaultPrevented, target: (event.target as HTMLElement)?.tagName }));
  });
  await page.getByRole('button', { name: 'Back', exact: true }).focus();
  await hotkey(page, 'focusChatInput');
  fixture.report.focusShortcut = await page.evaluate(() => ({
    keys: (window as unknown as { acceptanceKeys: unknown[] }).acceptanceKeys,
    visibility: document.visibilityState, hasFocus: document.hasFocus(),
    editors: [...document.querySelectorAll('[contenteditable]')].map(element => ({ editable: element.getAttribute('contenteditable'), label: element.getAttribute('aria-label'), disabled: element.getAttribute('aria-disabled') })),
  }));
  await page.waitForFunction(() => document.activeElement?.matches('[contenteditable="true"][aria-label]'));
  // Record the actual focus/input sequence through Back and capture opening.
  // Keep the first-fill assertion below strict so a focus race cannot be
  // hidden by retrying input against a different DOM state.
  await page.evaluate(() => {
    const trace: unknown[] = [];
    (window as unknown as { captureInteractionTrace: unknown[] }).captureInteractionTrace = trace;
    for (const type of ['focusin', 'focusout', 'beforeinput', 'input']) {
      document.addEventListener(type, event => {
        const target = event.target instanceof HTMLElement ? event.target : null;
        trace.push({
          type, timeOrigin: performance.timeOrigin, at: performance.now(), url: location.href,
          target: target?.tagName, role: target?.getAttribute('role'), label: target?.getAttribute('aria-label'),
          placeholder: target?.getAttribute('placeholder'), editable: target?.getAttribute('contenteditable'),
          value: target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement
            ? target.value.slice(0, 200) : target?.textContent?.slice(0, 200),
          inputType: event instanceof InputEvent ? event.inputType : undefined,
          data: event instanceof InputEvent ? event.data?.slice(0, 200) : undefined,
          stack: type === 'focusin' ? new Error('Focus event').stack?.split('\n').slice(0, 9) : undefined,
        });
        if (trace.length > 160) trace.shift();
      }, { capture: true });
    }
    trace.push({ type: 'before-back', timeOrigin: performance.timeOrigin, at: performance.now() });
  });
  // Return through the actual app control and router history, not a CDP
  // address-bar navigation, which is a different Electron lifecycle.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.waitForURL(url => url.pathname === '/');
  fixture.check('Focus-chat shortcut and full-page Back navigation');
  const rail = page.locator('aside:visible').first();
  const expanded = await rail.getAttribute('data-expanded');
  await hotkey(page, 'toggleRail');
  await eventually(async () => (await rail.getAttribute('data-expanded')) !== expanded, 'rail keyboard toggle');
  await hotkey(page, 'toggleRail');
  await eventually(async () => (await rail.getAttribute('data-expanded')) === expanded, 'rail keyboard restore');
  await hotkey(page, 'quickCapture');
  await page.getByRole('dialog', { name: 'Quick Capture', exact: true }).waitFor();
  await page.getByPlaceholder("What's on your mind?").fill('Keyboard-only capture preview.');
  fixture.report.captureInputTrace = await page.evaluate(() => ({
    events: (window as unknown as { captureInteractionTrace: unknown[] }).captureInteractionTrace,
    timeOrigin: performance.timeOrigin, at: performance.now(),
    active: document.activeElement?.outerHTML.slice(0, 1200),
    capture: document.querySelector('textarea[placeholder="What\'s on your mind?"]')?.outerHTML,
    captureDraftKeys: Object.keys(localStorage).filter(key => key.startsWith('ri:capture-draft:')),
    chatDraftKeys: Object.keys(localStorage).filter(key => key.startsWith('ri:chat-draft:')),
  }));
  const focusTrace = fixture.report.captureInputTrace as { events: { type?: string; placeholder?: string; editable?: string }[] };
  const captureFocused = focusTrace.events.findIndex(event => event.type === 'focusin' && event.placeholder === "What's on your mind?");
  assert(captureFocused >= 0, 'Quick Capture textarea never received focus');
  assert(!focusTrace.events.slice(captureFocused + 1).some(event => event.type === 'focusin' && event.editable === 'true'),
    'A background chat editor took focus after Quick Capture opened');
  assert.equal(await page.getByPlaceholder("What's on your mind?").inputValue(), 'Keyboard-only capture preview.');
  await page.getByPlaceholder("What's on your mind?").fill('');
  await hotkey(page, 'slideoutBack');
  await page.getByRole('dialog', { name: 'Quick Capture', exact: true }).waitFor({ state: 'hidden' });
  await hotkey(page, 'quickCapture');
  assert.equal(await page.getByPlaceholder("What's on your mind?").inputValue(), '');
  await hotkey(page, 'slideoutBack');
  fixture.check('Rail toggle, quick capture input, Escape, and reopening');

  await hotkey(page, 'search');
  await page.getByRole('combobox').fill(reloadTitle);
  await page.getByRole('option').filter({ hasText: reloadTitle }).first().click();
  await title.waitFor();
  assert.equal(await title.inputValue(), reloadTitle);
  await hotkey(page, 'slideoutCloseAll');
  await title.waitFor({ state: 'hidden' });
  fixture.check('Persisted note search, open slideout, and close-all shortcut');

  const content = 'Authenticated native attachment download\n';
  const attachment = await page.evaluate(async content => {
    const form = new FormData();
    form.append('file', new File([content], 'acceptance-download.txt', { type: 'text/plain' }));
    const response = await fetch('/api/attachments', { method: 'POST', body: form, signal: AbortSignal.timeout(15_000) });
    if (response.status !== 201) throw new Error(`Upload failed: ${response.status}`);
    return response.json() as Promise<Attachment>;
  }, content);
  assert.equal(attachment.originalName, 'acceptance-download.txt');
  const destination = path.join(fixture.base, attachment.originalName);
  // Use Electron's real download manager, but send the native save dialog to
  // the fixture directory. No writes to the user's Downloads directory.
  await app.evaluate(({ BrowserWindow }, destination) => {
    const state: NativeDownloadState = { phase: 'waiting' };
    (globalThis as DownloadFixtureGlobal).riDownloadAcceptance = state;
    BrowserWindow.getAllWindows()[0].webContents.session.once('will-download', (_event, item) => {
      item.setSavePath(destination);
      Object.assign(state, { phase: 'started', fileName: item.getFilename(), url: item.getURL() });
      item.once('done', (_event, result) => { Object.assign(state, { phase: result, totalBytes: item.getTotalBytes(), receivedBytes: item.getReceivedBytes() }); });
    });
  }, destination);
  await page.evaluate(attachment => {
    const link = document.createElement('a');
    link.href = `/api/attachments/${attachment.fileName}`;
    link.download = attachment.originalName;
    document.body.append(link); link.click(); link.remove();
  }, attachment);
  // Electron exposes native completion through DownloadItem. Its CDP Page
  // does not emit Playwright's Chromium-browser download event.
  await eventually(async () => {
    const state = await app.evaluate(() => (globalThis as DownloadFixtureGlobal).riDownloadAcceptance);
    if (['cancelled', 'interrupted'].includes(state.phase)) throw new Error(`Native download ${state.phase}`);
    return state.phase === 'completed';
  }, 'native DownloadItem completion');
  const completed = await app.evaluate(() => (globalThis as DownloadFixtureGlobal).riDownloadAcceptance);
  assert.equal(completed.fileName, attachment.originalName);
  assert.equal(completed.receivedBytes, Buffer.byteLength(content));
  assert.equal(new URL(completed.url!).pathname, `/api/attachments/${attachment.fileName}`);
  fixture.report.download = completed;
  await eventually(async () => fs.existsSync(destination), 'native download destination');
  assert.equal(fs.readFileSync(destination, 'utf8'), content);
  fixture.check('Authenticated upload and native attachment download with exact contents');
  fixture.report.exclusions = ['Microphone/voice shortcuts and execution/terminal shortcuts are covered by separate provider/workbench qualification. No provider was started.'];
  await page.screenshot({ path: path.join(fixture.base, 'interaction.png') });
}).catch(error => { console.error(error); process.exitCode = 1; });
