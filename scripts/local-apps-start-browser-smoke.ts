/** Start the distributed prebuilts through Ri, using only disposable records. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium, type Page, type Frame } from 'playwright-core';

async function guest(page: Page, name: string): Promise<Frame> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const errors = (await page.locator('div[role="alert"]').filter({
      has: page.getByRole('button', { name: /^(Retry|Reopen view)$/ }),
    }).allTextContents()).filter(text => text.trim());
    assert(!errors.length, `App failed: ${errors.join(' ')}`);
    for (const frame of page.frames()) {
      if (!frame.parentFrame() || frame.isDetached()) continue;
      const ready = name === 'Finances'
        ? frame.getByRole('heading', { name, exact: true })
        : frame.getByRole('textbox', { name: 'Record title' });
      if (await ready.count()) return frame;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`${name} did not open`);
}

async function main() {
  const root = process.env.RI_ROOT;
  assert(root && !['ri', 'ri-dev', 'ri-test'].some(name => path.resolve(root) === path.join(os.homedir(), name)), 'Use a disposable Home');
  const config = JSON.parse(await fs.readFile(path.join(root, '.config/config.json'), 'utf8'));
  assert.equal(config.globalSkillEnabled, false);
  const base = process.env.RI_LOCAL_APPS_BROWSER_URL ?? 'http://127.0.0.1:42261';
  assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
  const executablePath = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find(existsSync);
  assert(executablePath, 'Install Chromium for browser qualification');
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`${base}/apps#token=${encodeURIComponent(config.localToken)}`);
    for (const name of ['Personal tracker', 'Finances']) {
      const tile = page.locator('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
      await tile.getByRole('button', { name: /^(Preview app|Continue setup)$/ }).click({ timeout: 120_000 });
      const preview = await guest(page, name);
      if (name === 'Personal tracker') {
        await preview.getByRole('textbox', { name: 'Record title' }).fill('Synthetic preview record');
        await preview.getByRole('button', { name: 'Add', exact: true }).click();
        await preview.getByRole('button', { name: 'Synthetic preview record', exact: true }).waitFor();
      }
      await page.getByRole('button', { name: 'Use app', exact: true }).click();
      await page.getByRole('button', { name: 'Change app', exact: true }).waitFor({ timeout: 60_000 });
      const installed = await guest(page, name);
      if (name === 'Personal tracker') {
        assert.equal(await installed.getByRole('button', { name: 'Synthetic preview record', exact: true }).count(), 0);
        await installed.getByRole('textbox', { name: 'Record title' }).fill('Synthetic installed record');
        await installed.getByRole('button', { name: 'Add', exact: true }).click();
        await installed.getByRole('button', { name: 'Synthetic installed record', exact: true }).waitFor();
      }
      await page.reload();
      await guest(page, name);
      const second = await browser.newPage();
      const url = new URL(page.url());
      url.hash = `token=${encodeURIComponent(config.localToken)}`;
      await second.goto(url.toString());
      const shared = await guest(second, name);
      if (name === 'Personal tracker') await shared.getByRole('button', { name: 'Synthetic installed record', exact: true }).waitFor();
      await second.close();
      await page.screenshot({ path: path.join(root, name === 'Finances' ? 'finances-started.png' : 'tracker-started.png'), fullPage: true });
      console.log(`PASS: ${name} preview, activation, reload and second viewer`);
      await page.locator('header').getByRole('button', { name: 'Apps', exact: true }).click();
    }
    assert.deepEqual(errors, []);
  } catch (error) {
    await page.screenshot({ path: path.join(root, 'app-start-failure.png'), fullPage: true });
    throw error;
  } finally {
    await browser.close();
  }
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message.replace(/(?:#token=|ri_live_)[^\s"']+/g, '[private fixture token]') : 'Startup fixture failed');
  process.exitCode = 1;
});
