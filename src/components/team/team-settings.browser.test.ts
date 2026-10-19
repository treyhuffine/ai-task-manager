import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';

const enabled = process.env.RI_SPACES_BROWSER_TEST === '1';
let browser: Browser;
let server: http.Server;
let address: string;

beforeAll(async () => {
  if (!enabled) return;
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
      import {TeamSettings} from './src/components/team/team-settings';
      import {TeamContext} from './src/components/team/team-context';
      import {ExternalAiSection} from './src/components/settings/sections/external-ai-section';
      import {useSettingsStore,setSettingsSection} from './src/components/settings/settings-store';
      import {SettingsNav} from './src/components/settings/settings-nav';
      const params = new URLSearchParams(location.search);
      function Personal() {const {section}=useSettingsStore();return <div className='mx-auto my-6 flex w-full max-w-[900px] min-w-0 flex-col gap-6 p-4 sm:flex-row'><SettingsNav active={section} onSelect={setSettingsSection} getStarted={{done:2,total:5}}/><main style={{minWidth:0,flex:1}}>{section==='external-ai'&&<ExternalAiSection/>}</main></div>; }
      if(params.has('personal'))setSettingsSection(params.has('external')?'external-ai':'get-started');
      const identity={team:{id:'team',name:'Team Huffine',members:2,hostedOn:'Mac Mini'},member:{id:'owner',name:'Trey',role:params.get('role')==='member'?'member':'owner'}};
      createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}>{params.has('personal')?<Personal/>:<TeamContext.Provider value={identity}><TeamSettings/></TeamContext.Provider>}</QueryClientProvider>);
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env': '{"NODE_ENV":"development"}' },
    plugins: [{ name: 'team-settings-fixture', setup(b) {
      b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' }));
      b.onResolve({ filter: /lib\/trpc\/client$/ }, () => ({ path: 'api', namespace: 'fixture' }));
      b.onResolve({ filter: /team-chat$/ }, () => ({ path: 'chat', namespace: 'fixture' }));
      b.onResolve({ filter: /use-team$/ }, () => ({ path: 'members', namespace: 'fixture' }));
      b.onResolve({ filter: /team-areas$/ }, () => ({ path: 'areas-dialog', namespace: 'fixture' }));
      b.onResolve({ filter: /hooks\/use-areas$/ }, () => ({ path: 'areas', namespace: 'fixture' }));
      b.onResolve({ filter: /spaces\/space-root$/ }, () => ({ path: 'space', namespace: 'fixture' }));
      b.onResolve({ filter: /ui\/confirm-dialog$/ }, () => ({ path: 'confirm', namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ loader: 'tsx', resolveDir: process.cwd(), contents: {
        navigation: `import {useSyncExternalStore} from 'react';const subscribe=fn=>{addEventListener('popstate',fn);return()=>removeEventListener('popstate',fn);};const go=(url,replace=false)=>{history[replace?'replaceState':'pushState']({},'',url);dispatchEvent(new PopStateEvent('popstate'));};const router={push:url=>go(url),replace:url=>go(url,true)};export const useRouter=()=>router;export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(useSyncExternalStore(subscribe,()=>location.search));`,
        chat: `import {useQuery} from '@tanstack/react-query';import {trpc} from '@/lib/trpc/client';export const useTeamAiStatus=()=>useQuery(trpc.team.ai.status.queryOptions());`,
        members: `export const initials=name=>name.slice(0,1);export const useTeamMembers=()=>({active:[{id:'owner',name:'Trey',role:'owner'},{id:'member',name:'Sam',role:'member'}]});`,
        'areas-dialog': `export const NewAreaDialog=()=>null;`,
        areas: `export const useAreas=()=>({data:[]});export const useUpdateArea=()=>({});`,
        space: `export const useSpace=()=>null;`,
        confirm: `export const useConfirm=()=>async()=>true;`,
        api: `
          window.connectionCalls=[];let clients=[];const local=new URLSearchParams(location.search).has('local');
          let status={enabled:false,state:'off',authMode:'subscription',hasApiKey:false};
          const query=(name,fn=()=>[])=>({queryKey:()=>[name],queryOptions:()=>({queryKey:[name],queryFn:async()=>fn()})});
          export const trpc={team:{
            me:query('me'),members:query('members'),invitations:{list:query('invitations')},signIns:{list:query('signIns')},
            address:{get:query('address',()=>({address:'https://team.example.test',tunnelName:'team-huffine',suggestedName:'team-huffine',autoTunnel:false,nameLocked:false}))},
            aiClients:{list:query('clients',()=>clients)},ai:{status:query('status',()=>status),chats:{list:query('chats')}}
          }};
          trpc.externalAi={list:query('personalClients',()=>clients),address:query('personalAddress',()=>({mcpUrl:(local?'http://localhost:4224':'https://home.example.test')+'/api/orchestrator/mcp',reachable:!local}))};
          trpc.harness={skillsGlobalGet:query('skill',()=>({appOnly:false,enabled:true,configured:true,installed:true,conflicts:[]}))};
          const unreachable={mutate:async()=>({reachable:false})};
          export const trpcClient={team:{
            invitations:{createRemote:unreachable},signIns:{createRemote:unreachable},
            aiClients:{create:{mutate:async input=>{window.connectionCalls.push(input);const client={keyId:String(clients.length),name:input.name,createdAt:'2026-10-14',lastUsedAt:null};clients=[...clients,client];return {client,token:'fictional-test-token',mcpUrl:'https://team.example.test/api/team/mcp',reachable:true};}},revoke:{mutate:async()=>{clients=[];}}},
            ai:{configure:{mutate:async input=>{status={...status,...input};}},setEnabled:{mutate:async({enabled})=>{status={...status,enabled,state:enabled?'ready':'off'};}},refreshAuth:{mutate:async()=>({})},forgetKey:{mutate:async()=>({})}}
          }};
          trpcClient.harness={skillsGlobalPut:{mutate:async()=>({})}};
          trpcClient.externalAi={create:{mutate:async input=>{window.connectionCalls.push(input);const client={keyId:String(clients.length),name:input.name,createdAt:'2026-10-14',lastUsedAt:null};clients=[...clients,client];return {client,token:'fictional-personal-token',mcpUrl:(local?'http://localhost:4224':'https://home.example.test')+'/api/orchestrator/mcp',reachable:!local};}},revoke:{mutate:async()=>{clients=[];}}};
        `,
      }[path]! }));
    } }],
  });
  const require = createRequire(import.meta.url);
  const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
  const tailwind = require('@tailwindcss/postcss');
  const cssFile = path.resolve('src/app/globals.css');
  const css = await postcss([tailwind({ base: process.cwd() })]).process(fs.readFileSync(cssFile, 'utf8'), { from: cssFile });
  server = http.createServer((req, res) => {
    res.setHeader('content-type', req.url === '/bundle.js' ? 'text/javascript' : req.url === '/style.css' ? 'text/css' : 'text/html');
    res.end(req.url === '/bundle.js' ? bundle.outputFiles[0].text : req.url === '/style.css' ? css.css : '<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body style="font-family:Arial,sans-serif"><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.RI_REVIEW_CHROMIUM });
  browser.on('context', context => context.on('page', page => page.setDefaultTimeout(5_000)));
}, 90_000);

afterAll(async () => {
  await browser?.close();
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
});

async function screenshot(page: Page, name: string) {
  if (!process.env.RI_ARTIFACT_SCREENSHOTS) return;
  await page.screenshot({ path: path.join(process.env.RI_ARTIFACT_SCREENSHOTS, name), animations: 'disabled' });
}

it.skipIf(!enabled)('uses linked sections, preserves drafts while navigating and directs an invitation to remote access', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.goto(`${address}/?panel=settings`);
    const nav = page.getByRole('navigation', { name: 'Team settings' });
    await page.getByRole('textbox', { name: 'Team name', exact: true }).fill('Unsaved team name');
    await nav.getByRole('button', { name: 'AI & Models', exact: true }).click();
    expect(new URL(page.url()).searchParams.get('settings')).toBe('ai');
    await page.getByRole('button', { name: 'Turn on', exact: true }).waitFor();
    expect(await page.getByRole('button', { name: 'Connect an external assistant', exact: true }).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Save authentication', exact: true }).isDisabled()).toBe(true);
    await screenshot(page, 'team-settings-ai-desktop.png');
    await page.getByRole('combobox', { name: 'Authentication' }).selectOption('api_key');
    await page.getByRole('textbox', { name: 'Anthropic API key' }).fill('fictional-unsaved-key');
    await nav.getByRole('button', { name: 'General', exact: true }).click();
    expect(await page.getByRole('textbox', { name: 'Team name', exact: true }).inputValue()).toBe('Unsaved team name');
    await nav.getByRole('button', { name: 'AI & Models', exact: true }).click();
    expect(await page.getByRole('textbox', { name: 'Anthropic API key' }).inputValue()).toBe('fictional-unsaved-key');
    await nav.getByRole('button', { name: 'People', exact: true }).click();
    await page.getByRole('button', { name: 'Invite people', exact: true }).click();
    await page.getByText('Set up or reconnect a remote address here, then try making your link again.').waitFor();
    expect(new URL(page.url()).searchParams.get('settings')).toBe('remote');
    await page.goBack();
    await page.getByRole('heading', { name: 'People', exact: true }).first().waitFor();
  } finally { await page.close(); }
}, 30_000);

