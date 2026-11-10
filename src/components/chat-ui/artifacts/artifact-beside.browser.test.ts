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
import { htmlFilePreviewResponse } from '@/lib/sessions/html-preview-response';
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
  fs.writeFileSync(path.join(files, 'gallery.html'), galleryArtifact);
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
      import { registerComposer } from './src/components/chat/editor/composer-focus';
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
      // The chat's composer, registered as the real one is (⌘I, and where focus goes with no card to go back to).
      function Composer() {
        const ref = React.useRef(null);
        useEffect(() => registerComposer({ el: ref.current, focus: () => ref.current.focus(), insert: () => {} }), []);
        return <textarea ref={ref} aria-label="Message" className="m-3 border border-border" />;
      }
      // A hidden copy of the layout, as the dashboard keeps one per screen size: focus never goes to its view.
      function HiddenLayout() {
        const file = useBesidePreview(host);
        return <div className="hidden">{file && <BesideFileView host={host} />}</div>;
      }
      function App() {
        const [earlier, setEarlier] = useState(true);
        useEffect(() => { window.setEarlierShown = setEarlier; }, []);
        return <QueryClientProvider client={client}><TipProvider><ArtifactPreviewProvider>
          <HiddenLayout />
          <div className="flex h-dvh">
            <div data-preview-host={host} className="flex min-w-0 flex-1 flex-col">
              {/* An earlier conversation in the same surface: its own Previous and Next. */}
              {earlier && <section role="log" aria-label="Earlier chat" className="px-6 pt-3">
                <MessageFileChip attachment={{ fileName: 'diagram.svg', originalName: 'Team diagram.svg', mimeType: 'image/svg+xml', size: 160, uploadedAt: '2026-10-19T10:00:00Z' }} variant="block" />
              </section>}
              <section role="log" aria-label="Chat" className="min-h-0 flex-1 overflow-y-auto p-6 space-y-3">
                <p>Here is the report:</p>
                <PdfPreviewCard src={sessionPdfUrl('fixture', '/tmp/exports/member-offers.pdf')} name="member-offers.pdf" source="/tmp/exports/member-offers.pdf" />
                <ImagePreviewCard src="/shot.svg" alt="A screenshot" name="shot.svg" />
                <HtmlPreviewLink sessionId="fixture" path="/tmp/gallery.html">gallery.html</HtmlPreviewLink>
                <MessageFileChip attachment={{ fileName: 'agenda.pdf', originalName: 'Friday agenda.pdf', mimeType: 'application/pdf', size: ${AGENDA.byteLength}, uploadedAt: '2026-10-19T10:00:00Z' }} variant="block" />
              </section>
              <Composer />
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
    } else if (url.pathname === '/api/sessions/fixture/html' && url.searchParams.get('download') === '1') {
      // The real download: the file as written, under its name.
      const response = await htmlFilePreviewResponse(new Request(`http://fixture${req.url}`), path.join(files, 'gallery.html'), 'dark', 'gallery.html');
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
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
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  await page.goto(address);
  return page;
}

const card = (page: Page, name: string) => page.getByRole('button', { name });
const view = (page: Page, name: string) => page.getByRole('region', { name: `${name}, beside the chat` });
const panel = (page: Page) => page.getByRole('complementary', { name: 'Beside the chat' });
const tab = (page: Page, name: string) => panel(page).getByRole('button', { name, exact: true });
const focused = (locator: ReturnType<Page['locator']>) => locator.evaluate(element => element === document.activeElement);
/** Focus is somewhere in the element (the file's view, say), not only on it. */
const focusIn = (locator: ReturnType<Page['locator']>) => locator.evaluate(element => element.contains(document.activeElement));
const composer = (page: Page) => page.getByRole('textbox', { name: 'Message' });
const caret = (page: Page) => composer(page).evaluate(element => (element as HTMLTextAreaElement).selectionStart);
const storedPlace = (page: Page) => page.evaluate(key => localStorage.getItem(key), PREVIEW_PLACE_KEY);
/** The file's view is mounted and in front (not behind the panel's own tab). */
const inFront = (page: Page, name: string) => panel(page).locator(`section[aria-label="${name}, beside the chat"]`).evaluate(element => !element.closest('[inert]'));

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
    // Focus follows the file beside the chat, so its keys go on working there.
    await expect.poll(() => focusIn(view(page, 'member-offers.pdf'))).toBe(true);

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

