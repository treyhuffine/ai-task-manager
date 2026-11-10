/** Real desktop settings with a disposable Home and no OS preference changes.
 * Run after desktop:build. RI_DESKTOP_PACKAGE selects an existing package. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { acceptance } from './acceptance-fixture';
import { assertSameNativeWindow, nativeWindowSnapshot } from './acceptance-surfaces';

const source = !process.env.RI_DESKTOP_PACKAGE;
void acceptance('settings-tab', async fixture => {
  fixture.env.RI_LOCAL_APPS = '0';
  fixture.env.RI_DESKTOP_RECOVERY_SMOKE = '1';
  const page = await fixture.launch();
  await fixture.navigate('/?settings=this-computer');
  await page.getByRole('region', { name: 'Agents on this computer', exact: true }).getByText('Your agents run on this computer.', { exact: true }).waitFor();
  const before = await nativeWindowSnapshot(fixture.app!);
  const document = await page.evaluate(() => performance.timeOrigin);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await fixture.app!.evaluate(({ Menu, BrowserWindow }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('ri-desktop-preferences');
    if (!item?.enabled) throw new Error('Desktop Settings menu is unavailable');
    item.click(item, BrowserWindow.getAllWindows()[0], {} as never);
  });
  await page.getByRole('dialog', { name: 'This computer', exact: true }).waitFor();
  await page.getByRole('region', { name: 'Agents on this computer', exact: true }).waitFor();
  assertSameNativeWindow(before, await nativeWindowSnapshot(fixture.app!));
  assert.equal(await page.evaluate(() => performance.timeOrigin), document);
  assert.equal((await nativeWindowSnapshot(fixture.app!)).local.filter(view => view.visible).length, 0);
  const status = await page.evaluate(() => window.riDesktop!.deviceSettings!({ type: 'status' }));
  assert.equal(status.role, 'home');
  assert.equal(status.serviceAvailable, true);
  assert.equal('service' in status, false);
  assert.equal('deviceId' in status, false);
  await page.screenshot({ path: path.join(fixture.base, 'settings-tab.png') });
  fixture.check('The native menu opens the in-app tab, reads this computer’s status, and preserves the native window and viewer document');
}, { source, development: source }).catch(error => { console.error(error); process.exitCode = 1; });
