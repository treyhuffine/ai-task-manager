/**
 * The Home keeps 32 app views in memory, and a model's results last as long
 * as their chat, so a long chat can hold more results than that. The real
 * card opens a result only once it nears the screen, and opens it again
 * quietly when the Home has let its view go, rather than showing an error.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { build } from 'esbuild';
import { chromium, type Browser } from 'playwright-core';
import http from 'node:http';
import { prepareResource } from '@/lib/mcp-apps/resource';
import { VIEW_CLOSED_MESSAGE } from '@/lib/mcp-apps/metadata';

const chatId = '01900111-1111-7111-8111-111111111111';
const near = '01900222-2222-7222-8222-222222222222', far = '01900222-2222-7222-8222-333333333333';
const guest = `<html><body><p id="heading">Today</p><script>
addEventListener('message',event=>{const m=event.data;if(m&&m.jsonrpc==='2.0'&&m.id===1&&m.result)parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized',params:{}},'*')});
parent.postMessage({jsonrpc:'2.0',id:1,method:'ui/initialize',params:{protocolVersion:'2026-01-26',appInfo:{name:'Lists',version:'1.0.0'},appCapabilities:{}}},'*');
</script></body></html>`;
const resource = prepareResource({contents: [{uri: 'ui://fixture/list.html', mimeType: 'text/html;profile=mcp-app', text: guest}]}, 'ui://fixture/list.html', false);

const opens: string[] = [], statuses: string[] = [];
let server: http.Server, browser: Browser, origin = '';
beforeAll(async () => {
  const bundle = await build({stdin: {resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
    import {ConnectedView} from '@/components/mcp-apps/view';
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
      <div style={{width: 640}}><ConnectedView captureId="${near}" chatId="${chatId}"/><div style={{height: 4000}}/><ConnectedView captureId="${far}" chatId="${chatId}"/></div>
    </QueryClientProvider>);
  `}, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: {'process.env.NODE_ENV': '"development"', 'process.env': '{}'}});
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://fixture');
    if (url.pathname.startsWith('/api/trpc/')) {
      let body = ''; for await (const chunk of req) body += chunk;
      const input = JSON.parse(body || url.searchParams.get('input') || '{}'), method = url.pathname.slice('/api/trpc/'.length);
      const reply = (data: unknown) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({result: {data}})); };
      if (method === 'connectedApps.open') {
        opens.push(input.captureId);
        // Each open is a new view, as the Home makes one.
        return reply({id: `${input.captureId}-view-${opens.length}`, captureId: input.captureId, chatId, serverId: 'fixture', sourceRef: 'fixture', title: 'Lists · Today', resource,
          input: {}, result: {content: [{type: 'text', text: 'Today'}]}, revision: 0, legacy: false, kind: 'result', created: Date.now() - 60 * 60_000});
      }
      if (method === 'connectedApps.status') {
        statuses.push(input.viewId);
        // The Home let the near card's first view go, as it does past 32.
        if (input.viewId === `${near}-view-1`) {
          res.statusCode = 500; res.setHeader('content-type', 'application/json');
          return res.end(JSON.stringify({error: {message: VIEW_CLOSED_MESSAGE, code: -32603, data: {code: 'INTERNAL_SERVER_ERROR', httpStatus: 500}}}));
        }
        return reply({revision: 0});
      }
      if (method === 'transport.capabilities') return reply({websocket: false});
      res.statusCode = 500; res.end(`Unexpected ${method}`); return;
    }
    if (url.pathname === '/fixture.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
    res.setHeader('content-type', 'text/html'); res.end('<html><body style="margin:0"><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
  browser = await chromium.launch({executablePath: chromium.executablePath(), headless: true, chromiumSandbox: true, args: ['--disable-features=IsolateSandboxedIframes']});
}, 60_000);
afterAll(async () => { await browser?.close(); server?.closeAllConnections(); await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve()); });

it('opens a result near the screen, and opens it again quietly once the Home lets its view go', async () => {
  const page = await browser.newPage({viewport: {width: 900, height: 800}});
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(origin);
    const cards = page.locator('section[aria-label="Interactive app result"]');
    // The near card found its first view gone and opened a second, without saying so.
    await expect.poll(() => opens.filter(id => id === near).length, {timeout: 15_000}).toBe(2);
    await expect.poll(() => statuses).toContain(`${near}-view-2`);
    await cards.first().frameLocator('iframe').frameLocator('iframe').locator('#heading').waitFor();
    expect(await page.getByText(VIEW_CLOSED_MESSAGE).count()).toBe(0);
    // The far card hasn't opened, or asked anything of the Home, while it is out of sight.
    expect(opens).not.toContain(far);
    expect(statuses.some(id => id.startsWith(far))).toBe(false);
    await cards.last().scrollIntoViewIfNeeded();
    await expect.poll(() => opens).toContain(far);
    await cards.last().frameLocator('iframe').frameLocator('iframe').locator('#heading').waitFor();
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 45_000);
