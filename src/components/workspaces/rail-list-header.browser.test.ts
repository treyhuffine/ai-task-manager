/**
 * The rail's list header, Agents | Recent, against an isolated fixture: the
 * switch reads as a control rather than one more group label (sentence case,
 * the open list raised on a visible track), in dark and light, and switching
 * lists swaps the header's actions.
 */
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

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
  const css = await postcss([require('@tailwindcss/postcss')()]).process(fs.readFileSync('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') });
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
      import {TooltipProvider} from '@/components/ui/tooltip';
      import {ConfirmProvider} from '@/components/ui/confirm-dialog';
      import {WorkContext} from '@/contexts/work-context';
      import {RailListHeader} from '@/components/workspaces/rail-list';
      import {WorkspaceSelectionProvider} from '@/components/workspaces/workspace-selection-context';
      const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
      const noop=()=>{};
      const navigation={openAgent:noop,openExecution:noop,openTask:noop,openNote:noop,goHome:noop};
      const activity={activeSessionId:null,streamingSessionIds:new Set(),backgroundSessionIds:new Set(),pendingInputSessionIds:new Set(),setActiveExecutionId:noop,setSessionStreaming:noop};
      function Fixture(){
        const [tab,setTab]=useState('workspace');
        return <aside className="w-[256px] border-r border-border bg-background">
          <WorkspaceSelectionProvider><RailListHeader tab={tab} onSelect={setTab}/></WorkspaceSelectionProvider>
          <span data-group-label className="text-[8.5px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Pinned</span>
        </aside>;
      }
      createRoot(document.getElementById('root')).render(
        <QueryClientProvider client={client}><TooltipProvider><ConfirmProvider>
          <WorkContext navigation={navigation} activity={activity}><Fixture/></WorkContext>
        </ConfirmProvider></TooltipProvider></QueryClientProvider>);
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
  });
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://fixture');
    if (url.pathname === '/fixture.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
    if (url.pathname === '/fixture.css') { res.setHeader('content-type', 'text/css'); res.end(css.css); return; }
    if (url.pathname.startsWith('/api/')) { res.statusCode = 404; res.end(); return; }
    const theme = url.searchParams.get('theme') === 'light' ? '' : 'dark';
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><html class="${theme}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
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

async function open(theme: 'dark' | 'light'): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: 400, height: 200 }, deviceScaleFactor: 2 });
  page.setDefaultTimeout(5_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/?theme=${theme}`);
  await page.getByRole('tablist', { name: 'Rail list' }).waitFor();
  return { page, errors };
}

/** What sets each part apart: lettering, and the fill under it. */
async function looks(page: Page) {
  return page.evaluate(() => {
    const style = (el: Element | null) => getComputedStyle(el!);
    const list = document.querySelector('[role="tablist"]');
    const [agents, recent] = Array.from(document.querySelectorAll('[role="tab"]'));
    return {
      track: style(list).backgroundColor,
      agents: { transform: style(agents).textTransform, fill: style(agents).backgroundColor },
      recent: { transform: style(recent).textTransform, fill: style(recent).backgroundColor },
      groupLabel: style(document.querySelector('[data-group-label]')).textTransform,
      page: style(document.body).backgroundColor,
    };
  });
}

const CLEAR = 'rgba(0, 0, 0, 0)';

for (const theme of ['dark', 'light'] as const) {
  it(`reads as a switch, not a group label (${theme})`, async () => {
    const { page, errors } = await open(theme);
    try {
      const tabs = page.getByRole('tab');
      expect(await tabs.allInnerTexts()).toEqual(['Agents', 'Recent']);
      expect(await tabs.evaluateAll(els => els.map(el => el.getAttribute('aria-selected')))).toEqual(['true', 'false']);

      const look = await looks(page);
      // Group labels (Pinned, Needs you) are small caps. The switch isn't.
      expect(look.groupLabel).toBe('uppercase');
      expect(look.agents.transform).toBe('none');
      expect(look.recent.transform).toBe('none');
      // Both lists sit on one visible track, and the open one is raised on it.
      expect(look.track).not.toBe(CLEAR);
      expect(look.track).not.toBe(look.page);
      expect(look.agents.fill).not.toBe(CLEAR);
      expect(look.agents.fill).not.toBe(look.track);
      expect(look.recent.fill).toBe(CLEAR);
      await page.screenshot({ path: `/tmp/ri-rail-list-header-${theme}.png` });
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  });
}

it('switches lists, and the agent actions show only on Agents', async () => {
  const { page, errors } = await open('dark');
  try {
    expect(await page.getByRole('button', { name: 'New agent' }).count()).toBe(1);
    await page.getByRole('tab', { name: 'Recent' }).click();
    expect(await page.getByRole('tab', { name: 'Recent' }).getAttribute('aria-selected')).toBe('true');
    expect(await page.getByRole('tab', { name: 'Agents' }).getAttribute('aria-selected')).toBe('false');
    expect(await page.getByRole('button', { name: 'New agent' }).count()).toBe(0);
    // The fills ease over, so wait for the switch to settle.
    await expect.poll(async () => (await looks(page)).agents.fill).toBe(CLEAR);
    expect((await looks(page)).recent.fill).not.toBe(CLEAR);

    // The keyboard reaches each list on its own.
    await page.getByRole('tab', { name: 'Agents' }).focus();
    await page.keyboard.press('Enter');
    expect(await page.getByRole('tab', { name: 'Agents' }).getAttribute('aria-selected')).toBe('true');
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});