it.skipIf(!enabled)('takes focus when a file opens, so the arrow keys and Escape work straight away', async () => {
  const page = await openPage();
  try {
    // From a click on its card, with no click in the file first.
    const image = card(page, 'Open image: shot.svg');
    await image.click();
    await page.keyboard.press('ArrowRight');
    const html = view(page, 'gallery.html');
    await html.getByText('3 of 4', { exact: true }).waitFor();
    expect(await card(page, 'Open HTML: gallery.html').getAttribute('aria-current')).toBe('true');
    await page.keyboard.press('ArrowLeft');
    const beside = view(page, 'shot.svg');
    await beside.getByText('2 of 4', { exact: true }).waitFor();
    expect(await image.getAttribute('aria-current')).toBe('true');
    await page.keyboard.press('Escape');
    await beside.waitFor({ state: 'detached' });
    expect(await focused(image)).toBe(true);

    // From the keyboard, on the card focus went back to.
    await page.keyboard.press('Enter');
    await beside.waitFor();
    await page.keyboard.press('ArrowLeft');
    await view(page, 'member-offers.pdf').getByText('1 of 4', { exact: true }).waitFor();

    // Another card while a file is open takes the tab, and the keys with it.
    await card(page, 'Open PDF: Friday agenda.pdf').click();
    await view(page, 'Friday agenda.pdf').getByText('4 of 4', { exact: true }).waitFor();
    await page.keyboard.press('ArrowLeft');
    await html.getByText('3 of 4', { exact: true }).waitFor();

    // So does the file's own tab, brought forward after another.
    await page.getByRole('button', { name: 'Deck', exact: true }).click();
    await expect.poll(() => inFront(page, 'gallery.html')).toBe(false);
    await tab(page, 'gallery.html').click();
    await expect.poll(() => inFront(page, 'gallery.html')).toBe(true);
    await page.keyboard.press('ArrowLeft');
    await beside.getByText('2 of 4', { exact: true }).waitFor();

    // × hands focus back to the card as Escape does.
    await page.getByRole('button', { name: 'Close shot.svg' }).click();
    await beside.waitFor({ state: 'detached' });
    expect(await focused(image)).toBe(true);
  } finally { await page.context().close(); }
}, 60_000);

it.skipIf(!enabled)('leaves the chat its keys, and never takes focus from the composer', async () => {
  const page = await openPage();
  try {
    await card(page, 'Open image: shot.svg').click();
    const beside = view(page, 'shot.svg');
    await beside.getByText('2 of 4', { exact: true }).waitFor();

    // With the file open, the arrows typed in the composer move its caret, not the file.
    await composer(page).click();
    await page.keyboard.type('Compare them');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    expect(await caret(page)).toBe('Compare them'.length - 2);
    await page.keyboard.press('ArrowRight');
    expect(await caret(page)).toBe('Compare them'.length - 1);
    await page.waitForTimeout(300);
    expect(await beside.getByText('2 of 4', { exact: true }).count()).toBe(1);

    // A file that opens while you type (not from your click) leaves focus where it is.
    await card(page, 'Open PDF: member-offers.pdf').evaluate(element => (element as HTMLElement).click());
    await view(page, 'member-offers.pdf').getByText('1 of 4', { exact: true }).waitFor();
    await page.waitForTimeout(300);
    expect(await focused(composer(page))).toBe(true);
    await page.keyboard.press('ArrowLeft');
    expect(await caret(page)).toBe('Compare them'.length - 2);
    expect(await view(page, 'member-offers.pdf').count()).toBe(1);

    // Keys typed in an HTML artifact stay its own, and the Escape it didn't use closes the file.
    await card(page, 'Open HTML: gallery.html').click();
    const html = view(page, 'gallery.html');
    const frame = panel(page).frameLocator('iframe[title="HTML preview: gallery.html"]');
    const filter = frame.getByRole('textbox', { name: 'Filter shots' });
    await filter.click();
    await page.keyboard.type('dusk');
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(300);
    expect(await html.count()).toBe(1);
    await page.keyboard.press('Escape');
    await html.waitFor({ state: 'detached' });
    expect(await focused(card(page, 'Open HTML: gallery.html'))).toBe(true);
  } finally { await page.context().close(); }
}, 60_000);

