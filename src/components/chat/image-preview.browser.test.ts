import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';

// Real image load/decode failures, tooltip focus and lightbox interactions.
// RI_ARTIFACT_BROWSER_TEST=1 pnpm exec vitest run src/components/chat/image-preview.browser.test.ts
const enabled = process.env.RI_ARTIFACT_BROWSER_TEST === '1';
const remote = 'https://github.com/example/private/blob/revision/missing.png?raw=true';
const source = '/tmp/Screen Shot 100%.png';
let browser: Browser;
let server: http.Server;
let address: string;

beforeAll(async () => {
  if (!enabled) return;
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
      import { TipProvider } from './src/components/ui/tip';
      import { ArtifactPreviewProvider } from './src/components/chat/artifact-preview-provider';
      import { ImagePreviewCard } from './src/components/chat/image-preview-card';
      import { replyImageUrl } from './src/lib/sessions/reply-image-urls';
      const client = new QueryClient();
      function App() {
        const [switched, setSwitched] = useState(false);
        return <QueryClientProvider client={client}><TipProvider><ArtifactPreviewProvider>
          <main className="p-8 space-y-4">
            <h1>Chat image previews</h1>
            <div><ImagePreviewCard src={replyImageUrl('fixture', ${JSON.stringify(source)})} alt="The dashboard screenshot" /></div>
            <div><ImagePreviewCard src={${JSON.stringify(remote)}} alt="Private repository screenshot" /></div>
            <div><ImagePreviewCard src="/api/attachments/good.svg" name="Uploaded diagram.svg" alt="An uploaded diagram" /></div>
            <div><ImagePreviewCard src="/api/attachments/undecodable.png" alt="Damaged image" /></div>
            <div><ImagePreviewCard src={switched ? '/good.svg' : '/missing.png'} alt="Changing image" /></div>
            <button onClick={() => setSwitched(true)}>Change source</button>
          </main>
        </ArtifactPreviewProvider></TipProvider></QueryClientProvider>;
      }
      createRoot(document.getElementById('root')).render(<App />);
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env': '{"NODE_ENV":"development"}' }, loader: { '.css': 'empty' },
  });
  // Compile the real app styles so tooltip placement and dialog hit testing
  // match Ri, without starting a Home or opening any database.
  const require = createRequire(import.meta.url);
  const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
  const tailwind = require('@tailwindcss/postcss');
  const cssFile = path.resolve('src/app/globals.css');
  const css = await postcss([tailwind({ base: process.cwd() })]).process(fs.readFileSync(cssFile, 'utf8'), { from: cssFile });
  server = http.createServer((req, res) => {
    const url = new URL(req.url!, 'http://fixture');
    if (url.pathname === '/bundle.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(bundle.outputFiles[0].text);
    } else if (url.pathname === '/styles.css') {
      res.setHeader('Content-Type', 'text/css');
      res.end(css.css);
    } else if (url.pathname.endsWith('/reply-image')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'The screenshot file was not found.' }));
    } else if (url.pathname.endsWith('/good.svg')) {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#4f46e5"/></svg>');
    } else if (url.pathname.endsWith('/undecodable.png')) {
      res.setHeader('Content-Type', 'image/png');
      res.end('not an image');
    } else if (url.pathname === '/missing.png') {
      res.writeHead(404);
      res.end();
    } else {
      res.setHeader('Content-Type', 'text/html');
      res.end('<link rel="stylesheet" href="/styles.css"><div id="root"></div><script src="/bundle.js"></script>');
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.RI_REVIEW_CHROMIUM });
}, 90_000);

afterAll(async () => {
  await browser?.close();
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
});

async function openPage() {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  page.setDefaultTimeout(8_000);
  await page.route(remote, route => route.fulfill({ status: 404, contentType: 'text/html', body: 'Not found' }));
  await page.goto(address);
  return page;
}

async function hoverDetails(page: Page, target: ReturnType<Page['locator']>, expectedSource: string) {
  // Intermediate moves let Radix leave its tooltip transit area, as a real
  // pointer does when moving between cards.
  await page.mouse.move(1000, 950, { steps: 5 });
  await target.hover();
  const tip = page.getByRole('tooltip').filter({ hasText: expectedSource });
  await tip.waitFor();
  return (await tip.textContent())!;
}

