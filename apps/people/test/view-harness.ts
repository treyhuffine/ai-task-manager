import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { chromium, type Browser, type Frame, type FrameLocator, type Page } from 'playwright-core';
import { prepareHtml } from '@ri/app-kit/build';

/** Playwright's own Chromium when installed, then an installed Chrome or Brave. */
export const CHROME = [chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find((file) => file && fs.existsSync(file));
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');

export type Invoke = (action: string, input: unknown, invocationId?: string) => Promise<unknown>;
export interface Harness {
  browser: Browser; page: Page; view: FrameLocator;
  prompts: string[]; contexts: unknown[]; downloads: unknown[]; calls: { action: string; input: unknown }[]; locations: string[]; hostLinks: string[];
  open(pathname: string): Promise<void>;
  resize(width: number, height?: number): Promise<void>;
  theme(theme: 'light' | 'dark'): Promise<void>;
  refresh(): Promise<void>;
  screenshot(file: string): Promise<void>;
  /** The guest document's frame, for evaluating scroll and focus. */
  guest(): Frame;
  close(): Promise<void>;
}

/**
 * A host page with the real AppViewController (opaque relay and guest
 * frames, restrictive CSP). Tool calls reach `invoke`, writes re-run the
 * opener like Ri does, and host intents (chat drafts, location, Sources) are
 * recorded instead of followed. Nothing is ever sent.
 */
export async function openHarness(options: { html: string; invoke: Invoke; width: number; height?: number; theme?: 'light' | 'dark'; path?: string; readActions: Set<string>; file?: { name: string; mimeType: string; base64: string } }): Promise<Harness> {
  if (!CHROME) throw new Error('The packaged view test needs an installed Chrome');
  const guest = prepareHtml(options.html);
  const compile = async (source: string) => (await build({ stdin: { contents: source, resolveDir: root }, bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2023', logLevel: 'silent' })).outputFiles[0]!.text.replace(/<\/script/gi, '<\\/script');
  const hostScript = await compile(`import {AppViewController} from ${JSON.stringify(require.resolve('@ri/app-kit/view-host'))};window.AppViewController=AppViewController;`);
  const server = http.createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(`<html><head><style>html,body{margin:0;height:100%}#mount{height:100vh}</style></head><body><div id="mount"></div><script>${hostScript}</script></body></html>`); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, chromiumSandbox: true, args: ['--disable-features=IsolateSandboxedIframes'], env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR } });
  const page = await browser.newPage({ viewport: { width: options.width, height: options.height ?? 900 } });
  const state = { prompts: [] as string[], contexts: [] as unknown[], downloads: [] as unknown[], calls: [] as { action: string; input: unknown }[], locations: [] as string[], hostLinks: [] as string[] };
  let location = options.path ?? '/today';
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  const opener = async (pathname: string) => {
    const url = new URL(pathname, 'https://view.local');
    const result = await options.invoke('open_view', { path: url.pathname, query: Object.fromEntries(url.searchParams) }) as { data: unknown };
    return result.data;
  };
  await page.exposeFunction('__riCall', async (action: string, input: unknown, invocationId?: string) => {
    state.calls.push({ action, input });
    const result = await options.invoke(action, input, invocationId);
    if (!options.readActions.has(action)) setTimeout(() => { void refresh(); }, 0);
    return result;
  });
  await page.exposeFunction('__riContext', async (envelope: unknown) => { state.contexts.push(envelope); });
  await page.exposeFunction('__riNavigate', async (url: string) => {
    state.hostLinks.push(url);
    const parsed = new URL(url, 'https://view.local');
    if (parsed.pathname === '/__host/chat') state.prompts.push(parsed.searchParams.get('prompt') ?? '');
    if (parsed.pathname === '/__host/location') { location = parsed.searchParams.get('to') ?? location; state.locations.push(location); await refresh(); }
  });
  await page.exposeFunction('__riDownload', async (contents: unknown) => { state.downloads.push(contents); });
  await page.exposeFunction('__riSelect', async () => options.file ?? null);
  await page.exposeFunction('__riOpener', async (pathname: string) => opener(pathname));
  await page.goto(`http://127.0.0.1:${port}/`);
  const refresh = async () => {
    const data = await opener(location);
    await page.evaluate(async (value) => { await (window as unknown as { controller: { refresh(data: unknown): Promise<void> } }).controller.refresh(value); }, data as never).catch(() => undefined);
  };
  const open = async (pathname: string) => {
    location = pathname;
    const data = await opener(pathname);
    const url = new URL(pathname, 'https://view.local');
    await page.evaluate(async ({ guest, data, id, pathname, query, theme }) => {
      const w = window as unknown as Record<string, any>;
      if (w.controller) await w.controller.dispose();
      const call = async (action: string, input: unknown, _signal: AbortSignal, meta?: { invocationId?: string }) => w.__riCall(action, input, meta?.invocationId);
      w.controller = new w.AppViewController(document.getElementById('mount'), {
        call, context: async (envelope: unknown) => w.__riContext(envelope), navigate: async (url: string) => w.__riNavigate(url), externalLink: async (url: string) => w.__riNavigate(url),
        error: (error: Error) => console.error(`view error: ${error.message}`), selectFile: async () => w.__riSelect(), downloadFile: async (contents: unknown) => w.__riDownload(contents),
      });
      await w.controller.open(guest, { id, packageDigest: 'a'.repeat(64), initialData: data, path: pathname, query, theme, files: { select: { mimeTypes: ['text/csv', 'text/vcard', 'text/plain'], maxBytes: 524288 }, download: { mimeTypes: ['text/csv', 'application/json'], maxBytes: 524288 } } });
    }, { guest, data: data as never, id: randomUUID(), pathname: url.pathname, query: Object.fromEntries(url.searchParams), theme: options.theme ?? 'light' });
    const view = page.frameLocator('#mount iframe').frameLocator('iframe');
    try {
      await view.locator('.ri-title').first().waitFor({ timeout: 20000 });
    } catch (error) {
      fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
      await page.screenshot({ path: path.join(root, 'artifacts', 'render-failure.png') }).catch(() => undefined);
      const text = await view.locator('body').innerText({ timeout: 2000 }).catch(() => 'unreadable');
      const frames = await Promise.all(page.frames().map(async (frame) => `${frame.url().slice(0, 40)} title=${await frame.evaluate(() => document.querySelector('.ri-title')?.textContent ?? 'none').catch((e: Error) => `err ${e.message.slice(0, 80)}`)}`));
      throw new Error(`The view did not render: ${text.slice(0, 300)} :: ${(error as Error).message.split('\n')[0]}. Frames: ${frames.join(' | ')}. Browser errors: ${errors.join(' | ') || 'none'}`);
    }
  };
  try {
    await open(location);
  } catch (error) {
    await browser.close();
    server.close();
    throw error;
  }
  const harness: Harness = {
    browser, page, view: page.frameLocator('#mount iframe').frameLocator('iframe'), ...state,
    open,
    async resize(width, height = 900) { await page.setViewportSize({ width, height }); await page.waitForTimeout(250); },
    async theme(theme) { await page.evaluate((value) => (window as unknown as { controller: { theme(theme: string): void } }).controller.theme(value), theme); await page.waitForTimeout(150); },
    refresh,
    guest() {
      const frame = page.frames().find((candidate) => candidate.parentFrame()?.parentFrame() === page.mainFrame());
      if (!frame) throw new Error('The view frame is not attached');
      return frame;
    },
    async screenshot(file) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      // Let confirmation toasts from earlier steps finish so each screenshot shows only its own state.
      await harness.view.locator('.ri-toast').first().waitFor({ state: 'detached', timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(300);
      await page.screenshot({ path: file });
    },
    async close() {
      await browser.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      const relevant = errors.filter((message) => !/Failed to load resource/.test(message));
      if (relevant.length) throw new Error(`Browser errors: ${relevant.join(' | ')}`);
    },
  };
  return harness;
}
