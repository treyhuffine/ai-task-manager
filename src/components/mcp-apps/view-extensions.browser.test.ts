/**
 * OpenAI's model context and message extensions through the real view host
 * and React components, with a sandboxed guest and a synthetic API: titled,
 * thumbnailed and assistant-only context in the composer's strip, removal
 * that the app hears about, a send made while the person works in the app,
 * and one an app tries on its own, which becomes a draft.
 */
import { it, expect } from 'vitest';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { prepareResource } from '@/lib/mcp-apps/resource';

const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

it('shows an app\'s context as one removable group and sends only while the person works in the app', async () => {
  const require = createRequire(import.meta.url);
  const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
  const css = await postcss([require('@tailwindcss/postcss')()]).process(fs.readFileSync('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') });
  const chatId = '01900111-1111-7111-8111-111111111112', captureId = '01900222-2222-7222-8222-222222222223', viewId = '01900333-3333-7333-8333-333333333334';
  const resource = prepareResource({ contents: [{ uri: 'ui://fixture/parts.html', mimeType: 'text/html;profile=mcp-app', text: `<html><body style="font:14px system-ui;padding:16px"><h2>Parts</h2><output id="state">waiting</output><button id="share">Share selection</button><button id="send">Ask about this part</button><script>
let id=0;const pending=new Map();const rpc=(method,params)=>new Promise((resolve,reject)=>{const request=++id;pending.set(request,{resolve,reject});parent.postMessage({jsonrpc:'2.0',id:request,method,params},'*')});
const state=text=>{document.getElementById('state').textContent=text};
addEventListener('message',event=>{if(event.source!==parent)return;const m=event.data;if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);return}
  if(m.method==='ui/notifications/host-context-changed'&&Object.hasOwn(m.params,'openai/modelContext'))state('context:'+JSON.stringify(m.params['openai/modelContext']))});
const message=send=>rpc('ui/message',{role:'user',content:[{type:'text',text:'Explain the clearance of'},{type:'text',text:'Selected: M6 hex bolt',_meta:{'openai/title':'M6 hex bolt'}}],_meta:{'openai/message':{target:'active',send}}});
document.getElementById('share').onclick=async()=>{const result=await rpc('ui/update-model-context',{content:[
  {type:'text',text:'Selected: M6 hex bolt',_meta:{'openai/title':'M6 hex bolt','openai/thumbnail':{src:'data:image/png;base64,${PIXEL}'}}},
  {type:'text',text:'Viewer camera: isometric',annotations:{audience:['assistant']}},
  {type:'image',data:'${PIXEL}',mimeType:'image/png',_meta:{'openai/title':'Front view'}},
  {type:'resource_link',uri:'cad://parts/washer',name:'washer.stl',title:'M6 washer'}],structuredContent:{page:'viewer'}});state('updated:'+JSON.stringify(result._meta))};
document.getElementById('send').onclick=()=>message(true).then(()=>state('sent'));
rpc('ui/initialize',{protocolVersion:'2026-01-26',appInfo:{name:'Parts',version:'1.0.0'},appCapabilities:{}}).then(result=>{state('caps:'+JSON.stringify(result.hostCapabilities.experimental));parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized',params:{}},'*');
  // An app that sends as soon as it loads, before the person has touched it.
  setTimeout(()=>message(true),300)});
</script></body></html>` }] }, 'ui://fixture/parts.html', false);
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React,{useState,useEffect} from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
import{ConnectedView}from'@/components/mcp-apps/view';import{registerAppChatComposer,serializeAppParts}from'@/lib/client/app-chat-intent';import{AppContextStrip}from'@/components/chat-ui/references/app-context-strip';import{useConnectedContextGroups}from'@/hooks/use-connected-context';import{flushConnectedContext}from'@/lib/client/mcp-app-context';
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
function Fixture(){const[draft,setDraft]=useState('');const[sent,setSent]=useState([]);const[refs,setRefs]=useState('');const groups=useConnectedContextGroups('${chatId}');
useEffect(()=>registerAppChatComposer('${chatId}',text=>setDraft(d=>d+'|'+text),{appendParts:parts=>setDraft(d=>d+'|'+JSON.stringify(parts)),send:async(parts,fromApp)=>setSent(s=>[...s,{...serializeAppParts(parts),fromApp}])}),[]);
return <main className="flex h-dvh flex-col bg-background text-foreground"><div className="flex-1 overflow-auto p-5"><ConnectedView captureId="${captureId}" chatId="${chatId}"/></div>
<div className="border-t p-4"><AppContextStrip groups={groups} onRemove={viewId=>groups.find(g=>g.viewId===viewId)?.remove()}/><output data-draft>{draft}</output><output data-sent>{JSON.stringify(sent)}</output><button onClick={async()=>setRefs(JSON.stringify(await flushConnectedContext('${chatId}')))}>Preview attached context</button><output data-refs>{refs}</output></div></main>}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><Fixture/></QueryClientProvider>);
` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' } });
  let revision = 0, cleared = 0;
  const contexts: unknown[] = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://fixture');
    if (url.pathname.startsWith('/api/trpc/')) {
      let body = ''; for await (const chunk of req) body += chunk;
      const input = JSON.parse(body || url.searchParams.get('input') || '{}'), method = url.pathname.slice('/api/trpc/'.length);
      let data: unknown = null;
      if (method === 'connectedApps.open') data = { id: viewId, captureId, chatId, serverId: 'fixture', sourceRef: 'fixture', title: 'Bits & Bolts · Parts', resource, input: {}, result: { content: [] }, revision, legacy: false,
        kind: 'result', deepLink: null, file: null, modelContext: null, tool: 'cad.view', app: 'Bits & Bolts', icons: [] };
      if (method === 'connectedApps.status') data = { revision, expiresAt: Date.now() + 60_000 };
      if (method === 'connectedApps.context') { contexts.push(input.context); revision++; data = { revision, updateId: `update-${revision}` }; }
      if (method === 'connectedApps.clearContext') { cleared++; revision++; data = { revision }; }
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ result: { data } })); return;
    }
    if (url.pathname === '/fixture.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
    if (url.pathname === '/fixture.css') { res.setHeader('content-type', 'text/css'); res.end(css.css); return; }
    res.setHeader('content-type', 'text/html'); res.end('<html><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true, chromiumSandbox: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } }), errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
    const guest = page.frameLocator('iframe[aria-label="App view"]').frameLocator('iframe');
    // The host advertises the two extensions, so the app's SDK turns them on.
    await expect.poll(() => guest.locator('#state').textContent()).toContain('"openai/modelContext":{}');
    // The app's send at load, before any interaction, lands in the draft with a quiet note.
    await page.getByText('Bits & Bolts wrote a message for you. It\'s in the draft, ready when you are.').waitFor();
    expect(await page.locator('[data-sent]').textContent()).toBe('[]');
    expect(JSON.parse((await page.locator('[data-draft]').textContent())!.slice(1))).toEqual([
      { type: 'text', text: 'Explain the clearance of' }, { type: 'snippet', title: 'M6 hex bolt', text: 'Selected: M6 hex bolt' }]);
    // Working in the app, the same request sends, named as the app's.
    await guest.getByRole('button', { name: 'Ask about this part' }).click();
    await expect.poll(() => page.locator('[data-sent]').textContent()).toBe(JSON.stringify([{ text: 'Explain the clearance of Selected: M6 hex bolt', attachments: [], fromApp: { viewId, app: 'Bits & Bolts' } }]));
    // Shared context shows as one group: titled, thumbnailed, an image and a link. The assistant-only block does not show.
    await guest.getByRole('button', { name: 'Share selection' }).click();
    await expect.poll(() => guest.locator('#state').textContent()).toBe('updated:{"openai/modelContext":{"updateId":"update-1"}}');
    const chip = page.getByRole('button', { name: 'Context from Bits & Bolts', exact: true });
    await expect.poll(() => chip.textContent()).toBe('Bits & BoltsM6 hex bolt and 2 more');
    await chip.click();
    const popover = page.getByRole('dialog');
    await popover.getByText('M6 hex bolt', { exact: true }).waitFor();
    expect(await popover.getByText('Viewer camera: isometric').count()).toBe(0);
    expect(await popover.getByRole('img', { name: 'Front view' }).count()).toBe(1);
    expect(await popover.getByText('cad://parts/washer').count()).toBe(1);
    await page.screenshot({ path: '/tmp/ri-mcp-context-strip.png' });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Preview attached context' }).click();
    await expect.poll(() => page.locator('[data-refs]').textContent()).toBe(JSON.stringify([{ viewId, revision: 1 }]));
    // Removing the group drops it on the home, tells the app, and attaches nothing more.
    await page.getByRole('button', { name: 'Remove context from Bits & Bolts' }).click();
    await expect.poll(() => guest.locator('#state').textContent()).toBe('context:null');
    expect(cleared).toBe(1);
    expect(await chip.count()).toBe(0);
    await page.getByRole('button', { name: 'Preview attached context' }).click();
    await expect.poll(() => page.locator('[data-refs]').textContent()).toBe('[]');
    expect(contexts).toHaveLength(1);
    expect(errors).toEqual([]);
  } finally { await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}, 30_000);
