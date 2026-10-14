import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { getConfigPath, getDevAppRoot, APP_ROOT_ENV } from '../src/lib/config/paths';
import { AUTH_TOKEN_STORAGE_KEY } from '../src/lib/api/client';
import { SESSION_COOKIE_NAME } from '../src/lib/auth/session';

async function main() {
process.env[APP_ROOT_ENV] = getDevAppRoot();
const token = JSON.parse(fs.readFileSync(getConfigPath(), 'utf8')).localToken;
assert(token, 'Dev token missing');
const output = path.resolve('.work/notification-settings-qa');
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Users/agent/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' });
const errors: string[] = [];
try {
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 }, colorScheme: 'dark' });
  await context.addCookies([{ name: SESSION_COOKIE_NAME, value: token, url: 'http://localhost:42241', httpOnly: true, sameSite: 'Lax' }]);
  await context.addInitScript(({ token, key }) => localStorage.setItem(key, token), { token, key: AUTH_TOKEN_STORAGE_KEY });
  await context.addInitScript({ content: `(() => {
    window.qaNotifications = { supported: true, enabled: false };
    window.qaActions = [];
    window.qaReadError = false;
    window.riDesktop = {
      platform: 'darwin',
      notificationStatus: async () => { if (window.qaReadError) throw new Error('Waiting for Ri to reconnect.'); return { ...window.qaNotifications }; },
      connection: async action => { window.qaActions.push(action); return { phase: 'connected', issue: null, showNotice: false }; },
      onConnectionChange: () => () => {}, onResume: () => () => {},
      onPrepareClose: () => () => {}, onPrepareBackground: () => () => {}, onQuickCapture: () => () => {},
      openExternal: async () => {},
    };
    if (sessionStorage.getItem('qa-legacy')) delete window.riDesktop.notificationStatus;
    if (sessionStorage.getItem('qa-local')) window.riDesktop.notifications = async action => {
      window.qaActions.push(action);
      if (action === 'enable') window.qaNotifications.enabled = true;
      if (action === 'disable') window.qaNotifications.enabled = false;
      return { ...window.qaNotifications };
    };
  })();` });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://localhost:42241/?settings=notifications', { waitUntil: 'domcontentloaded' });
  const card = page.getByRole('region', { name: 'Desktop notifications on this computer', exact: true });
  await card.getByRole('status').filter({ hasText: 'Off' }).waitFor();
  await page.screenshot({ path: path.join(output, 'off-desktop.png') });
  await card.getByRole('button', { name: 'Enable desktop notifications', exact: true }).click();
  assert(await page.evaluate(() => (window as any).qaActions.includes('notifications')));
  await page.evaluate(() => { (window as any).qaNotifications.enabled = true; window.dispatchEvent(new Event('focus')); });
  await card.getByRole('status').filter({ hasText: 'On' }).waitFor();
  await card.getByRole('button', { name: 'Open notification settings', exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, 'on-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await card.scrollIntoViewIfNeeded();
  assert(await card.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
  await page.screenshot({ path: path.join(output, 'on-narrow.png') });
  await page.evaluate(() => { (window as any).qaReadError = true; });
  await card.getByRole('status').filter({ hasText: 'Needs attention' }).waitFor();
  await card.getByRole('button', { name: 'Check again', exact: true }).waitFor();
  await page.evaluate(() => { (window as any).qaReadError = false; (window as any).qaNotifications.enabled = false; });
  await card.getByRole('button', { name: 'Check again', exact: true }).click();
  await card.getByRole('status').filter({ hasText: 'Off' }).waitFor();
  await page.screenshot({ path: path.join(output, 'off-narrow.png') });
  await page.evaluate(() => { (window as any).qaNotifications.supported = false; });
  await card.getByRole('status').filter({ hasText: 'Unavailable' }).waitFor();
  assert.equal(await card.getByRole('button', { name: 'Enable desktop notifications', exact: true }).count(), 0);
  await page.evaluate(() => sessionStorage.setItem('qa-legacy', '1'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await card.getByRole('status').filter({ hasText: 'Check setup' }).waitFor();
  await card.getByRole('button', { name: 'Enable desktop notifications', exact: true }).click();
  assert(await page.evaluate(() => (window as any).qaActions.includes('settings')));
  await page.evaluate(() => sessionStorage.setItem('qa-local', '1'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await card.getByRole('status').filter({ hasText: 'Off' }).waitFor();
  assert(!(await page.evaluate(() => (window as any).qaActions.includes('enable'))));
  await card.getByRole('button', { name: 'Enable desktop notifications', exact: true }).click();
  await card.getByRole('status').filter({ hasText: 'On' }).waitFor();
  await card.getByRole('button', { name: 'Disable desktop notifications', exact: true }).click();
  await card.getByRole('status').filter({ hasText: 'Off' }).waitFor();
  await context.close();
  assert.deepEqual(errors, []);
  console.info('Notification UI: off, on, focused setup action, read failure and recovery, unsupported, older-shell fallback, local enable/disable, narrow layout passed. Screenshots:', output);
} finally { await browser.close(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
