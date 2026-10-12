/** Verify catalog discovery without installing or executing any included app. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright-core';

async function main() {
  const root = process.env.RI_ROOT;
  assert(root && ![path.join(os.homedir(), 'ri'), path.join(os.homedir(), 'ri-dev'), path.join(os.homedir(), 'ri-test')].includes(path.resolve(root)), 'Use an isolated, disposable Home');
  const config = JSON.parse(await fs.readFile(path.join(root, '.config/config.json'), 'utf8'));
  assert.equal(config.globalSkillEnabled, false);
  const base = process.env.RI_LOCAL_APPS_BROWSER_URL ?? 'http://127.0.0.1:42261';
  assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
  const executablePath = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find(existsSync);
  assert(executablePath, 'Install Chromium for browser qualification');
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${base}/apps#token=${encodeURIComponent(config.localToken)}`);
    await page.getByRole('button', { name: 'Apps', exact: true }).click({ timeout: 120_000 });
    for (const [name, heading] of [['Finances', 'Fictional monthly review'], ['Personal tracker', 'Fictional tracker']]) {
      const tile = page.locator('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
      await tile.getByRole('button', { name: 'Preview app', exact: true }).waitFor({ timeout: 120_000 });
      await tile.getByRole('button', { name: 'Sample data', exact: true }).click();
      await page.getByRole('dialog').getByRole('heading', { name: heading, exact: true }).waitFor();
      await page.keyboard.press('Escape');
    }
    await page.reload();
    await page.getByRole('heading', { name: 'Finances', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Personal tracker', exact: true }).waitFor();
    const saved = await fs.readFile(path.join(root, '.config/local-apps/state.json'), 'utf8').catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (saved) {
      const state = JSON.parse(saved);
      for (const key of ['instances', 'drafts', 'grants', 'schedules']) assert.equal(state[key].length, 0, `Catalog browsing created ${key}`);
    }
    await page.screenshot({ path: path.join(root, 'included-apps.png'), fullPage: true });
    console.log('PASS: Apps button, included Finances and tracker, inert sample data, reload, no installations or grants');
  } finally {
    await browser.close();
  }
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message.replace(/(?:#token=|ri_live_)[^\s"']+/g, '[private fixture token]') : 'Catalog fixture failed');
  process.exitCode = 1;
});
