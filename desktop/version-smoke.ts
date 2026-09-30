/** Exercise API skew through the actual Electron renderer and durable draft UI.
 * RI_DESKTOP_PACKAGE=... pnpm exec tsx desktop/version-smoke.ts */
import assert from 'node:assert/strict';
import path from 'node:path';
import { acceptance, api, bounded, eventually, type AcceptanceFixture } from './acceptance-fixture';
import { apiCompatibilityIssue } from '../src/lib/releases/api-contract';

async function openCapture(fixture: AcceptanceFixture) {
  await bounded(fixture.app!.evaluate(({ Menu, BrowserWindow }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('ri-quick-capture');
    if (!item?.enabled) throw new Error('Native Quick Capture is unavailable');
    item.click(item, BrowserWindow.getAllWindows()[0], {} as never);
  }), 'open native capture');
  const capture = fixture.page!.getByRole('dialog', { name: 'Quick Capture', exact: true });
  await capture.waitFor();
  await capture.locator('textarea').waitFor();
  return capture;
}

void acceptance('version-smoke', async fixture => {
  const page = await fixture.launch();
  const note = await api<{ id: string }>(page, '/api/notes', 'POST', { title: 'Before Home update', body: 'Saved original body.' });
  await fixture.navigate(`/note/${note.id}`);
  const title = page.locator('textarea.note-title');
  await title.waitFor();
  const composer = page.locator('[contenteditable="true"][aria-label]').first();
  await composer.waitFor();
  // Tiptap focuses the body after mount. Do not race that deferred autofocus
  // while Playwright is inserting into the separate title textarea.
  await page.waitForFunction(() => document.activeElement?.classList.contains('rich-editor-body'));
  const retainedTitle = 'An edit retained across an incompatible Home update';
  let upgraded = false;
  let rejected = 0;
  await page.route(`**/api/notes/${note.id}`, async route => {
    if (!upgraded && route.request().method() === 'PATCH') {
      rejected++;
      await route.fulfill({ status: 426, contentType: 'application/json', body: JSON.stringify(apiCompatibilityIssue('1', [2])) });
    } else await route.continue();
  });
  await page.route('**/api/version', async route => {
    if (!upgraded) await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ release: { build: 'acceptance-api-two' }, apiProtocols: [2] }) });
    else await route.continue();
  });
  await title.fill(retainedTitle);
  assert.equal(await title.inputValue(), retainedTitle, 'Initial title input must land in the title, not a mounting editor');
  await composer.fill('Chat draft retained through the Home update.');
  let capture = await openCapture(fixture);
  await capture.locator('textarea').fill('Capture draft retained through the Home update.');
  await capture.getByText('Draft saved on this device.', { exact: true }).waitFor();
  await capture.getByRole('button', { name: 'Close', exact: true }).click();
  await capture.waitFor({ state: 'hidden' });
  const reload = page.getByRole('button', { name: 'Reload with saved drafts' });
  await reload.waitFor();
  await eventually(async () => rejected > 0, 'old API mutation rejected');
  const draftKeys = await page.evaluate(() => Object.keys(localStorage).filter(key => /^ri:(?:document-draft:v1:|chat-draft:|capture-draft:)/.test(key)));
  for (const prefix of ['ri:document-draft:v1:', 'ri:chat-draft:', 'ri:capture-draft:']) assert(draftKeys.some(key => key.startsWith(prefix)), `Missing durable ${prefix} draft`);
  const before = await page.evaluate(() => performance.timeOrigin);
  // A previous successful write is not proof that newer draft bytes can still
  // be persisted. Force the actual browser storage method to fail on retention.
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as unknown as { restoreAcceptanceStorage: () => void }).restoreAcceptanceStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('ri:document-draft:')) throw new DOMException('Acceptance storage full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await reload.click();
  await page.getByRole('status').filter({ hasText: 'Acceptance storage full' }).waitFor();
  assert.equal(await page.evaluate(() => performance.timeOrigin), before);
  try { await eventually(async () => (await title.inputValue()) === retainedTitle, 'pending document title remains visible after rejected save', 5_000); }
  catch (error) {
    fixture.report.pendingDocument = await page.evaluate(id => ({
      title: document.querySelector<HTMLTextAreaElement>('textarea.note-title')?.value,
      draft: localStorage.getItem(`ri:document-draft:v1:notes:${id}`),
    }), note.id);
    throw error;
  }
  assert.equal(await page.evaluate(() => document.body.inert), false);
  fixture.check('Unsupported mutations keep document/chat/capture drafts, and storage failure prevents reload');

  await page.evaluate(() => (window as unknown as { restoreAcceptanceStorage: () => void }).restoreAcceptanceStorage());
  // Keep the old request rejected until navigation. The user explicitly
  // chooses to carry durable patches into the new view rather than lose them.
  page.once('framenavigated', () => { upgraded = true; });
  await page.evaluate(() => {
    const events: Array<{ type: string; value: string | boolean }> = [];
    (window as unknown as { versionReloadEvents: typeof events }).versionReloadEvents = events;
    window.addEventListener('beforeunload', event => { events.push({ type: 'beforeunload-prevented', value: event.defaultPrevented }); });
    let last = '';
    new MutationObserver(() => {
      const message = [...document.querySelectorAll('[role="status"]')].map(element => element.textContent).join(' | ');
      if (message !== last && events.length < 100) { last = message; events.push({ type: 'status', value: message }); }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await fixture.app!.evaluate(({ BrowserWindow, dialog }) => {
    const state = { prevented: 0, prepareClose: 0, navigations: [] as Array<{ event: string; path: string }>, dialogs: [] as string[], loadErrors: [] as string[] };
    (globalThis as unknown as { versionReloadNative: typeof state }).versionReloadNative = state;
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    contents.on('will-prevent-unload', () => { state.prevented++; });
    contents.on('will-navigate', (_event, url) => { state.navigations.push({ event: 'will-navigate', path: new URL(url).pathname }); });
    contents.on('did-start-navigation', (_event, url, inPlace, mainFrame) => { if (mainFrame) state.navigations.push({ event: inPlace ? 'start-in-place' : 'start', path: new URL(url).pathname }); });
    contents.on('did-fail-load', (_event, code, description) => { state.loadErrors.push(`${code}: ${description}`); });
    const send = contents.send.bind(contents);
    contents.send = (channel, ...args) => { if (channel === 'desktop:prepare-close') state.prepareClose++; send(channel, ...args); };
    const show = dialog.showMessageBox.bind(dialog);
    dialog.showMessageBox = ((...args: unknown[]) => {
      state.dialogs.push((args.at(-1) as { message?: string }).message ?? '');
      return show(...args as Parameters<typeof show>);
    }) as typeof show;
  });
  const ordinarySave = page.waitForResponse(response => response.url().endsWith(`/api/notes/${note.id}`) && response.request().method() === 'PATCH' && response.status() === 426);
  await page.evaluate(() => {
    window.addEventListener('beforeunload', event => {
      (window as unknown as { ordinaryReloadPrevented: boolean }).ordinaryReloadPrevented = event.defaultPrevented;
    }, { once: true });
    window.location.reload();
  });
  await Promise.all([page.waitForFunction(() => (window as unknown as { ordinaryReloadPrevented?: boolean }).ordinaryReloadPrevented === true), ordinarySave]);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  assert.equal(await page.evaluate(() => performance.timeOrigin), before);
  fixture.check('Ordinary renderer reload remains blocked while unsupported edits are pending');
  await reload.click();
  try { await page.waitForFunction(previous => performance.timeOrigin !== previous, before); }
  finally {
    fixture.report.versionReload = {
      renderer: await page.evaluate(() => (window as unknown as { versionReloadEvents?: unknown }).versionReloadEvents).catch(() => undefined),
      native: await fixture.app!.evaluate(() => (globalThis as unknown as { versionReloadNative?: unknown }).versionReloadNative).catch(() => undefined),
    };
  }
  await title.waitFor();
  assert.equal((await api<{ title: string }>(page, `/api/notes/${note.id}`)).title, 'Before Home update');
  await page.getByRole('button', { name: 'Restore draft', exact: true }).click();
  await eventually(async () => (await api<{ title: string }>(page, `/api/notes/${note.id}`)).title === retainedTitle, 'explicit document draft recovery');
  await eventually(async () => (await composer.innerText()).includes('Chat draft retained through the Home update.'), 'chat draft recovery');
  capture = await openCapture(fixture);
  await capture.getByRole('button', { name: 'Restore capture', exact: true }).click();
  await eventually(async () => (await capture.locator('textarea').inputValue()) === 'Capture draft retained through the Home update.', 'explicit capture draft recovery');
  fixture.check('Explicit version reload crosses native unload protection and restores all three draft kinds');
  await page.screenshot({ path: path.join(fixture.base, 'retained-drafts.png') });
  // Leave no unsent fixture input for the normal shutdown guard.
  await capture.getByRole('button', { name: 'Discard capture', exact: true }).click();
  await capture.getByRole('button', { name: 'Close', exact: true }).click();
  await capture.waitFor({ state: 'hidden' });
  await composer.fill('');
  fixture.report.exclusions = ['Simulates the Home API transition inside a real renderer. Signed N/N-1 installer qualification is separate.'];
}, { source: process.argv.includes('--source') }).catch(error => { console.error(error); process.exitCode = 1; });
