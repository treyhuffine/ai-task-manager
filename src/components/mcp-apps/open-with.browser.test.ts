import { expect, it } from 'vitest';
import { build } from 'esbuild';
import { chromium, type Page } from 'playwright-core';
import http from 'node:http';
import { fileAppsFor } from './open-with';

/**
 * Open with, for a chat attachment that a connected app's file entrypoint
 * (OpenAI's MCP extensions spec) handles: Bits & Bolts and an STL part. The
 * real chip, inside a chat's companion pane, against a synthetic API. Opening
 * takes a host handle, never a path, launches through approval, and shows the
 * file viewer beside that chat. A file no app handles, and a chip outside a
 * chat, offer nothing.
 */
const bundle = () => build({
  stdin: {resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
    import {MessageFileChip} from '@/components/chat-ui/artifacts/message-file-chip';
    import {ConnectedCompanionContext} from '@/lib/client/mcp-app-panel';
    import {ArtifactPreviewProvider} from '@/components/chat-ui/artifacts/artifact-preview-provider';
    import {TipProvider} from '@/components/ui/tip';
    window.opened = [];
    const file = (fileName, originalName, mimeType) => ({fileName, originalName, mimeType, size: 1200, uploadedAt: '2026-10-19T12:00:00.000Z'});
    const companion = {chatId: 'chat-1', captureId: null, open: id => window.opened.push(id), mount: null, register: () => () => {}};
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><TipProvider><ArtifactPreviewProvider>
      <section aria-label="In a chat"><ConnectedCompanionContext.Provider value={companion}>
        <p>Here is the bracket <MessageFileChip attachment={file('01a1-bracket.stl', 'bracket.stl', 'application/octet-stream')}/></p>
        <p>And the notes <MessageFileChip attachment={file('01a1-notes.csv', 'notes.csv', 'application/octet-stream')}/></p>
      </ConnectedCompanionContext.Provider></section>
      <section aria-label="Published"><MessageFileChip attachment={file('01a1-shared.stl', 'shared.stl', 'application/octet-stream')}/></section>
    </ArtifactPreviewProvider></TipProvider></QueryClientProvider>);
  `},
  bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
  define: {'process.env.NODE_ENV': '"development"', 'process.env': '{}'},
  plugins: [{name: 'isolate-chip', setup(builder) {
    builder.onResolve({filter: /contexts\/dashboard-context$/}, () => ({path: 'dashboard', namespace: 'fixture'}));
    builder.onLoad({filter: /.*/, namespace: 'fixture'}, () => ({loader: 'tsx', contents: 'export const useOptionalDashboard = () => null;'}));
  }}],
});

const bitsAndBolts = {id: 'bnb', name: 'Bits & Bolts', toolkitName: 'Bits & Bolts', account: 'Bits & Bolts', sourceRef: null, available: true, icons: [], standalone: true,
  entrypoints: [], threads: [], settings: true, mentions: true, views: [], recent: [],
  files: [{name: 'cad.open', title: 'Bits & Bolts CAD viewer', icons: [], extensions: ['.stl', '.3mf', '.step', '.stp']}]};

async function serve(handle: (method: string, input: Record<string, unknown>) => Promise<unknown>) {
  const code = (await bundle()).outputFiles[0].text;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://fixture');
    if (url.pathname.startsWith('/api/trpc/')) {
      let body = ''; for await (const chunk of req) body += chunk;
      const input = JSON.parse(body || url.searchParams.get('input') || '{}');
      const method = url.pathname.slice('/api/trpc/'.length);
      let data: unknown;
      if (method === 'connectedApps.catalog') data = [bitsAndBolts];
      else if (method === 'transport.capabilities') data = {websocket: false};
      else data = await handle(method, input);
      if (data === undefined) {res.statusCode = 500; res.end(`Unexpected operation ${method}`); return;}
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({result: {data}})); return;
    }
    if (url.pathname === '/fixture.js') {res.setHeader('content-type', 'text/javascript'); res.end(code); return;}
    res.setHeader('content-type', 'text/html'); res.end('<html><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return {server, origin: `http://127.0.0.1:${(server.address() as {port: number}).port}`};
}
const read = <T,>(page: Page, name: string) => page.evaluate(key => (window as unknown as Record<string, unknown>)[key], name) as Promise<T>;

it('lists the apps that open a file by its extension, naming the account only when a product has several', () => {
  const second = {...bitsAndBolts, id: 'bnb-2', account: 'Workshop'};
  expect(fileAppsFor([bitsAndBolts] as never, 'Bracket.STL').map(app => app.label)).toEqual(['Bits & Bolts']);
  expect(fileAppsFor([bitsAndBolts, second] as never, 'bracket.stl').map(app => app.label)).toEqual(['Bits & Bolts · Bits & Bolts', 'Bits & Bolts · Workshop']);
  expect(fileAppsFor([{...bitsAndBolts, available: false}] as never, 'bracket.stl')).toEqual([]);
  expect(fileAppsFor([bitsAndBolts] as never, 'notes.csv')).toEqual([]);
  expect(fileAppsFor([bitsAndBolts] as never, 'stl')).toEqual([]);
});

it('opens a chat attachment with its app beside the chat, through approval, by handle', async () => {
  const calls: {method: string; input: Record<string, unknown>}[] = [];
  let approved = false;
  const {server, origin} = await serve(async (method, input) => {
    calls.push({method, input});
    if (method === 'connectedApps.files.handle') return {handle: 'handle-1', name: 'bracket.stl'};
    if (method === 'connectedApps.prepare') return {kind: 'launch', viewId: 'view-1', invocationId: 'capture-1'};
    if (method === 'connectedApps.launch') return approved ? {kind: 'opened', captureId: 'capture-1'} : {kind: 'approval', viewId: 'view-1', ids: ['pending'], preview: {tool: 'cad.open'}};
    if (method === 'connectedApps.approval') { approved = input.approve === true; return null; }
    return undefined;
  });
  const browser = await chromium.launch({executablePath: chromium.executablePath(), headless: true, chromiumSandbox: true});
  try {
    const page = await browser.newPage(), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    const chat = page.getByRole('region', {name: 'In a chat'});
    await chat.getByRole('button', {name: 'Open with Bits & Bolts'}).waitFor();
    // Only the part has an app. The CSV has none, and a chip outside a chat offers nothing.
    expect(await chat.getByRole('button', {name: /Open with/}).count()).toBe(1);
    expect(await page.getByRole('region', {name: 'Published'}).getByRole('button', {name: /Open with/}).count()).toBe(0);

    await chat.getByRole('button', {name: 'Open with Bits & Bolts'}).click();
    await page.getByRole('group', {name: 'Allow Bits & Bolts to open bracket.stl'}).waitFor();
    await page.getByRole('button', {name: 'Allow once'}).click();
    await expect.poll(() => read(page, 'opened')).toEqual(['capture-1']);
    expect(calls.map(call => call.method)).toEqual(['connectedApps.files.handle', 'connectedApps.prepare', 'connectedApps.launch', 'connectedApps.approval', 'connectedApps.launch']);
    // The handle names the stored attachment. The app gets an opaque URI from the server, never a path.
    expect(calls[0].input).toEqual({kind: 'attachment', fileName: '01a1-bracket.stl', name: 'bracket.stl'});
    expect(calls[1].input).toEqual({serverId: 'bnb', name: 'cad.open', kind: 'file', file: {handle: 'handle-1'}, chatId: 'chat-1'});
    expect(errors).toEqual([]);
  } finally {await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));}
}, 30_000);
