import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { APP_ROOT_ENV, getConfigPath, getDevAppRoot, getAttachmentsDir } from '../src/lib/config/paths';
import { AUTH_TOKEN_STORAGE_KEY } from '../src/lib/api/client';
import { SESSION_COOKIE_NAME } from '../src/lib/auth/session';

async function main() {
  process.env[APP_ROOT_ENV] = getDevAppRoot();
  for (const name of ['RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_WORK_DIR']) delete process.env[name];
  const token = JSON.parse(fs.readFileSync(getConfigPath(), 'utf8')).localToken;
  assert(token, 'Dev token missing');
  const origin = 'http://localhost:42241';
  const headers = { Authorization: `Bearer ${token}` };
  const scratchResponse = await fetch(`${origin}/api/dev/sessions/scratch`, { headers });
  assert(scratchResponse.ok, 'Dev scratch unavailable');
  const scratch = (await scratchResponse.json()).session;
  const q = await import('../src/lib/db/queries');
  const session = q.createChatSession({
    type: 'execution', workspaceId: scratch.workspaceId, executionId: scratch.executionId,
    harness: scratch.harness, label: 'Inline image QA',
  });
  const image = path.resolve('.work/notification-settings-qa/off-desktop.png');
  const content = [
    '# Inline images',
    `Ordinary link: [Desktop screenshot](${image})`,
    `Backtick path: \`${image}\``,
    `Quoted path: "${image}"`,
    `Bare path: ${image}`,
    `Code block stays code:\n\n\`\`\`text\n${image}\n\`\`\``,
  ].join('\n\n');
  q.insertChatEvent({ sessionId: session.id, role: 'assistant', source: 'agent', content });
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(image)], { type: 'image/png' }), 'QA upload.png');
  const uploaded = await fetch(`${origin}/api/attachments`, { method: 'POST', headers, body: form });
  assert.equal(uploaded.status, 201);
  const attachment = await uploaded.json();
  q.insertChatEvent({ sessionId: session.id, role: 'user', source: 'user', content: `[[file:${attachment.fileName}]]`, attachments: [attachment] });
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Users/agent/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  });
  const output = path.resolve('.work/inline-image-qa');
  fs.mkdirSync(output, { recursive: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1360, height: 1000 }, colorScheme: 'dark' });
    await context.addCookies([{ name: SESSION_COOKIE_NAME, value: token, url: origin, httpOnly: true, sameSite: 'Lax' }]);
    await context.addInitScript(({ token, key }) => { if (window === window.top) localStorage.setItem(key, token); }, { token, key: AUTH_TOKEN_STORAGE_KEY });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${origin}/?session=${session.id}`, { waitUntil: 'domcontentloaded' });
    const cards = page.getByRole('button', { name: 'Open image: off-desktop.png', exact: true });
    await cards.nth(3).waitFor({ timeout: 45000 });
    assert.equal(await cards.count(), 4);
    for (let i = 0; i < 4; i++) {
      await cards.nth(i).scrollIntoViewIfNeeded();
      const image = cards.nth(i).locator('..').getByRole('img');
      await image.waitFor();
      await image.evaluate(async image => { await (image as HTMLImageElement).decode(); });
      assert(await image.evaluate(image => image.getBoundingClientRect().width <= 240));
    }
    const images = page.locator('.chat-markdown img');
    assert.equal((await page.locator('.chat-markdown pre').innerText()).trim(), image);
    const response = await page.request.get(`${origin}/api/sessions/${session.id}/reply-image?path=${encodeURIComponent(image)}`);
    assert.equal(response.status(), 200);
    assert.equal(response.headers()['content-type'], 'image/png');
    assert.equal((await response.body()).byteLength, fs.statSync(image).size);
    const thumbUrl = `${origin}/api/sessions/${session.id}/reply-image?path=${encodeURIComponent(image)}&thumbnail=1`;
    const thumbnail = await page.request.get(thumbUrl);
    assert.equal(thumbnail.headers()['content-type'], 'image/webp');
    const thumbBytes = (await thumbnail.body()).byteLength;
    assert(thumbBytes < fs.statSync(image).size / 4);
    const warmAt = performance.now();
    const warmed = await page.request.get(thumbUrl);
    console.info('Image original bytes:', fs.statSync(image).size, 'thumbnail bytes:', thumbBytes, 'warm request ms:', Math.round(performance.now() - warmAt));
    assert.equal(warmed.status(), 200);
    const unchanged = await page.request.get(thumbUrl, { headers: { 'If-None-Match': thumbnail.headers().etag } });
    assert.equal(unchanged.status(), 304);
    await page.getByRole('button', { name: 'Open image: off-desktop.png', exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('img').waitFor();
    await page.waitForFunction(() => { const image = document.querySelector<HTMLImageElement>('[role=dialog] img'); return image?.complete && image.naturalWidth > 480; });
    await page.setViewportSize({ width: 390, height: 844 });
    await dialog.getByRole('img').waitFor();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.setViewportSize({ width: 1360, height: 1000 });
    assert.equal(q.listChatEvents(session.id).find(event => event.source === 'agent')?.content, content);
    await cards.first().scrollIntoViewIfNeeded();
    await images.first().waitFor();
    await page.screenshot({ path: path.join(output, 'desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await cards.first().scrollIntoViewIfNeeded();
    await images.first().waitFor();
    assert(await images.first().evaluate(image => image.getBoundingClientRect().width <= 390));
    await page.screenshot({ path: path.join(output, 'narrow.png') });
    const uploadedCard = page.getByRole('button', { name: 'Open image: QA upload.png', exact: true });
    await uploadedCard.scrollIntoViewIfNeeded();
    await uploadedCard.locator('..').getByRole('img').waitFor();
    await uploadedCard.click();
    await page.getByRole('dialog').getByRole('img').waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    const attachmentThumbnail = await page.request.get(`${origin}/api/attachments/${attachment.fileName}?thumbnail=1`);
    assert.equal(attachmentThumbnail.status(), 200);
    assert.equal(attachmentThumbnail.headers()['content-type'], 'image/webp');
    assert.deepEqual(errors, []);
    console.info('Passed: four natural path formats render real image bytes, code stays code, stored output unchanged, narrow layout fits. Screenshots:', output);
    await context.close();
  } finally {
    await browser.close();
    q.deleteAllChatEvents(session.id);
    fs.rmSync(path.join(getAttachmentsDir(), attachment.fileName), { force: true });
    q.deleteChatSessionIfEmpty(session.id);
    const { resetDb } = await import('../src/lib/db');
    resetDb();
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
