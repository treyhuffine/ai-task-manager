import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';

// No Home or database. Run with RI_CHAT_LINK_BROWSER_TEST=1 pnpm exec vitest run <this file>.
const enabled = process.env.RI_CHAT_LINK_BROWSER_TEST === '1';
const url = 'https://example.com/guide?x=1&y=2#part';
let browser: Browser;
let server: http.Server;
let context: BrowserContext;
let page: Page;
let address: string;
const errors: string[] = [];

beforeAll(async () => {
  if (!enabled) return;
  fs.mkdirSync('.work/chat-ui-gallery', { recursive: true });
  const markdown = `[Website](${url})\n\nhttps://example.com/bare\n\n[Relative website](//example.com/relative)\n\n[Domain path](example.com/guide)\n\nwww.example.com\n\n[Source](./src/app.tsx)\n\n[Readme](README.md)\n\n[Email](mailto:sam@example.com)\n\n[Unsafe](javascript:alert%281%29)\n\n[Long URL](https://example.com/${'long-path/'.repeat(35)}?query=value#section)`;
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { MessageResponse } from './src/components/ai-elements/message';
      import { MarkdownLink } from './src/components/chat-ui/messages/markdown-link';
      createRoot(document.getElementById('root')).render(<main className="p-6 max-w-xl">
        <MessageResponse mode="static">{${JSON.stringify(markdown)}}</MessageResponse>
        <MarkdownLink href="streamdown:incomplete-link">Still streaming</MarkdownLink>
        <MessageResponse mode="static" components={{a: ({children}) => <span data-custom-link>{children}</span>}}>[Custom renderer](https://example.com/custom)</MessageResponse>
        <textarea aria-label="Chat composer" />
      </main>);
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env': '{"NODE_ENV":"production"}' }, loader: { '.css': 'empty' },
  });
  const require = createRequire(import.meta.url);
  const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
  const tailwind = require('@tailwindcss/postcss');
  const cssFile = path.resolve('src/app/globals.css');
  const css = await postcss([tailwind({ base: process.cwd() })]).process(fs.readFileSync(cssFile, 'utf8'), { from: cssFile });
  server = http.createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/bundle.js' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/bundle.js' ? bundle.outputFiles[0].text : `<!doctype html><html><head><style>${css.css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.RI_REVIEW_CHROMIUM });
}, 90_000);

beforeEach(async () => {
  if (!enabled) return;
  context = await browser.newContext({ viewport: { width: 1024, height: 900 }, hasTouch: true });
  await context.route('https://example.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Opened website</h1>' }));
  await context.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (value: string) => { (window as unknown as { copied: string }).copied = value; } } }));
  page = await context.newPage();
  page.setDefaultTimeout(2000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(address);
  await page.getByRole('link', { name: 'Website', exact: true }).waitFor();
});
afterEach(async task => {
  if (!enabled) return;
  if (task.task.result?.state === 'fail') console.error(await page.locator('body').ariaSnapshot());
  await context?.close();
});
afterAll(async () => {
  if (!enabled) return;
  await browser?.close();
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  expect(errors).toEqual([]);
});

it.skipIf(!enabled)('opens a native new tab immediately, preserving query and fragment', async () => {
  const link = page.getByRole('link', { name: 'Website', exact: true });
  expect(await link.getAttribute('target')).toBe('_blank');
  expect(await link.getAttribute('rel')).toBe('noopener noreferrer');
  const popup = context.waitForEvent('page');
  await link.click();
  const opened = await popup;
  await opened.waitForLoadState();
  expect(opened.url()).toBe(url);
  expect(await page.getByRole('dialog', { name: 'Open link', exact: true }).count()).toBe(0);
  expect(page.url()).toBe(`${address}/`);
});

it.skipIf(!enabled)('recognizes autolinks, protocol-relative links and scheme-less domain paths', async () => {
  for (const [name, target] of [['https://example.com/bare', 'https://example.com/bare'], ['Relative website', 'https://example.com/relative'], ['Domain path', 'https://example.com/guide'], ['www.example.com', 'http://www.example.com/']]) {
    expect(await page.getByRole('link', { name, exact: true }).getAttribute('href')).toBe(target);
  }
});

it.skipIf(!enabled)('opens a website immediately on touch', async () => {
  const popup = context.waitForEvent('page');
  await page.getByRole('link', { name: 'Website', exact: true }).tap();
  const opened = await popup;
  await opened.waitForLoadState();
  expect(opened.url()).toBe(url);
  expect(await page.getByRole('dialog', { name: 'Open link', exact: true }).count()).toBe(0);
});

it.skipIf(!enabled)('keeps the hover panel open while moving to Copy and copies the full URL', async () => {
  await page.getByRole('link', { name: 'Website', exact: true }).hover();
  const panel = page.getByRole('dialog', { name: 'Link destination' });
  await panel.waitFor();
  expect(await panel.textContent()).toContain(url);
  await page.screenshot({ path: '.work/chat-ui-gallery/links-hover.png' });
  await panel.getByRole('button', { name: 'Copy', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toBe(url);
  await panel.getByText('Copied', { exact: true }).waitFor();
});

it.skipIf(!enabled)('supports keyboard inspection, copying, back navigation and Escape', async () => {
  const link = page.getByRole('link', { name: 'Website', exact: true });
  await link.focus();
  const panel = page.getByRole('dialog', { name: 'Link destination' });
  await panel.waitFor();
  await page.keyboard.press('Tab');
  expect(await panel.getByRole('button', { name: 'Copy', exact: true }).evaluate(button => button === document.activeElement)).toBe(true);
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toBe(url);
  await page.keyboard.press('Shift+Tab');
  expect(await link.evaluate(element => element === document.activeElement)).toBe(true);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'hidden' });
  expect(await link.evaluate(element => element === document.activeElement)).toBe(true);
  await page.keyboard.press('Tab');
  expect(await page.getByRole('link', { name: 'https://example.com/bare', exact: true }).evaluate(element => element === document.activeElement)).toBe(true);
  await link.focus();
  await panel.waitFor();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  expect(await page.getByRole('link', { name: 'https://example.com/bare', exact: true }).evaluate(element => element === document.activeElement)).toBe(true);
});

it.skipIf(!enabled)('preserves composer focus when Escape dismisses a hover preview', async () => {
  const composer = page.getByRole('textbox', { name: 'Chat composer' });
  await composer.fill('Draft');
  await page.getByRole('link', { name: 'Website', exact: true }).hover();
  const panel = page.getByRole('dialog', { name: 'Link destination' });
  await panel.waitFor();
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'hidden' });
  expect(await composer.evaluate(element => element === document.activeElement)).toBe(true);
  await page.keyboard.type(' continued');
  expect(await composer.inputValue()).toBe('Draft continued');
});

it.skipIf(!enabled)('does not reopen a dismissed preview when a hover timer fires', async () => {
  await page.clock.install();
  const link = page.getByRole('link', { name: 'Website', exact: true });
  await link.focus();
  const panel = page.getByRole('dialog', { name: 'Link destination' });
  await panel.waitFor();
  await link.hover();
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'hidden' });
  await page.clock.runFor(350);
  expect(await panel.count()).toBe(0);
  // A fresh hover still opens the preview after dismissal.
  await page.mouse.move(900, 800);
  await link.hover();
  await page.clock.runFor(350);
  await panel.waitFor();
});

it.skipIf(!enabled)('retains the dialog for paths, filenames and other schemes', async () => {
  for (const [label, target] of [['Source', './src/app.tsx'], ['Readme', 'README.md'], ['Email', 'mailto:sam@example.com']]) {
    await page.getByRole('button', { name: label, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Open link', exact: true });
    expect(await dialog.textContent()).toContain(target);
    await dialog.getByRole('button', { name: 'Copy', exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toBe(target);
    expect(await dialog.getByRole('link', { name: 'Open in new tab' }).getAttribute('href')).toBe(target);
    await page.keyboard.press('Escape');
  }
});

it.skipIf(!enabled)('preserves sanitization, incomplete links and caller-supplied renderers', async () => {
  expect(await page.locator('a[href^="javascript:"]').count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Unsafe', exact: true }).count()).toBe(0);
  expect(await page.getByRole('link', { name: 'Still streaming', exact: true }).count()).toBe(0);
  expect(await page.locator('[data-custom-link]').textContent()).toBe('Custom renderer');
});

it.skipIf(!enabled)('fits long destinations on a phone and reports a clipboard failure', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('link', { name: 'Long URL' }).hover();
  const panel = page.getByRole('dialog', { name: 'Link destination' });
  await panel.waitFor();
  const bounds = await panel.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.work/chat-ui-gallery/links-phone-popover.png' });
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('Denied'); }; });
  await panel.getByRole('button', { name: 'Copy', exact: true }).click();
  await panel.getByText('Could not copy', { exact: true }).waitFor();
});
