import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import * as XLSX from 'xlsx';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { DEMO_AUDIO, DEMO_VIDEO } from '@/test/fixtures/media';
import { makeDocx, makePptx, makeZip } from '@/test/fixtures/zip';
import { previewContents } from '@/lib/files/preview';
import { fileBytes } from '@/lib/files/byte-delivery';
import { filePreviewMime } from '@/lib/files/preview-types';
import { AUTH_TOKEN_STORAGE_KEY } from '@/lib/api/client';

const enabled = process.env.RI_ARTIFACT_BROWSER_TEST === '1';
let browser: Browser;
let server: http.Server;
let address: string;
let dir: string;
const reads: string[] = [];
const deliveries: { name: string; cookie: string }[] = [];
const names = ['demo.webm', 'memo.wav', 'data.xlsx', 'data.csv', 'review.docx', 'review.pptx', 'files.zip', 'output.bin', 'broken.mov', 'review.md'];
const outputPath = `/fixture/${'a-long-folder-name/'.repeat(60)}output.bin`;
const prose = 'Verified browser/gallery and desktop/mobile checks.\n\n`browser/gallery` and `desktop/mobile` stay text too.\n\n[Website](https://example.com/review)';

beforeAll(async () => {
  if (!enabled) return;
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ri-rich-preview-browser-'));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Item', 'Quantity'], ['Widget', 5]]), 'Inventory');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Owner'], ['Alex']]), 'People');
  const fixtures: Record<string, Buffer | string> = {
    'demo.webm': Buffer.from(DEMO_VIDEO.split(',')[1], 'base64'), 'memo.wav': Buffer.from(DEMO_AUDIO.split(',')[1], 'base64'),
    'data.xlsx': XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), 'data.csv': 'Item,Quantity\nWidget,5',
    'review.docx': makeDocx(), 'review.pptx': makePptx(), 'files.zip': makeZip({ 'docs/review.md': '# Review' }),
    'output.bin': Buffer.from([0, 1, 2, 3]), 'broken.mov': 'not a video', 'review.md': '# Shared review\n\nReady to read.',
  };
  await Promise.all(Object.entries(fixtures).map(([name, bytes]) => fs.writeFile(path.join(dir, name), bytes)));
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React,{useState}from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
      import{TipProvider}from'./src/components/ui/tip';import{ArtifactPreviewProvider,useBesidePreview,useBesideRegion}from'./src/components/chat-ui/artifacts/artifact-preview-provider';
      import{PREVIEW_HOST_ATTRIBUTE}from'./src/components/chat-ui/artifacts/artifact-preview-store';import{BesideFileView}from'./src/components/chat-ui/artifacts/artifact-beside';
      import{AgentResponse}from'./src/components/chat-ui/messages/agent-response';
      const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
      function DetectionExamples(){return <>{['streaming','static'].map(mode=><section key={mode} aria-label={mode+' path detection'}><AgentResponse sessionId="fixture" mode={mode} text={${JSON.stringify(prose)}}/></section>)}</>}
      function Chat(){const [shown,setShown]=useState(false);const file=useBesidePreview('fixture');useBesideRegion('fixture',{available:true,side:'right',showing:shown&&!!file,show:()=>setShown(true)});
      return <main className="flex h-screen"><section role="log" aria-label="Chat" {...{[PREVIEW_HOST_ATTRIBUTE]:'fixture'}} className="min-w-0 w-1/2 space-y-3 p-6"><AgentResponse sessionId="fixture" text={${JSON.stringify(names.map(name => `[${name}](${name === 'output.bin' ? outputPath : `/fixture/${name}`})`).join('\n\n'))}}/><DetectionExamples/></section><aside className="min-w-0 w-1/2 border-l">{file&&<BesideFileView host="fixture"/>}</aside></main>}
      createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><TipProvider><ArtifactPreviewProvider><Chat/></ArtifactPreviewProvider></TipProvider></QueryClientProvider>);
    ` }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env': '{"NODE_ENV":"production"}' },
    plugins: [{ name: 'fixture-trpc', setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/trpc\/client$/ }, () => ({ path: 'client', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `import{createTRPCClient,httpLink}from'@trpc/client';import{createTRPCOptionsProxy}from'@trpc/tanstack-react-query';import{QueryClient}from'@tanstack/react-query';export const trpcClient=createTRPCClient({links:[httpLink({url:'/api/trpc'})]});export const terminalTRPCClient=trpcClient;const client=new QueryClient();export const trpc=createTRPCOptionsProxy({client:trpcClient,queryClient:()=>client});`, loader: 'js', resolveDir: process.cwd() }));
    } }],
  });
  const require = createRequire(import.meta.url);
  const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
  const tailwind = require('@tailwindcss/postcss');
  const cssFile = path.resolve('src/app/globals.css');
  const css = await postcss([tailwind({ base: process.cwd() })]).process(await fs.readFile(cssFile, 'utf8'), { from: cssFile });
  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, 'http://fixture');
      if (url.pathname === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
      if (url.pathname === '/styles.css') { res.setHeader('Content-Type', 'text/css'); res.end(css.css); return; }
      if (url.pathname === '/api/session') {
        await new Promise(resolve => setTimeout(resolve, 500));
        res.writeHead(204, { 'Set-Cookie': 'preview-fixture=ready; HttpOnly; Path=/' }); res.end(); return;
      }
      if (url.pathname === '/api/trpc/sessions.get') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ result: { data: { id: 'fixture', workspaceId: null, executionId: null } } })); return;
      }
      if (url.pathname === '/api/trpc/sessions.fileGet') {
        const input = JSON.parse(url.searchParams.get('input') || '{}');
        if ((input.query ?? input.json?.query)?.path !== '/fixture/review.md') { res.writeHead(404); res.end(); return; }
        const content = await fs.readFile(path.join(dir, 'review.md'), 'utf8');
        reads.push('review.md');
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ result: { data: { path: '/fixture/review.md', content, encoding: 'utf8', mime: 'text/markdown', size: content.length, isBinary: false, tooLarge: false } } })); return;
      }
      if (url.pathname === '/api/trpc/filePreviews.read') {
        const input = JSON.parse(url.searchParams.get('input') || '{}');
        const name = String(input.path ?? input.json?.path ?? '').split('/').at(-1)!;
        if (!names.includes(name)) { res.writeHead(404); res.end(); return; }
        reads.push(name);
        const file = path.join(dir, name);
        const data = await previewContents(file, name, (await fs.stat(file)).size);
        if (data.kind === 'document') data.html += '<script>window.executed=true;parent.executed=true</script><img src="/api/should-not-load">';
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ result: { data } })); return;
      }
      if (/^\/api\/sessions\/fixture\/(media|download)$/.test(url.pathname)) {
        const name = (url.searchParams.get('path') ?? '').split('/').at(-1) ?? '';
        if (!names.includes(name)) { res.writeHead(404); res.end(); return; }
        deliveries.push({ name, cookie: req.headers.cookie ?? '' });
        const headers = Object.fromEntries(Object.entries(req.headers).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
        const download = url.pathname.endsWith('/download');
        const response = await fileBytes(new Request(url, { headers, method: req.method }), path.join(dir, name), name, download ? 'application/octet-stream' : filePreviewMime(name), download);
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
      }
      if (url.pathname.startsWith('/api/')) { res.writeHead(404); res.end(); return; }
      res.setHeader('Content-Type', 'text/html'); res.end('<link rel="stylesheet" href="/styles.css"><div id="root"></div><script src="/bundle.js"></script>');
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ channel: 'chromium', headless: true, executablePath: process.env.RI_REVIEW_CHROMIUM });
}, 90_000);
afterAll(async () => { await browser?.close(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); if (dir) await fs.rm(dir, { recursive: true, force: true }); });
async function page() { const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1200, height: 900 } }); const page = await context.newPage(); page.setDefaultTimeout(15_000); await page.goto(address); return page; }
async function open(page: Page, name: string) { await page.getByRole('button', { name: `Open file: ${name}`, exact: true }).click(); const view = page.getByRole('region', { name: `${name}, beside the chat`, exact: true }); await view.waitFor(); return view; }

it.skipIf(!enabled)('keeps slash-separated prose as text in streaming and static replies', async () => {
  const p = await page();
  try {
    for (const mode of ['streaming', 'static']) {
      const example = p.getByRole('region', { name: `${mode} path detection`, exact: true });
      await example.getByText('Verified browser/gallery and desktop/mobile checks.', { exact: true }).waitFor();
      expect(await example.getByRole('button').count()).toBe(0);
      expect(await example.getByRole('link').count()).toBe(1);
      expect(await example.getByRole('link', { name: 'Website', exact: true }).getAttribute('href')).toBe('https://example.com/review');
      expect(await example.getByRole('link', { name: 'Website', exact: true }).getAttribute('target')).toBe('_blank');
    }
  } finally { await p.context().close(); }
}, 30_000);

it.skipIf(!enabled)('opens a shared Markdown path in a chat without an agent folder', async () => {
  const p = await page();
  try {
    const view = await open(p, 'review.md');
    await view.getByRole('heading', { name: 'Shared review', exact: true }).waitFor();
    await view.getByRole('button', { name: 'Source', exact: true }).click();
    expect(await view.getByLabel('File source').innerText()).toContain('# Shared review');
    await view.getByRole('button', { name: 'Show large', exact: true }).click();
    await p.getByRole('dialog').getByRole('heading', { name: 'Shared review', exact: true }).waitFor();
  } finally { await p.context().close(); }
}, 30_000);

it.skipIf(!enabled)('loads only the opened file, plays real video/audio and preserves native media keys', async () => {
  const p = await page();
  try {
    const before = reads.length;
    await p.getByRole('button', { name: 'Open file: demo.webm', exact: true }).waitFor();
    expect(reads.length).toBe(before);
    let view = await open(p, 'demo.webm');
    const video = view.locator('video'); await video.waitFor();
    expect(await video.getAttribute('autoplay')).toBeNull();
    await video.evaluate(async element => { const player = element as HTMLVideoElement; await player.play(); player.pause(); });
    expect(await video.evaluate(element => (element as HTMLVideoElement).videoWidth)).toBe(96);
    await view.getByLabel('Playback speed', { exact: true }).selectOption('1.5');
    expect(await video.evaluate(element => (element as HTMLVideoElement).playbackRate)).toBe(1.5);
    await video.focus(); await p.keyboard.press('ArrowRight'); expect(await view.count()).toBe(1);
    await view.getByRole('button', { name: 'Show large', exact: true }).click();
    const dialog = p.getByRole('dialog'); await dialog.locator('video').waitFor();
    await dialog.locator('video').focus(); await p.keyboard.press('ArrowRight'); expect(await dialog.locator('video').count()).toBe(1);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await p.evaluate(() => localStorage.setItem('ri.client.previewPlace', 'beside')); await p.reload();
    view = await open(p, 'memo.wav');
    await view.locator('audio').evaluate(async element => { await (element as HTMLAudioElement).play(); (element as HTMLAudioElement).pause(); });
    await open(p, 'broken.mov'); await p.getByText('This browser cannot play this file or the file is unavailable. Download it to open it in another player.', { exact: true }).waitFor();
  } finally { await p.context().close(); }
}, 30_000);
it.skipIf(!enabled)('switches real workbook sheets, shows CSV source, Office content and archive entries', async () => {
  const p = await page();
  try {
    let view = await open(p, 'data.xlsx'); await view.getByRole('cell', { name: 'Widget', exact: true }).waitFor();
    await view.getByLabel('Sheet', { exact: true }).selectOption('1'); await view.getByRole('cell', { name: 'Alex', exact: true }).waitFor();
    view = await open(p, 'data.csv'); await view.getByRole('button', { name: 'Source', exact: true }).click(); expect(await view.getByLabel('File source').innerText()).toContain('Item,Quantity');
    view = await open(p, 'review.docx'); const frame = await (await view.getByTitle('Document preview').elementHandle())!.contentFrame();
    await frame!.getByText('Next steps', { exact: true }).waitFor();
    expect(await frame!.evaluate(() => Boolean((window as unknown as { executed?: boolean }).executed))).toBe(false);
    expect(await frame!.evaluate(() => { try { return Boolean(parent.document); } catch { return false; } })).toBe(false);
    view = await open(p, 'review.pptx'); await view.getByText('Ship the review', { exact: false }).waitFor();
    view = await open(p, 'files.zip'); await view.getByRole('cell', { name: 'docs/review.md', exact: true }).waitFor();
  } finally { await p.context().close(); }
}, 30_000);
it.skipIf(!enabled)('copies and downloads unsupported original bytes in both preview placements', async () => {
  const p = await page();
  try {
    await p.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (value: string) => { (window as unknown as { copied: string }).copied = value; } }, configurable: true }));
    await p.getByRole('button', { name: 'Open file: output.bin', exact: true }).hover();
    await p.getByRole('tooltip').waitFor();
    expect(await p.getByRole('tooltip').innerText()).toContain(outputPath);
    const view = await open(p, 'output.bin');
    await view.getByText('No preview is available for this file type. Download it to open it.', { exact: true }).waitFor();
    await view.getByRole('heading', { name: 'output.bin', exact: true }).waitFor();
    const besideCopy = view.getByRole('button', { name: 'Copy path', exact: true });
    expect(await besideCopy.innerText()).toContain('Copy path');
    expect(await besideCopy.innerText()).toContain(outputPath);
    await besideCopy.hover(); await p.getByRole('tooltip').waitFor();
    expect(await p.getByRole('tooltip').innerText()).toContain(outputPath);
    expect((await p.locator('[data-slot="tooltip-content"]').boundingBox())!.height).toBeLessThan(280);
    expect(await p.locator('[data-slot="tooltip-content"] > span').first().evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await besideCopy.click(); expect(await p.evaluate(() => (window as unknown as { copied: string }).copied)).toBe(outputPath);
    await view.getByRole('button', { name: 'Show large', exact: true }).click();
    const dialog = p.getByRole('dialog');
    const largeCopy = dialog.getByRole('button', { name: 'Copy path', exact: true });
    expect(await largeCopy.innerText()).toContain('Copy path');
    await largeCopy.focus(); await p.keyboard.press('Tab'); await p.keyboard.press('Shift+Tab');
    expect(await largeCopy.evaluate(element => element === document.activeElement)).toBe(true);
    await p.getByRole('tooltip').waitFor();
    expect(await p.getByRole('tooltip').innerText()).toContain(outputPath);
    await largeCopy.press('Enter');
    expect(await p.evaluate(() => (window as unknown as { copied: string }).copied)).toBe(outputPath);
    const [download] = await Promise.all([p.waitForEvent('download'), dialog.getByRole('link', { name: 'Download output.bin', exact: true }).click()]);
    expect(download.suggestedFilename()).toBe('output.bin'); expect(await fs.readFile((await download.path())!)).toEqual(Buffer.from([0, 1, 2, 3]));
    await p.setViewportSize({ width: 390, height: 844 });
    expect(await largeCopy.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    if (process.env.RI_ARTIFACT_SCREENSHOTS) await p.screenshot({ path: path.join(process.env.RI_ARTIFACT_SCREENSHOTS, 'file-path-large-phone.png') });
    await dialog.getByRole('button', { name: 'Show beside the chat', exact: true }).click();
    await view.getByRole('heading', { name: 'output.bin', exact: true }).waitFor();
    expect(await besideCopy.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    if (process.env.RI_ARTIFACT_SCREENSHOTS) await p.screenshot({ path: path.join(process.env.RI_ARTIFACT_SCREENSHOTS, 'file-path-beside-phone.png') });
    await p.setViewportSize({ width: 1200, height: 900 });
    if (process.env.RI_ARTIFACT_SCREENSHOTS) await p.screenshot({ path: path.join(process.env.RI_ARTIFACT_SCREENSHOTS, 'file-path-beside-desktop.png') });
  } finally { await p.context().close(); }
}, 30_000);

it.skipIf(!enabled)('waits for cookie authentication before native playback and an immediate download', async () => {
  for (const name of ['output.bin', 'demo.webm']) {
    const context = await browser.newContext({ acceptDownloads: true });
    try {
      await context.addInitScript(key => localStorage.setItem(key, 'ri_fixture_pairing'), AUTH_TOKEN_STORAGE_KEY);
      const p = await context.newPage(); p.setDefaultTimeout(5000); await p.goto(address);
      const before = deliveries.length;
      if (name === 'output.bin') {
        const view = await open(p, name);
        const [download] = await Promise.all([p.waitForEvent('download'), view.getByRole('link', { name: 'Download output.bin', exact: true }).click()]);
        expect(download.suggestedFilename()).toBe('output.bin');
      } else {
        await open(p, name);
      }
      await expect.poll(() => deliveries.slice(before).find(delivery => delivery.name === name)?.cookie, { timeout: 5000 }).toContain('preview-fixture=ready');
    } finally { await context.close(); }
  }
}, 30_000);
