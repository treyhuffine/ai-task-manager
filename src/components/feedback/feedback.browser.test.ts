/** Actual feedback controls, synthetic delivery. No requests leave the test server. */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { build } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

let server: http.Server;
let browser: Browser;
let base: string;
let failPrepare = false;
let delay = 0;
let uploadDelay = 0;
let failUpload = false;
let calls: { path: string; input: Record<string, unknown> }[] = [];
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
  'base64',
);
let previewBytes: Buffer = png;
beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
  const css = await postcss([require('@tailwindcss/postcss')()]).process(
    fs.readFileSync('src/app/globals.css', 'utf8'),
    { from: path.resolve('src/app/globals.css') },
  );
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'tsx',
      contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import {TooltipProvider} from '@/components/ui/tooltip';
    import {HomeBoundary} from '@/components/home/home-context';
    import {FeedbackRailButton,FeedbackDialog} from '@/components/feedback/feedback-trigger';
    import {openFeedback} from '@/components/feedback/feedback-store';
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}}); window.testQueries=client;
    function Fixture(){return <HomeBoundary><main className="flex h-dvh bg-background text-foreground">
      <aside data-wide className="hidden w-60 shrink-0 flex-col border-r border-border bg-sidebar p-3 md:flex"><p className="p-2 text-sm font-semibold">My Ri</p><p className="p-2 text-xs text-muted-foreground">Home</p><p className="p-2 text-xs text-muted-foreground">Agents</p><div className="mt-auto"><FeedbackRailButton collapsed={false}/></div></aside>
      <aside data-strip className="hidden w-11 shrink-0 flex-col justify-end border-r border-border pb-3 md:flex"><FeedbackRailButton collapsed/></aside>
      <section className="flex-1 p-6 md:p-12"><p className="text-xs text-muted-foreground">Your space to focus</p><h1 className="mt-2 text-2xl font-semibold">A little less friction.</h1><p className="mt-3 max-w-sm text-sm text-muted-foreground">Share a rough edge or an idea, then get back to what matters.</p><button data-dialog className="mt-6 rounded-full border border-border px-4 py-2 text-sm" onClick={()=>openFeedback()}>Feedback & bugs</button><button aria-label="Search" className="sr-only">Search</button></section>
      <FeedbackDialog/>
    </main></HomeBoundary>}
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><TooltipProvider><Fixture/></TooltipProvider></QueryClientProvider>);
  `,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
  });
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://fixture');
    if (url.pathname.includes('/trpc/')) {
      const procedure = url.pathname.split('/trpc/')[1];
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const input = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      let data: unknown;
      if (procedure === 'homeContext')
        data = {
          home: { id: 'test-home', kind: 'personal', name: 'My Ri' },
          viewer: { id: 'local', name: 'Tester', role: 'personal' },
          capabilities: {},
          executionChoices: [],
        };
      if (procedure === 'feedback.preparePublicIssue') {
        calls.push({ path: url.pathname, input });
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        if (failPrepare) {
          res.statusCode = 503;
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({
              error: {
                message: 'Connection failed',
                code: -32603,
                data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 503 },
              },
            }),
          );
          return;
        }
        data = {
          githubIssueUrl: base + '/public-issue',
          body: String(input.message),
          needsBodyPaste: String(input.message).length > 1000,
        };
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ result: { data } }));
      return;
    }
    if (url.pathname.endsWith('/api/attachments') && req.method === 'POST') {
      for await (const _chunk of req) {
        void _chunk;
      }
      if (uploadDelay) await new Promise((resolve) => setTimeout(resolve, uploadDelay));
      res.setHeader('content-type', 'application/json');
      if (failUpload) {
        failUpload = false;
        res.statusCode = 413;
        res.end('{"message":"File too large"}');
        return;
      }
      res.statusCode = 201;
      res.end(
        JSON.stringify({
          fileName: crypto.randomUUID() + '.png',
          originalName: 'Screenshot.png',
          mimeType: 'image/png',
          size: previewBytes.length,
          uploadedAt: 'now',
        }),
      );
      return;
    }
    if (url.pathname.includes('/attachments/')) {
      res.setHeader('content-type', 'image/png');
      res.end(previewBytes);
      return;
    }
    if (url.pathname === '/fixture.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(bundle.outputFiles[0].text);
      return;
    }
    if (url.pathname === '/fixture.css') {
      res.setHeader('content-type', 'text/css');
      res.end(css.css);
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(
      '<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const executablePath = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ].find(fs.existsSync);
  browser = await chromium.launch({ executablePath, headless: true });
}, 30_000);
beforeEach(() => {
  failPrepare = false;
  delay = 0;
  uploadDelay = 0;
  failUpload = false;
  calls = [];
  previewBytes = png;
});
afterAll(async () => {
  await browser?.close();
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});
async function open(width = 1280, height = 800) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.setDefaultTimeout(5000);
  await page.goto(base);
  await page.addStyleTag({
    content: '*,::before,::after{animation:none!important;transition:none!important}',
  });
  await page.locator('[data-dialog]').waitFor();
  return page;
}
const details = (page: Page) => page.getByRole('textbox', { name: 'Feedback details' });
const file = () => ({ name: 'Screenshot.png', mimeType: 'image/png', buffer: previewBytes });
async function snapshot(page: Page, name: string) {
  const folder = process.env.RI_FEEDBACK_SCREENSHOTS;
  if (!folder) return;
  fs.mkdirSync(folder, { recursive: true });
  await page
    .getByRole('button', { name: 'Connecting...', exact: true })
    .waitFor({ state: 'detached' });
  await page
    .locator('img')
    .evaluateAll((images) =>
      Promise.all(images.map((image) => (image as HTMLImageElement).decode().catch(() => {}))),
    );
  await page.screenshot({ path: path.join(folder, name + '.png') });
  const surface = page.locator('[data-slot="popover-content"],[data-slot="dialog-content"]');
  if (await surface.count())
    await surface.screenshot({ path: path.join(folder, name + '-detail.png') });
}
it('preserves one draft across rail, collapsed rail, dialog and page reload', async () => {
  const page = await open();
  try {
    await page.locator('[data-wide]').getByRole('button').click();
    await details(page).fill('Keep this report');
    await page.getByRole('button', { name: 'Close feedback' }).click();
    await details(page).waitFor({ state: 'detached' });
    await page.locator('[data-strip]').getByRole('button').click();
    expect(await details(page).inputValue()).toBe('Keep this report');
    await page.getByRole('button', { name: 'Close feedback' }).click();
    await details(page).waitFor({ state: 'detached' });
    await page.locator('[data-dialog]').click();
    expect(await details(page).inputValue()).toBe('Keep this report');
    await page.reload();
    await page.locator('[data-dialog]').click();
    expect(await details(page).inputValue()).toBe('Keep this report');
  } finally {
    await page.close();
  }
});
it('supports native radio arrows and returns dialog focus to its trigger', async () => {
  const page = await open();
  try {
    await page.locator('[data-dialog]').click();
    const radio = page.getByRole('radio', { name: 'Feedback', exact: true });
    await radio.focus();
    await page.keyboard.press('ArrowRight');
    expect(await page.getByRole('radio', { name: 'Bug', exact: true }).isChecked()).toBe(true);
    await page.keyboard.press('Escape');
    await details(page).waitFor({ state: 'detached' });
    await expect
      .poll(() => page.locator('[data-dialog]').evaluate((el) => el === document.activeElement))
      .toBe(true);
  } finally {
    await page.close();
  }
});
it('opens a GitHub draft, freezes input during preparation and never claims it was sent', async () => {
  delay = 250;
  const page = await open();
  try {
    await page.locator('[data-wide]').getByRole('button').click();
    await details(page).fill('The rail covers my task');
    await snapshot(page, '01-desktop-compose');
    const popup = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Continue on GitHub', exact: true }).click();
    expect(await details(page).isDisabled()).toBe(true);
    const tab = await popup;
    await page.getByText('Finish on GitHub', { exact: true }).waitFor();
    await snapshot(page, '03-github-handoff');
    await expect.poll(() => tab.url()).toContain('/public-issue');
    expect(calls[0].input.message).toBe('The rail covers my task');
    expect(await page.getByText(/Sent to Ri|Feedback saved/).count()).toBe(0);
    await page.reload();
    await page.locator('[data-dialog]').click();
    await page.getByText('Finish on GitHub', { exact: true }).waitFor();
    expect(await details(page).inputValue()).toBe('The rail covers my task');
    await tab.close();
  } finally {
    await page.close();
  }
});
it('keeps a draft after preparation fails and allows the same GitHub flow to retry', async () => {
  failPrepare = true;
  const page = await open();
  try {
    await page.locator('[data-dialog]').click();
    await details(page).fill('Please fix this');
    await page.getByRole('button', { name: 'Continue on GitHub', exact: true }).click();
    await page.getByRole('alert').waitFor();
    await snapshot(page, '04-connection-error');
    expect(await details(page).inputValue()).toBe('Please fix this');
    failPrepare = false;
    const popup = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Continue on GitHub', exact: true }).click();
    const tab = await popup;
    await page.getByText('Finish on GitHub', { exact: true }).waitFor();
    expect(calls).toHaveLength(2);
    expect(calls[1].input).toEqual(calls[0].input);
    await tab.close();
  } finally {
    await page.close();
  }
});
it('keeps phone controls on screen with a long report and a reduced visual viewport', async () => {
  const page = await open(390, 700);
  try {
    previewBytes = await page.screenshot();
    await page.locator('[data-dialog]').click();
    await details(page).fill(
      Array.from({ length: 30 }, (_, i) => `Step ${i}: the task did not open.`).join('\n'),
    );
    await page.locator('input[type=file]').setInputFiles(file());
    await page.getByRole('button', { name: 'Attach', exact: true }).waitFor();
    await details(page).fill(
      'When I open a task on my phone, the details panel covers the bottom buttons.\n\nI expected to scroll without losing the actions.',
    );
    await expect
      .poll(() => page.locator('img').evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await snapshot(page, '02-phone-attachment');
    const bounds = await page
      .getByRole('button', { name: 'Continue on GitHub', exact: true })
      .boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThan(700);
    await page.evaluate(() => {
      const viewport = new EventTarget();
      Object.defineProperties(viewport, { height: { value: 350 }, offsetTop: { value: 0 } });
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
      viewport.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('resize'));
    });
    // ResizeObserver and the shared viewport hook observe the normal browser viewport in production.
    await page.setViewportSize({ width: 390, height: 350 });
    await expect
      .poll(async () => {
        const b = await page
          .getByRole('button', { name: 'Continue on GitHub', exact: true })
          .boundingBox();
        return b!.y + b!.height;
      })
      .toBeLessThan(350);
    await snapshot(page, 'phone-keyboard');
  } finally {
    await page.close();
  }
});
it('counts in-flight image pastes and preserves successful uploads in a partial failure', async () => {
  const page = await open();
  try {
    await page.locator('[data-dialog]').click();
    uploadDelay = 100;
    await page.locator('input[type=file]').setInputFiles(Array.from({ length: 4 }, file));
    await page.getByRole('button', { name: 'Attach', exact: true }).waitFor();
    await details(page).evaluate((el) => {
      for (let i = 0; i < 2; i++) {
        const dt = new DataTransfer();
        dt.items.add(new File(['x'], 'paste.png', { type: 'image/png' }));
        el.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
        );
      }
    });
    await expect
      .poll(() => page.getByRole('button', { name: 'Remove Screenshot.png' }).count())
      .toBe(5);
    await page.getByRole('button', { name: 'Remove Screenshot.png' }).first().click();
    await page.getByRole('button', { name: 'Remove Screenshot.png' }).first().click();
    failUpload = true;
    await page.locator('input[type=file]').setInputFiles([file(), file()]);
    await page.getByRole('alert').waitFor();
    expect(await page.getByRole('button', { name: 'Remove Screenshot.png' }).count()).toBe(4);
  } finally {
    await page.close();
  }
});
it('offers one destination, includes the opt-out, and provides files for the final GitHub step', async () => {
  const page = await open(390, 700);
  try {
    await page.locator('[data-dialog]').click();
    await details(page).fill('An idea for the task list');
    await page.getByRole('checkbox', { name: 'Include app & view info' }).uncheck();
    await page.locator('input[type=file]').setInputFiles(file());
    await page.getByRole('button', { name: 'Attach', exact: true }).waitFor();
    expect(
      await page.getByRole('button', { name: 'Continue on GitHub', exact: true }).count(),
    ).toBe(1);
    expect(
      await page.getByRole('button', { name: /Send to|Create a public GitHub issue/ }).count(),
    ).toBe(0);
    const popup = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Continue on GitHub', exact: true }).click();
    const tab = await popup;
    await page.getByText('Finish on GitHub', { exact: true }).waitFor();
    expect(calls[0].input.includeDiagnostics).toBe(false);
    expect(calls[0].input.diagnostics).toBeUndefined();
    await page.getByRole('link', { name: 'Download Screenshot.png' }).waitFor();
    await page.getByText('Files are kept in Ri.', { exact: false }).waitFor();
    await snapshot(page, '05-phone-handoff');
    await tab.close();
  } finally {
    await page.close();
  }
});
it('keeps a long report available for copying or downloading into GitHub', async () => {
  const page = await open();
  try {
    await page.locator('[data-dialog]').click();
    await details(page).fill('A detailed report. '.repeat(100));
    const popup = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Continue on GitHub', exact: true }).click();
    const tab = await popup;
    await page.getByText('This report is too long to prefill.', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Copy full report' }).waitFor();
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download report' }).click();
    expect((await download).suggestedFilename()).toBe('ri-feedback.md');
    await tab.close();
  } finally {
    await page.close();
  }
});
