import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { APP_ROOT_ENV, getConfigPath, getDevAppRoot } from '../src/lib/config/paths';
import { AUTH_TOKEN_STORAGE_KEY } from '../src/lib/api/client';
import { SESSION_COOKIE_NAME } from '../src/lib/auth/session';

async function main() {
  process.env[APP_ROOT_ENV] = getDevAppRoot();
  for (const name of ['RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_WORK_DIR']) delete process.env[name];
  const token = JSON.parse(fs.readFileSync(getConfigPath(), 'utf8')).localToken;
  assert(token);
  const origin = 'http://localhost:42241';
  const response = await fetch(`${origin}/api/dev/sessions/scratch`, { headers: { Authorization: `Bearer ${token}` } });
  assert(response.ok);
  const scratch = (await response.json()).session;
  const q = await import('../src/lib/db/queries');
  const session = q.createChatSession({ type: 'execution', workspaceId: scratch.workspaceId, executionId: scratch.executionId, harness: scratch.harness, label: 'HTML preview QA' });
  const html = '/Users/agent/code/ballcoach.ai/work/visualizations/playbank-explorer.html';
  const content = `Try the filters, sorting, Preview, and Add below.\n\n\uE200visualize\uE202${JSON.stringify({ path: html, mode: 'wide' })}\uE201\n\nAlso [open the HTML file](${html}) or \`${html}\`.\n\n[Ordinary web link](https://example.com)\n\n[Web image link](https://example.com/proof.png) and [Web HTML link](https://example.com/proof.html)`;
  q.insertChatEvent({ sessionId: session.id, role: 'assistant', source: 'agent', content });
  const browser = await chromium.launch({ headless: true, executablePath: '/Users/agent/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' });
  const output = path.resolve('.work/html-preview-qa');
  fs.mkdirSync(output, { recursive: true });
  let page: Page | undefined;
  try {
    const context = await browser.newContext({ viewport: { width: 1360, height: 1000 }, colorScheme: 'dark' });
    await context.addCookies([{ name: SESSION_COOKIE_NAME, value: token, url: origin, httpOnly: true, sameSite: 'Lax' }]);
    await context.addInitScript(({ token, key }) => { if (window === window.top) localStorage.setItem(key, token); }, { token, key: AUTH_TOKEN_STORAGE_KEY });
    page = await context.newPage();
    const errors: string[] = [];
    const frameApiRequests: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.frame().parentFrame() && request.url().includes('/api/')) frameApiRequests.push(request.url()); });
    await page.goto(`${origin}/?session=${session.id}`, { waitUntil: 'domcontentloaded' });
    const trigger = page.getByRole('button', { name: 'Open HTML: playbank-explorer.html', exact: true }).first();
    await trigger.waitFor({ timeout: 45000 });
    await page.getByText('Ordinary web link', { exact: true }).waitFor();
    for (const label of ['Web image link', 'Web HTML link']) {
      const link = page.getByText(label, { exact: true });
      await link.waitFor();
      console.info('Web link element:', await link.evaluate(node => node.outerHTML));
      assert.equal(await page.getByRole('button', { name: `Open HTML: ${label}`, exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: `Open image: ${label}`, exact: true }).count(), 0);
    }
    assert(!(await page.locator('.chat-markdown').allTextContents()).join(' ').includes('visualize'));
    const thumb = page.frameLocator('iframe[title="Thumbnail: playbank-explorer.html"]').first();
    await thumb.getByRole('heading', { name: 'Basketball plays you can see, teach, and make your own.' }).waitFor();
    assert.equal(await thumb.locator('script').count(), 0);
    assert.equal(await page.locator('iframe[title="Thumbnail: playbank-explorer.html"]').first().getAttribute('sandbox'), '');
    await page.screenshot({ path: path.join(output, 'cards.png') });
    const openedAt = performance.now();
    await trigger.click();
    const dialog = page.getByRole('dialog');
    const frame = dialog.frameLocator('iframe');
    await frame.getByRole('heading', { name: 'Basketball plays you can see, teach, and make your own.' }).waitFor({ timeout: 30000 });
    console.info('HTML open from cached thumbnail, ms:', Math.round(performance.now() - openedAt));
    assert.equal(await dialog.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
    const library = frame.locator('[data-design="library"]');
    const count = await library.locator('.pb-play').count();
    assert(count > 1);
    await library.getByRole('button', { name: 'Need a three' }).click();
    assert((await library.locator('.pb-play').count()) < count);
    await library.locator('[data-preview]').first().click();
    await library.locator('.pb-detail [data-step="1"]').click();
    await library.getByText('Step 2 of', { exact: false }).waitFor();
    await frame.getByRole('combobox', { name: 'Choose preview variant' }).selectOption({ label: 'Guided discovery' });
    await frame.getByRole('heading', { name: 'Your next possession. Your next good look.' }).waitFor();
    const iframe = dialog.locator('iframe');
    const element = await iframe.elementHandle();
    const actualFrame = await element!.contentFrame();
    assert(actualFrame);
    const isolated = await actualFrame.evaluate(async origin => {
      let parentBlocked = false, storageBlocked = false, apiBlocked = false;
      try { void parent.document.body; } catch { parentBlocked = true; }
      try { void localStorage.length; } catch { storageBlocked = true; }
      try { await fetch(`${origin}/api/health`, { credentials: 'include' }); } catch { apiBlocked = true; }
      return { parentBlocked, storageBlocked, apiBlocked };
    }, origin);
    assert.deepEqual(isolated, { parentBlocked: true, storageBlocked: true, apiBlocked: true });
    assert.deepEqual(frameApiRequests, []);
    await page.screenshot({ path: path.join(output, 'desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await iframe.evaluate(frame => frame.getBoundingClientRect().width <= 390));
    assert.equal(await frame.getByRole('combobox', { name: 'Choose preview variant' }).inputValue(), '1');
    await page.screenshot({ path: path.join(output, 'narrow.png') });
    await dialog.getByRole('button', { name: 'Reload preview' }).click();
    await frame.getByRole('heading', { name: 'Basketball plays you can see, teach, and make your own.' }).waitFor();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.setViewportSize({ width: 1360, height: 1000 });
    await page.getByRole('button', { name: /^Files/ }).first().click();
    await page.evaluate(path => window.dispatchEvent(new CustomEvent('ri:open-file', { detail: { path } })), html);
    await page.getByRole('button', { name: 'Source', exact: true }).waitFor();
    await page.locator('iframe[title="HTML preview: playbank-explorer.html"]').waitFor();
    await page.getByRole('button', { name: 'Source', exact: true }).click();
    await page.locator('.cm-editor').waitFor();
    await page.getByTestId('exec-files-viewer').getByRole('button', { name: 'Preview', exact: true }).click();
    await page.locator('iframe[title="HTML preview: playbank-explorer.html"]').waitFor();
    assert.equal(q.listChatEvents(session.id).find(event => event.source === 'agent')?.content, content);
    assert.deepEqual(errors, []);
    console.info('Passed: real visualize artifact, normal file links, filters and step controls, both design variants, opaque-origin sandbox and blocked API access, mobile layout, reload, file-viewer Preview/Source. Screenshots:', output);
    await context.close();
  } catch (error) {
    await page?.screenshot({ path: path.join(output, 'failure.png') });
    console.info('Chat text on failure:', await page?.locator('.chat-markdown').allTextContents());
    throw error;
  } finally {
    await browser.close();
    q.deleteAllChatEvents(session.id); q.deleteChatSessionIfEmpty(session.id);
    const { resetDb } = await import('../src/lib/db'); resetDb();
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
