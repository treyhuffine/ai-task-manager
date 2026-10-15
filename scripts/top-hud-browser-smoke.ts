/** Responsive HUD qualification against `pnpm dev`, with synthetic glance data.
 * Run: pnpm exec tsx scripts/top-hud-browser-smoke.ts
 * Only reads the dev Home. Browser contexts and intercepted data are disposable.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { APP_ROOT_ENV, getConfigPath, getProductionAppRoot, resolveDevAppRoot } from '@/lib/config/paths';
import { isWithin } from '@/lib/config/dev-isolation';
import { normalizeGoogleEvent } from '@/lib/calendar/events';
import type { CalendarRangeResult } from '@/lib/calendar/types';
import type { WorkRange, WorkStats } from '@/lib/work/types';
import type { RunsStats } from '@/hooks/use-runs-stats';

const NOW = new Date('2026-10-12T13:46:00-06:00');
const DATE = '2026-10-12';
const TITLE = '2:00 PM - MT, Portal Discussion and quarterly planning with the whole team';
const event = normalizeGoogleEvent({
  id: 'hud-smoke-event', summary: TITLE,
  start: `${DATE}T14:00:00-06:00`, end: `${DATE}T15:00:00-06:00`,
}, 'hud-smoke-calendar')!;
const calendar: CalendarRangeResult = {
  status: 'ok', asOf: NOW.toISOString(), workday: { start: '09:00', end: '17:00' }, providers: [],
  days: [{ date: DATE, allDay: [], events: [event], gaps: [], freeMinutes: 420, largestGapMinutes: 300, busyMinutes: 60, complete: true }],
};
const stats: WorkStats = {
  handsOnMinutes: 60, agentMinutes: 180, whileAwayMinutes: 120, activeMinutes: 180,
  personHours: 61, codeHours: 20, codeAgentMinutes: 60, commits: 10,
  agents: 2, chats: 4, agentWords: 5000, yourWords: 500, peak: null,
};
const work: WorkRange = {
  start: DATE, days: 1, generatedAt: NOW.toISOString(), totals: stats, agents: [], report: [],
  dayList: [{ date: DATE, stats, spans: [], looseCommits: [], blocks: [], sittings: [], tasksDone: [], executionsFinished: [] }],
};

async function checkLayout(page: Page, label: string) {
  const problems = await page.locator('[data-desktop-titlebar]').evaluate(header => {
    const bounds = header.getBoundingClientRect();
    const row = header.querySelector<HTMLElement>('.top-hud-row')!;
    const failures: string[] = [];
    if (row.scrollWidth > row.clientWidth + 1) failures.push('Header overflows');
    const buttons = [...header.querySelectorAll<HTMLElement>('button')].filter(button => button.getBoundingClientRect().width > 0);
    let previousRight = bounds.left;
    for (const button of buttons) {
      const box = button.getBoundingClientRect();
      if (box.left < previousRight - 1) failures.push(`Overlapping control: ${button.getAttribute('aria-label')}`);
      if (box.right > bounds.right + 1 || box.top < bounds.top - 1 || box.bottom > bounds.bottom + 1) failures.push('Control exceeds header');
      for (const icon of button.querySelectorAll('svg')) {
        const iconBounds = icon.getBoundingClientRect();
        if (iconBounds.width < 9) failures.push('Icon was squeezed');
      }
      previousRight = box.right;
    }
    const timing = header.querySelector<HTMLElement>('.hud-calendar-timing');
    if (timing && timing.scrollWidth > timing.clientWidth + 1) failures.push('Event time is clipped');
    return failures;
  });
  assert.deepEqual(problems, [], label);
}

async function main() {
  process.env[APP_ROOT_ENV] = resolveDevAppRoot();
  assert(!isWithin(getConfigPath(), getProductionAppRoot()), 'Use the dev Home');
  const config = JSON.parse(await fs.readFile(getConfigPath(), 'utf8'));
  const base = process.env.RI_HUD_BROWSER_URL ?? 'http://127.0.0.1:42241';
  assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname) && new URL(base).port !== '4224', 'Use a local dev server');
  const executablePath = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find(existsSync);
  assert(executablePath, 'Chromium is required');
  const output = path.resolve('.work/top-hud');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath, headless: true });
  let budgetState: RunsStats['budgetState'] = 'block';
  try {
    for (const desktop of [false, true]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'America/Denver' });
      const page = await context.newPage();
      await page.clock.setFixedTime(NOW);
      // Literal script avoids tsx's nested-function name helpers leaking into
      // a serialized Playwright callback and silently skipping the bridge.
      await page.addInitScript({ content: `
        localStorage.setItem('ri.client.apiTransport', 'http');
        ${desktop ? `window.riDesktop = {
          platform: 'darwin', openExternal: async () => {},
          onResume: () => () => {}, onPrepareClose: () => () => {},
          onPrepareBackground: () => () => {}, onQuickCapture: () => () => {}
        };` : ''}
      ` });
      await page.route('**/api/trpc/**', async route => {
        const procedure = new URL(route.request().url()).pathname.split('/').at(-1);
        const fraction = budgetState === 'warn' ? 0.85 : 1.01;
        const budget: RunsStats = { activeRuns: 0, todaySpend: 4, monthSpend: fraction * 100, budget: 100, budgetFraction: fraction, budgetState };
        const fixtures: Record<string, unknown> = { 'calendar.list': calendar, 'work.range': work, 'runs.statsGet': budget };
        if (procedure && procedure in fixtures) {
          await route.fulfill({ json: { result: { data: fixtures[procedure] } } });
        } else await route.continue();
      });
      await page.goto(`${base}/apps#token=${encodeURIComponent(config.localToken)}`);
      await page.locator('.hud-calendar-timing').waitFor({ timeout: 120_000 });
      if (desktop) await page.waitForFunction(() => document.documentElement.dataset.riDesktop === 'darwin');
      assert.equal(await page.locator('[data-desktop-titlebar] button[aria-label="Back"]').count(), desktop ? 1 : 0);
      assert.equal(await page.locator('[data-desktop-titlebar]').evaluate(header => getComputedStyle(header).paddingLeft), desktop ? '88px' : '16px');
      assert.equal(await page.locator('.hud-calendar-timing').innerText(), 'in 14m');
      assert.equal(await page.locator('[data-desktop-titlebar] button[aria-label^="Today so far"]').count(), 1);
      for (const width of [1440, 1280, 1200, 1184, 1152, 1024, 960, 928, 900, 896, 832, 800, 768]) {
        await page.setViewportSize({ width, height: 900 });
        await checkLayout(page, `${desktop ? 'Mac renderer' : 'browser'} at ${width}px`);
      }
      // Stress layout with larger counts without creating any sessions.
      await page.locator('.top-hud-row > div:first-child span.font-mono').evaluateAll(nodes => {
        for (const node of nodes) node.textContent = '999';
      });
      await checkLayout(page, 'Three-digit status counts at minimum width');
      await page.locator('[data-desktop-titlebar]').screenshot({ path: path.join(output, `${desktop ? 'mac' : 'browser'}-768.png`) });
      await page.setViewportSize({ width: 800, height: 900 });
      assert.equal(await page.locator('.hud-shortcut').isVisible(), false);
      assert.equal(await page.locator('.hud-view-label').isVisible(), false);
      assert.equal(await page.locator('.hud-quick-capture').isVisible(), false);
      await page.locator('.hud-create').click();
      await page.getByRole('button', { name: 'Quick Capture', exact: false }).waitFor();
      await page.keyboard.press('Escape');
      await page.locator('[data-desktop-titlebar] button[aria-label^="Day shape:"]').click();
      await page.getByText(TITLE, { exact: true }).last().waitFor();
      await page.keyboard.press('Escape');
      await page.locator('[data-desktop-titlebar] button[aria-label="Close apps"]').hover();
      await page.getByRole('tooltip').filter({ hasText: 'Close apps' }).waitFor();
      await page.locator('[data-desktop-titlebar] button[aria-label="Close apps"]').click();
      assert.equal(new URL(page.url()).pathname, '/');
      budgetState = 'warn';
      await page.reload();
      await page.locator('.hud-budget-short').filter({ hasText: '85%' }).waitFor();
      await checkLayout(page, 'Budget warning');
      if (!desktop) {
        for (const width of [767, 390, 320]) {
          await page.setViewportSize({ width, height: 850 });
          await page.getByRole('button', { name: 'Search', exact: true }).first().waitFor();
          assert.equal(await page.locator('[data-desktop-titlebar]').isVisible(), false);
          const phoneHeader = page.locator('header').filter({ has: page.getByRole('button', { name: 'Search', exact: true }) }).last();
          assert.equal(await phoneHeader.getByRole('button', { name: 'Quick capture', exact: true }).count(), 0);
          assert.equal(await phoneHeader.evaluate(header => header.scrollWidth > header.clientWidth), false);
        }
        await page.getByRole('button', { name: 'Create', exact: true }).last().click();
        await page.getByRole('button', { name: 'Quick Capture', exact: false }).waitFor();
        await page.keyboard.press('Escape');
        await page.getByRole('dialog').waitFor({ state: 'hidden' });
        await page.screenshot({ path: path.join(output, 'phone-320.png') });
      }
      budgetState = 'block';
      await context.close();
    }
    console.log('PASS: responsive browser and Mac renderer headers, long event title with visible countdown, budget warning/block, larger status counts, day peek, Create capture, close navigation and separate phone header');
  } finally { await browser.close(); }
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message.replace(/(?:#token=|ri_live_)[^\s"']+/g, '[dev token]') : 'HUD qualification failed');
  process.exitCode = 1;
});
