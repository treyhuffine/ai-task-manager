/** Source Electron + real Next dev sign-in, including a rejected request and
 * retry without replacing the Home or restarting its healthy background owner. */
import assert from 'node:assert/strict';
import type { BrowserWindow } from 'electron';
import type { Page } from 'playwright-core';
import { waitForHome } from './first-run';
import { acceptance, api, eventually } from './acceptance-fixture';
import { serviceStatus } from '../src/lib/service/client';

void acceptance('development-viewer', async fixture => {
  fixture.env.RI_DESKTOP_RECOVERY_SMOKE = '1';
  const page = await fixture.launchRaw();
  const nativeWindow = await fixture.app!.browserWindow(page);
  await nativeWindow.evaluate((window: BrowserWindow) => {
    const session = window.webContents.session;
    const original = session.fetch.bind(session);
    let rejectOnce = true;
    session.fetch = async (url, options) => {
      if (rejectOnce && new URL(typeof url === 'string' ? url : url.url).pathname === '/api/session') {
        rejectOnce = false;
        return new Response('Untrusted upstream failure body', { status: 500 });
      }
      return original(url, options);
    };
  });
  let setup: Page | undefined;
  await eventually(async () => {
    setup = fixture.app!.windows().find(window => window.url().includes('Ri%20on%20this%20device'));
    return !!setup;
  }, 'first-run local setup');
  await setup!.getByRole('button', { name: 'Use this device as Home', exact: true }).click();
  let recovery: Page | undefined;
  await eventually(async () => {
    recovery = fixture.app!.windows().find(window => window.url().includes('Ri%20local%20installation'));
    return !!recovery;
  }, 'local recovery window after rejected sign-in');
  await recovery!.waitForFunction(() => document.getElementById('reason')?.textContent?.includes('HTTP 500'));
  const reason = await recovery!.locator('#reason').innerText();
  assert.match(reason, /local Ri service/);
  assert.doesNotMatch(reason, /Connect this device again|credential|Untrusted upstream/);
  const before = await serviceStatus();
  assert.equal(before?.phase, 'running');
  fixture.check('An HTTP 500 sign-in failure reports the server error without asking to pair again');
  await recovery!.getByRole('button', { name: 'Connect or retry startup', exact: true }).click();
  await waitForHome(page);
  fixture.origin = new URL(page.url()).origin;
  const home = await api<{ id: string }>(page, '/api/home');
  assert(home.id);
  assert.equal((await serviceStatus())?.runId, before?.runId);
  fixture.check('Retry signs in through the real dev API and cookie without replacing the running Home');
  await api(page, '/api/user-state', 'PATCH', { onboardedAt: new Date().toISOString() });
  await fixture.navigate('/');
  await page.locator('aside:visible').first().waitFor();
  await fixture.quit();
  await fixture.launch();
  assert.equal((await api<{ id: string }>(fixture.page!, '/api/home')).id, home.id);
  assert.equal((await serviceStatus())?.runId, before?.runId);
  fixture.check('Reopening source Electron signs into the same background dev Home');
}, { source: true, development: true, chooseHome: false }).catch(error => { console.error(error); process.exitCode = 1; });
