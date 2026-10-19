/**
 * An inline connected view is as tall as it says it is. The real component, real
 * Tailwind CSS and a real sandboxed guest that reports its height with
 * `ui/notifications/size-changed`. Until October 19 a flex rule collapsed every
 * inline view to its 240 px minimum, which cut off the end of Todoist's task list.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { build } from 'esbuild';
import { chromium, type Browser } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { prepareResource } from '@/lib/mcp-apps/resource';

const chatId = '01900111-1111-7111-8111-111111111111', captureId = '01900222-2222-7222-8222-222222222222', viewId = '01900333-3333-7333-8333-333333333333';
// The guest draws a list as tall as its result asks, then reports that height to the host.
const guest = `<html><head><style>body{margin:0;font:14px system-ui}#list{background:linear-gradient(#eef5f4,#cfe3df)}</style></head><body><div id="list"></div><script>
addEventListener('message',event=>{const m=event.data;if(!m||m.jsonrpc!=='2.0')return;
if(m.id===1&&m.result)parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized',params:{}},'*');
if(m.method==='ui/notifications/tool-result'){const h=m.params.structuredContent.height;document.getElementById('list').style.height=h+'px';parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/size-changed',params:{height:h}},'*')}});
parent.postMessage({jsonrpc:'2.0',id:1,method:'ui/initialize',params:{protocolVersion:'2026-01-26',appInfo:{name:'Sized list',version:'1.0.0'},appCapabilities:{}}},'*');
</script></body></html>`;
const resource = prepareResource({contents: [{uri: 'ui://fixture/list.html', mimeType: 'text/html;profile=mcp-app', text: guest}]}, 'ui://fixture/list.html', false);

let server: http.Server, browser: Browser, origin = '';
beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
  const css = await postcss([require('@tailwindcss/postcss')()]).process(fs.readFileSync('src/app/globals.css', 'utf8'), {from: path.resolve('src/app/globals.css')});
  const bundle = await build({stdin: {resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
    import {ConnectedView} from '@/components/mcp-apps/view';
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
      <div style={{width: 640, padding: 16}}><p>Your list for today:</p><ConnectedView captureId="${captureId}" chatId="${chatId}"/><p id="after">After the result</p></div>
    </QueryClientProvider>);
  `}, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: {'process.env.NODE_ENV': '"development"', 'process.env': '{}'}});
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://fixture');
    if (url.pathname.startsWith('/api/trpc/')) {
      const method = url.pathname.slice('/api/trpc/'.length);
      const height = Number(new URL(req.headers.referer ?? 'http://fixture').searchParams.get('height'));
      const data = method === 'connectedApps.open' ? {id: viewId, captureId, chatId, serverId: 'fixture', sourceRef: 'fixture', title: 'Lists · Today', resource, input: {}, result: {content: [{type: 'text', text: 'Today'}], structuredContent: {height}}, revision: 0, legacy: false}
        : method === 'connectedApps.status' ? {revision: 0, expiresAt: Date.now() + 60_000}
        : method === 'transport.capabilities' ? {websocket: false} : undefined;
      if (data === undefined) { res.statusCode = 500; res.end(`Unexpected ${method}`); return; }
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({result: {data}})); return;
    }
    if (url.pathname === '/fixture.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
    if (url.pathname === '/fixture.css') { res.setHeader('content-type', 'text/css'); res.end(css.css); return; }
    res.setHeader('content-type', 'text/html'); res.end('<html><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
  browser = await chromium.launch({executablePath: chromium.executablePath(), headless: true, chromiumSandbox: true});
}, 60_000);
afterAll(async () => { await browser?.close(); server?.closeAllConnections(); await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve()); });

async function frameHeight(height: number) {
  const page = await browser.newPage({viewport: {width: 900, height: 900}});
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`${origin}/?height=${height}`);
    const frame = page.locator('section[aria-label="Interactive app result"] iframe').first();
    await frame.waitFor();
    // The host starts at 420 px. Wait for the guest's own report to land.
    await expect.poll(async () => Math.round((await frame.boundingBox())!.height), {timeout: 15_000}).not.toBe(420);
    const box = (await frame.boundingBox())!, after = (await page.locator('#after').boundingBox())!;
    expect(errors).toEqual([]);
    return {height: Math.round(box.height), gapToNext: Math.round(after.y - (box.y + box.height))};
  } finally { await page.close(); }
}

it('is exactly as tall as a short view reports, with nothing cut off', async () => {
  const sized = await frameHeight(315);
  expect(sized.height).toBe(315);
  // The text after the result follows the frame, not a fixed box under it.
  expect(sized.gapToNext).toBeLessThan(40);
}, 30_000);

it('caps a tall view at 80% of the window, where the view scrolls inside', async () => {
  // A 900 px tall window caps at 720 px, below the host's own 900 px ceiling.
  expect((await frameHeight(1500)).height).toBe(720);
}, 30_000);
