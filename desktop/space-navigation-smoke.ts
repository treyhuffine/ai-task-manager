/** Real Electron navigation out of a team document, using a disposable Home.
 * pnpm desktop:build && pnpm exec tsx desktop/space-navigation-smoke.ts
 * The disconnected gate needs no remote team and mounts the same space layout
 * as a connected team. Without its prepare-close callback, leaving hangs for
 * 15 seconds and opens a false unsaved-changes dialog. */
import assert from 'node:assert/strict';
import { acceptance } from './acceptance-fixture';

type GuardDiagnostics = typeof globalThis & { spaceGuardDialogs: string[] };
void acceptance('desktop-space-navigation', async fixture => {
  const page = await fixture.launch();
  // Compile this route before timing the native navigation. A cold Next dev
  // build can take longer than the viewer guard's navigation test deadline.
  await page.evaluate(async () => {
    const response = await fetch('/space/disconnected-team');
    if (!response.ok) throw new Error(`Space page returned ${response.status}`);
    await response.text();
  });
  await fixture.app!.evaluate(({ dialog }) => {
    const state = globalThis as GuardDiagnostics;
    state.spaceGuardDialogs = [];
    const original = dialog.showMessageBox.bind(dialog);
    dialog.showMessageBox = ((...args: Parameters<typeof dialog.showMessageBox>) => {
      const options = args.at(-1) as { message: string };
      state.spaceGuardDialogs.push(options.message);
      return original(...args);
    }) as typeof dialog.showMessageBox;
  });
  await fixture.navigate('/space/disconnected-team');
  await page.getByRole('button', { name: 'Open Settings, Teams' }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.riAuthority), 'space');
  await page.getByRole('button', { name: 'Open Settings, Teams' }).click();
  await page.waitForURL(url => url.pathname === '/' && url.searchParams.get('settings') === 'teams');
  await page.waitForFunction(() => document.documentElement.dataset.riAuthority === 'personal');
  assert.deepEqual(await fixture.app!.evaluate(() => (globalThis as GuardDiagnostics).spaceGuardDialogs), []);
  fixture.check('Team recovery button returns to My Ri through the real native navigation guard without a false save warning');
  await fixture.navigate('/space/disconnected-team');
  await page.getByRole('button', { name: 'Open Settings, Teams' }).waitFor();
  await fixture.quit();
  fixture.check('Native Quit succeeds from a clean team document');
}, { source: true, development: true }).catch(error => { console.error(error); process.exitCode = 1; });
