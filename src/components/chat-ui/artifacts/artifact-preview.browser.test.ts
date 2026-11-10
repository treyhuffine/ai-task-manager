import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { HTML_PREVIEW_KEY_MESSAGE, HTML_PREVIEW_RESPONSE_CSP, HTML_PREVIEW_TAIL, htmlPreviewHead } from '@/lib/sessions/html-preview-document';

// Real image load/decode failures, tooltip focus, and image and HTML preview
// dialog interactions, keyboard included.
// RI_ARTIFACT_BROWSER_TEST=1 pnpm exec vitest run src/components/chat-ui/artifacts/artifact-preview.browser.test.ts
const enabled = process.env.RI_ARTIFACT_BROWSER_TEST === '1';
const remote = 'https://github.com/example/private/blob/revision/missing.png?raw=true';
const source = '/tmp/Screen Shot 100%.png';
// An artifact with a control to focus and a menu that uses Escape itself.
const galleryArtifact = `<main>
  <h1>Gallery</h1>
  <input aria-label="Filter shots">
  <button id="menu-button" onclick="document.getElementById('menu').hidden = false">Sort</button>
  <ul id="menu" role="menu" hidden><li>Newest</li></ul>
</main>
<script>
  document.addEventListener('keydown', event => {
    const menu = document.getElementById('menu');
    if (event.key === 'Escape' && !menu.hidden) { menu.hidden = true; event.preventDefault(); }
  });
</script>`;
let browser: Browser;
let server: http.Server;
let address: string;

