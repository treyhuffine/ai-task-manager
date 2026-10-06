/** Public Playwright/CDP targeting for one native window with two isolated
 * renderers. ElectronApplication.windows() describes renderer targets, not
 * native BrowserWindows, so it cannot establish the single-window contract. */
import assert from 'node:assert/strict';
import type { ElectronApplication, Page } from 'playwright-core';

export type LocalSurface = 'companion' | 'maintenance';

export async function nativeWindowSnapshot(app: ElectronApplication) {
  const windows = await app.evaluate(({ BrowserWindow, WebContentsView }) => BrowserWindow.getAllWindows().map(window => ({
    id: window.id, bounds: window.getBounds(), contentBounds: window.getContentBounds(),
    visible: window.isVisible(), minimized: window.isMinimized(),
    viewer: { id: window.webContents.id, target: window.webContents.getOrCreateDevToolsTargetId(), url: window.webContents.getURL() },
    local: window.contentView.children.filter(view => view instanceof WebContentsView && view.webContents !== window.webContents)
      .map(view => {
        const contents = (view as Electron.WebContentsView).webContents;
        return { id: contents.id, target: contents.getOrCreateDevToolsTargetId(), bounds: view.getBounds(), visible: view.getVisible(),
          separateSession: contents.session !== window.webContents.session };
      }),
  })));
  assert.equal(windows.length, 1, 'Ri must own exactly one native BrowserWindow');
  return windows[0];
}

async function pageForTarget(app: ElectronApplication, target: string): Promise<Page | undefined> {
  for (const page of app.context().pages()) {
    if (page.isClosed()) continue;
    const session = await app.context().newCDPSession(page).catch(() => undefined);
    if (!session) continue;
    try {
      const { targetInfo } = await session.send('Target.getTargetInfo');
      if (targetInfo.targetId === target) return page;
    } catch { /* A disposed local renderer can disappear during a handoff. */ }
    finally { await session.detach().catch(() => {}); }
  }
  return undefined;
}

async function findPage(app: ElectronApplication, select: (state: Awaited<ReturnType<typeof nativeWindowSnapshot>>) => string[], view?: LocalSurface) {
  const deadline = Date.now() + 30_000;
  do {
    for (const target of select(await nativeWindowSnapshot(app))) {
      const page = await pageForTarget(app, target);
      if (!page) continue;
      if (!view || await page.locator(`html[data-ri-local-view="${view}"]`).count().catch(() => 0)) {
        page.setDefaultTimeout(30_000);
        return page;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(`Timed out finding ${view ?? 'main'} renderer attached to Ri's native window`);
}

export function viewerPage(app: ElectronApplication) {
  return findPage(app, state => [state.viewer.target]);
}

export function localPage(app: ElectronApplication, view: LocalSurface) {
  return findPage(app, state => state.local.filter(local => local.visible).map(local => local.target), view);
}

/** The frozen local preload exposes two bridges, but only the active document's
 * action domain may be invoked. Check the actual IPC boundary, not just copy. */
export async function assertLocalIsolation(app: ElectronApplication, page: Page, view: LocalSurface) {
  const state = await nativeWindowSnapshot(app);
  assert.equal(state.local.length, 1, 'Only one local control renderer should be attached');
  assert.notEqual(state.local[0].id, state.viewer.id);
  assert.equal(state.local[0].separateSession, true);
  assert.deepEqual(await page.evaluate(() => ({ desktop: typeof window.riDesktop,
    require: typeof (window as unknown as { require?: unknown }).require })), { desktop: 'undefined', require: 'undefined' });
  await assert.rejects(page.evaluate(async active => {
    const local = window as unknown as { riMaintenance: { request(action: string): Promise<unknown> }; riCompanion: { request(action: string): Promise<unknown> } };
    return (active === 'companion' ? local.riMaintenance : local.riCompanion).request('status');
  }, view), /Untrusted (?:maintenance|companion)/);
}

export function assertSameNativeWindow(before: Awaited<ReturnType<typeof nativeWindowSnapshot>>, after: Awaited<ReturnType<typeof nativeWindowSnapshot>>) {
  assert.equal(after.id, before.id, 'Setup and the app must share the same native window');
  assert.deepEqual(after.bounds, before.bounds, 'Opening local controls must preserve window placement and size');
  assert.deepEqual(after.contentBounds, before.contentBounds, 'Local controls must preserve the title bar and content bounds');
  assert.equal(after.viewer.id, before.viewer.id, 'The authenticated renderer must stay alive');
}
