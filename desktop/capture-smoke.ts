/** Packaged capture intake and durable recovery in a disposable installation.
 * Synthetic clipboard/drop events never read the operating system clipboard.
 * Only the final text capture reaches the real stream API, with triage off.
 * No image extraction, microphone, harness or external provider is used.
 * RI_DESKTOP_PACKAGE=... pnpm exec tsx desktop/capture-smoke.ts */
import assert from 'node:assert/strict';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { acceptance, api, bounded, eventually, type AcceptanceFixture } from './acceptance-fixture';
import { serviceStatus } from '../src/lib/service/client';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMw7nj3HwAFRAKpaXmUKgAAAABJRU5ErkJggg==';
interface DialogState { response: number; dialogs: { message: string; buttons: string[] }[] }
type NativeGlobal = typeof globalThis & { riCaptureAcceptance: DialogState };
type RendererGlobal = typeof globalThis & { riCaptureOriginalSetItem?: typeof Storage.prototype.setItem };

async function mockDialogs(fixture: AcceptanceFixture) {
  await fixture.app!.evaluate(({ dialog }) => {
    const state: DialogState = { response: 1, dialogs: [] };
    (globalThis as NativeGlobal).riCaptureAcceptance = state;
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = args.at(-1) as { message?: string; buttons?: string[] };
      state.dialogs.push({ message: options.message ?? '', buttons: options.buttons ?? [] });
      return { response: options.message === 'Ri’s window stopped responding' ? 0 : state.response, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  });
}

async function openCapture(fixture: AcceptanceFixture) {
  await bounded(fixture.app!.evaluate(({ Menu, BrowserWindow }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('ri-quick-capture');
    if (!item?.enabled) throw new Error('Native Quick Capture command is unavailable');
    item.click(item, BrowserWindow.getAllWindows()[0], {} as never);
  }), 'open native capture');
  const capture = fixture.page!.getByRole('dialog', { name: 'Quick Capture', exact: true });
  await capture.waitFor();
  await capture.locator('textarea').waitFor();
  return capture;
}

async function loadedImages(page: Page, names: string[]) {
  await page.waitForFunction(names => names.every(name => [...document.querySelectorAll<HTMLImageElement>('[role="dialog"] img')]
    .some(image => image.alt === name && image.complete && image.naturalWidth > 0)), names);
}

async function captureHasText(page: Page, text: string) {
  await page.waitForFunction(text => document.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea')?.value === text, text);
}

async function streamRows(page: Page, rawText: string) {
  const rows = await api<{ id: string; rawText: string }[]>(page, '/api/stream?limit=1000');
  return rows.filter(row => row.rawText === rawText);
}

void acceptance('capture-smoke', async fixture => {
  let page = await fixture.launch();
  await mockDialogs(fixture);
  await api(page, '/api/stream/autonomy', 'PUT', { mode: 'manual_only' });
  const originalService = await serviceStatus();
  assert.equal(originalService?.phase, 'running');
  const captureText = 'Capture fixture: picker, screenshot paste, and drop. Normal pasted text.';
  let imageRequests = 0;
  await page.route('**/api/capture', route => {
    imageRequests++;
    return route.abort('blockedbyclient');
  });

  try {
    let capture = await openCapture(fixture);
    await capture.locator('textarea').fill('Capture fixture: picker, screenshot paste, and drop. ');
    const ordinaryPaste = await capture.locator('textarea').evaluate(textarea => {
      const data = new DataTransfer();
      data.setData('text/plain', 'Normal pasted text.');
      const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
      textarea.dispatchEvent(event);
      return { prevented: event.defaultPrevented, text: (textarea as HTMLTextAreaElement).value };
    });
    assert.equal(ordinaryPaste.prevented, false, 'Image intake swallowed a normal text paste');
    // Untrusted paste events do not invoke Chromium's native text insertion.
    // Insert that text through the keyboard driver after checking the handler.
    await capture.locator('textarea').press('End');
    await page.keyboard.insertText('Normal pasted text.');
    assert.equal(await capture.locator('textarea').inputValue(), captureText);
    assert.equal(await capture.locator('textarea').getAttribute('maxlength'), '100000');
    fixture.check('Plain-text paste remains unconsumed and the shared capture text limit is exposed');

    await capture.locator('input[type="file"]').setInputFiles({ name: 'picker.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') });
    const imagePaste = await capture.locator('textarea').evaluate((textarea, png) => {
      const data = new DataTransfer();
      data.items.add(new File([Uint8Array.from(atob(png), char => char.charCodeAt(0))], 'pasted-screenshot.png', { type: 'image/png' }));
      data.setData('text/plain', 'An image clipboard payload must not duplicate this text.');
      const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
      textarea.dispatchEvent(event);
      return event.defaultPrevented;
    }, PNG);
    assert.equal(imagePaste, true);
    const imageDrop = await capture.evaluate((dialog, png) => {
      const data = new DataTransfer();
      data.items.add(new File([Uint8Array.from(atob(png), char => char.charCodeAt(0))], 'dropped.png', { type: 'image/png' }));
      dialog.dispatchEvent(new DragEvent('dragenter', { dataTransfer: data, bubbles: true, cancelable: true }));
      dialog.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }));
      const event = new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true });
      dialog.dispatchEvent(event);
      return event.defaultPrevented;
    }, PNG);
    assert.equal(imageDrop, true);
    await loadedImages(page, ['picker.png', 'pasted-screenshot.png', 'dropped.png']);
    assert.equal(await capture.getByRole('img').count(), 3);
    assert.equal(await capture.locator('textarea').inputValue(), captureText);
    assert.equal(imageRequests, 0);
    fixture.check('Picker, synthetic screenshot paste, and image drop stage three loaded previews without uploading or duplicate clipboard text');

    await capture.locator('input[type="file"]').setInputFiles({ name: 'unsupported.pdf', mimeType: 'application/pdf', buffer: Buffer.from('Not an image') });
    await capture.getByText('Only supported image files can be added.', { exact: true }).waitFor();
    await capture.locator('textarea').evaluate(textarea => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'oversized.png', { type: 'image/png' }));
      textarea.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await capture.getByText('Images in a capture must total 20 MiB or less.', { exact: true }).waitFor();
    assert.equal(await capture.getByRole('img').count(), 3);
    const retainedSources = await capture.getByRole('img').evaluateAll(images => images.filter(image => image.getAttribute('alt') !== 'pasted-screenshot.png').map(image => image.getAttribute('src')));
    await capture.getByRole('button', { name: 'Remove image', exact: true }).nth(1).click();
    await capture.getByRole('img', { name: 'pasted-screenshot.png', exact: true }).waitFor({ state: 'hidden' });
    await loadedImages(page, ['picker.png', 'dropped.png']);
    assert.deepEqual(await capture.getByRole('img').evaluateAll(images => images.map(image => image.getAttribute('src'))), retainedSources);
    await capture.getByText('Draft saved on this device.', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(fixture.base, 'capture-images.png') });
    fixture.check('Unsupported and oversized images are rejected without clearing prior content, and removing one preview leaves both remaining images usable');

    await capture.getByRole('button', { name: 'Close', exact: true }).click();
    await capture.waitFor({ state: 'hidden' });
    capture = await openCapture(fixture);
    assert.equal(await capture.locator('textarea').inputValue(), captureText);
    await loadedImages(page, ['picker.png', 'dropped.png']);
    assert.equal((await streamRows(page, captureText)).length, 0);
    fixture.check('Closing and reopening capture retains its unsent text and images without creating a stream record');

    await fixture.reload();
    capture = await openCapture(fixture);
    await capture.getByText('Saved captures on this device', { exact: true }).waitFor();
    assert.equal(await capture.locator('textarea').inputValue(), '');
    assert.equal((await streamRows(page, captureText)).length, 0);
    await capture.getByRole('button', { name: 'Restore capture', exact: true }).click();
    await captureHasText(page, captureText);
    assert.equal(await capture.locator('textarea').inputValue(), captureText);
    await loadedImages(page, ['picker.png', 'dropped.png']);
    await capture.getByText('Draft saved on this device.', { exact: true }).waitFor();
    fixture.check('Native reload offers explicit recovery of durable text and image blobs and never submits them automatically');

    await fixture.quit();
    assert.equal((await serviceStatus())?.runId, originalService!.runId);
    page = await fixture.launch();
    await mockDialogs(fixture);
    assert.equal((await serviceStatus())?.runId, originalService!.runId);
    capture = await openCapture(fixture);
    await capture.getByRole('button', { name: 'Restore capture', exact: true }).click();
    await captureHasText(page, captureText);
    assert.equal(await capture.locator('textarea').inputValue(), captureText);
    await loadedImages(page, ['picker.png', 'dropped.png']);
    await capture.getByText('Draft saved on this device.', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(fixture.base, 'capture-restored.png') });
    fixture.check('GUI Quit and relaunch recover the text and both image blobs while retaining the same background service');

    // Playwright permanently marks the old Page crashed. Observe the app's own
    // recovery in Electron main, then reopen the viewer to attach a fresh driver.
    await page.unrouteAll({ behavior: 'wait' });
    const recovered = await bounded(fixture.app!.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const contents = window.webContents;
      const before = { windowId: window.id, contentsId: contents.id, rendererPid: contents.getOSProcessId() };
      let loaded = false;
      let reason: string | undefined;
      contents.once('did-finish-load', () => { loaded = true; });
      contents.once('render-process-gone', (_event, details) => { reason = details.reason; });
      contents.forcefullyCrashRenderer();
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        if (loaded && !contents.isDestroyed() && !contents.isCrashed()) {
          const ready = await contents.executeJavaScript("document.documentElement.dataset.riDesktop && [...document.querySelectorAll('aside')].some(element => element.getBoundingClientRect().width > 0)") as boolean;
          if (ready) return { before, after: { windowId: window.id, contentsId: contents.id, rendererPid: contents.getOSProcessId() }, reason };
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error(`Capture renderer did not recover: ${JSON.stringify({ loaded, reason })}`);
    }), 'capture renderer crash recovery', 55_000);
    assert.equal(recovered.after.windowId, recovered.before.windowId);
    assert.equal(recovered.after.contentsId, recovered.before.contentsId);
    assert.notEqual(recovered.after.rendererPid, recovered.before.rendererPid);
    assert(recovered.reason);
    fixture.report.crashRecovery = recovered;
    fixture.page = undefined;
    await fixture.quit();
    page = await fixture.launch();
    await mockDialogs(fixture);
    assert.equal((await serviceStatus())?.runId, originalService!.runId);
    capture = await openCapture(fixture);
    assert.equal((await streamRows(page, captureText)).length, 0);
    await capture.getByRole('button', { name: 'Restore capture', exact: true }).click();
    await captureHasText(page, captureText);
    assert.equal(await capture.locator('textarea').inputValue(), captureText);
    await loadedImages(page, ['picker.png', 'dropped.png']);
    fixture.check('Forced renderer crash reloads the existing window and durable recovery still restores text and images without submission');

    await capture.getByRole('button', { name: 'Discard capture', exact: true }).click();
    await captureHasText(page, '');
    assert.equal(await capture.locator('textarea').inputValue(), '');
    assert.equal(await capture.getByRole('img').count(), 0);
    await fixture.reload();
    capture = await openCapture(fixture);
    assert.equal(await capture.locator('textarea').inputValue(), '');
    assert.equal(await capture.getByRole('button', { name: 'Restore capture', exact: true }).count(), 0);
    assert.equal((await streamRows(page, captureText)).length, 0);
    fixture.check('Explicit discard survives reload and never turns the discarded draft into a stream record');

    const discardedRecovery = 'Discard this saved capture directly from the recovery list.';
    await capture.locator('textarea').fill(discardedRecovery);
    await capture.getByText('Draft saved on this device.', { exact: true }).waitFor();
    await fixture.reload();
    capture = await openCapture(fixture);
    await capture.getByRole('button', { name: 'Discard saved capture', exact: true }).click();
    await capture.getByRole('button', { name: 'Restore capture', exact: true }).waitFor({ state: 'hidden' });
    await fixture.reload();
    capture = await openCapture(fixture);
    assert.equal(await capture.getByRole('button', { name: 'Restore capture', exact: true }).count(), 0);
    assert.equal(await capture.locator('textarea').inputValue(), '');
    assert.equal((await streamRows(page, discardedRecovery)).length, 0);
    fixture.check('Discarding directly from the saved-capture list persists without restoring or submitting its content');

    const submitted = 'Only this text is intentionally submitted by capture acceptance.';
    await capture.locator('textarea').fill(submitted);
    await capture.getByText('Draft saved on this device.', { exact: true }).waitFor();
    await capture.getByRole('button', { name: 'Capture', exact: true }).click();
    await capture.waitFor({ state: 'hidden' });
    await eventually(async () => (await streamRows(page, submitted)).length === 1, 'capture text persisted exactly once');
    await fixture.reload();
    capture = await openCapture(fixture);
    assert.equal(await capture.locator('textarea').inputValue(), '');
    assert.equal(await capture.getByRole('button', { name: 'Restore capture', exact: true }).count(), 0);
    assert.equal((await streamRows(page, submitted)).length, 1);
    fixture.check('Successful text capture uses the real stream pipeline exactly once and removes its durable draft across reload');

    const uncertain = 'Capture with an intentionally interrupted response.';
    await page.route('**/api/stream', route => route.request().method() === 'POST' ? route.abort('connectionrefused') : route.continue());
    await capture.locator('textarea').fill(uncertain);
    await capture.getByText('Draft saved on this device.', { exact: true }).waitFor();
    await capture.getByRole('button', { name: 'Capture', exact: true }).click();
    await capture.getByText(/Check your Stream before capturing again/).first().waitFor();
    assert.equal(await capture.locator('textarea').inputValue(), uncertain);
    await page.unroute('**/api/stream');
    await fixture.reload();
    capture = await openCapture(fixture);
    await capture.getByRole('button', { name: 'Restore capture', exact: true }).click();
    await captureHasText(page, uncertain);
    assert.equal(await capture.locator('textarea').inputValue(), uncertain);
    await capture.getByText(/Check your Stream before capturing again/).first().waitFor();
    assert.equal((await streamRows(page, uncertain)).length, 0);
    await capture.getByRole('button', { name: 'Discard capture', exact: true }).click();
    await captureHasText(page, '');
    fixture.check('Interrupted submission retains an uncertain draft across reload, warns before retry, and does not replay the request');

    await page.evaluate(() => {
      (globalThis as RendererGlobal).riCaptureOriginalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith('ri:capture-draft:')) throw new DOMException('Capture acceptance quota failure', 'QuotaExceededError');
        return (globalThis as RendererGlobal).riCaptureOriginalSetItem!.call(this, key, value);
      };
    });
    const unsafe = 'This in-memory draft cannot be written while storage fails.';
    await capture.locator('textarea').fill(unsafe);
    await capture.getByText(/could not.*sav|cannot.*sav|not.*saved|storage.*unavailable|unable.*sav/i).waitFor();
    let unsafeSubmissionRequests = 0;
    await page.route('**/api/stream', route => {
      if (route.request().method() !== 'POST') return route.continue();
      unsafeSubmissionRequests++;
      return route.abort('blockedbyclient');
    });
    await capture.getByRole('button', { name: 'Capture', exact: true }).click();
    await capture.getByRole('alert').filter({ hasText: 'Capture was not sent.' }).waitFor();
    assert.equal(await capture.getByText(/This capture may already have been submitted/).count(), 0);
    assert.equal(await capture.locator('textarea').inputValue(), unsafe);
    assert.equal(unsafeSubmissionRequests, 0, 'Capture sent a POST before its submission marker was durable');
    assert.equal((await streamRows(page, unsafe)).length, 0);
    await page.unroute('**/api/stream');
    await fixture.app!.evaluate(() => { const state = (globalThis as NativeGlobal).riCaptureAcceptance; state.response = 0; state.dialogs = []; });
    await fixture.app!.evaluate(({ app }) => app.quit());
    await eventually(async () => (await fixture.app!.evaluate(() => (globalThis as NativeGlobal).riCaptureAcceptance.dialogs)).some(dialog => dialog.buttons.includes('Quit anyway')), 'storage failure vetoes native Quit');
    assert.equal(await capture.locator('textarea').inputValue(), unsafe);
    assert.equal(await page.evaluate(() => document.body.inert), false);
    await page.screenshot({ path: path.join(fixture.base, 'capture-storage-failure.png') });
    await page.evaluate(() => {
      if ((globalThis as RendererGlobal).riCaptureOriginalSetItem) Storage.prototype.setItem = (globalThis as RendererGlobal).riCaptureOriginalSetItem!;
      delete (globalThis as RendererGlobal).riCaptureOriginalSetItem;
    });
    await capture.locator('textarea').fill(`${unsafe} Storage restored.`);
    await capture.getByText('Draft saved on this device.', { exact: true }).waitFor();
    await capture.getByRole('button', { name: 'Discard capture', exact: true }).click();
    await captureHasText(page, '');
    assert.equal(imageRequests, 0);
    fixture.check('Quota failure prevents submission before POST, cancelled native Quit retains the unsafe draft, and persistence recovers after storage is restored');
    fixture.report.limits = ['Clipboard and drag/drop events use fixture Files, not the OS clipboard.', 'No image was uploaded or extracted. Only text used the real stream pipeline.', 'Storage quota failure is injected into capture metadata writes, not actual disk exhaustion.'];
  } finally {
    if (fixture.page && !fixture.page.isClosed()) await bounded(fixture.page.evaluate(() => {
      if ((globalThis as RendererGlobal).riCaptureOriginalSetItem) Storage.prototype.setItem = (globalThis as RendererGlobal).riCaptureOriginalSetItem!;
      delete (globalThis as RendererGlobal).riCaptureOriginalSetItem;
    }), 'capture storage cleanup', 5_000).catch(() => {});
    if (fixture.app) await bounded(fixture.app.evaluate(() => {
      const state = (globalThis as Partial<NativeGlobal>).riCaptureAcceptance;
      if (state) state.response = 1;
    }), 'capture dialog cleanup', 5_000).catch(() => {});
  }
}).catch(error => { console.error(error); process.exitCode = 1; });