beforeAll(async () => {
  if (!enabled) return;
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React, { useEffect, useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
      import { TipProvider } from './src/components/ui/tip';
      import { ArtifactPreviewProvider, useArtifactPreview } from './src/components/chat-ui/artifacts/artifact-preview-provider';
      import { ImagePreviewCard } from './src/components/chat-ui/artifacts/image-preview-card';
      import { ArtifactCard } from './src/components/chat-ui/artifacts/artifact-card';
      import { replyImageUrl } from './src/lib/sessions/reply-image-urls';
      const client = new QueryClient();
      function OpenHtml() {
        const open = useArtifactPreview();
        return <button onClick={event => open({ kind: 'html', sessionId: 'fixture', path: '/tmp/gallery.html' }, event.currentTarget)}>Open gallery preview</button>;
      }
      const galleryHtml = { kind: 'html', sessionId: 'fixture', path: '/tmp/gallery.html' };
      function App() {
        const [switched, setSwitched] = useState(false);
        // A reply that adds an image while the dialog is open, which blocks clicks outside it.
        const [arrived, setArrived] = useState(false);
        useEffect(() => { window.addGalleryImage = () => setArrived(true); }, []);
        return <QueryClientProvider client={client}><TipProvider><ArtifactPreviewProvider>
          <main className="p-8 space-y-4">
            <h1>Chat image previews</h1>
            <div><ImagePreviewCard src={replyImageUrl('fixture', ${JSON.stringify(source)})} alt="The dashboard screenshot" /></div>
            <div><ImagePreviewCard src={${JSON.stringify(remote)}} alt="Private repository screenshot" /></div>
            <div><ImagePreviewCard src="/api/attachments/good.svg" name="Uploaded diagram.svg" alt="An uploaded diagram" /></div>
            <div><ImagePreviewCard src="/api/attachments/undecodable.png" alt="Damaged image" /></div>
            <div><ImagePreviewCard src={switched ? '/good.svg' : '/missing.png'} alt="Changing image" /></div>
            <button onClick={() => setSwitched(true)}>Change source</button>
            <OpenHtml />
            {/* Last, so it pushes no lazy card above it out of view. */}
            <div><ImagePreviewCard src="/photos/large.svg" name="Large photo.svg" alt="A large photo" /></div>
          </main>
          <section role="log" aria-label="Gallery chat" className="p-8">
            <p><ImagePreviewCard src="/gallery/one.svg" alt="First shot" /></p>
            <div><div><ArtifactCard preview={galleryHtml} name="gallery.html" aria-label="Open HTML: gallery.html" icon={null}>HTML</ArtifactCard></div></div>
            <ImagePreviewCard src="/gallery/two.svg" alt="Second shot" />
            <div style={{ display: 'none' }}><ImagePreviewCard src="/gallery/hidden.svg" alt="Hidden copy" /></div>
            <ImagePreviewCard src="/gallery/three.svg" alt="Third shot" />
            {arrived && <ImagePreviewCard src="/gallery/four.svg" alt="Fourth shot" />}
          </section>
          <section role="log" aria-label="Other chat" className="p-8">
            <ImagePreviewCard src="/gallery/other.svg" alt="Other chat shot" />
          </section>
          <main>
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
    } else if (url.pathname.startsWith('/gallery/')) {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#0f766e"/></svg>');
    } else if (url.pathname === '/photos/large.svg') {
      // Larger than the dialog, so fit is under 100% and a click zooms to the image's own size.
      res.setHeader('Content-Type', 'image/svg+xml');
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1600"><rect width="2400" height="1600" fill="#0f172a"/><circle cx="1200" cy="800" r="300" fill="#f59e0b"/></svg>');
    } else if (url.pathname.endsWith('/good.svg')) {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#4f46e5"/></svg>');
    } else if (url.pathname.endsWith('/undecodable.png')) {
      res.setHeader('Content-Type', 'image/png');
      res.end('not an image');
    } else if (url.pathname === '/api/sessions/fixture/html') {
      // Served as the html route serves it: Ri's head and tail around the
      // file, under the same sandbox policy.
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Security-Policy', HTML_PREVIEW_RESPONSE_CSP);
      res.end(`<!doctype html>${htmlPreviewHead(url.searchParams.get('theme') === 'light' ? 'light' : 'dark')}${galleryArtifact}${HTML_PREVIEW_TAIL}`);
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
  // Headless Chromium drops some clicks into an out-of-process sandboxed
  // frame. In process, keys still reach only the focused frame's document.
  browser = await chromium.launch({ headless: true, executablePath: process.env.RI_REVIEW_CHROMIUM, args: ['--disable-features=IsolateSandboxedIframes'] });
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

async function hoverImageArea(page: Page, image: ReturnType<Page['locator']>) {
  await image.scrollIntoViewIfNeeded();
  const bounds = (await image.boundingBox())!;
  // Move naturally through the tooltip's transit area and onto the image.
  // Thumbnail hit testing reaches the card's stretched button by design.
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, { steps: 8 });
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
    expect(await dialog.locator('[data-slot="dialog-description"]').textContent()).toContain(source);
    await dialog.getByText('HTTP 404: The screenshot file was not found.', { exact: true }).waitFor();
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
    expect(await dialog.locator('[data-slot="dialog-description"]').textContent()).toContain('/api/attachments/good.svg');
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { (window as unknown as { copied: string }).copied = value; } } }));
    const copy = dialog.getByRole('button', { name: 'Copy link', exact: true });
    expect(await copy.innerText()).toContain('Copy link');
    await copy.click();
    expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toBe(`${address}/api/attachments/good.svg`);
  } finally { await page.close(); }
}, 30_000);

it.skipIf(!enabled)('keeps image and lightbox header hover clear while thumbnail title details and clicks still work', async () => {
  const page = await openPage();
  try {
    const card = page.getByRole('button', { name: 'Open image: Uploaded diagram.svg' });
    const image = page.getByRole('img', { name: 'An uploaded diagram' });
    await image.waitFor();
    await hoverImageArea(page, image);
    await page.waitForTimeout(700);
    expect(await page.getByRole('tooltip').count()).toBe(0);
    expect(await hoverDetails(page, card, '/api/attachments/good.svg')).toContain('An uploaded diagram');
    // Moving from the title back onto the image also hides the details.
    await hoverImageArea(page, image);
    await page.getByRole('tooltip').waitFor({ state: 'hidden' });
    await image.click({ force: true });
    const dialog = page.getByRole('dialog');
    const fullImage = dialog.getByRole('img', { name: 'An uploaded diagram' });
    await fullImage.waitFor();
    await hoverImageArea(page, fullImage);
    await page.waitForTimeout(700);
    expect(await page.getByRole('tooltip').count()).toBe(0);
    await dialog.locator('[data-slot="dialog-title"]').hover();
    await page.waitForTimeout(700);
    expect(await page.getByRole('tooltip').count()).toBe(0);
    const sourceText = dialog.locator('[data-slot="dialog-description"]');
    expect(await sourceText.textContent()).toContain('/api/attachments/good.svg');
    await sourceText.hover();
    await page.waitForTimeout(700);
    expect(await page.getByRole('tooltip').count()).toBe(0);
  } finally { await page.close(); }
}, 30_000);

