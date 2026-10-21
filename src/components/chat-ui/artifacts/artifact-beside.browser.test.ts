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
import { HTML_PREVIEW_RESPONSE_CSP, HTML_PREVIEW_TAIL, htmlPreviewHead } from '@/lib/sessions/html-preview-document';
import { PREVIEW_PLACE_KEY } from '@/lib/client/preview-place';

// Files beside the chat, in a real Chromium with its PDF viewer: a chat and
// the panel beside it, the way Home's second panel, an execution's tools and
// an agent's tools hold a file as one more tab. Opening, closing, coming
// back from the card, the Large or Beside switch and the place it remembers,
// keys, and the chats with no panel beside them.
// RI_ARTIFACT_BROWSER_TEST=1 pnpm exec vitest run src/components/chat-ui/artifacts/artifact-beside.browser.test.ts
const enabled = process.env.RI_ARTIFACT_BROWSER_TEST === '1';
const REPORT = makePdf(['Member offers', 'Annual and Lifetime']);
const AGENDA = makePdf(['Friday agenda']);
const galleryArtifact = '<main><h1>Gallery</h1><input aria-label="Filter shots"></main>';
let home: TestHome;
let browser: Browser;
let server: http.Server;
let address: string;

beforeAll(async () => {
  if (!enabled) return;
  home = await createTestHome({ prefix: 'ri-beside-browser-', openDb: false });
  const files = path.join(home.root, 'files');
  fs.mkdirSync(files);
  fs.writeFileSync(path.join(files, 'member-offers.pdf'), REPORT);
  fs.writeFileSync(path.join(files, 'agenda.pdf'), AGENDA);
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React, { useEffect, useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
      import { TipProvider } from './src/components/ui/tip';
      import { ArtifactPreviewProvider, useBesidePreview, useBesideRegion } from './src/components/chat-ui/artifacts/artifact-preview-provider';
      import { BesideFileTab, BesideFileView } from './src/components/chat-ui/artifacts/artifact-beside';
      import { ImagePreviewCard } from './src/components/chat-ui/artifacts/image-preview-card';
      import { PdfPreviewCard } from './src/components/chat-ui/artifacts/pdf-preview-card';
      import { HtmlPreviewLink } from './src/components/chat-ui/artifacts/html-preview-link';
      import { MessageFileChip } from './src/components/chat-ui/artifacts/message-file-chip';
      import { sessionPdfUrl } from './src/lib/sessions/reply-pdf';
      const client = new QueryClient();
      const host = 'home:a';
      // A panel beside the chat with a tab of its own, as Home's Deck panel.
      function Panel() {
        const [fileShown, setFileShown] = useState(false);
        const [available, setAvailable] = useState(true);
        useEffect(() => { window.setPanelOnScreen = setAvailable; }, []);
        const file = useBesidePreview(host);
        const shown = fileShown && !!file;
        useBesideRegion(host, { available, side: 'right', showing: available && shown, show: () => setFileShown(true) });
        return <aside aria-label="Beside the chat" className="relative flex min-h-0 w-[620px] shrink-0 flex-col border-l border-border">
          <div className="flex h-9 shrink-0 items-stretch border-b border-border">
            <button aria-pressed={!shown} onClick={() => setFileShown(false)} className="px-3 text-[11px]">Deck</button>
            <BesideFileTab host={host} active={shown} onSelect={() => setFileShown(true)} className={'border-b-2 px-3 text-[11px] ' + (shown ? 'border-primary text-primary' : 'border-transparent text-muted-foreground')} />
          </div>
          <div className="relative min-h-0 flex-1">
            <div inert={shown} className="p-4"><h2>Deck</h2><p>Today's work</p></div>
            {file && <div inert={!shown} className={'absolute inset-0 ' + (shown ? '' : 'pointer-events-none opacity-0')}><BesideFileView host={host} /></div>}
          </div>
        </aside>;
      }
      function App() {
        return <QueryClientProvider client={client}><TipProvider><ArtifactPreviewProvider>
          <div className="flex h-dvh">
            <div data-preview-host={host} className="flex min-w-0 flex-1 flex-col">
              <section role="log" aria-label="Chat" className="min-h-0 flex-1 overflow-y-auto p-6 space-y-3">
                <p>Here is the report:</p>
                <PdfPreviewCard src={sessionPdfUrl('fixture', '/tmp/exports/member-offers.pdf')} name="member-offers.pdf" source="/tmp/exports/member-offers.pdf" />
                <ImagePreviewCard src="/shot.svg" alt="A screenshot" name="shot.svg" />
                <HtmlPreviewLink sessionId="fixture" path="/tmp/gallery.html">gallery.html</HtmlPreviewLink>
                <MessageFileChip attachment={{ fileName: 'agenda.pdf', originalName: 'Friday agenda.pdf', mimeType: 'application/pdf', size: ${AGENDA.byteLength}, uploadedAt: '2026-10-19T10:00:00Z' }} variant="block" />
              </section>
              <textarea aria-label="Message" className="m-3 border border-border" />
            </div>
            <Panel />
          </div>
          <div role="dialog" aria-label="A task's chat" className="fixed bottom-2 left-2 bg-background p-2">
            <ImagePreviewCard src="/other.svg" alt="In a slideout" name="other.svg" />
          </div>
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
    const pdf = /^\/api\/sessions\/fixture\/pdf(?:\/[^/]+)?$/.test(url.pathname) ? url.searchParams.get('path')?.split('/').at(-1)
      : /^\/api\/attachments\/agenda\.pdf(?:\/[^/]+)?$/.test(url.pathname) ? 'agenda.pdf' : null;
    if (pdf) {
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
    } else if (url.pathname.endsWith('.svg')) {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#0f766e"/></svg>');
    } else if (url.pathname === '/api/sessions/fixture/html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Security-Policy', HTML_PREVIEW_RESPONSE_CSP);
      res.end(`<!doctype html>${htmlPreviewHead('dark')}${galleryArtifact}${HTML_PREVIEW_TAIL}`);
    } else if (url.pathname === '/api/session') {
      res.writeHead(204);
      res.end();
    } else if (url.pathname.startsWith('/api/')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not in this fixture.' }));
    } else {
      res.setHeader('Content-Type', 'text/html');
      res.end('<link rel="stylesheet" href="/styles.css"><div id="root"></div><script src="/bundle.js"></script>');
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  // The full Chromium build, for its PDF viewer. In-process sandboxed frames
  // take clicks reliably when headless.
  browser = await chromium.launch({ channel: 'chromium', headless: true, executablePath: process.env.RI_REVIEW_CHROMIUM, args: ['--disable-features=IsolateSandboxedIframes'] });
}, 90_000);

afterAll(async () => {
  await browser?.close();
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  await home?.cleanup();
});

async function openPage() {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  await page.goto(address);
  return page;
}

const card = (page: Page, name: string) => page.getByRole('button', { name });
const view = (page: Page, name: string) => page.getByRole('region', { name: `${name}, beside the chat` });
const tab = (page: Page, name: string) => page.getByRole('complementary', { name: 'Beside the chat' }).getByRole('button', { name, exact: true });
const focused = (locator: ReturnType<Page['locator']>) => locator.evaluate(element => element === document.activeElement);
const storedPlace = (page: Page) => page.evaluate(key => localStorage.getItem(key), PREVIEW_PLACE_KEY);
/** The file's view is mounted and in front (not behind the panel's own tab). */
const inFront = (page: Page, name: string) => page.locator(`section[aria-label="${name}, beside the chat"]`).evaluate(element => !element.closest('[inert]'));

async function shot(page: Page, name: string) {
  if (process.env.RI_ARTIFACT_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.RI_ARTIFACT_SCREENSHOTS, name) });
}

