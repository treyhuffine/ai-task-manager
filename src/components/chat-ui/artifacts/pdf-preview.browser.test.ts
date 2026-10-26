import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { makePdf } from '@/test/fixtures/pdf';
import { pdfResponse } from '@/lib/attachments/pdf-delivery';

// PDF cards and the preview dialog in a real Chromium with its PDF viewer:
// thumbnails drawn by the Home's renderer, the browser's viewer, Download,
// Previous and Next, errors, and page images for a browser without a viewer.
// RI_ARTIFACT_BROWSER_TEST=1 pnpm exec vitest run src/components/chat-ui/artifacts/pdf-preview.browser.test.ts
const enabled = process.env.RI_ARTIFACT_BROWSER_TEST === '1';
const REPORT = makePdf(['Member offers', 'Annual and Lifetime', 'Payment recovery']);
const AGENDA = makePdf(['Friday agenda']);
let home: TestHome;
let browser: Browser;
let server: http.Server;
let address: string;

beforeAll(async () => {
  if (!enabled) return;
  home = await createTestHome({ prefix: 'ri-pdf-browser-', openDb: false });
  const files = path.join(home.root, 'files');
  fs.mkdirSync(files);
  fs.writeFileSync(path.join(files, 'member-offers.pdf'), REPORT);
  fs.writeFileSync(path.join(files, 'agenda.pdf'), AGENDA);
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
      import { TipProvider } from './src/components/ui/tip';
      import { ArtifactPreviewProvider } from './src/components/chat-ui/artifacts/artifact-preview-provider';
      import { ImagePreviewCard } from './src/components/chat-ui/artifacts/image-preview-card';
      import { PdfPreviewCard } from './src/components/chat-ui/artifacts/pdf-preview-card';
      import { MessageFileChip } from './src/components/chat-ui/artifacts/message-file-chip';
      import { sessionPdfUrl } from './src/lib/sessions/reply-pdf';
      const client = new QueryClient();
      function App() {
        return <QueryClientProvider client={client}><TipProvider><ArtifactPreviewProvider>
          <section role="log" aria-label="Chat" className="p-8 space-y-4">
            <p>Here is the report:</p>
            <PdfPreviewCard src={sessionPdfUrl('fixture', '/tmp/exports/member-offers.pdf')} name="member-offers.pdf" source="/tmp/exports/member-offers.pdf" />
            <ImagePreviewCard src="/shot.svg" alt="A screenshot" name="shot.svg" />
            <MessageFileChip attachment={{ fileName: 'agenda.pdf', originalName: 'Friday agenda.pdf', mimeType: 'application/pdf', size: ${AGENDA.byteLength}, uploadedAt: '2026-10-19T10:00:00Z' }} variant="block" />
            <PdfPreviewCard src={sessionPdfUrl('fixture', '/tmp/exports/gone.pdf')} name="gone.pdf" source="/tmp/exports/gone.pdf" />
          </section>
        </ArtifactPreviewProvider></TipProvider></QueryClientProvider>;
      }
      createRoot(document.getElementById('root')).render(<App />);
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env': '{"NODE_ENV":"development"}' }, loader: { '.css': 'empty' },
  });
  const require = createRequire(import.meta.url);
  const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
  const tailwind = require('@tailwindcss/postcss');
  const cssFile = path.resolve('src/app/globals.css');
  const css = await postcss([tailwind({ base: process.cwd() })]).process(fs.readFileSync(cssFile, 'utf8'), { from: cssFile });
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://fixture');
    // The real delivery, renderer included, for the two PDFs.
    // With or without the file name the viewer's URL ends in.
    const pdf = /^\/api\/sessions\/fixture\/pdf(?:\/[^/]+)?$/.test(url.pathname) ? url.searchParams.get('path')?.split('/').at(-1)
      : /^\/api\/attachments\/agenda\.pdf(?:\/[^/]+)?$/.test(url.pathname) ? 'agenda.pdf' : null;
    if (pdf) {
      if (pdf === 'gone.pdf' && url.pathname.includes('/sessions/')) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'This PDF is no longer there.' }));
        return;
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(key, value);
      const response = await pdfResponse(new Request(`http://fixture${req.url}`, { headers }), path.join(files, pdf), url.searchParams.get('name') ?? pdf);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } else if (url.pathname === '/bundle.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(bundle.outputFiles[0].text);
    } else if (url.pathname === '/styles.css') {
      res.setHeader('Content-Type', 'text/css');
      res.end(css.css);
    } else if (url.pathname === '/shot.svg') {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#0f766e"/></svg>');
    } else if (url.pathname === '/api/session') {
      res.writeHead(204);
      res.end();
    } else {
      res.setHeader('Content-Type', 'text/html');
      res.end('<link rel="stylesheet" href="/styles.css"><div id="root"></div><script src="/bundle.js"></script>');
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  // The full Chromium build: the headless shell has no PDF viewer.
  browser = await chromium.launch({ channel: 'chromium', headless: true, executablePath: process.env.RI_REVIEW_CHROMIUM });
}, 90_000);

afterAll(async () => {
  await browser?.close();
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  await home?.cleanup();
});

async function openPage(options: { noViewer?: boolean } = {}) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 1000 }, acceptDownloads: true });
  // Android's Chrome reports no PDF viewer.
  if (options.noViewer) await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'pdfViewerEnabled', { get: () => false }));
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  await page.goto(address);
  return page;
}