it.skipIf(!enabled)('explains optional external access, defaults the connection label and keeps custom labels optional', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.goto(`${address}/?panel=settings&settings=external-ai`);
    await page.getByRole('button', { name: 'Connect an external assistant', exact: true }).click();
    await page.getByText('MCP gives your assistant tools', { exact: false }).waitFor();
    expect(await page.getByRole('textbox', { name: 'Connection label', exact: true }).isVisible()).toBe(false);
    await page.getByRole('button', { name: 'Get connection instructions', exact: true }).click();
    await page.getByText('claude mcp add', { exact: false }).waitFor();
    expect(await page.evaluate('window.connectionCalls')).toEqual([{ name: 'Claude Code' }]);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByText('Not used yet', { exact: true }).waitFor();
    await screenshot(page, 'team-settings-external-desktop.png');
    await page.getByRole('button', { name: 'Connect an external assistant', exact: true }).click();
    await page.getByText('Codex', { exact: true }).click();
    await page.getByText('Connection label (optional)', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Connection label', exact: true }).fill('Codex on my laptop');
    await page.getByRole('button', { name: 'Get connection instructions', exact: true }).click();
    await page.getByText('codex mcp add', { exact: false }).waitFor();
    expect(await page.evaluate('window.connectionCalls')).toEqual([{ name: 'Claude Code' }, { name: 'Codex on my laptop' }]);
  } finally { await page.close(); }
}, 30_000);