it.skipIf(!enabled)('opens a PDF beside the chat as a tab, closes it, and brings it back from its card', async () => {
  const page = await openPage();
  try {
    const pdf = card(page, 'Open PDF: member-offers.pdf');
    await pdf.click();
    const beside = view(page, 'member-offers.pdf');
    await beside.locator('iframe[title="PDF: member-offers.pdf"]').waitFor();
    expect(await page.getByRole('dialog', { name: 'member-offers.pdf' }).count()).toBe(0);
    await beside.getByText('/tmp/exports/member-offers.pdf', { exact: true }).waitFor();
    await beside.getByText('1 of 4', { exact: true }).waitFor();
    expect(await pdf.getAttribute('aria-current')).toBe('true');
    expect(await tab(page, 'member-offers.pdf').getAttribute('aria-pressed')).toBe('true');
    await expect.poll(() => page.frames().some(frame => frame.url().startsWith('chrome-extension://')), { timeout: 15_000 }).toBe(true);

    // The chat stays usable beside it: no dialog takes the page.
    const composer = page.getByRole('textbox', { name: 'Message' });
    await composer.click();
    await page.keyboard.type('What does page 2 say?');
    expect(await composer.inputValue()).toBe('What does page 2 say?');
    await page.waitForTimeout(800);
    await shot(page, 'beside-pdf.png');

    // × puts it away, and focus goes back to its card.
    await page.getByRole('button', { name: 'Close member-offers.pdf' }).click();
    await beside.waitFor({ state: 'detached' });
    expect(await tab(page, 'member-offers.pdf').count()).toBe(0);
    expect(await focused(pdf)).toBe(true);
    expect(await pdf.getAttribute('aria-current')).toBeNull();
    await page.getByRole('heading', { name: 'Deck' }).waitFor();

    // Clicking the card brings it back.
    await pdf.click();
    await beside.waitFor();

    // The panel's own tab comes forward and the file waits behind it as a
    // tab, still loaded. Its card isn't marked while it's out of sight.
    const viewer = await beside.locator('iframe').elementHandle();
    await page.getByRole('button', { name: 'Deck', exact: true }).click();
    await expect.poll(() => inFront(page, 'member-offers.pdf')).toBe(false);
    expect(await tab(page, 'member-offers.pdf').getAttribute('aria-pressed')).toBe('false');
    expect(await pdf.getAttribute('aria-current')).toBeNull();
    await tab(page, 'member-offers.pdf').click();
    await expect.poll(() => inFront(page, 'member-offers.pdf')).toBe(true);
    expect(await viewer!.evaluate(element => element.isConnected)).toBe(true);
    expect(await pdf.getAttribute('aria-current')).toBe('true');
    await page.getByRole('button', { name: 'Deck', exact: true }).click();
    // Its card brings it forward as well.
    await pdf.click();
    await expect.poll(() => inFront(page, 'member-offers.pdf')).toBe(true);

    // Another card takes the same tab.
    await card(page, 'Open PDF: Friday agenda.pdf').click();
    await view(page, 'Friday agenda.pdf').waitFor();
    expect(await page.getByRole('region', { name: /beside the chat$/ }).count()).toBe(1);
    expect(await pdf.getAttribute('aria-current')).toBeNull();
    expect(await card(page, 'Open PDF: Friday agenda.pdf').getAttribute('aria-current')).toBe('true');
  } finally { await page.context().close(); }
}, 60_000);