async function thumbnailDrawn(page: Page, card: ReturnType<Page['locator']>) {
  const image = card.locator('xpath=ancestor::span[1]').locator('img');
  await image.waitFor();
  await page.waitForFunction(element => element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0, await image.elementHandle());
  return image.evaluate(element => ({ width: (element as HTMLImageElement).naturalWidth, alt: (element as HTMLImageElement).alt }));
}

it.skipIf(!enabled)('shows first-page thumbnails for a reply PDF and an uploaded one', async () => {
  const page = await openPage();
  try {
    expect(await thumbnailDrawn(page, page.getByRole('button', { name: 'Open PDF: member-offers.pdf' }))).toEqual({ width: 480, alt: 'First page of member-offers.pdf' });
    expect(await thumbnailDrawn(page, page.getByRole('button', { name: 'Open PDF: Friday agenda.pdf' }))).toEqual({ width: 480, alt: 'First page of Friday agenda.pdf' });
    const missing = page.getByRole('button', { name: 'Open PDF: gone.pdf' }).locator('xpath=ancestor::span[1]');
    await missing.getByText('HTTP 404: This PDF is no longer there.').waitFor();
    if (process.env.RI_ARTIFACT_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.RI_ARTIFACT_SCREENSHOTS, 'pdf-cards.png') });
  } finally { await page.context().close(); }
}, 60_000);

it.skipIf(!enabled)("opens the PDF in the browser's viewer, downloads it, and steps through the chat's previews", async () => {
  const page = await openPage();
  try {
    await page.getByRole('button', { name: 'Open PDF: member-offers.pdf' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    expect(await dialog.locator('[data-slot="dialog-title"]').textContent()).toBe('member-offers.pdf');
    expect(await dialog.locator('[data-slot="dialog-description"]').textContent()).toContain('/tmp/exports/member-offers.pdf');
    await dialog.locator('iframe[title="PDF: member-offers.pdf"]').waitFor();
    // Chrome's viewer took the frame: its extension page loaded inside it,
    // for the URL that ends in the file's name.
    await expect.poll(() => page.frames().some(frame => frame.url().startsWith('chrome-extension://')), { timeout: 15_000 }).toBe(true);
    expect(await dialog.locator('iframe').getAttribute('src')).toBe('/api/sessions/fixture/pdf/member-offers.pdf?path=%2Ftmp%2Fexports%2Fmember-offers.pdf');
    await page.waitForTimeout(1500);
    if (process.env.RI_ARTIFACT_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.RI_ARTIFACT_SCREENSHOTS, 'pdf-dialog.png') });

    const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('link', { name: 'Download' }).click()]);
    expect(download.suggestedFilename()).toBe('member-offers.pdf');
    expect(fs.readFileSync((await download.path())!).equals(REPORT)).toBe(true);

    // Previous and Next move through every preview in the chat, PDFs included.
    expect(await dialog.getByText('1 of 4').count()).toBe(1);
    await page.keyboard.press('ArrowRight');
    await dialog.getByText('2 of 4').waitFor();
    expect(await dialog.locator('[data-slot="dialog-title"]').textContent()).toBe('shot.svg');
    expect(await dialog.getByRole('link', { name: 'Download' }).count()).toBe(0);
    await page.keyboard.press('ArrowRight');
    await dialog.getByText('3 of 4').waitFor();
    expect(await dialog.locator('[data-slot="dialog-description"]').textContent()).toContain('/api/attachments/agenda.pdf');
    const [upload] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('link', { name: 'Download' }).click()]);
    expect(upload.suggestedFilename()).toBe('Friday agenda.pdf');
    expect(fs.readFileSync((await upload.path())!).equals(AGENDA)).toBe(true);

    // A PDF that can't open says why, in Ri, with a way to try again.
    await page.keyboard.press('ArrowRight');
    await dialog.getByText('4 of 4').waitFor();
    await dialog.getByText('HTTP 404: This PDF is no longer there.').waitFor();
    await dialog.getByRole('button', { name: 'Try again' }).waitFor();
    expect(await dialog.locator('iframe').count()).toBe(0);
  } finally { await page.context().close(); }
}, 60_000);

it.skipIf(!enabled)('shows the pages as images in a browser without a PDF viewer', async () => {
  const page = await openPage({ noViewer: true });
  try {
    await page.getByRole('button', { name: 'Open PDF: member-offers.pdf' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('Pages are shown as images here. Download the PDF to search or copy its text.').waitFor();
    expect(await dialog.locator('iframe').count()).toBe(0);
    // Later pages load as the reader scrolls toward them.
    const scroller = dialog.locator('.overflow-y-auto');
    for (const n of [1, 2, 3]) {
      const image = dialog.getByRole('img', { name: `Page ${n} of member-offers.pdf` });
      await expect.poll(async () => {
        await scroller.evaluate(element => element.scrollBy(0, 400));
        return image.count();
      }, { timeout: 15_000 }).toBe(1);
      await page.waitForFunction(element => element instanceof HTMLImageElement && element.complete && element.naturalWidth === 1280, await image.elementHandle());
    }
    if (process.env.RI_ARTIFACT_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.RI_ARTIFACT_SCREENSHOTS, 'pdf-pages.png') });
    await dialog.getByRole('link', { name: 'Download' }).waitFor();
  } finally { await page.context().close(); }
}, 60_000);
