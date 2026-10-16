import { expect, it } from 'vitest';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import http from 'node:http';

it('starts workflows explicitly, preserves inputs, and cancels declined or abandoned invocations', async () => {
  const bundle = await build({
    stdin: {resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
      import {ConnectedAppPage} from '@/components/mcp-apps/page';
      function Fixture() {const [open,setOpen]=useState(true);return open?<ConnectedAppPage serverId="fixture" navigate={()=>setOpen(false)}/>:<p>Left apps</p>;}
      createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><Fixture/></QueryClientProvider>);
    `},
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    define: {'process.env.NODE_ENV': '"development"', 'process.env': '{}'},
    plugins: [{name: 'isolate-workflow', setup(builder) {
      builder.onResolve({filter: /local-apps\/library-chat$/}, () => ({path: 'chat', namespace: 'fixture'}));
      builder.onResolve({filter: /^\.\/view$/}, args => args.importer.endsWith('/mcp-apps/page.tsx') ? {path: 'view', namespace: 'fixture'} : undefined);
      builder.onLoad({filter: /.*/, namespace: 'fixture'}, args => ({loader: 'tsx', resolveDir: process.cwd(), contents: args.path === 'chat' ? 'export const LibraryChat=()=>null;' : 'export const ConnectedView=({captureId})=><p>Opened {captureId}</p>;'}));
    }}],
  });
  const inputs: unknown[] = [], launches: string[] = [], cancellations: unknown[] = [];
  let approved = false, effects = 0, declined = 0;
  let holdLaunch = false;
  let releaseLaunch!: () => void;
  const delayedLaunch = new Promise<void>(resolve => {releaseLaunch = resolve;});
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://fixture');
    if (url.pathname.startsWith('/api/trpc/')) {
      let body = ''; for await (const chunk of req) body += chunk;
      const input = JSON.parse(body || url.searchParams.get('input') || '{}');
      const method = url.pathname.slice('/api/trpc/'.length);
      let data: unknown;
      if (method === 'connectedApps.catalog') data = [{id: 'fixture', name: 'Fixture', toolkitName: 'Fixture', account: 'Account A', sourceRef: 'source', available: true, recent: [], tools: [{name: 'calculate', title: 'Calculate', description: '', global: false, inputSchema: {type: 'object', properties: {enabled: {type: 'boolean'}, amount: {type: 'number'}}, required: ['enabled']}}]}];
      else if (method === 'connectedApps.prepare') {inputs.push(input.args); data = {viewId: `view-${inputs.length}`, invocationId: `invocation-${inputs.length}`};}
      else if (method === 'connectedApps.launch') {
        launches.push(input.viewId);
        if (holdLaunch) await delayedLaunch;
        if (approved) {effects++; data = {kind: 'opened', captureId: 'completed'};}
        else data = {kind: 'approval', viewId: input.viewId, ids: ['pending'], preview: {operation: 'Calculate'}};
      } else if (method === 'connectedApps.approval') {approved = input.approve; if (!approved) declined++; data = null;}
      else if (method === 'connectedApps.cancel') {cancellations.push(input); data = null;}
      else {res.statusCode = 500; res.end('Unexpected operation'); return;}
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({result: {data}})); return;
    }
    if (url.pathname === '/fixture.js') {res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return;}
    res.setHeader('content-type', 'text/html'); res.end('<html><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({executablePath: chromium.executablePath(), headless: true, chromiumSandbox: true});
  try {
    const page = await browser.newPage(), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${(server.address() as {port: number}).port}`);
    const run = page.getByRole('button', {name: 'Run workflow', exact: true});
    await run.waitFor(); expect(inputs).toEqual([]); expect(effects).toBe(0);
    await page.getByRole('spinbutton', {name: 'amount'}).fill('12');
    await page.getByRole('spinbutton', {name: 'amount'}).fill('');
    await run.click(); await page.getByText('Allow this workflow to run?', {exact: true}).waitFor();
    expect(inputs).toEqual([{enabled: false}]); expect(effects).toBe(0);
    await page.getByRole('button', {name: 'Decline', exact: true}).click(); await run.waitFor();
    expect(declined).toBe(1); expect(effects).toBe(0);
    expect(cancellations).toEqual([{viewId: 'view-1', invocationId: 'invocation-1'}]);
    await run.click(); await page.getByText('Allow this workflow to run?', {exact: true}).waitFor();
    expect(inputs).toEqual([{enabled: false}, {enabled: false}]); expect(launches).toEqual(['view-1', 'view-2']);
    await page.getByRole('button', {name: 'Allow once', exact: true}).click();
    await page.getByText('Opened completed', {exact: true}).waitFor();
    expect(effects).toBe(1); expect(launches).toEqual(['view-1', 'view-2', 'view-2']);
    approved = false; holdLaunch = true;
    await run.click(); await expect.poll(() => launches).toEqual(['view-1', 'view-2', 'view-2', 'view-3']);
    await page.getByRole('button', {name: 'Back to Apps', exact: true}).click();
    await page.getByText('Left apps', {exact: true}).waitFor();
    await expect.poll(() => cancellations).toContainEqual({viewId: 'view-3', invocationId: 'invocation-3'});
    releaseLaunch();
    expect(effects).toBe(1); expect(errors).toEqual([]);
  } finally {releaseLaunch(); await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));}
}, 30_000);
