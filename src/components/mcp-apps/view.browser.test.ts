/** Product components, isolated synthetic API, real sandboxed MCP guest. */
import { it, expect } from 'vitest';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { prepareResource } from '@/lib/mcp-apps/resource';

it('keeps the live iframe and draft while expanding, gates actions natively, and attaches only acknowledged context', async () => {
  const require = createRequire(import.meta.url);
  const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
  const css = await postcss([require('@tailwindcss/postcss')()]).process(fs.readFileSync('src/app/globals.css','utf8'),{from:path.resolve('src/app/globals.css')});
  const chatId='01900111-1111-7111-8111-111111111111', captureId='01900222-2222-7222-8222-222222222222', viewId='01900333-3333-7333-8333-333333333333';
  const resource=prepareResource({contents:[{uri:'ui://fixture/index.html',mimeType:'text/html;profile=mcp-app',text:`<html><head><style>body{margin:0;padding:24px;color:#152c3b;background:#eef5f4;font:14px system-ui}h2{font-size:23px;margin:0 0 8px}p{color:#4b646e}button{background:#17645a;color:white;padding:10px 16px;border:0;border-radius:8px}output{display:block;font-size:40px;margin:20px 0}</style></head><body><h2>Portfolio calculator</h2><p>A fictional account for this test</p><output id="value">$70,000</output><button id="update">Recalculate</button><script>
let id=0;const pending=new Map();const rpc=(method,params)=>new Promise((resolve,reject)=>{const request=++id;pending.set(request,{resolve,reject});parent.postMessage({jsonrpc:'2.0',id:request,method,params},'*')});
const probe=()=>{const r=document.getElementById('update').getBoundingClientRect();return rpc('tools/call',{name:'probe',arguments:{value:document.getElementById('value').textContent,x:r.x+r.width/2,y:r.y+r.height/2}})};
addEventListener('message',event=>{if(event.source!==parent)return;const m=event.data;if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}if(m.method==='ui/notifications/tool-result'){document.getElementById('value').textContent=m.params.structuredContent.value;probe()}});
document.getElementById('update').onclick=async()=>{const result=await rpc('tools/call',{name:'recalculate',arguments:{amount:9}});document.getElementById('value').textContent=result.structuredContent.value;await rpc('ui/update-model-context',{structuredContent:{selected:9}});await rpc('ui/message',{role:'user',content:[{type:'text',text:'Explain this result'}]});await probe()};
rpc('ui/initialize',{protocolVersion:'2026-01-26',appInfo:{name:'Independent calculator',version:'1.0.0'},appCapabilities:{}}).then(()=>parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized',params:{}},'*'));
</script></body></html>`}]},'ui://fixture/index.html',false);
  const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React,{useState,useEffect} from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
import{ConnectedCompanion}from'@/components/mcp-apps/companion';import{ConnectedView}from'@/components/mcp-apps/view';import{registerAppChatComposer}from'@/lib/client/app-chat-intent';import{flushConnectedContext}from'@/lib/client/mcp-app-context';
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});function Fixture(){const[draft,setDraft]=useState('Keep my original question.');const[context,setContext]=useState('');useEffect(()=>registerAppChatComposer('${chatId}',text=>setDraft(previous=>previous+' '+text)),[]);return <main className="flex h-dvh flex-col bg-background text-foreground"><header className="border-b p-4 text-sm font-medium">Portfolio review</header><ConnectedCompanion chatId="${chatId}">{()=> <div className="flex min-h-0 flex-1 flex-col"><div className="flex-1 overflow-auto p-5"><p className="mb-5 text-sm">Here is the interactive result from your connected account.</p><ConnectedView captureId="${captureId}" chatId="${chatId}"/></div><div className="border-t p-4"><textarea aria-label="Chat draft" className="w-full rounded-lg border p-3" value={draft} onChange={event=>setDraft(event.target.value)}/><button onClick={async()=>setContext(JSON.stringify(await flushConnectedContext('${chatId}')))}>Preview attached context</button><output data-context>{context}</output></div></div>}</ConnectedCompanion></main>};createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><Fixture/></QueryClientProvider>);
`},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"','process.env':'{}'}});
  let opens=0, effects=0, revision=0, approved=false, contextRequests=0;
  let acknowledgeContext!: () => void;
  const contextAcknowledgement=new Promise<void>(resolve=>{acknowledgeContext=resolve;});
  const probes: {value:string;x:number;y:number}[]=[];
  const invocationIds: string[]=[];
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url!,'http://fixture');
    if(url.pathname.startsWith('/api/trpc/')){
      let body='';for await(const chunk of req)body+=chunk;
      const input=JSON.parse(body||url.searchParams.get('input')||'{}'), method=url.pathname.slice('/api/trpc/'.length);
      let data:unknown;
      if(method==='connectedApps.open'){opens++;data={id:viewId,captureId,chatId,serverId:'fixture',sourceRef:'fixture',title:'Total Finance · Portfolio calculator',resource,input:{},result:{content:[{type:'text',text:'A fictional portfolio'}],structuredContent:{value:'$70,000'},_meta:{privateUi:'Private fixture data'}},revision,legacy:false};}
      if(method==='connectedApps.status')data={revision,expiresAt:Date.now()+60_000};
      if(method==='connectedApps.invoke'){
        if(input.name==='probe'){probes.push(input.args);data={kind:'result',result:{content:[]}};}
        else{invocationIds.push(input.invocationId);if(!approved)data={kind:'approval',ids:['01900444-4444-7444-8444-444444444444'],preview:{operation:'Recalculate portfolio',amount:9}};else{effects++;data={kind:'result',result:{content:[{type:'text',text:'Updated portfolio'}],structuredContent:{value:'$90,000'}}};}}
      }
      if(method==='connectedApps.approval'){approved=input.approve;data=null;}
      if(method==='connectedApps.context'){contextRequests++;await contextAcknowledgement;revision++;data={revision,updateId:'update-'+revision};}
      res.setHeader('content-type','application/json');res.end(JSON.stringify({result:{data}}));return;
    }
    if(url.pathname==='/fixture.js'){res.setHeader('content-type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
    if(url.pathname==='/fixture.css'){res.setHeader('content-type','text/css');res.end(css.css);return;}
    res.setHeader('content-type','text/html');res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({executablePath:chromium.executablePath(),headless:true,chromiumSandbox:true});
  try{
    const page=await browser.newPage({viewport:{width:1200,height:900}}), errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${(server.address() as {port:number}).port}`);
    await expect.poll(()=>probes.length).toBe(1);
    const frame=await page.locator('iframe').boundingBox();await page.mouse.click(frame!.x+probes[0].x,frame!.y+probes[0].y);
    await page.getByText('Allow this app operation?',{exact:true}).waitFor();expect(effects).toBe(0);
    await page.getByRole('button',{name:'Allow once',exact:true}).click();
    await expect.poll(()=>contextRequests).toBe(1);
    // The very first context update has not acknowledged. Send must await this
    // view instead of immediately completing with an empty attachment list.
    await page.getByRole('button',{name:'Preview attached context'}).click();
    expect(await page.locator('[data-context]').textContent()).toBe('');
    acknowledgeContext();
    await expect.poll(()=>page.locator('[data-context]').textContent()).toBe(JSON.stringify([{viewId,revision:1}]));
    await expect.poll(()=>probes.at(-1)?.value).toBe('$90,000');
    expect(effects).toBe(1);expect(invocationIds).toHaveLength(2);expect(invocationIds[0]).toBe(invocationIds[1]);
    expect(await page.getByRole('textbox',{name:'Chat draft'}).inputValue()).toBe('Keep my original question. Explain this result');
    await page.getByRole('button',{name:'Preview attached context'}).click();await expect.poll(()=>page.locator('[data-context]').textContent()).toBe(JSON.stringify([{viewId,revision:1}]));
    await page.screenshot({path:'/tmp/ri-mcp-inline-desktop.png'});
    const initialProbeCount=probes.length;
    await page.getByRole('button',{name:'Open beside chat',exact:true}).click();await page.getByRole('complementary',{name:'Connected app beside this chat'}).locator('iframe').waitFor();
    expect(await page.locator('iframe').count()).toBe(1);expect(opens).toBe(1);expect(probes.length).toBe(initialProbeCount);expect(effects).toBe(1);
    await page.screenshot({path:'/tmp/ri-mcp-beside-desktop.png'});
    await page.getByRole('button',{name:'Close app',exact:true}).click();await page.getByRole('region',{name:'Interactive app result'}).locator('iframe').waitFor();
    expect(opens).toBe(1);expect(probes.length).toBe(initialProbeCount);
    await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Open beside chat',exact:true}).click();
    await page.getByRole('complementary',{name:'Connected app beside this chat'}).locator('iframe').waitFor();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(await page.getByRole('textbox',{name:'Chat draft'}).inputValue()).toContain('Keep my original question.');
    await page.screenshot({path:'/tmp/ri-mcp-beside-mobile.png'});expect(errors).toEqual([]);
  }finally{await browser.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
},30_000);
