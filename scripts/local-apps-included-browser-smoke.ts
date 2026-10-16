/**
 * Native qualification for Travel, Job Search and People on a disposable Home.
 * Synthetic data only. It never connects an account.
 *
 * Prepare a private catalog so the checkout's live catalog stays untouched:
 *
 *   mkdir -p /tmp/ri-included/catalog
 *   cp release/local-apps/catalog/ri-{finance,tracker}.* release/local-apps/dev-catalog/ri-{travel,job-search,people}.* /tmp/ri-included/catalog/
 *   pnpm iso /tmp/ri-included/home --init --port 42273 -- env RI_LOCAL_APPS=1 RI_CHAT_SOURCES=1 \
 *     RI_LOCAL_APPS_CATALOG_DIR=/tmp/ri-included/catalog NEXT_DIST_DIR=.next-included-42273 pnpm dev --port 42273
 *   RI_ROOT=/tmp/ri-included/home RI_LOCAL_APPS_BROWSER_URL=http://127.0.0.1:42273 pnpm exec tsx scripts/local-apps-included-browser-smoke.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type FrameLocator, type Page } from 'playwright-core';

interface Case {
  name: string;
  packageId: string;
  slug: string;
  /** Text from the fictional preview data. */
  preview: string;
  /** The installed, empty app's welcome line. */
  empty: string;
  /** One synthetic record created through the app's own action, and text that shows it. */
  seed: { action: string; input: Record<string, unknown>; shows: string };
  /** A section the app remembers in the URL. */
  section: string;
  /** The app's list route, where every record of the seeded kind appears. */
  list: string;
}
const CASES: Case[] = [
  { name: 'Travel', packageId: 'ri-travel', slug: 'travel', preview: 'Lisbon', empty: 'Bring your next trip together',
    seed: { action: 'save_trip', input: { title: 'Fictional Porto weekend', startDate: '2026-12-04', endDate: '2026-12-06', homeZone: 'America/Denver' }, shows: 'Fictional Porto weekend' }, section: 'Sources', list: '/trips' },
  { name: 'Job Search', packageId: 'ri-job-search', slug: 'job-search', preview: 'Northstar', empty: 'Keep your next opportunity together',
    seed: { action: 'save_opportunity', input: { company: 'Fictional Harbor Labs', role: 'Design systems lead' }, shows: 'Fictional Harbor Labs' }, section: 'Materials', list: '/opportunities' },
  { name: 'People', packageId: 'ri-people', slug: 'people', preview: 'Maya Chen', empty: 'Pick up where you left off',
    seed: { action: 'save_person', input: { name: 'Fictional Ines Duarte' }, shows: 'Fictional Ines Duarte' }, section: 'Sources', list: '/people' },
];