it.skipIf(!enabled)('shows the original source and server error on hover and in the lightbox', async () => {
  const page = await openPage();
  try {
    const card = page.getByRole('button', { name: 'Open image: Screen Shot 100%.png' });
    const failure = page.getByText('HTTP 404: The screenshot file was not found.', { exact: true });
    await failure.waitFor();
    const details = await hoverDetails(page, card, source);
    expect(details).toContain(source);
    expect(details).toContain('The dashboard screenshot');
    expect(details).toContain('HTTP 404: The screenshot file was not found.');
    expect(details).not.toContain('thumbnail=1');
    if (process.env.RI_ARTIFACT_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.RI_ARTIFACT_SCREENSHOTS, 'image-card.png') });
    await card.click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    expect(await dialog.locator('[data-slot="dialog-description"]').textContent()).toBe(source);
    await dialog.getByText('HTTP 404: The screenshot file was not found.', { exact: true }).waitFor();
    expect(await hoverDetails(page, dialog.getByText('Preview unavailable', { exact: true }), source)).toContain(source);
    if (process.env.RI_ARTIFACT_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.RI_ARTIFACT_SCREENSHOTS, 'image-lightbox.png') });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    expect(await card.evaluate(el => el === document.activeElement)).toBe(true);
  } finally { await page.close(); }
}, 30_000);

it.skipIf(!enabled)('exposes an inaccessible external URL and a browser decode failure', async () => {
  const page = await openPage();
  try {
    const card = page.getByRole('button', { name: 'Open image: missing.png' }).first();
    await page.getByText('The browser could not load or decode this image.', { exact: true }).first().waitFor();
    const details = await hoverDetails(page, card, remote);
    expect(details).toContain(remote);
    expect(details).toContain('Private repository screenshot');
    expect(details).toContain('The browser could not load or decode this image.');
    const brokenUpload = page.getByRole('button', { name: 'Open image: undecodable.png' });
    await brokenUpload.locator('..').getByText('The browser could not load or decode this image.', { exact: true }).waitFor();
    expect(await hoverDetails(page, brokenUpload, '/api/attachments/undecodable.png')).toContain('The browser could not load or decode this image.');
  } finally { await page.close(); }
}, 30_000);

it.skipIf(!enabled)('keeps working thumbnails, keyboard details and full-size loading intact', async () => {
  const page = await openPage();
  const requests: string[] = [];
  page.on('request', req => requests.push(req.url()));
  try {
    const card = page.getByRole('button', { name: 'Open image: Uploaded diagram.svg' });
    await page.getByRole('img', { name: 'An uploaded diagram' }).waitFor();
    // Tip opens for keyboard focus even when the filename fits in its footer.
    await page.keyboard.press('Tab');
    await card.focus();
    const tooltip = page.getByRole('tooltip').filter({ hasText: '/api/attachments/good.svg' });
    await tooltip.waitFor();
    expect(await tooltip.textContent()).toContain('/api/attachments/good.svg');
    expect(requests.some(url => url.endsWith('/api/attachments/good.svg'))).toBe(false);
    await card.press('Enter');
    const dialog = page.getByRole('dialog');
    const image = dialog.getByRole('img', { name: 'An uploaded diagram' });
    await image.waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('[role="dialog"] img')].some(img => img.naturalWidth > 0));
    expect(requests.some(url => url.endsWith('/api/attachments/good.svg'))).toBe(true);
    expect(await hoverDetails(page, image, '/api/attachments/good.svg')).toContain('An uploaded diagram');
  } finally { await page.close(); }
}, 30_000);

it.skipIf(!enabled)('clears stale failures when an image source changes', async () => {
  const page = await openPage();
  try {
    const broken = page.getByRole('button', { name: 'Open image: missing.png' }).last();
    await broken.locator('..').getByText('Preview unavailable', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Change source', exact: true }).click();
    const recovered = page.getByRole('img', { name: 'Changing image' });
    await recovered.waitFor();
    await page.waitForFunction(() => document.querySelector<HTMLImageElement>('img[alt="Changing image"]')?.naturalWidth);
    const details = await hoverDetails(page, page.getByRole('button', { name: 'Open image: good.svg', exact: true }), '/good.svg');
    expect(details).toContain('/good.svg');
    expect(details).not.toContain('could not load');
  } finally { await page.close(); }
}, 30_000);
