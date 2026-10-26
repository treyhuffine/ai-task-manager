/** Real review components and mutations, isolated from accounts, running apps and AI calls. */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { build } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { LAYOUT_OPTIONS } from './options';

let server: http.Server;
let browser: Browser;
let base: string;
let writes: Array<{ procedure: string; input: Record<string, unknown> }> = [];
const instance = { id: 'finances', slug: 'finances', displayName: 'Finances', description: 'Understand spending and recurring costs.', icon: 'wallet', packageId: 'finances', version: '1', digest: 'current', hasView: true, hasActions: true, enabled: true, archived: false, activation: { phase: 'active' }, runtime: { condition: 'stopped' } };
const custom = { id: 'company', slug: 'company', displayName: 'Company data', url: 'https://company.example.test/mcp', enabled: true, auth: { kind: 'none' }, lastStatus: 'ok', tools: [] };
const agent = { id: 'design', name: 'Design', status: 'active', purpose: 'Shape ideas and make them real.', instructions: 'Explore before narrowing.', integrationScopes: [], attachments: [], emoji: null, areaId: null, cwd: '/fixture/design' };
function fixtureResponses(): Record<string, unknown> {
  return {
    'connectedApps.catalog': [],
    'localApps.enabled': { enabled: true },
    'localApps.list': { revision: 1, instances: [structuredClone(instance)], drafts: [], invocations: [], grants: [], approvals: [], panels: [], schedules: [] },
    'localApps.catalog': [{ packageId: 'ri-travel', name: 'Travel', description: 'Keep a whole trip together.', version: '1', artifactDigest: 'travel-package', demo: { heading: 'Your next trip', caption: 'A sample itinerary.', columns: ['Day', 'Plan'], rows: [['Friday', 'Arrive'], ['Saturday', 'Explore']] } }],
    'integrations.statusGet': { providers: [{ id: 'google', displayName: 'Google', method: 'oauth2', configured: true }, { id: 'linear', displayName: 'Linear', method: 'api_key', configured: true, credentialFields: [] }], redirectUri: 'https://fixture.test/oauth' },
    'integrations.connectionsGet': { connections: [{ id: 'work', providerId: 'google', accountId: 'work', label: 'Work', email: 'work@example.test', status: 'active', scopes: [] }] },
    'integrations.mcpServersGet': { servers: [structuredClone(custom)], approvalSettings: { defaultPolicy: 'writes', override: null } },
    'integrations.toolkitsGet': { toolkits: [{ id: 'gmail', displayName: 'Gmail', providerId: 'google', scopes: [], actions: [] }] },
    'integrations.writePolicyGet': { toolkits: [] },
    'integrations.authConfigsGet': { configs: [] },
    'skills.list': { skills: [{ ref: 'ri:private-workflow', name: 'Private workflow', description: 'Our internal writing process.', hasErrors: false, location: { kind: 'ri' } }], projects: [] },
    'workspaces.list': [structuredClone(agent)],
    'workspaces.get': structuredClone(agent),
    'localApps.describe': { contract: { actions: [] }, manifest: { extensions: { 'com.ri': { requests: { riActions: [], integrations: [] }, runtime: { protocol: 'stdio' } } } } },
    'localApps.serviceStatus': { ready: true, worker: { started: false }, jobs: { states: {} } },
    'orchestratorChat.list': { session: { id: 'fixture-chat', harness: 'codex' } },
    'chatSources.search': { items: [], total: 0 },
    'skills.RefGet': { skill: { ref: 'ri:private-workflow', name: 'Private workflow', description: 'Our process', body: 'Use our source material.', hash: 'original' } },
  };
}
let responses = fixtureResponses();
vi.setConfig({ testTimeout: 30_000 });
beforeEach(() => { responses = fixtureResponses(); writes = []; });

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
  const css = await postcss([require('@tailwindcss/postcss')()]).process(fs.readFileSync('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') });
  const stubs: Record<string, string> = {
    sonner: `export const toast=Object.assign(()=>{}, {error:message=>window.feedback.push(String(message)),success:()=>{},warning:()=>{},loading:()=>{},info:()=>{},dismiss:()=>{}});export const Toaster=()=>null;`,
    '@/contexts/dashboard-context': `export const useDashboard=()=>({activeView:{kind:'apps',route:'',query:window.currentQuery},openSkill:ref=>window.actions.push(['skill',ref]),openAgent:id=>window.actions.push(['agent',id]),goHome:()=>window.actions.push(['home']),showPanelTab:()=>{},setMobileTab:()=>{},isFocusMode:false});export const useOptionalDashboard=useDashboard;`,
    '@/components/chat/harness-chat': `export const HarnessChat=()=> <div data-native-chat style={{padding:20}}>Your real chat surface<textarea aria-label="Message Ri" /></div>;export const HarnessChatSession=HarnessChat;`,
    '@/components/deck/deck-container': `export const DeckContainer=()=> <div data-native-deck style={{padding:20}}>Your daily deck</div>;`,
    '@/components/chat/main-chat-history-menu': `export const MainChatHistoryMenu=()=>null;`,
    '@/components/skills/use-skill-chat': `export const useSkillChat=()=>({sessionId:'skill-chat'});`,
    '@/components/mcp-apps/page': `export const ConnectedAppPage=()=> <div data-native-connected>Connected app host</div>;`,
    '@/components/agents/agent-icon': `export const AgentIcon=({workspace})=><span>{workspace.name.slice(0,1)}</span>;export const resolveAgentPicture=workspace=>({image:null,emoji:workspace.emoji??null});`,
  };
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React,{useState,useEffect} from 'react';
      import {createRoot} from 'react-dom/client';
      import {QueryClient,QueryClientProvider,useQuery} from '@tanstack/react-query';
      import {TooltipProvider} from '@/components/ui/tooltip';
      import {AppsLayoutReview} from '@/components/local-apps/layout-review';
      import {AppsReviewRailSlot} from '@/components/local-apps/layout-review/rail-portal';
      import {useLocalApps} from '@/components/local-apps/app-hooks';
      import {Toaster} from 'sonner';
      const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
      window.actions=[]; window.currentQuery={}; window.feedback=[];
      localStorage.setItem('ri.client.apiTransport','http');
      function Fixture(){
        const [query,setQuery]=useState(Object.fromEntries(new URLSearchParams(location.search)));
        const [destination,setDestination]=useState('');
        const {data,enabled,checking,error}=useLocalApps();
        window.currentQuery=query;
        useEffect(()=>{const pop=()=>setQuery(Object.fromEntries(new URLSearchParams(location.search)));window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);},[]);
        const navigate=(route,options)=>{if(!route||route.startsWith('?')){history[options?.replace?'replaceState':'pushState'](null,'',route||'/');setQuery(Object.fromEntries(new URLSearchParams(route)));}else {window.actions.push(['navigate',route]);setDestination(route);}};
        return <div className="flex h-dvh min-w-0"><aside className="hidden w-56 shrink-0 overflow-y-auto border-r md:block" aria-label="Ri rail"><div className="p-4">Ri</div><AppsReviewRailSlot><div className="p-4">Agents and chats</div></AppsReviewRailSlot></aside><main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {destination?<div><output data-destination>{destination}</output><button onClick={()=>setDestination('')}>Return to Apps</button></div>:<AppsLayoutReview data={data} localEnabled={enabled} localLoading={checking} localError={error} query={query} navigate={navigate}/>}
        </main><Toaster/></div>;
      }
      createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><TooltipProvider><Fixture/></TooltipProvider></QueryClientProvider>);
    ` },
    bundle: true, write: false, outdir: '/fixture', format: 'iife', platform: 'browser', jsx: 'automatic', logLevel: 'silent',
    loader: { '.css': 'local-css' }, define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
    plugins: [{ name: 'existing-surfaces', setup(api) {
      api.onResolve({ filter: /^(@\/|sonner$)/ }, args => stubs[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
      api.onResolve({ filter: /(^|\/)app-page$/ }, () => ({ path: 'app-page', namespace: 'fixture' }));
      api.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path] ?? `export const AppPage=({instance,navigate})=><div data-native-app style={{padding:20}}>Live app: {instance.displayName}<button onClick={()=>navigate('')}>Close live app</button></div>;`, loader: 'tsx', resolveDir: process.cwd() }));
    } }],
  });
  const js = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  const moduleCss = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://fixture');
    if (url.pathname.startsWith('/api/trpc/')) {
      let body = ''; for await (const chunk of req) body += chunk;
      const input = JSON.parse(body || url.searchParams.get('input') || '{}');
      const procedure = url.pathname.slice('/api/trpc/'.length);
      if (req.method === 'POST') writes.push({ procedure, input });
      let data = responses[procedure];
      if (procedure === 'localApps.configure') {
        const list = responses['localApps.list'] as { revision: number; instances: Array<typeof instance> };
        Object.assign(list.instances[0], input.patch); list.revision++; data = { ok: true };
      } else if (procedure === 'integrations.mcpServersPatch') {
        const value = responses['integrations.mcpServersGet'] as { servers: Array<typeof custom> };
        Object.assign(value.servers[0], input.body); data = { entry: value.servers[0] };
      } else if (procedure === 'localApps.addCatalog') data = { id: 'travel-draft' };
      else if (procedure === 'localApps.createDraft') data = { id: 'new-app' };
      else if (procedure === 'skills.create') data = { skill: { ref: 'draft:' + (input.body.name ?? 'new-skill'), hash: 'fresh' } };
      else if (procedure === 'skills.RefPut') data = { skill: { ref: input.params.ref, hash: 'saved' } };
      else if (procedure === 'workspaces.update') { responses['workspaces.get'] = { ...agent, ...input.body }; data = responses['workspaces.get']; }
      res.setHeader('content-type', 'application/json');
      if (data === undefined) { res.statusCode = 500; res.end(JSON.stringify({ error: { message: `Unexpected request: ${procedure}`, code: -32603, data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 } } })); }
      else res.end(JSON.stringify({ result: { data } }));
      return;
    }
    if (url.pathname === '/fixture.js') { res.setHeader('content-type', 'text/javascript; charset=utf-8'); res.end(js); return; }
    if (url.pathname === '/fixture.css') { res.setHeader('content-type', 'text/css; charset=utf-8'); res.end(css.css + '\n' + moduleCss); return; }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<!doctype html><html class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const executables = [process.env.RI_TEST_CHROMIUM, chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].filter((value): value is string => !!value);
  const executablePath = executables.find(fs.existsSync);
  if (!executablePath) throw new Error('Install a Playwright Chromium browser to run Apps layout tests.');
  browser = await chromium.launch({ executablePath, headless: true });
}, 60_000);
afterAll(async () => { await browser?.close(); server?.closeAllConnections(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); });
async function open(layout = 'discover') {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => console.error('Review browser error:', error.message));
  page.setDefaultTimeout(8_000);
  await page.goto(`${base}/?layout=${layout}`);
  await page.getByRole('button', { name: 'Your library (4)', exact: true }).first().waitFor();
  await page.getByText('Loading additions…', { exact: true }).waitFor({ state: 'hidden' });
  return page;
}
const choose = (page: Page, layout: string) => page.getByLabel('Apps layout', { exact: true }).selectOption(layout);

it('renders twelve distinct layouts with live host slots, persistent selection and no horizontal overflow', async () => {
  const page = await open();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const option of LAYOUT_OPTIONS) {
        await choose(page, option.id);
        await page.locator(`[data-apps-layout="${option.id}"]`).waitFor();
        if (option.id === 'agent') await page.getByLabel('Agent', { exact: true }).waitFor();
        if (option.id === 'home') { await page.locator('[data-native-deck]').waitFor(); await page.locator('[data-native-chat]').waitFor(); }
        if (option.id === 'chat') await page.locator('[data-native-chat]').waitFor();
        if (option.id === 'shelf') await page.locator('[data-native-app]').waitFor();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${option.id} at ${width}px`).toBe(true);
      }
    }
    await choose(page, 'split'); await page.reload();
    await expect.poll(() => page.getByLabel('Apps layout', { exact: true }).inputValue()).toBe('split');
    await page.goto(base);
    expect(await page.getByLabel('Apps layout', { exact: true }).inputValue()).toBe('split');
    await choose(page, 'preview'); await page.goBack();
    expect(await page.getByLabel('Apps layout', { exact: true }).inputValue()).toBe('split');
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 90_000);

