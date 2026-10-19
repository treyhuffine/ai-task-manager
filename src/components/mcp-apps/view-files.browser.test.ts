/** A file viewer as OpenAI's file entrypoint runs one: product components, synthetic API, real sandboxed guest. */
import { it, expect } from 'vitest';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { prepareResource } from '@/lib/mcp-apps/resource';

/**
 * The guest does what Bits & Bolts' viewer does with a file the host opened:
 * reads it through the host by its opaque URI, watches it, reloads when it
 * changes, saves with the etag it read, and asks the host to open another
 * file by path. It reports each step through a `probe` tool call.
 */
const guest = `<html><body><p>CAD viewer</p><script>
let id=0;const pending=new Map();const rpc=(method,params)=>new Promise((resolve,reject)=>{const request=++id;pending.set(request,{resolve,reject});parent.postMessage({jsonrpc:'2.0',id:request,method,params},'*')});
const report=(event,data)=>rpc('tools/call',{name:'probe',arguments:{event,...data}});
let uri=null,etag=null,reads=0;
const load=async()=>{const r=await rpc('resources/read',{uri});const meta=r.contents[0]._meta['openai/resource'];etag=meta.etag;reads++;await report('read',{text:r.contents[0].text,etag,writable:meta.writable});
  if(reads===2){const saved=await rpc('openai/resources/write',{uri,text:'solid edited',ifMatch:etag});await report('saved',saved);await rpc('openai/files/open',{path:'/parts/other.stl'});await report('opened',{})}};
addEventListener('message',event=>{if(event.source!==parent)return;const m=event.data;if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);return}
  if(m.method==='ui/notifications/tool-input'&&!uri){uri=m.params.arguments.file.resourceUri;load().then(()=>rpc('resources/subscribe',{uri})).then(()=>report('subscribed',{}))}
  if(m.method==='notifications/resources/updated'){report('updated',{uri:m.params.uri}).then(load)}});
rpc('ui/initialize',{protocolVersion:'2026-01-26',appInfo:{name:'CAD viewer',version:'1.0.0'},appCapabilities:{}}).then(r=>{report('init',{experimental:Object.keys(r.hostCapabilities.experimental||{}).sort(),serverResources:!!r.hostCapabilities.serverResources});parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized',params:{}},'*')});
</script></body></html>`;