it.skipIf(!enabled)('keeps all phone sections reachable and hides owner-only settings from members', async () => {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  try {
    await page.goto(`${address}/?panel=settings&settings=remote&role=member`);
    const nav = page.getByRole('navigation', { name: 'Team settings' });
    await page.getByRole('textbox', { name: 'Team name', exact: true }).waitFor();
    expect(await nav.getByRole('button', { name: 'Remote access', exact: true }).count()).toBe(0);
    await nav.getByRole('button', { name: 'Your access', exact: true }).click();
    await page.getByRole('button', { name: 'Sign in on another device', exact: true }).click();
    await page.getByText('Ask a team owner', { exact: false }).waitFor();
    await nav.getByRole('button', { name: 'External AI', exact: true }).click();
    await page.getByRole('button', { name: 'Connect an external assistant', exact: true }).waitFor();
    expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
    const navBox = await nav.boundingBox();
    const closeBox = await page.getByRole('button', { name: 'Close', exact: true }).boundingBox();
    expect(navBox!.x + navBox!.width).toBeLessThanOrEqual(closeBox!.x);
    await screenshot(page, 'team-settings-external-phone.png');
    await nav.getByRole('button', { name: 'AI & Models', exact: true }).click();
    expect(await page.getByRole('button', { name: 'Turn on', exact: true }).count()).toBe(0);
    await screenshot(page, 'team-settings-ai-phone.png');
  } finally { await page.close(); }
}, 30_000);

it.skipIf(!enabled)('preserves the personal settings checklist and search', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.goto(`${address}/?personal=1`);
    const nav = page.getByRole('navigation', { name: 'Settings', exact: true });
    expect(await nav.getByRole('button', { name: 'Get started 2/5' }).getAttribute('aria-current')).toBe('page');
    await page.getByRole('textbox', { name: 'Search settings', exact: true }).fill('models');
    expect(await nav.getByRole('button').count()).toBe(1);
    await nav.getByRole('button', { name: 'Models', exact: true }).click();
    expect(await nav.getByRole('button', { name: 'Models', exact: true }).getAttribute('aria-current')).toBe('page');
  } finally { await page.close(); }
}, 20_000);

it.skipIf(!enabled)('connects and disconnects personal assistants without exposing the token again', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.goto(`${address}/?personal=1&external=1`);
    await page.getByText('Uses your Home’s remote address.', { exact: false }).waitFor();
    // Coding tools on this computer come first, through Ri's skills, with no key.
    await page.getByRole('heading', { name: 'Coding tools on this computer', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Uninstall', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Connect an external assistant', exact: true }).click();
    await page.getByText('Codex', { exact: true }).click();
    await page.getByRole('button', { name: 'Get connection instructions', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('heading', { name: 'Set up Codex', exact: true }).waitFor();
    expect(await dialog.textContent()).toContain('https://home.example.test/api/orchestrator/mcp');
    expect(await dialog.textContent()).toContain('RI_HOME_TOKEN');
    expect(await dialog.textContent()).not.toContain('the team');
    await screenshot(page, 'personal-external-ai-desktop.png');
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByText('Not used yet', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Connect an external assistant', exact: true }).click();
    expect(await page.getByRole('dialog').textContent()).not.toContain('fictional-personal-token');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await page.getByRole('button', { name: 'Disconnect', exact: true }).waitFor({ state: 'hidden' });
  } finally { await page.close(); }
}, 30_000);

it.skipIf(!enabled)('explains local-only personal access on a phone and links to Devices', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.goto(`${address}/?personal=1&external=1&local=1`);
    await page.getByRole('button', { name: 'Connect an external assistant', exact: true }).click();
    await page.getByRole('button', { name: 'Get connection instructions', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('This is a local address.', { exact: false }).waitFor();
    expect(await dialog.textContent()).toContain('http://localhost:4224/api/orchestrator/mcp');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await screenshot(page, 'personal-external-ai-phone.png');
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Remote access in Devices', exact: true }).click();
    expect(await page.getByRole('navigation', { name: 'Settings', exact: true }).getByRole('button', { name: 'Devices', exact: true }).getAttribute('aria-current')).toBe('page');
  } finally { await page.close(); }
}, 30_000);
