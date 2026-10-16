/** The rail's actual footer, wide and collapsed, against an isolated synthetic API: an account only you can fix shows, and leads to its page. */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { build } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';

let server: http.Server;
let browser: Browser;
let base: string;
let attention: unknown[] = [];

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
  const css = await postcss([require('@tailwindcss/postcss')()]).process(fs.readFileSync('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') });
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
      import {TooltipProvider} from '@/components/ui/tooltip';
      import {useSettingsStore} from '@/components/settings/settings-store';
      import {RailFooter} from '@/components/workspaces/rail-footer';
      const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
      function Fixture(){
        const settings=useSettingsStore();
        return <main className="flex h-dvh">
          <aside data-rail="wide" className="flex w-[256px] flex-col justify-end border-r border-border"><RailFooter collapsed={false}/></aside>
          <aside data-rail="strip" className="flex w-[44px] flex-col justify-end border-r border-border"><RailFooter collapsed/></aside>
          <output data-settings>{settings.open?settings.section+' '+settings.anchor:'closed'}</output>
        </main>;
      }
      createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><TooltipProvider><Fixture/></TooltipProvider></QueryClientProvider>);
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
  });
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://fixture');
    if (url.pathname.startsWith('/api/trpc/')) {
      for await (const chunk of req) void chunk;
      const procedure = url.pathname.slice('/api/trpc/'.length);
      const data = procedure === 'integrations.attentionGet' ? attention : procedure === 'spaces.list' ? [] : undefined;
      res.setHeader('content-type', 'application/json');
      if (data === undefined) { res.statusCode = 500; res.end(JSON.stringify({ error: { message: `Unexpected request: ${procedure}`, code: -32603, data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 } } })); }
      else res.end(JSON.stringify({ result: { data } }));
      return;
    }
    if (url.pathname === '/fixture.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
    if (url.pathname === '/fixture.css') { res.setHeader('content-type', 'text/css'); res.end(css.css); return; }
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const executablePath = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find(fs.existsSync);
  if (!executablePath) throw new Error('Chromium is required for rail qualification');
  browser = await chromium.launch({ executablePath, headless: true });
}, 30_000);

afterAll(async () => {
  await browser?.close(); server?.closeAllConnections();
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
});

async function open(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  page.setDefaultTimeout(5_000);
  await page.goto(base);
  return page;
}
const settings = (page: Page) => page.locator('[data-settings]').innerText();
const wide = (page: Page) => page.locator('[data-rail="wide"]');
const strip = (page: Page) => page.locator('[data-rail="strip"]');

it('counts accounts only you can fix, names them, and goes to the page that fixes them', async () => {
  attention = [
    { key: 'work', name: 'Google', account: 'Work', target: { kind: 'provider', id: 'google' } },
    { key: 'home', name: 'Google', account: 'Home', target: { kind: 'provider', id: 'google' } },
  ];
  const page = await open();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    const connect = wide(page).getByRole('button', { name: 'Connect accounts, 2 waiting on you' });
    await connect.waitFor();
    expect(await connect.innerText()).toContain('2');
    await connect.hover();
    await page.getByRole('tooltip').filter({ hasText: 'Reconnect Google (Work) and Google (Home)' }).first().waitFor();
    await page.screenshot({ path: '/tmp/ri-rail-footer-attention.png' });
    await connect.click();
    expect(await settings(page)).toBe('plugins integrations:google');

    // The collapsed rail shows the same accounts as a plug with a dot, above Settings.
    const plug = strip(page).getByRole('button', { name: 'Reconnect Google (Work) and Google (Home)' });
    await plug.waitFor();
    expect(await strip(page).getByRole('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label'))))
      .toEqual(['Reconnect Google (Work) and Google (Home)', 'Settings']);
    expect(await plug.locator('.bg-amber-500').count()).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});

it('stays quiet while every account works', async () => {
  attention = [];
  const page = await open();
  try {
    const connect = wide(page).getByRole('button', { name: 'Connect accounts', exact: true });
    await connect.waitFor();
    // The plug and the three fanned tiles, not a count.
    expect(await connect.locator('svg').count()).toBe(4);
    expect(await connect.getByLabel(/waiting on you/).count()).toBe(0);
    expect(await strip(page).getByRole('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))).toEqual(['Settings']);
    await page.screenshot({ path: '/tmp/ri-rail-footer-quiet.png' });
    await connect.click();
    expect(await settings(page)).toBe('plugins integrations');
  } finally {
    await page.close();
  }
});
