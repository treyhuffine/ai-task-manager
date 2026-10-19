/** The actual library and unchanged Plugins surface, against an isolated synthetic API. */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { build } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { encodeSource } from '@/lib/chat-sources/reference';

let server: http.Server;
let browser: Browser;
let base: string;
const chatId = '01900111-1111-7111-8111-111111111111';
const sources = ['Work', 'Personal'].map(account => ({
  sourceRef: encodeSource({ v: 1, kind: 'integration', toolkitId: 'gmail', account: { accountId: account, authConfigId: null } }),
  label: `Gmail · ${account}`, accountLabel: account, service: 'Gmail', groupId: 'gmail', keywords: [account], status: 'ready', chat: true, view: 'none',
}));
const customServer = { id: 'receipts', slug: 'receipts', displayName: 'Receipts', url: 'https://receipts.example.test/mcp', enabled: true, auth: { kind: 'none' }, lastStatus: 'ok', tools: [{ name: 'list_receipts', description: 'Read receipts', readOnlyHint: true }] };
const skills = [{ ref: 'ri:weekly-review', name: 'Weekly review', description: 'Turn the week’s notes into a clear plan for Monday.', hasErrors: false, location: { kind: 'ri' } }];
const responses: Record<string, unknown> = {
  'connectedApps.catalog': [],
  'integrations.statusGet': { providers: [
    { id: 'google', displayName: 'Google', method: 'oauth2', configured: true },
    { id: 'linear', displayName: 'Linear', method: 'api_key', configured: true, credentialFields: [] },
    { id: 'mcp_receipts', displayName: 'MCP: Receipts', method: 'api_key', configured: true },
  ], redirectUri: 'https://fixture.test/oauth' },
  'integrations.connectionsGet': { connections: sources.map((s, i) => ({ id: `google-${i}`, providerId: 'google', accountId: s.accountLabel, label: s.accountLabel, email: `${s.accountLabel.toLowerCase()}@example.test`, status: 'active', scopes: [] })) },
  'integrations.toolkitsGet': { toolkits: [{ id: 'gmail', providerId: 'google', displayName: 'Gmail', description: 'Mail', scopes: [], actions: [] }] },
  'integrations.writePolicyGet': { toolkits: [] },
  'integrations.authConfigsGet': { configs: [] },
  'integrations.mcpServersGet': { servers: [customServer], approvalSettings: { defaultPolicy: 'writes', override: null } },
  'skills.list': { skills, projects: [] },
  'skills.create': { skill: { ref: 'draft:new-skill' } },
  'localApps.catalog': [],
  'localApps.createDraft': { id: 'new-draft' },
  'orchestratorChat.list': { session: { id: chatId, harness: 'claude' } },
};

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
  const css = await postcss([require('@tailwindcss/postcss')()]).process(fs.readFileSync('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') });
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React,{useState,useEffect} from 'react';
      import {createRoot} from 'react-dom/client';
      import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
      import {TooltipProvider} from '@/components/ui/tooltip';
      import {AppLibrary} from '@/components/local-apps/app-library';
      import {PluginsSection} from '@/components/settings/sections/plugins-section';
      import {useSettingsStore,openSettings} from '@/components/settings/settings-store';
      import {receiveChatSources} from '@/lib/client/source-handoff';
      import {useAppPane} from '@/lib/client/app-pane';
      const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
      const mode=new URLSearchParams(location.search);
      if(mode.has('settings'))openSettings('plugins');
      window.actions=[];window.references=[];
      receiveChatSources('${chatId}',offer=>{window.references.push(offer.sourceRef);return true;});
      const data={revision:1,instances:[{id:'tracker',slug:'subscription-tracker',displayName:'Subscription tracker',description:'See recurring costs and decide what to keep.',packageId:'subscription-tracker',hasView:true,hasActions:true,enabled:true,archived:false,activation:{phase:'active'},runtime:{condition:'stopped'}}],drafts:[],grants:[],approvals:[],panels:[]};
      function PaneProbe({route}){
        const {mode,setMode}=useAppPane('tracker',route.includes('riChat=1')?'chat':'closed');
        return <><output data-pane>{mode}</output><button onClick={()=>setMode('closed')}>Close app chat</button><button onClick={()=>setMode('app')}>Show app pane</button></>;
      }
      function Fixture(){
        const [query,setQuery]=useState(Object.fromEntries(mode));
        const [destination,setDestination]=useState('');
        const [paneMount,setPaneMount]=useState(0);
        const settings=useSettingsStore();
        useEffect(()=>{const pop=()=>setQuery(Object.fromEntries(new URLSearchParams(location.search)));window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);},[]);
        const navigate=route=>{if(!route||route.startsWith('?')){history.pushState(null,'',route||'/');setQuery(Object.fromEntries(new URLSearchParams(route)));}else setDestination(route);};
        return <main className="flex h-dvh min-w-0 flex-col">
          {destination?<><output data-destination>{destination}</output><PaneProbe key={paneMount} route={destination}/><button onClick={()=>setPaneMount(n=>n+1)}>Remount pane</button><button onClick={()=>setDestination('')}>Return to library</button></>:mode.has('settings')?<div className="mx-auto w-full max-w-3xl overflow-auto px-5" data-settings-scroll><PluginsSection/></div>:<AppLibrary data={mode.has('disabled')?undefined:data} localEnabled={!mode.has('disabled')} localLoading={false} query={query} navigate={navigate}/>}
          <output hidden data-settings-open>{String(settings.open)}</output>
        </main>;
      }
      createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><TooltipProvider><Fixture/></TooltipProvider></QueryClientProvider>);
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
    plugins: [{ name: 'isolated-dashboard', setup(api) {
      api.onResolve({ filter: /^@\/contexts\/dashboard-context$/ }, () => ({ path: 'dashboard', namespace: 'fixture' }));
      api.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const useDashboard=()=>({openSkill:ref=>window.actions.push(['skill',ref]),goHome:()=>window.actions.push(['home']),showPanelTab:tab=>window.actions.push(['panel',tab]),setMobileTab:tab=>window.actions.push(['mobile',tab]),isFocusMode:false});export const useOptionalDashboard=useDashboard;`, loader: 'js' }));
    } }],
  });
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://fixture');
    if (url.pathname.startsWith('/api/trpc/')) {
      let body = ''; for await (const chunk of req) body += chunk;
      const input = JSON.parse(body || url.searchParams.get('input') || '{}');
      const procedure = url.pathname.slice('/api/trpc/'.length);
      const data = procedure === 'chatSources.search' ? { items: sources.map(source => ({ kind: 'source', source })), total: 2 }
        : procedure === 'chatSources.resolve' ? sources.filter(source => input.refs?.includes(source.sourceRef))
        : responses[procedure];
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
  if (!executablePath) throw new Error('Chromium is required for library qualification');
  browser = await chromium.launch({ executablePath, headless: true });
}, 30_000);

afterAll(async () => {
  await browser?.close(); server?.closeAllConnections();
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
});

async function open(query = ''): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  page.setDefaultTimeout(5_000);
  await page.goto(base + query);
  return page;
}
const card = (page: Page, name: string) => page.locator('article').filter({ has: page.getByRole('heading', { name, exact: true }) });

it('shows real capabilities, exact accounts and setup in Apps without opening Settings', async () => {
  const page = await open();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await card(page, 'Google').waitFor();
    expect(await card(page, 'Google').innerText()).toContain('2 accounts');
    expect(await card(page, 'Google').getByRole('button', { name: 'Open', exact: true }).count()).toBe(0);
    expect(await card(page, 'Subscription tracker').innerText()).toContain('Opens in Ri');
    expect(await card(page, 'Weekly review').innerText()).toContain('Agent workflow');
    expect(await page.getByRole('heading', { name: 'Receipts', exact: true }).count()).toBe(1);
    await page.screenshot({ path: '/tmp/ri-apps-library-desktop.png' });
    await page.getByRole('button', { name: 'Use Google in chat' }).click();
    await page.getByRole('button', { name: /Gmail · Personal/ }).click();
    expect(await page.evaluate(() => (window as unknown as { references: string[] }).references)).toEqual([sources[1].sourceRef]);
    expect(await page.locator('[data-settings-open]').textContent()).toBe('false');
    await page.getByRole('textbox', { name: 'Search library' }).fill('Personal');
    await card(page, 'Google').getByRole('button', { name: 'Manage' }).click();
    await page.getByText('personal@example.test', { exact: false }).first().waitFor();
    expect(await page.locator('[data-settings-open]').textContent()).toBe('false');
    await page.getByRole('button', { name: 'Apps', exact: true }).click();
    expect(await page.getByRole('textbox', { name: 'Search library' }).inputValue()).toBe('Personal');
    await page.getByRole('button', { name: 'Clear search', exact: true }).click();
    await page.getByRole('button', { name: 'Discover', exact: true }).click();
    await card(page, 'Linear').getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByRole('heading', { name: 'Linear', exact: true }).waitFor();
    await page.goBack();
    await page.getByRole('textbox', { name: 'Search library' }).waitFor();
    expect(await page.getByRole('button', { name: 'Discover', exact: true }).getAttribute('aria-current')).toBe('page');
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it('reopens app chat from the library while preserving pane choices across remounts', async () => {
  const page = await open();
  try {
    await page.getByRole('button', { name: 'Use Subscription tracker in chat' }).click();
    await expect.poll(() => page.locator('[data-pane]').textContent()).toBe('chat');
    expect(await page.locator('[data-destination]').textContent()).toBe('subscription-tracker?riChat=1');
    await page.getByRole('button', { name: 'Show app pane' }).click();
    await page.getByRole('button', { name: 'Remount pane' }).click();
    expect(await page.locator('[data-pane]').textContent()).toBe('app');
    await page.getByRole('button', { name: 'Close app chat' }).click();
    await page.getByRole('button', { name: 'Remount pane' }).click();
    expect(await page.locator('[data-pane]').textContent()).toBe('closed');
    await page.getByRole('button', { name: 'Return to library' }).click();
    await page.getByRole('button', { name: 'Use Subscription tracker in chat' }).click();
    await expect.poll(() => page.locator('[data-pane]').textContent()).toBe('chat');
  } finally { await page.close(); }
});

it('opens the existing builders and custom MCP controls, including on mobile', async () => {
  const page = await open();
  try {
    await card(page, 'Receipts').waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: '/tmp/ri-apps-library-mobile.png' });
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('menuitem', { name: /Add custom MCP/ }).click();
    await page.getByRole('textbox', { name: 'Server URL' }).waitFor();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('My server');
    await page.getByRole('textbox', { name: 'Server URL' }).fill('https://example.test/mcp');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Apps', exact: true }).click();
    await card(page, 'Receipts').getByRole('button', { name: 'Manage' }).click();
    await page.getByRole('switch', { name: 'Turn off Receipts' }).waitFor();
    await page.getByRole('button', { name: 'Apps', exact: true }).click();
    await page.getByRole('button', { name: 'Build', exact: true }).click();
    await page.getByRole('menuitem', { name: /Create a skill/ }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { actions: string[][] }).actions)).toContainEqual(['skill', 'draft:new-skill']);
    await page.getByRole('button', { name: 'Build', exact: true }).click();
    await page.getByRole('menuitem', { name: /Build an app/ }).click();
    await page.locator('[data-destination]').waitFor();
    expect(await page.locator('[data-destination]').textContent()).toContain('new-draft');
  } finally { await page.close(); }
});

it('keeps connections and skills usable when local apps are disabled or another catalog fails', async () => {
  const page = await open('?disabled');
  try {
    await card(page, 'Google').waitFor();
    await card(page, 'Weekly review').waitFor();
    await page.getByRole('button', { name: 'Build', exact: true }).click();
    expect(await page.getByRole('menuitem', { name: /Build an app/ }).getAttribute('data-disabled')).toBe('');
    await page.keyboard.press('Escape');
    await page.route('**/api/trpc/integrations.statusGet*', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Catalog temporarily unavailable', code: -32603, data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 } } }) }));
    await page.reload();
    await page.getByRole('alert').waitFor();
    await card(page, 'Weekly review').waitFor();
    await card(page, 'Receipts').waitFor();
  } finally { await page.close(); }
});

it('retains Settings Plugins tabs, service browsing, skill creation and custom MCP navigation', async () => {
  const page = await open('?settings');
  try {
    await page.getByRole('tab', { name: 'Connectors', exact: true }).waitFor();
    await page.getByRole('tab', { name: 'Skills', exact: true }).click();
    await page.getByText('Weekly review', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'New skill', exact: true }).waitFor();
    await page.getByRole('tab', { name: 'MCP servers', exact: true }).click();
    await page.getByRole('button', { name: /Receipts/ }).first().click();
    await page.getByRole('switch', { name: 'Turn off Receipts' }).waitFor();
    await page.getByRole('button', { name: 'All MCP servers', exact: true }).click();
    await page.getByRole('button', { name: 'Add MCP server', exact: true }).click();
    await page.getByRole('textbox', { name: 'Server URL' }).waitFor();
    expect(await page.locator('[data-settings-open]').textContent()).toBe('true');
  } finally { await page.close(); }
});