it.skipIf(!enabled)('works the same way in the large view, and focus follows a file between the two', async () => {
  const page = await openPage();
  try {
    await page.evaluate(key => localStorage.setItem(key, 'large'), PREVIEW_PLACE_KEY);
    await page.reload();
    const image = card(page, 'Open image: shot.svg');
    await image.click();
    await page.getByRole('dialog', { name: 'shot.svg' }).getByText('2 of 4', { exact: true }).waitFor();
    await page.keyboard.press('ArrowRight');
    await page.getByRole('dialog', { name: 'gallery.html' }).getByText('3 of 4', { exact: true }).waitFor();
    await page.keyboard.press('ArrowLeft');
    const large = page.getByRole('dialog', { name: 'shot.svg' });
    await large.getByText('2 of 4', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await large.waitFor({ state: 'hidden' });
    // Once the dialog's exit animation is over.
    await expect.poll(() => focused(image)).toBe(true);

    // Moved beside the chat, then large again, the keys work wherever it is.
    await page.keyboard.press('Enter');
    await large.getByRole('button', { name: 'Show beside the chat' }).click();
    const beside = view(page, 'shot.svg');
    await expect.poll(() => focusIn(beside)).toBe(true);
    await page.keyboard.press('ArrowRight');
    const html = view(page, 'gallery.html');
    await html.getByText('3 of 4', { exact: true }).waitFor();
    await html.getByRole('button', { name: 'Show large' }).click();
    await page.getByRole('dialog', { name: 'gallery.html' }).waitFor();
    await page.keyboard.press('ArrowLeft');
    await large.getByText('2 of 4', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await large.waitFor({ state: 'hidden' });
    await expect.poll(() => focused(image)).toBe(true);
  } finally { await page.context().close(); }
}, 60_000);

it.skipIf(!enabled)('zooms an image beside the chat, with keys only while focus is in the file, never while typing in the chat', async () => {
  const page = await openPage();
  try {
    await card(page, 'Open image: shot.svg').click();
    const beside = view(page, 'shot.svg');
    const image = beside.getByRole('img', { name: 'A screenshot' });
    await image.waitFor();
    const level = beside.getByRole('group', { name: 'Zoom' }).getByRole('button', { name: /^Fit to window/ });
    const percent = async () => Number((await level.textContent())?.replace('%', ''));
    await expect.poll(percent).toBeGreaterThan(0);
    const fitPercent = await percent();
    const fit = (await image.boundingBox())!;
    await page.mouse.click(fit.x + fit.width / 2, fit.y + fit.height / 2);
    await expect.poll(percent).toBe(Math.round(fitPercent * 2));
    expect(await focusIn(beside)).toBe(true);
    await page.keyboard.press('0');
    await expect.poll(percent).toBe(fitPercent);
    await page.keyboard.press('+');
    await expect.poll(percent).toBe(Math.round(fitPercent * 1.5));
    // Past the glide, so the screenshot shows where it lands.
    await page.waitForTimeout(400);
    await shot(page, 'beside-zoomed.png');

    // Typing in the chat types, and leaves the image where it is.
    await composer(page).click();
    await page.keyboard.type('0-+=');
    expect(await composer(page).inputValue()).toContain('0-+=');
    expect(await percent()).toBe(Math.round(fitPercent * 1.5));
  } finally { await page.context().close(); }
}, 60_000);

it.skipIf(!enabled)('puts focus in the chat\'s composer, not the page, when the card a closing file came from is gone', async () => {
  const page = await openPage();
  try {
    const setEarlierShown = (shown: boolean) => page.evaluate(value => (window as unknown as { setEarlierShown: (value: boolean) => void }).setEarlierShown(value), shown);
    const diagram = card(page, 'Open image: Team diagram.svg');
    await diagram.click();
    const beside = view(page, 'Team diagram.svg');
    await beside.getByRole('img').waitFor();
    // The transcript it came from goes (another chat in the surface), and the file stays open.
    await setEarlierShown(false);
    await diagram.waitFor({ state: 'detached' });
    await page.keyboard.press('Escape');
    await beside.waitFor({ state: 'detached' });
    expect(await focused(composer(page))).toBe(true);

    // The same from the large view.
    await setEarlierShown(true);
    await diagram.click();
    await view(page, 'Team diagram.svg').getByRole('button', { name: 'Show large' }).click();
    const large = page.getByRole('dialog', { name: 'Team diagram.svg' });
    await large.getByRole('img').waitFor();
    await setEarlierShown(false);
    await diagram.waitFor({ state: 'detached' });
    await page.keyboard.press('Escape');
    await large.waitFor({ state: 'hidden' });
    await expect.poll(() => focused(composer(page))).toBe(true);
  } finally { await page.context().close(); }
}, 60_000);

it.skipIf(!enabled)('keeps the arrow keys working after Next disables at the last file', async () => {
  const page = await openPage();
  try {
    await card(page, 'Open PDF: member-offers.pdf').click();
    const first = view(page, 'member-offers.pdf');
    await first.getByText('1 of 4', { exact: true }).waitFor();
    for (const position of ['2 of 4', '3 of 4', '4 of 4']) {
      await panel(page).locator('section[aria-label$=", beside the chat"]').getByRole('button', { name: 'Next preview' }).click();
      await panel(page).locator('section[aria-label$=", beside the chat"]').getByText(position, { exact: true }).waitFor();
    }
    const last = view(page, 'Friday agenda.pdf');
    expect(await last.getByRole('button', { name: 'Next preview' }).isDisabled()).toBe(true);
    // Focus didn't fall to the page with the disabled button: the arrows still move.
    await expect.poll(() => last.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('ArrowLeft');
    await view(page, 'gallery.html').getByText('3 of 4', { exact: true }).waitFor();
  } finally { await page.context().close(); }
}, 60_000);

it.skipIf(!enabled)('downloads every kind of file under its own name, HTML as written rather than as previewed', async () => {
  const page = await openPage();
  const save = async (link: ReturnType<Page['locator']>) => {
    const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
    return { name: download.suggestedFilename(), bytes: fs.readFileSync((await download.path())!) };
  };
  try {
    await card(page, 'Open HTML: gallery.html').click();
    const html = await save(view(page, 'gallery.html').getByRole('link', { name: 'Download gallery.html' }));
    expect(html.name).toBe('gallery.html');
    expect(html.bytes.toString('utf8')).toBe(galleryArtifact);

    await card(page, 'Open image: Team diagram.svg').click();
    const image = await save(view(page, 'Team diagram.svg').getByRole('link', { name: 'Download Team diagram.svg' }));
    expect(image.name).toBe('Team diagram.svg');
    expect(image.bytes.toString('utf8')).toContain('<svg');

    await card(page, 'Open PDF: member-offers.pdf').click();
    const pdf = await save(view(page, 'member-offers.pdf').getByRole('link', { name: 'Download member-offers.pdf' }));
    expect(pdf.name).toBe('member-offers.pdf');
    expect(pdf.bytes.equals(REPORT)).toBe(true);

    // An image Ri doesn't serve (from the web) has no Download: the header shows where it is.
    await card(page, 'Open image: shot.svg').click();
    expect(await view(page, 'shot.svg').getByRole('link', { name: /^Download/ }).count()).toBe(0);
  } finally { await page.context().close(); }
}, 60_000);

it.skipIf(!enabled)('copies the original path and offers downloads beside the chat and in the lightbox', async () => {
  const page = await openPage();
  try {
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { (window as unknown as { copied: string }).copied = value; } } }));
    await card(page, 'Open PDF: member-offers.pdf').click();
    const beside = view(page, 'member-offers.pdf');
    await beside.getByRole('button', { name: 'Copy path', exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toBe('/tmp/exports/member-offers.pdf');
    expect(await beside.getByRole('link', { name: 'Download member-offers.pdf', exact: true }).getAttribute('download')).toBe('member-offers.pdf');
    await beside.getByRole('button', { name: 'Show large', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'member-offers.pdf', exact: true });
    await dialog.getByRole('button', { name: 'Copy path', exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toBe('/tmp/exports/member-offers.pdf');
    const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('link', { name: 'Download member-offers.pdf', exact: true }).click()]);
    expect(download.suggestedFilename()).toBe('member-offers.pdf');
    expect(fs.readFileSync((await download.path())!).equals(REPORT)).toBe(true);
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
