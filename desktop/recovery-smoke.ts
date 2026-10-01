import { writeDesktopHomeIntent } from '../src/lib/service/desktop-role-intent';
/** Real native failed-service recovery and advanced local association. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import electron from 'electron';
import { _electron, type ElectronApplication } from 'playwright-core';
import { waitForHome } from './first-run';
import { demoEnvironment } from './config';
import { installationEnvironment, localInstallation } from './installation';
import { ensureService, serviceStatus, stopService } from '../src/lib/service/client';
import { installedRuntime } from '../src/lib/service/runtime';
import { desktopPackageLayout } from './package-layout';

const repo = path.resolve(__dirname, '..');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-recovery-smoke-'));
const root = path.join(base, 'home');
const advanced = localInstallation({ root: path.join(base, 'associated'), database: path.join(base, 'separate.db'), config: path.join(base, 'settings'), work: path.join(base, 'work') });
const testHome = path.join(base, 'os-home');
fs.mkdirSync(testHome, { recursive: true });
const desktopState = path.join(base, 'desktop-state');
const env = demoEnvironment(repo, { ...process.env, HOME: testHome, XDG_CONFIG_HOME: path.join(testHome, '.config'), RI_DESKTOP_STATE_DIR: desktopState, RI_DESKTOP_ROOT: root, RI_INSTALL_ROOT: path.join(base, 'runtime'), RI_DESKTOP_NODE: process.execPath }, 'production');
const packageFile = process.env.RI_DESKTOP_PACKAGE;
const executablePath = packageFile ? desktopPackageLayout(packageFile).executable : electron as unknown as string;
const args = packageFile ? [] : [path.join(repo, 'dist/desktop/main.cjs')];
let instance: ElectronApplication | undefined;
function select(environment: NodeJS.ProcessEnv) { for (const name of ['RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_WORK_DIR']) delete process.env[name]; Object.assign(process.env, environment); }
async function close() {
  if (!instance) return;
  const current = instance; instance = undefined;
  await Promise.all([current.waitForEvent('close', { timeout: 30_000 }), current.evaluate(({ app }) => app.quit())]);
}
async function mainSmoke() {
try {
  select(env);
  writeDesktopHomeIntent();
  fs.mkdirSync(path.join(root, '.config'), { recursive: true });
  fs.writeFileSync(path.join(root, '.config/local-service.json'), JSON.stringify({ version: 1, port: 0 }));
  instance = await _electron.launch({ executablePath, args, env: { ...env, RI_DESKTOP_SMOKE: '1', RI_DESKTOP_RECOVERY_SMOKE: '1' }, timeout: 240_000 });
  const main = await instance.firstWindow();
  const recovery = instance.windows().find(page => page !== main) ?? await instance.waitForEvent('window', { predicate: page => page !== main, timeout: 240_000 });
  recovery.on('console', message => { if (message.type() === 'error') console.error('[recovery-ui]', message.text()); });
  console.info('Recovery window loaded');
  await recovery.getByText('Service needs attention', { exact: true }).waitFor();
  await recovery.getByRole('button', { name: 'Recover service', exact: true }).waitFor();
  assert.match(await recovery.locator('#reason').innerText(), /endpoint configuration/);
  assert.equal(await recovery.evaluate(() => typeof (window as unknown as { require?: unknown }).require), 'undefined');
  assert.equal(await recovery.evaluate(() => typeof window.riDesktop), 'undefined');
  select(env);
  const failed = await serviceStatus();
  assert.equal(failed?.phase, 'failed');
  assert.equal(await main.locator('body').innerText().then(text => text.includes('Starting Ri')), true);
  // Read-only verification must not create a mistyped path.
  const absent = path.join(base, 'does-not-exist');
  await recovery.locator('#root').fill(absent);
  await recovery.getByRole('button', { name: 'Verify installation', exact: true }).click();
  await recovery.locator('#error').filter({ hasText: /ENOENT/ }).waitFor();
  assert.equal(fs.existsSync(absent), false);
  // Repair only the deliberately broken fixture and exercise actual UI recovery.
  fs.unlinkSync(path.join(root, '.config/local-service.json'));
  await instance.evaluate(({ dialog }) => {
    const original = dialog.showMessageBox;
    dialog.showMessageBox = ((...parameters: unknown[]) => {
      const options = parameters.at(-1) as { message?: string };
      if (options.message === 'Recover the background service?') return Promise.resolve({ response: 1, checkboxChecked: false });
      return original(...parameters as Parameters<typeof original>);
    }) as typeof original;
  });
  await recovery.getByRole('button', { name: 'Recover service', exact: true }).click();
  await recovery.waitForFunction(() => !(document.getElementById('retry') as HTMLButtonElement).disabled, { timeout: 40_000 });
  assert.equal(await recovery.locator('#error').innerText(), '');
  await waitForHome(main);
  const running = await serviceStatus();
  assert.equal(running?.phase, 'running'); assert.notEqual(running?.runId, failed?.runId);
  for (const dir of [advanced.root, advanced.config, advanced.work]) fs.mkdirSync(dir, { recursive: true });
  const database = new Database(path.join(root, 'data.db'), { readonly: true });
  try { await database.backup(advanced.database); } finally { database.close(); }
  const associationEnv = demoEnvironment(repo, { ...env, ...installationEnvironment(advanced) }, 'production');
  select(associationEnv);
  // Deliberately start an existing source/CLI owner. Connecting a packaged
  // viewer must not select the bundled runtime for its future restarts.
  await ensureService({ repo, node: process.execPath, env: { ...associationEnv, RI_RUNTIME_REPO: repo } });
  assert.equal(installedRuntime(), null);
  select(env);
  await recovery.getByText('Separate database, configuration or work folders', { exact: true }).click();
  for (const [key, value] of Object.entries(advanced)) await recovery.locator(`#${key}`).fill(value);
  await recovery.getByRole('button', { name: 'Verify installation', exact: true }).click();
  await recovery.getByRole('button', { name: 'Use verified installation', exact: true }).waitFor({ state: 'visible' });
  await recovery.waitForFunction(() => !(document.getElementById('use') as HTMLButtonElement).disabled);
  assert.match(await recovery.locator('#inspection').innerText(), /Ready to connect/);
  await recovery.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await recovery.getByText('Service running', { exact: true }).waitFor();
  await recovery.screenshot({ path: path.join(base, 'recovery.png'), fullPage: true });
  let savedSelectionVerified = false;
  {
    await instance.evaluate(({ app, dialog }) => {
      // Playwright owns the replacement launch, so it can track and clean up
      // both processes. Exercise the real selection/save/quit path first.
      app.relaunch = () => {};
      const original = dialog.showMessageBox;
      dialog.showMessageBox = ((...parameters: unknown[]) => {
        const options = parameters.at(-1) as { message?: string };
        if (options.message === 'Use this local installation?') return Promise.resolve({ response: 1, checkboxChecked: false });
        return original(...parameters as Parameters<typeof original>);
      }) as typeof original;
    });
    await Promise.all([instance.waitForEvent('close', { timeout: 30_000 }), recovery.getByRole('button', { name: 'Use verified installation', exact: true }).click()]);
    instance = undefined;
    const saved = JSON.parse(fs.readFileSync(path.join(desktopState, packageFile ? 'desktop-installation.json' : 'installation.json'), 'utf8'));
    assert.deepEqual(saved.identity, advanced);
    savedSelectionVerified = true;
  }
  assert.equal((await serviceStatus())?.runId, running?.runId, 'Quitting recovery stopped the shared service');
  instance = await _electron.launch({ executablePath, args: [...args, '--ri-use-saved-installation'],
    env: { ...env, RI_DESKTOP_SMOKE: '1' }, timeout: 240_000 });
  const associatedPage = await instance.firstWindow();
  await waitForHome(associatedPage);
  select(associationEnv);
  const associated = await serviceStatus();
  assert.deepEqual(associated?.identity, advanced);
  assert.equal(associated?.repo, repo);
  assert.equal(installedRuntime(), null, 'Attaching a viewer silently selected a different runtime');
  assert.equal(fs.existsSync(path.join(advanced.root, 'data.db')), false, 'Desktop created an unintended second database');
  assert.equal(await associatedPage.evaluate(async () => (await fetch('/api/user-state')).status), 200);
  await close();
  assert.equal((await serviceStatus())?.runId, associated?.runId);
  console.info(JSON.stringify({ passed: true, failedServiceRecovered: true, advancedIdentity: advanced, savedSelectionVerified, guiQuitPreservesService: true, artifacts: base }, null, 2));
} finally {
  await close().catch(() => {});
  for (const environment of [env, demoEnvironment(repo, { ...env, ...installationEnvironment(advanced) }, 'production')]) {
    select(environment); await stopService().catch(() => {});
  }
}
}
void mainSmoke().catch(error => { console.error(error); process.exitCode = 1; });