async function main() {
  const root = process.env.RI_ROOT;
  assert(root && ![path.join(os.homedir(), 'ri'), path.join(os.homedir(), 'ri-dev'), path.join(os.homedir(), 'ri-test')].includes(path.resolve(root)), 'Use an isolated, disposable Home');
  const config = JSON.parse(await fs.readFile(path.join(root, '.config/config.json'), 'utf8'));
  assert.equal(config.globalSkillEnabled, false);
  const base = process.env.RI_LOCAL_APPS_BROWSER_URL ?? 'http://127.0.0.1:42273';
  assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
  const only = process.env.RI_INCLUDED_APP;
  const out = path.join(root, 'included-smoke');
  await fs.mkdir(out, { recursive: true });

  async function rpc(name: string, input: unknown = {}, mutation = false) {
    const response = await fetch(`${base}/api/trpc/${name}${mutation ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`}`, {
      method: mutation ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${config.localToken}`, 'Content-Type': 'application/json' },
      ...(mutation ? { body: JSON.stringify(input) } : {}),
    });
    const value = await response.json();
    assert(response.ok && !value.error, `${name}: ${value.error?.message ?? 'Request failed'}`);
    return value.result.data;
  }
  const executablePath = [chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find((file) => file && existsSync(file));
  assert(executablePath, 'Install a Chromium browser for browser qualification');
  // Out-of-process sandboxed frames intermittently hide the nested app frame from automation.
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-features=IsolateSandboxedIframes'] });
  const results: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    page.setDefaultTimeout(30_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const guest = (target: Page = page): FrameLocator => target.frameLocator('iframe[aria-label="App view"]').frameLocator('iframe');
    await page.goto(`${base}/apps#token=${encodeURIComponent(config.localToken)}`);

    for (const app of CASES.filter((item) => !only || item.packageId === only)) try {
      // Library tile: the app's name and a purpose icon instead of a letter.
      await page.goto(`${base}/apps`);
      // Included apps are listed under Discover.
      await page.getByText('Discover', { exact: true }).first().click({ timeout: 120_000 });
      const tile = page.locator('article').filter({ has: page.getByRole('heading', { name: app.name, exact: true }) });
      await tile.waitFor({ timeout: 120_000 });
      assert.equal(await tile.locator('svg').first().count(), 1, `${app.name} tile has no purpose icon`);
      let instance = (await rpc('localApps.list')).instances.find((item: { packageId: string }) => item.packageId === app.packageId);
      const fresh = !instance;
      if (!instance) {
        await tile.getByRole('button', { name: /Preview app|Continue setup/ }).click({ timeout: 120_000 });
        await page.getByRole('button', { name: 'Use app', exact: true }).waitFor({ timeout: 120_000 });
        // The preview runs on its own fictional records, never an account.
        await guest().getByText(app.preview).filter({ visible: true }).first().waitFor({ timeout: 90_000 });
        await page.screenshot({ path: path.join(out, `${app.slug}-preview.png`) });
        await page.getByRole('button', { name: 'Use app', exact: true }).click();
        await page.getByRole('button', { name: 'Change app', exact: true }).waitFor({ timeout: 90_000 });
        instance = (await rpc('localApps.list')).instances.find((item: { packageId: string }) => item.packageId === app.packageId);
      }
      assert(instance, `${app.name} was not installed`);
      await page.goto(`${base}/apps/${instance.slug}`);
      let frame = guest();
      // A fresh install starts empty. A rerun on the same Home keeps earlier records.
      if (fresh) {
        await frame.getByText(app.empty).filter({ visible: true }).first().waitFor({ timeout: 90_000 });
        await page.screenshot({ path: path.join(out, `${app.slug}-empty.png`) });
      }

      // Connect email opens Ri's own Sources dialog, which shows connected, granted and automatic separately.
      // On a rerun the app has records, so the same dialog opens from the app's More menu.
      if (fresh) await frame.getByRole('button', { name: /Connect email/ }).first().click();
      else {
        await page.getByRole('button', { name: 'More', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Sources and access' }).click();
      }
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('heading', { name: `${app.name} sources` }).waitFor();
      await dialog.getByText(/No account for Gmail is connected to Ri yet/).waitFor();
      await page.screenshot({ path: path.join(out, `${app.slug}-sources-dialog.png`) });
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });

      // A record written through the app's own action appears after the host's refresh.
      // Open the list first. The record must then appear through the host's refresh, with no navigation.
      await page.goto(`${base}/apps/${instance.slug}${app.list}`);
      frame = guest();
      await frame.getByRole('tab').first().waitFor({ timeout: 60_000 });
      await rpc('localApps.invoke', { id: instance.id, action: app.seed.action, input: app.seed.input, invocationId: crypto.randomUUID() }, true);
      await frame.getByText(app.seed.shows).filter({ visible: true }).first().waitFor({ timeout: 60_000 });

      // The app remembers its section in the URL without reopening the view.
      await frame.locator('html').evaluate(() => { (window as unknown as { __riSmoke: number }).__riSmoke = 1; });
      const before = page.url();
      await frame.getByRole('tab', { name: new RegExp(`^${app.section}`) }).first().click();
      await page.waitForFunction((previous) => window.location.href !== previous, before, { timeout: 10_000 });
      assert.equal(await frame.locator('html').evaluate(() => (window as unknown as { __riSmoke?: number }).__riSmoke), 1, `${app.name} view reloaded on a location update`);
      const remembered = page.url();
      await page.reload();
      frame = guest();
      await frame.getByRole('tab', { name: new RegExp(`^${app.section}`), selected: true }).first().waitFor({ timeout: 60_000 }).catch(async (error) => {
        const tabs = await frame.locator('[role=tab]').evaluateAll((elements) => elements.map((element) => `${element.textContent?.trim()}:${element.getAttribute('aria-selected')}`)).catch(() => []);
        throw new Error(`${error instanceof Error ? error.message.split('\n')[0] : error}. Tabs after reload: ${tabs.join(', ')}`);
      });
      assert.equal(page.url(), remembered);

      // Ask Ri stages editable text in the native composer and sends nothing.
      // Questions are about a record, so open the seeded one first.
      await page.goto(`${base}/apps/${instance.slug}${app.list}`);
      frame = guest();
      await frame.getByText(app.seed.shows).filter({ visible: true }).first().click({ timeout: 60_000 });
      await frame.getByRole('button', { name: /^Ask/ }).filter({ visible: true }).first().click({ timeout: 60_000 });
      await page.waitForFunction(() => Array.from(document.querySelectorAll('[contenteditable=true]')).some((element) => (element.textContent ?? '').trim().length > 10), undefined, { timeout: 90_000 });
      const chat = await rpc('documentChat.list', { query: { entityType: 'app', entityId: instance.id } });
      const events = await rpc('sessions.eventsGet', { params: { id: chat.session.id }, query: { limit: '20' } });
      assert.equal(events.filter((event: { source: string }) => event.source === 'user').length, 0, `${app.name} question sent itself`);
      await page.screenshot({ path: path.join(out, `${app.slug}-ask.png`) });

      // A phone-width page shows one column with no sideways scroll.
      await page.setViewportSize({ width: 390, height: 860 });
      const appTab = page.getByRole('tab', { name: 'App', exact: true });
      if (await appTab.count()) await appTab.click();
      frame = guest();
      // Wait until the app pane, not the chat pane, fills the phone width.
      for (let attempt = 0; attempt < 50; attempt++) {
        if ((await frame.locator('html').evaluate((element) => element.clientWidth).catch(() => 0)) > 300) break;
        await page.waitForTimeout(200);
      }
      assert((await frame.locator('html').evaluate((element) => element.clientWidth)) > 300, `${app.name} app pane did not open at 390 px`);
      assert(await frame.locator('html').evaluate((element) => element.scrollWidth <= element.clientWidth + 1), `${app.name} overflows at 390 px`);
      await page.screenshot({ path: path.join(out, `${app.slug}-390.png`), fullPage: true });
      await page.setViewportSize({ width: 1500, height: 1000 });
      results.push(`${app.name}: catalog icon, fictional preview, install, empty state, native Sources dialog, action write and refresh, remembered section without reload, Ask Ri draft without send, 390 px`);
    } catch (error) {
      await page.screenshot({ path: path.join(out, `${app.slug}-failure.png`) }).catch(() => {});
      throw new Error(`${app.name}: ${error instanceof Error ? error.message : error} (url ${page.url()})`);
    }
    assert.deepEqual(errors, [], `Page errors: ${errors.join(' | ')}`);
    console.log(`PASS\n${results.join('\n')}\nScreenshots: ${out}`);
  } finally {
    await browser.close();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message.replace(/(?:#token=|ri_live_)[^\s"']+/g, '[private fixture token]') : 'Included apps smoke failed');
  process.exitCode = 1;
});