it.skipIf(!enabled)('closes the image lightbox on the first Escape, with the pointer resting on the image', async () => {
  const page = await openPage();
  try {
    const card = page.getByRole('button', { name: 'Open image: Uploaded diagram.svg' });
    await page.getByRole('img', { name: 'An uploaded diagram' }).waitFor();
    await card.click();
    const dialog = page.getByRole('dialog');
    const fullImage = dialog.getByRole('img', { name: 'An uploaded diagram' });
    await fullImage.waitFor();
    // A hover tooltip over the image was a dismissable layer above the
    // dialog, so the first Escape only closed the tooltip.
    await hoverImageArea(page, fullImage);
    await page.waitForTimeout(700);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    expect(await card.evaluate(el => el === document.activeElement)).toBe(true);
  } finally { await page.close(); }
}, 30_000);

async function openLargePhoto(page: Page) {
  await page.getByRole('button', { name: 'Open image: Large photo.svg' }).click();
  const dialog = page.getByRole('dialog');
  const image = dialog.getByRole('img', { name: 'A large photo' });
  await image.waitFor();
  const zoom = dialog.getByRole('group', { name: 'Zoom' });
  const level = zoom.getByRole('button', { name: /^Fit to window/ });
  const percent = async () => Number((await level.textContent())?.replace('%', ''));
  await expect.poll(percent).toBeGreaterThan(0);
  // The dialog's opening animation, and each glide to a new zoom, settle first.
  const settle = () => page.waitForTimeout(350);
  await settle();
  return { dialog, image, zoom, percent, settle, box: async () => (await image.boundingBox())! };
}

it.skipIf(!enabled)('zooms an image in at the pointer on a click, pans it by drag and wheel, and goes back to fit', async () => {
  const page = await openPage();
  try {
    const { image, percent, settle, box } = await openLargePhoto(page);
    const fitPercent = await percent();
    expect(fitPercent).toBeLessThan(100);
    const fit = await box();
    // The whole image shows, centered in the space under the header, inside its margin.
    const stage = await image.evaluate(element => { const rect = element.parentElement!.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; });
    expect(Math.abs(fit.x + fit.width / 2 - (stage.x + stage.width / 2))).toBeLessThan(1);
    expect(Math.abs(fit.y + fit.height / 2 - (stage.y + stage.height / 2))).toBeLessThan(1);
    expect(Math.min(stage.width - 24 - fit.width, stage.height - 24 - fit.height)).toBeCloseTo(0, 0);
    expect(Math.abs(fit.width / 2400 * 100 - fitPercent)).toBeLessThanOrEqual(0.5);

    const at = { x: fit.x + fit.width * 0.7, y: fit.y + fit.height * 0.6 };
    await page.mouse.move(at.x, at.y);
    if (process.env.RI_ARTIFACT_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.RI_ARTIFACT_SCREENSHOTS, 'image-fit-hover.png') });
    await page.mouse.click(at.x, at.y);
    await expect.poll(percent).toBe(100);
    await settle();
    if (process.env.RI_ARTIFACT_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.RI_ARTIFACT_SCREENSHOTS, 'image-zoomed.png') });
    const zoomed = await box();
    expect(zoomed.width).toBeCloseTo(2400, 0);
    // The point clicked is still under the pointer.
    expect(Math.abs(zoomed.x + zoomed.width * 0.7 - at.x)).toBeLessThan(2);
    expect(Math.abs(zoomed.y + zoomed.height * 0.6 - at.y)).toBeLessThan(2);
    expect(await image.evaluate(element => getComputedStyle(element.parentElement!).cursor)).toBe('grab');

    // A drag moves it and is not a click.
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x - 150, at.y - 80, { steps: 6 });
    await page.mouse.up();
    const dragged = await box();
    expect(dragged.x - zoomed.x).toBeCloseTo(-150, 0);
    expect(dragged.y - zoomed.y).toBeCloseTo(-80, 0);
    expect(await percent()).toBe(100);

    // So does scrolling, two fingers on a trackpad or a mouse wheel.
    await page.mouse.wheel(0, 100);
    await expect.poll(async () => Math.round((await box()).y - dragged.y)).toBe(-100);

    // Dragging far past the edge stops with the image still covering the view.
    await page.mouse.down();
    await page.mouse.move(at.x + 3000, at.y + 3000, { steps: 4 });
    await page.mouse.up();
    const edge = await box();
    expect(Math.abs(edge.x - stage.x)).toBeLessThan(1);
    expect(Math.abs(edge.y - stage.y)).toBeLessThan(1);

    // Another click goes back to fit.
    await page.mouse.click(at.x, at.y);
    await expect.poll(percent).toBe(fitPercent);
    await settle();
    const back = await box();
    expect(Math.abs(back.x - fit.x)).toBeLessThan(1);
    expect(Math.abs(back.width - fit.width)).toBeLessThan(1);
    expect(await image.evaluate(element => getComputedStyle(element.parentElement!).cursor)).toBe('zoom-in');
  } finally { await page.close(); }
}, 30_000);

