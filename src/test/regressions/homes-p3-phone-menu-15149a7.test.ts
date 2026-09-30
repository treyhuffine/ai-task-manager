/**
 * Actual mobile agents view and sheet in Chromium at phone width; data hooks only are fixtures.
 * Adapted at the simplification pass: the fixture hooks gain the setup ones
 * the sheet now uses (a device the agent isn't on offers to set it up).
 */
import http from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { chromium } from 'playwright-core';
import { expect, it } from 'vitest';

it('returns focus and pointer input after selecting or dismissing the agent device sheet', async () => {
  const require = createRequire(import.meta.url);
  const {build} = createRequire(require.resolve('tsx/package.json'))('esbuild');
  const fixture = `
    const workspace={id:'agent',name:'Review agent',collapsed:true,sessionCount:0,needsReviewCandidateCount:0,attachments:[]};
    const record=(kind,value)=>window.actions.push({kind,value});
    export const useWorkspaces=()=>({data:[workspace],isLoading:false});
    export const useNeedsReviewSessions=()=>({data:[]});
    export const useWorkspaceSessions=()=>({data:[]});
    export const useUpdateWorkspace=()=>({mutate:()=>{}});
    export const useAreas=()=>({data:[]});
    export const useQueryClient=()=>({});
    export const useDashboard=()=>({streamingSessionIds:new Set(),pendingInputSessionIds:new Set(),setActiveView:()=>{},setMobileTab:()=>{},openAgent:(id,tab)=>record('open',tab)});
    export const useAgentViewMode=()=>({opensView:true});
    export const WorkspaceCreateModal=()=>null;
    export const startExecution=(_qc,input)=>{record('start',input.deviceId??'default');return {sessionId:'chat',done:Promise.resolve()};};
    export const useRunOn=()=>({data:{defaultId:'home',choices:[{deviceId:'home',name:'Review home',isHome:true,ready:true,connected:true},{deviceId:'worker',name:'Review worker',isHome:false,ready:true,connected:true}]}});
    export const useSetDefaultDevice=()=>({isPending:false,mutate:(id)=>record('default',id)});
    export const useSetupPlan=()=>({data:null,isLoading:false,error:null});
    export const useSetUpAgent=()=>({isPending:false,mutate:()=>{}});
  `;
  const bundled = await build({
    stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {MobileAgentsView} from '@/components/mobile/mobile-agents-view';
      window.actions=[];createRoot(document.getElementById('root')).render(<MobileAgentsView/>);
    `},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},
    plugins:[{name:'fixtures',setup(api:{
      onResolve(opts:{filter:RegExp},fn:()=>{path:string;namespace:string}):void;
      onLoad(opts:{filter:RegExp;namespace:string},fn:()=>{contents:string;loader:string}):void;
    }){
      api.onResolve({filter:/^(?:@\/hooks\/use-(?:workspaces|areas)|@\/contexts\/dashboard-context|@\/lib\/executions\/start-execution|@\/lib\/client\/agent-view-mode|@\/components\/workspaces\/workspace-create-modal|@tanstack\/react-query)$/},()=>({path:'data-hooks',namespace:'fixture'}));
      api.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:fixture,loader:'js'}));
    }}],
  });
  const server=http.createServer((req,res)=>{
    if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundled.outputFiles[0].text);return;}
    res.setHeader('Content-Type','text/html');
    res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}button{padding:10px;margin:4px}svg{width:16px;height:16px}[data-slot="sheet-overlay"]{position:fixed;inset:0;background:#8888;z-index:50}[data-slot="sheet-content"]{position:fixed;inset:10%;background:white;padding:15px;z-index:51}</style><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise<void>((resolve)=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({executablePath:`${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell`,headless:true});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
    page.setDefaultTimeout(5000);
    await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    const menu=page.getByRole('button',{name:'More for Review agent'});
    const plus=page.getByRole('button',{name:'New execution',exact:true});
    for(const pick of [false,true,false]){
      await menu.tap();
      await page.getByRole('menuitem',{name:'New execution on…'}).tap();
      const sheet=page.getByRole('dialog',{name:'New execution in Review agent, on…'});
      await sheet.waitFor();
      await page.waitForFunction(()=>document.querySelector('[data-slot="sheet-content"]')?.contains(document.activeElement));
      if(pick) await sheet.getByRole('button',{name:/Review worker/}).tap();
      else await page.keyboard.press('Escape');
      await sheet.waitFor({state:'hidden'});
      await page.waitForFunction(()=>getComputedStyle(document.body).pointerEvents!=='none');
      await page.keyboard.press('Tab');
      expect(await page.evaluate(()=>document.activeElement?.tagName)).toBe('BUTTON');
      await plus.tap();
    }
    for(const name of ['Files','Terminal','Setup']){
      await menu.tap();await page.getByRole('menuitem',{name,exact:true}).tap();
      await page.waitForFunction(()=>getComputedStyle(document.body).pointerEvents!=='none');
    }
    expect(await page.evaluate(()=>(window as unknown as {actions:unknown[]}).actions)).toEqual([
      {kind:'start',value:'default'},{kind:'start',value:'worker'},{kind:'start',value:'default'},{kind:'start',value:'default'},
      {kind:'open',value:'files'},{kind:'open',value:'terminal'},{kind:'open',value:'setup'},
    ]);
  }finally{
    await browser.close();server.closeAllConnections();await new Promise<void>((resolve)=>server.close(()=>resolve()));
  }
},30_000);
