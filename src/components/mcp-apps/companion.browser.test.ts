/**
 * The pane beside a chat through the real companion and view components, with
 * sandboxed guests and a synthetic API: a fresh result that prefers full
 * screen opens there on its own, the next one replaces it, and neither
 * replaces a tab the person opened, whose guest keeps its state until the
 * person chooses to replace it.
 */
import { it, expect } from 'vitest';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { prepareResource } from '@/lib/mcp-apps/resource';

/** A guest that counts its own clicks, so a remount (which loses the count) shows. */
const guest = (name: string, meta?: Record<string, unknown>) => prepareResource({ contents: [{ uri: `ui://fixture/${name}.html`, mimeType: 'text/html;profile=mcp-app', ...(meta ? { _meta: meta } : {}),
  text: `<html><body style="font:14px system-ui;padding:16px"><h2>${name}</h2><output id="count">0</output><button id="add">Add</button><script>
let id=0;const pending=new Map();const rpc=(method,params)=>new Promise((resolve,reject)=>{const request=++id;pending.set(request,{resolve,reject});parent.postMessage({jsonrpc:'2.0',id:request,method,params},'*')});
addEventListener('message',event=>{if(event.source!==parent)return;const m=event.data;if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}});
document.getElementById('add').onclick=()=>{const out=document.getElementById('count');out.textContent=String(Number(out.textContent)+1)};
rpc('ui/initialize',{protocolVersion:'2026-01-26',appInfo:{name:'${name}',version:'1.0.0'},appCapabilities:{}}).then(()=>parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized',params:{}},'*'));
</script></body></html>` }] }, `ui://fixture/${name}.html`, false);

it('places fresh full-screen results beside a chat without displacing a tab the person opened', async () => {
  const require = createRequire(import.meta.url);
  const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
  const css = await postcss([require('@tailwindcss/postcss')()]).process(fs.readFileSync('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') });
  const chatId = '01900111-1111-7111-8111-111111111113';
  const tray = guest('Parts tray');
  const viewer = guest('Part viewer', { 'openai/ui': { preferredDisplayMode: 'fullscreen' } });
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
import{ConnectedCompanion}from'@/components/mcp-apps/companion';import{ConnectedView}from'@/components/mcp-apps/view';import{useConnectedCompanion}from'@/lib/client/mcp-app-panel';
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
function Transcript(){const companion=useConnectedCompanion();const[results,setResults]=useState([]);
return <div className="flex-1 overflow-auto p-4"><button onClick={()=>setResults(r=>[...r,'result-'+(r.length+1)])}>Model result</button>
<button onClick={()=>void companion.openTab({serverId:'fixture',name:'tray',title:'Parts tray'})}>Open Parts tray</button>
{results.map(id=><section key={id} data-result={id}><ConnectedView captureId={id} chatId="${chatId}"/></section>)}</div>}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><main className="flex h-dvh bg-background text-foreground"><ConnectedCompanion chatId="${chatId}">{()=><Transcript/>}</ConnectedCompanion></main></QueryClientProvider>);
` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' } });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://fixture');
    if (url.pathname.startsWith('/api/trpc/')) {
      let body = ''; for await (const chunk of req) body += chunk;
      const input = JSON.parse(body || url.searchParams.get('input') || '{}'), method = url.pathname.slice('/api/trpc/'.length);
      let data: unknown = null;
      if (method === 'connectedApps.prepare') data = { kind: 'launch', viewId: 'view-tab', invocationId: 'tab' };
      if (method === 'connectedApps.launch') data = { kind: 'opened', captureId: 'tab' };
      if (method === 'connectedApps.open') {
        const tab = input.captureId === 'tab';
        data = { id: `view-${input.captureId}`, captureId: input.captureId, chatId, serverId: 'fixture', sourceRef: 'fixture', title: tab ? 'Bits & Bolts · Parts tray' : 'Bits & Bolts · Part viewer',
          resource: tab ? tray : viewer, input: {}, result: { content: [] }, revision: 0, legacy: false, kind: tab ? 'thread' : 'result', created: Date.now(),
          deepLink: null, file: null, modelContext: null, tool: tab ? 'tray' : 'cad.view', app: 'Bits & Bolts', icons: [] };
      }
      if (method === 'connectedApps.status') data = { revision: 0, expiresAt: Date.now() + 60_000 };
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ result: { data } })); return;
    }
    if (url.pathname === '/fixture.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
    if (url.pathname === '/fixture.css') { res.setHeader('content-type', 'text/css'); res.end(css.css); return; }
    res.setHeader('content-type', 'text/html'); res.end('<html><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true, chromiumSandbox: true, args: ['--disable-features=IsolateSandboxedIframes'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1300, height: 900 } }), errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    // A step that never happens fails on its own locator, well inside the test's timeout.
    page.setDefaultTimeout(10_000);
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
    const pane = page.getByRole('complementary', { name: 'Connected app beside this chat' });
    const paneTitle = pane.locator('span').first();
    const besideGuest = pane.frameLocator('iframe[aria-label="App view"]').frameLocator('iframe');
    const result = (id: string) => page.locator(`[data-result="${id}"]`);

    // A fresh result that prefers full screen opens beside the chat into the empty pane.
    await page.getByRole('button', { name: 'Model result' }).click();
    await result('result-1').getByText('Open beside this chat.').waitFor();
    await expect.poll(() => besideGuest.locator('h2').textContent()).toBe('Part viewer');
    // The next one replaces it, and the first goes back into the transcript.
    await page.getByRole('button', { name: 'Model result' }).click();
    await result('result-2').getByText('Open beside this chat.').waitFor();
    await result('result-1').getByRole('button', { name: 'Open beside chat' }).waitFor();

    // The person opens a tab and works in it.
    await page.getByRole('button', { name: 'Open Parts tray' }).click();
    await expect.poll(() => paneTitle.textContent()).toBe('Parts tray');
    await expect.poll(() => besideGuest.locator('h2').textContent()).toBe('Parts tray');
    await besideGuest.getByRole('button', { name: 'Add' }).click();
    await besideGuest.getByRole('button', { name: 'Add' }).click();
    await expect.poll(() => besideGuest.locator('#count').textContent()).toBe('2');

    // A fresh result now stays in the transcript and offers the pane, leaving the tab and its state alone.
    await page.getByRole('button', { name: 'Model result' }).click();
    await result('result-3').getByRole('button', { name: 'Open beside chat' }).waitFor();
    await result('result-3').frameLocator('iframe[aria-label="App view"]').frameLocator('iframe').locator('h2').waitFor();
    expect(await paneTitle.textContent()).toBe('Parts tray');
    expect(await besideGuest.locator('#count').textContent()).toBe('2');

    // Replacing the tab is the person's choice.
    await result('result-3').getByRole('button', { name: 'Open beside chat' }).click();
    await result('result-3').getByText('Open beside this chat.').waitFor();
    await expect.poll(() => paneTitle.textContent()).toBe('App beside this chat');
    await expect.poll(() => besideGuest.locator('h2').textContent()).toBe('Part viewer');
    expect(errors).toEqual([]);
  } finally { await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}, 30_000);
