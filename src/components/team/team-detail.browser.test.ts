import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';

const enabled = process.env.RI_SPACES_BROWSER_TEST === '1';
let browser: Browser;
let server: http.Server;
let address: string;

beforeAll(async () => {
  if (!enabled) return;
  // Real detail, sheet, inclusion controls and global CSS. Only the data and
  // editor are fixtures. The title bar matches DesktopChrome's fallback DOM.
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
      import {TeamDetail} from './src/components/team/team-detail';
      const params=new URLSearchParams(location.search);
      if(params.has('desktop'))document.documentElement.dataset.riDesktop=params.get('desktop');
      if(params.has('hud'))document.querySelector('.desktop-drag-fallback').outerHTML='<header data-desktop-titlebar style="height:40px">Ri</header>';
      createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><TeamDetail/></QueryClientProvider>);
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env': '{"NODE_ENV":"development"}' },
    plugins: [{ name: 'team-detail-fixture', setup(b) {
      const fixtures: Record<string, string> = {
        'team-context': `import {useState} from 'react';export const useTeam=()=>({team:{name:'Team Huffine'},member:{id:'me',role:'member'}});export function useTeamNav(){const [open,setOpen]=useState(true);const note=new URLSearchParams(location.search).has('note');return {taskId:open&&!note?'task':null,noteId:open&&note?'note':null,closeDetail:()=>setOpen(false)};}`,
        'space-root': `export const useSpace=()=>({id:'team-fixture',status:'active'});`,
        'use-team': `export const initials=name=>name.slice(0,1);export const useTeamMembers=()=>({active:[],byId:new Map()});`,
        'use-tasks': `export const useTask=()=>({data:{id:'task',title:'Shared task',status:'todo',bodyRevision:0}});export const useUpdateTask=()=>({});export const useDeleteTask=()=>({});`,
        'use-notes': `export const useNote=()=>({data:{id:'note',title:'Shared note',bodyRevision:0,kind:'note'}});export const useUpdateNote=()=>({});export const useDeleteNote=()=>({});`,
        'use-document-autosave': `export const useDocumentAutosave=()=>()=>{};`,
        'use-entity-versions': `export const useEntityVersions=()=>({data:{versions:[]}});`,
        'shared-body-editor': `export const SaveStatus=()=>null;export const SharedBodyState=()=>null;export const useSharedBody=()=>({ready:false,status:{status:'saved'}});`,
        'rich-editor': `export const NoteEditor=()=>null;`,
        'team-areas': `export const TeamAreaSelect=()=>null;`,
        'published-results': `export const TeamPublishedResults=()=>null;`,
        'lifecycle-status-control': `export const LifecycleStatusControl=()=>null;`,
        'confirm-dialog': `export const useConfirm=()=>async()=>true;`,
        'entity-keys': `export const entityKeys={tasks:{all:['tasks']},notes:{all:['notes']}};`,
        'invalidate-tasks': `export const invalidateTaskListsSoon=()=>{};`,
        'my-ri-client': `
          let added=false,saved=false;window.inclusionCalls=[];
          const assigned=new URLSearchParams(location.search).has('assigned');
          export const myRiClient={spaces:{
            myWork:{query:async()=>({inMyWork:assigned||added,assigned,added,taskId:assigned||added?'local-task':null})},
            addToMyWork:{mutate:async input=>{window.inclusionCalls.push(input);added=true;}},
            noteSaved:{query:async()=>({saved,noteId:saved?'local-note':null})},
            saveNote:{mutate:async input=>{window.inclusionCalls.push(input);saved=true;}}
          }};
        `,
        'trpc/client': `export const trpcClient={};`,
      };
      b.onResolve({ filter: /.*/ }, args => {
        const key = Object.keys(fixtures).find(key => args.path.endsWith('/' + key));
        return key ? { path: key, namespace: 'fixture' } : undefined;
      });
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: fixtures[path], loader: 'tsx', resolveDir: process.cwd() }));
    } }],
  });
  const require = createRequire(import.meta.url);
  const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
  const cssFile = path.resolve('src/app/globals.css');
  const css = await postcss([require('@tailwindcss/postcss')({ base: process.cwd() })]).process(fs.readFileSync(cssFile, 'utf8'), { from: cssFile });
  server = http.createServer((req, res) => {
    res.setHeader('content-type', req.url === '/bundle.js' ? 'text/javascript' : req.url === '/style.css' ? 'text/css' : 'text/html');
    res.end(req.url === '/bundle.js' ? bundle.outputFiles[0].text : req.url === '/style.css' ? css.css : '<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div class="desktop-drag-fallback">Ri</div><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.RI_REVIEW_CHROMIUM });
}, 90_000);

afterAll(async () => {
  await browser?.close();
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
});

it.skipIf(!enabled).each([
  { name: 'Mac team task', query: '?desktop=darwin', top: 40, width: 1280, action: 'Add to my work', after: 'In my work' },
  { name: 'Mac team note', query: '?desktop=darwin&note=1', top: 40, width: 800, action: 'Save to my notes', after: 'In my notes' },
  { name: 'Mac with dashboard title bar', query: '?desktop=darwin&hud=1', top: 40, width: 1280, action: 'Add to my work', after: 'In my work' },
  { name: 'web', query: '', top: 0, width: 1280, action: 'Add to my work', after: 'In my work' },
  { name: 'phone web', query: '', top: 0, width: 390, action: 'Add to my work', after: 'In my work' },
  { name: 'Windows desktop', query: '?desktop=win32', top: 0, width: 1280, action: 'Add to my work', after: 'In my work' },
])('keeps $name controls visible and clickable', async ({ query, top, width, action, after, name }) => {
  const page = await browser.newPage({ viewport: { width, height: 860 } });
  page.setDefaultTimeout(5_000);
  try {
    await page.goto(address + query);
    const button = page.getByRole('button', { name: action, exact: true });
    await button.waitFor();
    const sheet = page.locator('[data-slot=sheet-content]');
    await page.waitForFunction(() => document.querySelector('[data-slot=sheet-content]')?.getAnimations().every(animation => animation.playState === 'finished'));
    const bounds = (await sheet.boundingBox())!;
    expect(bounds.y).toBe(top);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(861);
    expect((await button.boundingBox())!.y).toBeGreaterThanOrEqual(top);
    const close = sheet.getByRole('button', { name: 'Close', exact: true });
    expect((await close.boundingBox())!.y).toBeGreaterThanOrEqual(top);
    await button.click();
    await page.getByRole('button', { name: after, exact: true }).waitFor();
    expect(await page.evaluate('window.inclusionCalls.length')).toBe(1);
    expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
    if (process.env.RI_ARTIFACT_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.RI_ARTIFACT_SCREENSHOTS, `team-detail-${name.replaceAll(' ', '-')}.png`) });
    await close.click();
    await sheet.waitFor({ state: 'hidden' });
  } finally { await page.close(); }
}, 20_000);

it.skipIf(!enabled)('opens the existing personal-work menu for an assigned task on Mac', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.setDefaultTimeout(5_000);
  try {
    await page.goto(address + '?desktop=darwin&assigned=1');
    const button = page.getByRole('button', { name: 'In my work', exact: true });
    await button.waitFor();
    expect((await button.boundingBox())!.y).toBeGreaterThanOrEqual(40);
    await button.click();
    await page.getByRole('menuitem', { name: 'Open in My Ri', exact: true }).waitFor();
    expect(await page.evaluate('window.inclusionCalls')).toEqual([]);
  } finally { await page.close(); }
}, 20_000);
