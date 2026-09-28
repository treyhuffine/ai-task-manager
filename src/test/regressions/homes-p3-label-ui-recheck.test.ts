/** Browser-level smoke of the real menu, dialog, label preference and phone sheet.
 * Only data hooks are replaced. No real Home, worker or API is contacted.
 *
 * Adapted after ece748f: the phone's hold on + became the agent's ⋯ menu
 * ("New execution on…"), so the probe opens the sheet from a real dropdown
 * item, as the agents list does, instead of a long press. + is a plain tap.
 * And at the simplification pass: moves are named by computer ("Move to
 * Review worker"), and the fixture hooks gain the setup ones. */
import http from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { chromium } from 'playwright-core';
import { expect, it } from 'vitest';

it('keeps the move dialog usable from the home menu, and the ⋯ menu picks a computer without starting twice', async () => {
  const require = createRequire(import.meta.url);
  const { build } = createRequire(require.resolve('tsx/package.json'))('esbuild');
  const stub = `
    const record = (kind, value) => window.actions.push({kind, value});
    export const useComputers = () => ({data:[{id:'home',name:'Review home',isHome:true},{id:'worker',name:'Review worker',isHome:false,worker:{connected:true}}]});
    export const useThisComputer = () => ({id:'worker',name:'Review worker'});
    export const useClientLocation = () => ({kind:'remote'});
    export const useRunOn = () => ({data:{defaultId:'home',choices:[{computerId:'home',name:'Review home',isHome:true,ready:true,connected:true},{computerId:'worker',name:'Review worker',isHome:false,ready:true,connected:true}]}});
    export const useSetDefaultComputer = () => ({isPending:false,mutate:(id)=>record('default',id)});
    export const useTransfer = () => ({data:null});
    export const useWorkingState = () => ({data:{changed:[],untracked:[],localOnly:[],branch:'review'},isLoading:false});
    export const useReviewOn = () => ({data:{review:null}});
    export const useStartTransfer = () => ({isPending:false,mutate:(input,options)=>{record('move',input.toComputerId);options.onSuccess();}});
    export const useCommit = () => ({mutate:()=>{}});
    export const useOpenCodeHere = () => ({isPending:false,mutate:()=>record('review','worker')});
    export const useOpenReview = () => () => {};
    export const useSetupPlan = () => ({data:null,isLoading:false,error:null});
    export const useSetUpAgent = () => ({isPending:false,mutate:()=>{}});
  `;
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {Popover} from 'radix-ui';
      import {MoveActions} from '@/components/executions/transfer/location-menu';
      import {RunOnSheet} from '@/components/mobile/run-on-sheet';
      import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu';
      import {useComputerLabelMode} from '@/lib/client/computer-label-mode';
      import {locationLabel} from '@/lib/executions/location';
      window.actions=[];
      function App(){
        const [open,setOpen]=useState(false);
        const labels=useComputerLabelMode();
        const session={id:'chat',status:'active',location:{computerId:'home',name:'Review home',isHome:true}};
        const workspace={id:'agent',name:'Review agent',isGit:true};
        const start=(id)=>window.actions.push({kind:'start',value:id??'default'});
        return <>
          <output id="label">{locationLabel(session,true,labels.mode)??'unlabeled'}</output>
          <button onClick={()=>labels.setMode('always')}>Name all computers</button>
          <Popover.Root><Popover.Trigger>Execution menu</Popover.Trigger><Popover.Portal><Popover.Content>
            <MoveActions session={session} workspace={workspace}/>
          </Popover.Content></Popover.Portal></Popover.Root>
          <DropdownMenu><DropdownMenuTrigger asChild><button id="more" aria-label="More for Review agent">⋯</button></DropdownMenuTrigger>
            <DropdownMenuContent><DropdownMenuItem onSelect={()=>setOpen(true)}>New execution on…</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
          <button id="plus" onClick={()=>start()}>New execution</button>
          <RunOnSheet workspace={workspace} open={open} onOpenChange={setOpen} onPick={(id)=>{setOpen(false);start(id);}}/>
        </>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [{ name: 'isolated-data-hooks', setup(api: {
      onResolve(options: {filter: RegExp}, fn: () => {path: string; namespace: string}): void;
      onLoad(options: {filter: RegExp; namespace: string}, fn: () => {contents: string; loader: string}): void;
    }) {
      api.onResolve({ filter: /^(?:@\/hooks\/use-(?:computers|opener|client-location|workspaces|execution)|\.\/review-bar)$/ }, () => ({ path: 'fixture-hooks', namespace: 'fixture' }));
      api.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: stub, loader: 'js' }));
    } }],
  });
  const server = http.createServer((req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0]!.text); return; }
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>[data-slot="dialog-overlay"],[data-slot="sheet-overlay"]{position:fixed;inset:0;background:#8888;z-index:50}[data-slot="dialog-content"],[data-slot="sheet-content"]{position:fixed;inset:10%;background:white;padding:20px;z-index:51}button{padding:12px;margin:4px}#plus{position:fixed;bottom:12px;left:12px}#more{position:fixed;bottom:12px;left:120px}</style><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell`, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    await page.locator('#plus').waitFor();
    expect(await page.locator('#label').textContent()).toBe('unlabeled');
    await page.getByRole('button', { name: 'Name all computers' }).click();
    expect(await page.locator('#label').textContent()).toBe('Review home');
    await page.getByRole('button', { name: 'Execution menu' }).click();
    await page.getByRole('button', { name: 'Move to Review worker' }).click();
    await page.getByRole('dialog', { name: 'Move to Review worker' }).waitFor();
    await page.getByRole('button', { name: 'Move to Review worker', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.locator('#plus').tap();
    await page.locator('#more').tap();
    await page.getByRole('menuitem', { name: 'New execution on…' }).tap();
    await page.getByRole('dialog', { name: 'New execution in Review agent, on…' }).waitFor();
    await page.getByRole('button', { name: 'Make default' }).click();
    await page.getByRole('dialog', { name: 'New execution in Review agent, on…' }).getByRole('button', { name: /Review worker/ }).click();
    const actions = await page.evaluate(() => (window as unknown as { actions: unknown[] }).actions);
    expect(actions).toEqual([
      {kind:'move',value:'worker'}, {kind:'start',value:'default'},
      {kind:'default',value:'worker'}, {kind:'start',value:'worker'},
    ]);
  } finally {
    await browser.close(); server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 40_000);