it.skipIf(!enabled)('moves a file between beside and large, and opens the next one wherever the last one went', async () => {
  const page = await openPage();
  try {
    const image = card(page, 'Open image: shot.svg');
    await image.click();
    const beside = view(page, 'shot.svg');
    await beside.getByRole('img', { name: 'A screenshot' }).waitFor();
    expect(await beside.getByRole('button', { name: 'Show beside the chat' }).getAttribute('aria-pressed')).toBe('true');
    await beside.getByRole('button', { name: 'Show large' }).click();

    const dialog = page.getByRole('dialog', { name: 'shot.svg' });
    await dialog.getByRole('img', { name: 'A screenshot' }).waitFor();
    expect(await view(page, 'shot.svg').count()).toBe(0);
    expect(await tab(page, 'shot.svg').count()).toBe(0);
    expect(await storedPlace(page)).toBe('large');
    expect(await dialog.getByRole('button', { name: 'Show large' }).getAttribute('aria-pressed')).toBe('true');
    await shot(page, 'large-with-switch.png');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    expect(await focused(image)).toBe(true);

    // Files open large now, until one moves back beside the chat.
    const pdf = card(page, 'Open PDF: member-offers.pdf');
    await pdf.click();
    const large = page.getByRole('dialog', { name: 'member-offers.pdf' });
    await large.locator('iframe[title="PDF: member-offers.pdf"]').waitFor();
    await large.getByRole('button', { name: 'Show beside the chat' }).click();
    await large.waitFor({ state: 'hidden' });
    await view(page, 'member-offers.pdf').locator('iframe[title="PDF: member-offers.pdf"]').waitFor();
    expect(await storedPlace(page)).toBe('beside');
    expect(await focused(pdf)).toBe(true);

    // The choice outlasts the page.
    await view(page, 'member-offers.pdf').getByRole('button', { name: 'Show large' }).click();
    await page.getByRole('dialog', { name: 'member-offers.pdf' }).waitFor();
    await page.reload();
    await card(page, 'Open image: shot.svg').click();
    await page.getByRole('dialog', { name: 'shot.svg' }).waitFor();
    await page.getByRole('dialog', { name: 'shot.svg' }).getByRole('button', { name: 'Show beside the chat' }).click();
    await page.reload();
    await card(page, 'Open image: shot.svg').click();
    await view(page, 'shot.svg').waitFor();
    expect(await page.getByRole('dialog', { name: 'shot.svg' }).count()).toBe(0);
  } finally { await page.context().close(); }
}, 60_000);