it.skipIf(!enabled)('zooms with Ctrl and the wheel, the keys and the control, keeps Escape closing, and opens the next file fit', async () => {
  const page = await openPage();
  try {
    const { dialog, zoom, percent, settle } = await openLargePhoto(page);
    const fitPercent = await percent();
    const zoomOut = zoom.getByRole('button', { name: 'Zoom out' });
    const zoomIn = zoom.getByRole('button', { name: 'Zoom in' });
    expect(await zoomOut.getAttribute('aria-disabled')).toBe('true');

    // A trackpad pinch arrives as Ctrl and the wheel. The page itself doesn't zoom.
    const image = dialog.getByRole('img', { name: 'A large photo' });
    const center = (await image.boundingBox())!;
    await page.mouse.move(center.x + center.width / 2, center.y + center.height / 2);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await expect.poll(percent).toBeGreaterThan(fitPercent);
    expect(Math.abs(await percent() - fitPercent * Math.exp(0.25))).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);

    // Keys work from wherever focus is in the dialog, its header's buttons included.
    await dialog.getByRole('button', { name: 'Copy link' }).focus().catch(() => undefined);
    await page.keyboard.press('0');
    await expect.poll(percent).toBe(fitPercent);
    await page.keyboard.press('+');
    await expect.poll(percent).toBe(Math.round(fitPercent * 1.5));
    await page.keyboard.press('=');
    await expect.poll(async () => Math.abs(await percent() - fitPercent * 2.25)).toBeLessThanOrEqual(1);
    await page.keyboard.press('-');
    await expect.poll(async () => Math.abs(await percent() - fitPercent * 1.5)).toBeLessThanOrEqual(1);
    expect(await zoomOut.getAttribute('aria-disabled')).toBeNull();

    // The control: out to fit stops there with focus kept, in, and the percent back to fit.
    await zoomOut.click();
    await expect.poll(percent).toBe(fitPercent);
    // Only looks unavailable, so it can still be pressed (Playwright won't, unforced).
    await zoomOut.click({ force: true });
    expect(await percent()).toBe(fitPercent);
    expect(await zoomOut.evaluate(element => element === document.activeElement)).toBe(true);
    await zoomIn.click();
    await expect.poll(percent).toBe(Math.round(fitPercent * 1.5));
    await zoom.getByRole('button', { name: /^Fit to window/ }).click();
    await expect.poll(percent).toBe(fitPercent);

    // The previous file and back: the image opens fit again.
    await zoomIn.click();
    await expect.poll(percent).toBeGreaterThan(fitPercent);
    await page.keyboard.press('ArrowLeft');
    await dialog.locator('[data-slot="dialog-title"]', { hasText: 'missing.png' }).waitFor();
    await page.keyboard.press('ArrowRight');
    await dialog.locator('[data-slot="dialog-title"]', { hasText: 'Large photo.svg' }).waitFor();
    await expect.poll(percent).toBe(fitPercent);

    // Zoomed in, the first Escape still closes the dialog.
    await settle();
    const fit = (await image.boundingBox())!;
    await page.mouse.click(fit.x + fit.width / 2, fit.y + fit.height / 2);
    await expect.poll(percent).toBe(100);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    expect(await page.getByRole('button', { name: 'Open image: Large photo.svg' }).evaluate(element => element === document.activeElement)).toBe(true);
  } finally { await page.close(); }
}, 30_000);

