/** The rail's actual Apps row and flyout, against an isolated synthetic API: every app with a screen you can open gets a row. */
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
const requests: string[] = [];
const app = (id: string, displayName: string, over: Record<string, unknown> = {}) => ({
  id, slug: id, displayName, description: '', packageId: id, hasView: true, hasActions: true, enabled: true, archived: false,
  activation: { phase: 'active' }, runtime: { condition: 'stopped' }, ...over,
});
const connected = (id: string, toolkitName: string, over: Record<string, unknown> = {}) => ({
  id, name: toolkitName, toolkitName, account: id, available: true, sourceRef: null, standalone: true, entrypoints: [{ name: 'home', title: toolkitName }], views: [], recent: [], ...over,
});
const empty = { 'localApps.list': { revision: 1, drafts: [], grants: [], panels: [], instances: [], approvals: [] }, 'connectedApps.catalog': [] };
let current: Record<string, unknown>;
const responses: Record<string, unknown> = {
  'localApps.enabled': { enabled: true },
  'localApps.list': {
    revision: 1, drafts: [{ id: 'draft', profile: 'react' }], grants: [], panels: [],
    // Built here, included, and one archived and one disabled that wait in the library.
    instances: [app('tracker', 'Subscription tracker'), app('travel', 'Travel', { icon: 'plane' }),
      app('old', 'Archived app', { archived: true }), app('off', 'Disabled app', { enabled: false })],
    approvals: [{ id: 'approval', instanceId: 'tracker', invocationId: 'i', actionId: 'a', preview: {} }],
  },
  'connectedApps.catalog': [
    // An official provider with two accounts, the first signed out: one row, opening the one that can open.
    connected('todoist-old', 'Todoist', { providerId: 'todoist', name: 'Todoist', available: false }),
    connected('todoist-work', 'Todoist', { providerId: 'todoist', name: 'Todoist 2' }),
    // An MCP server the person added.
    connected('receipts', 'Receipts'),
    // A provider whose only account is signed out.
    connected('notion', 'Notion', { providerId: 'notion', available: false }),
    // A service whose interface only comes back as a tool result has no screen to open, so no row.
    connected('linear', 'Linear', { providerId: 'linear', standalone: false, entrypoints: [], views: [{ name: 'list-issues', title: 'Issues' }] }),
  ],
};

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
      import {useAppPlaces} from '@/components/local-apps/use-app-places';
      import {RailRows} from '@/components/workspaces/rail-nav';
      const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
      function Fixture(){
        return <aside className="relative flex h-dvh w-[256px] flex-col border-r border-border bg-background"><RailRows places={useAppPlaces()} label="Places"/></aside>;
      }
      createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><TooltipProvider><Fixture/></TooltipProvider></QueryClientProvider>);
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
    plugins: [{ name: 'isolated-dashboard', setup(api) {
      api.onResolve({ filter: /^@\/contexts\/dashboard-context$/ }, () => ({ path: 'dashboard', namespace: 'fixture' }));
      api.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ resolveDir: process.cwd(), loader: 'js', contents: `
        import {useSyncExternalStore} from 'react';
        let view={kind:'home'};const subscribers=new Set();window.views=[];
        const setActiveView=next=>{view=next;window.views.push(next);subscribers.forEach(notify=>notify());};
        const subscribe=notify=>{subscribers.add(notify);return()=>subscribers.delete(notify);};
        export const useDashboard=()=>({activeView:useSyncExternalStore(subscribe,()=>view),setActiveView});
        export const useOptionalDashboard=useDashboard;
      ` }));
    } }],
  });
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://fixture');
    if (url.pathname.startsWith('/api/trpc/')) {
      for await (const chunk of req) void chunk;
      const procedure = url.pathname.slice('/api/trpc/'.length);
      requests.push(procedure);
      const data = current[procedure];
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
  const page = await browser.newPage({ viewport: { width: 900, height: 640 } });
  page.setDefaultTimeout(5_000);
  await page.goto(base);
  return page;
}
const flyout = (page: Page) => page.getByRole('navigation', { name: 'Apps', exact: true });
const views = (page: Page) => page.evaluate(() => (window as unknown as { views: unknown[] }).views);

it('peeks installed apps and connected apps together, by name, and opens each where it lives', async () => {
  current = responses;
  const page = await open();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    const row = page.getByRole('button', { name: /^Apps/ });
    await row.waitFor();
    // The count still means approvals, which only installed apps hold between visits.
    await page.getByLabel('1 waiting on you').waitFor();
    expect(requests).not.toContain('connectedApps.catalog');

    await row.hover();
    await flyout(page).waitFor();
    const names = () => flyout(page).locator('button > span.truncate').allInnerTexts();
    await expect.poll(names).toEqual(['Open your library', 'Receipts', 'Subscription tracker', 'Todoist', 'Travel']);
    // Reaching the row warmed the connections, and the flyout read that same cache.
    expect(requests.filter(name => name === 'connectedApps.catalog')).toHaveLength(1);
    expect(await flyout(page).getByLabel('Needs your approval').count()).toBe(1);
    await page.screenshot({ path: '/tmp/ri-apps-flyout.png' });

    await flyout(page).getByRole('button', { name: 'Todoist' }).click();
    // A connected app's row opens its screen itself, its first global entrypoint.
    await expect.poll(() => views(page)).toEqual([{ kind: 'apps', route: '~connected/todoist-work', query: { open: 'home' } }]);
    // Going there closes the peek. Back on it, Todoist is the row on screen.
    await flyout(page).waitFor({ state: 'detached' });
    await page.mouse.move(600, 600);
    await row.hover();
    await flyout(page).waitFor();
    expect(await flyout(page).getByRole('button', { name: 'Todoist' }).getAttribute('aria-current')).toBe('page');

    await flyout(page).getByRole('button', { name: 'Receipts' }).click();
    await page.mouse.move(600, 600);
    await row.hover();
    await flyout(page).getByRole('button', { name: 'Travel' }).click();
    await expect.poll(() => views(page)).toEqual([
      { kind: 'apps', route: '~connected/todoist-work', query: { open: 'home' } },
      { kind: 'apps', route: '~connected/receipts', query: { open: 'home' } },
      { kind: 'apps', route: 'travel' },
    ]);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});

it('with no apps yet, still offers the library and says what will appear', async () => {
  current = { ...responses, ...empty };
  const page = await open();
  try {
    await page.getByRole('button', { name: /^Apps/ }).hover();
    await flyout(page).waitFor();
    expect(await flyout(page).getByRole('button').allInnerTexts()).toEqual(['Open your library']);
    await flyout(page).getByText('Apps you install, and connected services with a screen of their own, appear here.').waitFor();
    await page.screenshot({ path: '/tmp/ri-apps-flyout-empty.png' });
    await flyout(page).getByRole('button', { name: 'Open your library' }).click();
    await expect.poll(() => views(page)).toEqual([{ kind: 'apps', route: '' }]);
  } finally {
    await page.close();
  }
});