it('reads, watches and saves the opened file through Ri, and opens another file by path beside the chat', async () => {
  const chatId = 'chat-1', uri = 'ri-file:handle-1';
  const resource = prepareResource({contents: [{uri: 'ui://bits-and-bolts/file-v35', mimeType: 'text/html;profile=mcp-app', text: guest}]}, 'ui://bits-and-bolts/file-v35', false);
  const bundle = await build({stdin: {resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
    import{ConnectedCompanion}from'@/components/mcp-apps/companion';import{ConnectedView}from'@/components/mcp-apps/view';
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
      <ConnectedCompanion chatId="${chatId}">{() => <ConnectedView captureId="capture-1" chatId="${chatId}"/>}</ConnectedCompanion></QueryClientProvider>);
  `}, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: {'process.env.NODE_ENV': '"development"', 'process.env': '{}'},
  plugins: [{name: 'isolate-view', setup(builder) {
    builder.onResolve({filter: /contexts\/dashboard-context$/}, () => ({path: 'dashboard', namespace: 'fixture'}));
    builder.onLoad({filter: /.*/, namespace: 'fixture'}, () => ({loader: 'tsx', contents: 'export const useOptionalDashboard = () => null;'}));
  }}]});
  const probes: Record<string, unknown>[] = [], calls: {method: string; input: Record<string, unknown>}[] = [];
  let reads = 0, changes = 0;
  const view = (captureId: string) => ({id: captureId === 'capture-1' ? 'view-1' : 'view-2', captureId, chatId, serverId: 'bnb', sourceRef: 'bnb', title: 'Bits & Bolts · CAD viewer', resource,
    input: {file: {name: 'hex-bolt.stl', resourceUri: uri}}, result: {content: []}, revision: 0, legacy: false, kind: 'file', deepLink: null, file: {name: 'hex-bolt.stl'}, modelContext: null,
    tool: 'cad.open', app: 'Bits & Bolts', icons: []});
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://fixture');
    if (url.pathname.startsWith('/api/trpc/')) {
      let body = ''; for await (const chunk of req) body += chunk;
      const input = JSON.parse(body || url.searchParams.get('input') || '{}'), method = url.pathname.slice('/api/trpc/'.length);
      calls.push({method, input});
      let data: unknown;
      if (method === 'connectedApps.open') data = view(input.captureId);
      else if (method === 'connectedApps.status') data = {revision: 0, expiresAt: Date.now() + 60_000};
      else if (method === 'transport.capabilities') data = {websocket: false};
      else if (method === 'connectedApps.invoke') { if (input.viewId === 'view-1') probes.push(input.args); data = {kind: 'result', result: {content: []}}; }
      else if (method === 'connectedApps.readResource') { reads++; data = {contents: [{uri, mimeType: 'model/stl', text: `solid v${reads}`, _meta: {'openai/resource': {etag: `v${reads}`, writable: true}}}]}; }
      else if (method === 'connectedApps.files.subscribe') data = {revision: 0};
      // The long poll: the file changes once, then the watch ends.
      else if (method === 'connectedApps.files.changes') { changes++; await new Promise(resolve => setTimeout(resolve, 200)); data = changes === 1 ? {revision: 1, watching: true} : {revision: 1, watching: false}; }
      else if (method === 'connectedApps.files.write') data = {outcome: 'saved', etag: 'v3'};
      else if (method === 'connectedApps.files.open') data = {kind: 'app', serverId: 'bnb', tool: 'cad.open', handle: 'handle-2', name: 'other.stl', chatId};
      else if (method === 'connectedApps.prepare') data = {kind: 'launch', viewId: 'view-2', invocationId: 'capture-2'};
      else if (method === 'connectedApps.launch') data = {kind: 'opened', captureId: 'capture-2'};
      else if (method === 'connectedApps.files.unsubscribe') data = null;
      if (data === undefined) { res.statusCode = 500; res.end(`Unexpected operation ${method}`); return; }
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({result: {data}})); return;
    }
    if (url.pathname === '/fixture.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
    res.setHeader('content-type', 'text/html'); res.end('<html><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({executablePath: chromium.executablePath(), headless: true, chromiumSandbox: true, args: ['--disable-features=IsolateSandboxedIframes']});
  try {
    const page = await browser.newPage(), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${(server.address() as {port: number}).port}`);
    await expect.poll(() => probes.map(probe => probe.event), {timeout: 15_000}).toEqual(['init', 'read', 'subscribed', 'updated', 'read', 'saved', 'opened']);
    // A file view is told it may read, watch and write the file, open files, and send messages and context like any view in a chat.
    expect(probes[0]).toEqual({event: 'init', experimental: ['openai/files', 'openai/message', 'openai/modelContext', 'openai/resource'], serverResources: true});
    expect(probes[1]).toEqual({event: 'read', text: 'solid v1', etag: 'v1', writable: true});
    expect(probes[3]).toEqual({event: 'updated', uri});
    expect(probes[4]).toMatchObject({text: 'solid v2', etag: 'v2'});
    expect(probes[5]).toEqual({event: 'saved', outcome: 'saved', etag: 'v3'});
    expect(calls.find(call => call.method === 'connectedApps.files.write')?.input).toEqual({viewId: 'view-1', uri, text: 'solid edited', ifMatch: 'v2'});
    expect(calls.find(call => call.method === 'connectedApps.files.open')?.input).toEqual({viewId: 'view-1', path: '/parts/other.stl'});
    expect(calls.find(call => call.method === 'connectedApps.prepare')?.input).toEqual({serverId: 'bnb', name: 'cad.open', kind: 'file', file: {handle: 'handle-2'}, chatId});
    // The other file opens beside the same chat.
    await expect.poll(() => calls.some(call => call.method === 'connectedApps.open' && call.input.captureId === 'capture-2' && call.input.chatId === chatId)).toBe(true);
    await page.getByRole('complementary', {name: 'Connected app beside this chat'}).locator('iframe').first().waitFor();
    expect(errors).toEqual([]);
  } finally { await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}, 40_000);