it.skipIf(!enabled)('pinches with two fingers on a touch screen, and a tap zooms', async () => {
  const page = await openPage();
  try {
    const { image, percent, settle } = await openLargePhoto(page);
    const fitPercent = await percent();
    const fit = (await image.boundingBox())!;
    const cx = fit.x + fit.width / 2;
    const cy = fit.y + fit.height / 2;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: { x: number; y: number }[]) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((point, id) => ({ ...point, id })) });
    // Fingers 100 px apart spread to 300 px: three times as far, so three times the zoom.
    await touch('touchStart', [{ x: cx - 50, y: cy }, { x: cx + 50, y: cy }]);
    for (const spread of [80, 110, 150]) await touch('touchMove', [{ x: cx - spread, y: cy }, { x: cx + spread, y: cy }]);
    await touch('touchEnd', []);
    await expect.poll(async () => Math.abs(await percent() - fitPercent * 3)).toBeLessThanOrEqual(1);
    // Lifting the fingers was not a tap.
    await page.waitForTimeout(100);
    expect(Math.abs(await percent() - fitPercent * 3)).toBeLessThanOrEqual(1);

    // A tap zoomed in goes back to fit.
    await touch('touchStart', [{ x: cx, y: cy }]);
    await touch('touchEnd', []);
    await expect.poll(percent).toBe(fitPercent);
    await settle();
  } finally { await page.close(); }
}, 30_000);