it('keeps custom MCPs and skills in the complete library, and settings survive switching layouts', async () => {
  const page = await open('control');
  try {
    await page.getByRole('switch', { name: 'Allow Ri to use Company data' }).click();
    await expect.poll(() => writes.some(write => write.procedure === 'integrations.mcpServersPatch')).toBe(true);
    expect(writes.find(write => write.procedure === 'integrations.mcpServersPatch')!.input).toMatchObject({ params: { id: 'company' }, body: { enabled: false } });
    await choose(page, 'discover');
    await page.getByRole('button', { name: 'Your library (4)', exact: true }).first().click();
    await page.getByRole('heading', { name: 'Private workflow', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Manage Company data', exact: true }).last().click();
    expect(await page.getByRole('switch', { name: 'Allow Ri to use Company data' }).getAttribute('aria-checked')).toBe('false');
    await page.getByRole('button', { name: 'Close details' }).click();
    await page.getByRole('button', { name: 'Manage Finances', exact: true }).click();
    await page.getByRole('switch', { name: 'Keep Finances handy' }).click();
    await choose(page, 'split'); await choose(page, 'discover');
    expect(await page.getByRole('region', { name: 'Quick access' }).getByRole('button', { name: 'Finances', exact: true }).count()).toBe(1);
    await page.getByRole('button', { name: 'Your library (4)', exact: true }).first().click();
    await page.getByRole('button', { name: 'Manage Finances', exact: true }).click();
    await page.getByRole('region', { name: 'Finances details' }).getByRole('button', { name: 'Manage', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Disable', exact: true }).click();
    await expect.poll(() => writes.some(write => write.procedure === 'localApps.configure')).toBe(true);
    expect(writes.find(write => write.procedure === 'localApps.configure')!.input).toMatchObject({ id: 'finances', revision: 1, patch: { enabled: false, archived: false } });
  } finally { await page.close(); }
});

it('uses the real preview and skill draft flows, and preserves imported frontmatter', async () => {
  const page = await open();
  try {
    await page.getByRole('button', { name: 'Preview app Travel', exact: true }).click();
    await page.locator('[data-destination]').waitFor();
    expect(await page.locator('[data-destination]').textContent()).toBe('drafts/travel-draft');
    expect(writes.find(write => write.procedure === 'localApps.addCatalog')!.input).toEqual({ packageId: 'ri-travel' });
    await page.getByRole('button', { name: 'Return to Apps' }).click();
    await page.getByRole('button', { name: 'Preview skill Research brief', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { actions: string[][] }).actions)).toContainEqual(['skill', 'draft:research-brief']);
    expect(writes.find(write => write.procedure === 'skills.create')!.input).toMatchObject({ body: { name: 'research-brief' } });
    await expect.poll(() => page.getByRole('button', { name: 'Preview skill Research brief', exact: true }).isEnabled()).toBe(true);
    const content = '---\nname: imported-review\ndescription: Review supplied work\nallowed-tools: Read\n---\n\nUse the supplied checklist.\n';
    await page.getByLabel('Import SKILL.md', { exact: true }).setInputFiles({ name: 'SKILL.md', mimeType: 'text/markdown', buffer: Buffer.from(content) });
    await expect.poll(() => writes.filter(write => write.procedure === 'skills.RefPut').length, { timeout: 5000 }).toBe(1);
    expect(writes.find(write => write.procedure === 'skills.RefPut')!.input).toEqual({ params: { ref: 'draft:imported-review' }, body: { content, baseHash: 'fresh' } });
  } finally { await page.close(); }
});

it('keeps browsing context through connector setup and opens real apps in tabs', async () => {
  const page = await open();
  try {
    await page.getByRole('searchbox', { name: 'Search additions' }).fill('Linear');
    await page.getByRole('button', { name: 'Connect Linear', exact: true }).click();
    await page.getByRole('heading', { name: 'Linear', exact: true }).waitFor();
    await page.goBack();
    expect(await page.getByRole('searchbox', { name: 'Search additions' }).inputValue()).toBe('Linear');
    await page.getByRole('button', { name: 'Clear search' }).click();
    await choose(page, 'tabs');
    await page.getByRole('navigation', { name: 'Open apps' }).getByRole('button', { name: 'Finances', exact: true }).click();
    await page.locator('[data-native-app]').waitFor();
    await page.getByRole('button', { name: 'Close Finances tab' }).click();
    expect(await page.locator('[data-native-app]').count()).toBe(0);
    await choose(page, 'agent');
    await page.getByRole('checkbox', { name: 'Gmail', exact: true }).click();
    await expect.poll(() => writes.some(write => write.procedure === 'workspaces.update')).toBe(true);
    expect(writes.find(write => write.procedure === 'workspaces.update')!.input).toMatchObject({ params: { id: 'design' }, body: { integrationScopes: [{ toolkitId: 'gmail' }] } });
  } finally { await page.close(); }
});