it.skipIf(!enabled)('steps with the arrow keys while focus is in the file, closes on Escape, and leaves the chat its keys', async () => {
  const page = await openPage();
  try {
    const image = card(page, 'Open image: shot.svg');
    await image.click();
    const beside = view(page, 'shot.svg');
    await beside.getByText('2 of 4', { exact: true }).waitFor();
    // Focus is still on the card in the chat: the arrows aren't the file's.
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    expect(await beside.count()).toBe(1);

    await beside.getByRole('img', { name: 'A screenshot' }).click();
    await page.keyboard.press('ArrowLeft');
    const pdf = view(page, 'member-offers.pdf');
    await pdf.getByText('1 of 4', { exact: true }).waitFor();
    expect(await card(page, 'Open PDF: member-offers.pdf').getAttribute('aria-current')).toBe('true');
    expect(await image.getAttribute('aria-current')).toBeNull();
    await pdf.getByRole('button', { name: 'Next preview' }).click();
    await beside.waitFor();
    await page.keyboard.press('ArrowRight');
    const html = view(page, 'gallery.html');
    const frame = page.frameLocator('iframe[title="HTML preview: gallery.html"]');
    await frame.getByRole('heading', { name: 'Gallery' }).waitFor();

    // Keys typed in the artifact stay its own, and Escape it didn't use closes the file.
    const filter = frame.getByRole('textbox', { name: 'Filter shots' });
    await filter.click();
    await page.keyboard.type('dusk');
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(300);
    expect(await html.count()).toBe(1);
    await page.keyboard.press('Escape');
    await html.waitFor({ state: 'detached' });
    expect(await focused(card(page, 'Open HTML: gallery.html'))).toBe(true);

    // Escape on Ri's own part of the view closes it too.
    await image.click();
    await beside.getByRole('img', { name: 'A screenshot' }).click();
    await page.keyboard.press('Escape');
    await beside.waitFor({ state: 'detached' });
    expect(await focused(image)).toBe(true);
  } finally { await page.context().close(); }
}, 60_000);

it.skipIf(!enabled)('keeps the arrow keys working after Next disables at the last file', async () => {
  const page = await openPage();
  try {
    await card(page, 'Open PDF: member-offers.pdf').click();
    const first = view(page, 'member-offers.pdf');
    await first.getByText('1 of 4', { exact: true }).waitFor();
    for (const position of ['2 of 4', '3 of 4', '4 of 4']) {
      await page.locator('section[aria-label$=", beside the chat"]').getByRole('button', { name: 'Next preview' }).click();
      await page.locator('section[aria-label$=", beside the chat"]').getByText(position, { exact: true }).waitFor();
    }
    const last = view(page, 'Friday agenda.pdf');
    expect(await last.getByRole('button', { name: 'Next preview' }).isDisabled()).toBe(true);
    // Focus didn't fall to the page with the disabled button: the arrows still move.
    await expect.poll(() => last.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('ArrowLeft');
    await view(page, 'gallery.html').getByText('3 of 4', { exact: true }).waitFor();
  } finally { await page.context().close(); }
}, 60_000);

it.skipIf(!enabled)('opens large where the chat has no panel beside it', async () => {
  const page = await openPage();
  try {
    // A chat in a slideout has nothing beside it.
    await card(page, 'Open image: other.svg').click();
    const dialog = page.getByRole('dialog', { name: 'other.svg' });
    await dialog.getByRole('img', { name: 'In a slideout' }).waitFor();
    expect(await dialog.getByRole('button', { name: 'Show beside the chat' }).count()).toBe(0);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });

    // The panel beside the chat off screen (a narrow window, a hidden layout).
    await page.evaluate(() => (window as unknown as { setPanelOnScreen: (value: boolean) => void }).setPanelOnScreen(false));
    await card(page, 'Open image: shot.svg').click();
    const large = page.getByRole('dialog', { name: 'shot.svg' });
    await large.waitFor();
    expect(await large.getByRole('button', { name: 'Show beside the chat' }).count()).toBe(0);
    expect(await storedPlace(page)).toBeNull();
  } finally { await page.context().close(); }
}, 60_000);