async function openGallery(page: Page) {
  const opener = page.getByRole('button', { name: 'Open gallery preview', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  const frame = page.frameLocator('iframe[title="HTML preview: gallery.html"]');
  await frame.getByRole('heading', { name: 'Gallery' }).waitFor();
  return { opener, dialog, frame };
}

it.skipIf(!enabled)('closes an HTML preview on Escape after focus moves into the artifact', async () => {
  const page = await openPage();
  try {
    const { opener, dialog, frame } = await openGallery(page);
    // Escape before anything inside is focused, as with an image.
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    expect(await opener.evaluate(el => el === document.activeElement)).toBe(true);

    await openGallery(page);
    await frame.getByRole('heading', { name: 'Gallery' }).click();
    expect(await frame.locator('body').evaluate(() => document.hasFocus())).toBe(true);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    expect(await opener.evaluate(el => el === document.activeElement)).toBe(true);

    await openGallery(page);
    const filter = frame.getByRole('textbox', { name: 'Filter shots' });
    await filter.click();
    await page.keyboard.type('dusk');
    expect(await filter.inputValue()).toBe('dusk');
    expect(await filter.evaluate(el => el === document.activeElement && document.hasFocus())).toBe(true);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
  } finally { await page.close(); }
}, 30_000);

it.skipIf(!enabled)('leaves an Escape the artifact used to it, and ignores messages from anywhere but the frame', async () => {
  const page = await openPage();
  try {
    const { dialog, frame } = await openGallery(page);
    await frame.getByRole('button', { name: 'Sort', exact: true }).click();
    const menu = frame.getByRole('menu');
    await menu.waitFor();
    expect(await menu.evaluate(() => document.hasFocus())).toBe(true);
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden' });
    await page.waitForTimeout(300);
    expect(await dialog.isVisible()).toBe(true);
    // Ri's own window posting the same message is not the frame.
    await page.evaluate(type => window.postMessage({ type, key: 'Escape' }, '*'), HTML_PREVIEW_KEY_MESSAGE);
    await page.waitForTimeout(300);
    expect(await dialog.isVisible()).toBe(true);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
  } finally { await page.close(); }
}, 30_000);

async function expectShown(page: Page, title: string, position: string | null) {
  const dialog = page.getByRole('dialog');
  await dialog.locator('[data-slot="dialog-title"]', { hasText: title }).waitFor();
  if (position) await dialog.getByText(position, { exact: true }).waitFor();
  else expect(await dialog.getByRole('button', { name: 'Next preview' }).count()).toBe(0);
}

it.skipIf(!enabled)('moves through the chat\'s images and HTML with the arrow keys, in transcript order, stopping at the ends', async () => {
  const page = await openPage();
  try {
    await page.getByRole('button', { name: 'Open image: one.svg' }).click();
    await expectShown(page, 'one.svg', '1 of 4');
    const dialog = page.getByRole('dialog');
    expect(await dialog.getByRole('button', { name: 'Previous preview' }).isDisabled()).toBe(true);
    await page.keyboard.press('ArrowLeft');
    await expectShown(page, 'one.svg', '1 of 4');
    await page.keyboard.press('ArrowRight');
    await expectShown(page, 'gallery.html', '2 of 4');
    await page.frameLocator('iframe[title="HTML preview: gallery.html"]').getByRole('heading', { name: 'Gallery' }).waitFor();
    // Focus is still Ri's, so the next press moves on past the artifact.
    await page.keyboard.press('ArrowRight');
    await expectShown(page, 'two.svg', '3 of 4');
    await dialog.getByRole('img', { name: 'Second shot' }).waitFor();
    if (process.env.RI_ARTIFACT_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.RI_ARTIFACT_SCREENSHOTS, 'lightbox-navigation.png') });
    // The hidden copy of the layout is not a stop.
    await page.keyboard.press('ArrowRight');
    await expectShown(page, 'three.svg', '4 of 4');
    expect(await dialog.getByRole('button', { name: 'Next preview' }).isDisabled()).toBe(true);
    await page.keyboard.press('ArrowRight');
    await expectShown(page, 'three.svg', '4 of 4');
    await dialog.getByRole('button', { name: 'Previous preview' }).click();
    await expectShown(page, 'two.svg', '3 of 4');
    // Closing returns to the card last shown, not the one first opened.
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    expect(await page.getByRole('button', { name: 'Open image: two.svg' }).evaluate(el => el === document.activeElement)).toBe(true);
  } finally { await page.close(); }
}, 30_000);

it.skipIf(!enabled)('leaves arrow keys inside an HTML artifact to the artifact', async () => {
  const page = await openPage();
  try {
    await page.getByRole('button', { name: 'Open HTML: gallery.html' }).click();
    await expectShown(page, 'gallery.html', '2 of 4');
    const filter = page.frameLocator('iframe[title="HTML preview: gallery.html"]').getByRole('textbox', { name: 'Filter shots' });
    await filter.click();
    await page.keyboard.type('dusk');
    expect(await filter.evaluate(el => el === document.activeElement && document.hasFocus())).toBe(true);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    await expectShown(page, 'gallery.html', '2 of 4');
    expect(await filter.inputValue()).toBe('dusk');
  } finally { await page.close(); }
}, 30_000);

it.skipIf(!enabled)('keeps other chats out, and takes in a card that arrives while the dialog is open', async () => {
  const page = await openPage();
  try {
    await page.getByRole('button', { name: 'Open image: other.svg' }).click();
    await expectShown(page, 'other.svg', null);
    await page.keyboard.press('ArrowLeft');
    await expectShown(page, 'other.svg', null);
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });

    await page.getByRole('button', { name: 'Open image: three.svg' }).click();
    await expectShown(page, 'three.svg', '4 of 4');
    await page.evaluate(() => (window as unknown as { addGalleryImage: () => void }).addGalleryImage());
    await expectShown(page, 'three.svg', '4 of 5');
    await page.keyboard.press('ArrowRight');
    await expectShown(page, 'four.svg', '5 of 5');
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
