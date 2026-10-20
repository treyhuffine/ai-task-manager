/**
 * A view's network (docs/connected-mcp-apps.md, "Security"), through the real
 * view host and component with a sandboxed guest: it reaches the domain its
 * UI resource declares, for a fetch and an image, and nothing else, even on
 * this same computer.
 */
import { it, expect } from 'vitest';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { declaredCsp } from '@ri/mcp-apps-host/csp';

const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

/** A server on this computer with some data and an image, readable from any origin. */
async function origin() {
  const server = http.createServer((req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    if (req.url === '/data.json') { res.setHeader('content-type', 'application/json'); res.end('{"parts":3}'); return; }
    res.setHeader('content-type', 'image/png'); res.end(PIXEL);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}

it('reaches the domains a view declares, and no others', async () => {
  const require = createRequire(import.meta.url);
  const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
  const css = await postcss([require('@tailwindcss/postcss')()]).process(fs.readFileSync('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') });
  const declared = await origin(), undeclared = await origin();
  const chatId = '01900111-1111-7111-8111-111111111116', captureId = '01900222-2222-7222-8222-222222222226', viewId = '01900333-3333-7333-8333-333333333337';
  const html = `<html><body style="font:14px system-ui;padding:16px"><output id="result">waiting</output><script>
let id=0;const pending=new Map();const rpc=(method,params)=>new Promise((resolve,reject)=>{const request=++id;pending.set(request,{resolve,reject});parent.postMessage({jsonrpc:'2.0',id:request,method,params},'*')});
addEventListener('message',event=>{if(event.source!==parent)return;const m=event.data;if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}});
const get=url=>fetch(url).then(r=>r.json()).then(j=>'ok:'+j.parts,()=>'blocked');
const image=url=>new Promise(resolve=>{const img=new Image();img.onload=()=>resolve('loaded');img.onerror=()=>resolve('blocked');img.src=url;document.body.append(img)});
rpc('ui/initialize',{protocolVersion:'2026-01-26',appInfo:{name:'Network',version:'1.0.0'},appCapabilities:{}}).then(async()=>{
  parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized',params:{}},'*');
  const result={declaredFetch:await get('${declared.url}/data.json'),undeclaredFetch:await get('${undeclared.url}/data.json'),
    declaredImage:await image('${declared.url}/pixel.png'),undeclaredImage:await image('${undeclared.url}/pixel.png')};
  document.getElementById('result').textContent=JSON.stringify(result);
});
</script></body></html>`;
  // As the Home prepares it: the declared domains read from the resource's `_meta` (MCP Apps `ui.csp`).
  const resource = { html, csp: declaredCsp({ ui: { csp: { connectDomains: [declared.url], resourceDomains: [declared.url] } } }), digest: 'network-fixture',
    displayModes: { available: ['inline', 'fullscreen'], declared: false } };
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
import{ConnectedView}from'@/components/mcp-apps/view';
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><main className="p-5"><ConnectedView captureId="${captureId}" chatId="${chatId}"/></main></QueryClientProvider>);
` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' } });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://fixture');
    if (url.pathname.startsWith('/api/trpc/')) {
      for await (const chunk of req) void chunk;
      const method = url.pathname.slice('/api/trpc/'.length);
      let data: unknown = null;
      if (method === 'connectedApps.open') data = { id: viewId, captureId, chatId, serverId: 'fixture', sourceRef: 'fixture', title: 'Network', resource, input: {}, result: { content: [] }, revision: 0, legacy: false,
        kind: 'result', created: Date.now(), deepLink: null, file: null, modelContext: null, tool: 'net', app: 'Network', icons: [] };
      if (method === 'connectedApps.status') data = { revision: 0 };
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ result: { data } })); return;
    }
    if (url.pathname === '/fixture.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
    if (url.pathname === '/fixture.css') { res.setHeader('content-type', 'text/css'); res.end(css.css); return; }
    res.setHeader('content-type', 'text/html'); res.end('<html><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true, chromiumSandbox: true, args: ['--disable-features=IsolateSandboxedIframes'] });
  try {
    const page = await browser.newPage(), errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(10_000);
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
    const guest = page.frameLocator('iframe[aria-label="App view"]').frameLocator('iframe');
    await expect.poll(() => guest.locator('#result').textContent(), { timeout: 10_000 }).not.toBe('waiting');
    expect(JSON.parse((await guest.locator('#result').textContent())!)).toEqual({
      declaredFetch: 'ok:3', undeclaredFetch: 'blocked', declaredImage: 'loaded', undeclaredImage: 'blocked' });
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    for (const s of [server, declared.server, undeclared.server]) { s.closeAllConnections(); await new Promise<void>(resolve => s.close(() => resolve())); }
  }
}, 40_000);
