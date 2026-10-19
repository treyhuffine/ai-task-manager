import { expect, it } from 'vitest';
import { build } from 'esbuild';
import { chromium, type Page } from 'playwright-core';
import http from 'node:http';
import { encodeSource } from '@/lib/chat-sources/reference';

/**
 * The connected app page against a synthetic API: chat is where a service is
 * used, so the page has no tool forms. Try in chat hands the main chat the
 * service's chip and starter prompt. A standalone screen (a global entrypoint)
 * opens full screen with no inputs, through approval, from Open app or from a
 * launch in the URL (the flyout and ⌘K), and cancels when left.
 */
const bundle = () => build({
  stdin: {resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
    import {ConnectedAppPage} from '@/components/mcp-apps/page';
    import {receiveChatSources} from '@/lib/client/source-handoff';
    window.offers = []; window.dashboard = []; window.routes = [];
    receiveChatSources('main-chat', offer => { window.offers.push(offer); return true; });
    const at = new URL(location.href);
    function Fixture() {
      // The Apps shell: the route and its query, keyed so a new launch is a fresh page.
      const [view, setView] = useState({server: at.searchParams.get('server'), query: Object.fromEntries([...at.searchParams].filter(([key]) => key !== 'server'))});
      const navigate = (value, options) => {
        window.routes.push(value + (options?.replace ? ' (replace)' : ''));
        const next = new URL(value, 'https://app.invalid/');
        setView({server: next.pathname.startsWith('/~connected/') ? next.pathname.slice(12) : null, query: Object.fromEntries(next.searchParams)});
      };
      return view.server ? <ConnectedAppPage key={view.server + ':' + (view.query.open ?? '')} serverId={view.server} navigate={navigate}
        resultId={view.query.result} screenId={view.query.screen} launch={view.query.open}/> : <p>Left apps</p>;
    }
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><Fixture/></QueryClientProvider>);
  `},
  bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
  define: {'process.env.NODE_ENV': '"development"', 'process.env': '{}'},
  plugins: [{name: 'isolate-page', setup(builder) {
    builder.onResolve({filter: /contexts\/dashboard-context$/}, () => ({path: 'dashboard', namespace: 'fixture'}));
    builder.onResolve({filter: /^\.\/view$/}, args => args.importer.endsWith('/mcp-apps/page.tsx') ? {path: 'view', namespace: 'fixture'} : undefined);
    builder.onLoad({filter: /.*/, namespace: 'fixture'}, args => ({loader: 'tsx', resolveDir: process.cwd(), contents: args.path === 'dashboard'
      ? `const record = name => () => window.dashboard.push(name);
         export const useDashboard = () => ({goHome: record('home'), showPanelTab: tab => window.dashboard.push('tab:' + tab), setMobileTab: () => {}, isFocusMode: false, exitFocusMode: () => {}});
         export const useOptionalDashboard = () => null;`
      : 'export const ConnectedView=({captureId, chatId, expanded})=><p>{expanded ? "Full screen" : "Opened"} {captureId} for {chatId ?? "no chat"}</p>;'}));
  }}],
});

const todoistRef = encodeSource({v: 1, kind: 'integration', toolkitId: 'todoist', account: {accountId: 'todoist:default', authConfigId: null}});
const todoist = {id: 'todoist-server', name: 'Todoist', toolkitName: 'Todoist', providerId: 'todoist', account: 'trey@example.com', sourceRef: todoistRef, available: true,
  standalone: false, entrypoints: [], views: [{name: 'find-tasks-by-date', title: 'Find tasks by date'}],
  recent: [{id: 'older', chatId: 'chat-1', title: 'Todoist · Find tasks by date', created: Date.now() - 20 * 60_000, launched: false}, {id: 'newer', chatId: 'chat-1', title: 'Todoist · Find tasks by date', created: Date.now() - 60_000, launched: false}]};
const canvas = {id: 'canvas-server', name: 'Canvas', toolkitName: 'Canvas', account: 'Canvas', sourceRef: null, available: true,
  standalone: true, entrypoints: [{name: 'open-canvas', title: 'Canvas'}], views: [],
  recent: [{id: 'earlier-screen', title: 'Canvas · Canvas', created: Date.now() - 5 * 60_000, launched: true}]};

async function serve(handle: (method: string, input: Record<string, unknown>) => Promise<unknown>) {
  const code = (await bundle()).outputFiles[0].text;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://fixture');
    if (url.pathname.startsWith('/api/trpc/')) {
      let body = ''; for await (const chunk of req) body += chunk;
      const input = JSON.parse(body || url.searchParams.get('input') || '{}');
      const method = url.pathname.slice('/api/trpc/'.length);
      let data: unknown;
      if (method === 'connectedApps.catalog') data = [todoist, canvas];
      else if (method === 'orchestratorChat.list') data = {session: {id: 'main-chat'}};
      // The client's own probe for a WebSocket link. Plain HTTP serves the fixture.
      else if (method === 'transport.capabilities') data = {websocket: false};
      else data = await handle(method, input);
      if (data === undefined) {res.statusCode = 500; res.end(`Unexpected operation ${method}`); return;}
      if (data instanceof Error) {res.statusCode = 500; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({error: {message: data.message, code: -32603, data: {code: 'INTERNAL_SERVER_ERROR', httpStatus: 500}}})); return;}
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({result: {data}})); return;
    }
    if (url.pathname === '/fixture.js') {res.setHeader('content-type', 'text/javascript'); res.end(code); return;}
    res.setHeader('content-type', 'text/html'); res.end('<html><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return {server, origin: `http://127.0.0.1:${(server.address() as {port: number}).port}`};
}
const read = <T,>(page: Page, name: string) => page.evaluate(key => (window as unknown as Record<string, unknown>)[key], name) as Promise<T>;

it('uses a result-only service from chat: no forms, Try in chat writes the mention and starter prompt, recent results reopen', async () => {
  const calls: string[] = [];
  const {server, origin} = await serve(async method => { calls.push(method); return undefined; });
  const browser = await chromium.launch({executablePath: chromium.executablePath(), headless: true, chromiumSandbox: true});
  try {
    const page = await browser.newPage(), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/?server=todoist-server`);
    await page.getByRole('heading', {name: 'Todoist', exact: true}).waitFor();
    await page.getByText('trey@example.com', {exact: true}).waitFor();
    // The forms and their run path are gone, and a result-only service has nothing to open on its own.
    expect(await page.getByRole('button', {name: /Run workflow|Open app/}).count()).toBe(0);
    expect(await page.locator('form, textarea, input').count()).toBe(0);
    await page.getByText('“What’s on my list today?”', {exact: true}).waitFor();

    await page.getByRole('button', {name: 'Try in chat', exact: true}).click();
    await expect.poll(() => read(page, 'offers')).toEqual([{sourceRef: todoistRef, prompt: 'What’s on my list today?'}]);
    expect(await read(page, 'dashboard')).toEqual(['home', 'tab:chat']);

    // Newest first. Opening one shows it on the page, and opening it again closes it.
    const rows = page.getByRole('button', {name: /Todoist · Find tasks by date/});
    expect(await rows.allInnerTexts()).toEqual([expect.stringContaining('1 min ago'), expect.stringContaining('20 min ago')]);
    await rows.first().click();
    await page.getByText('Opened newer for chat-1', {exact: true}).waitFor();
    await rows.first().click();
    expect(await page.getByText('Opened newer for chat-1').count()).toBe(0);
    expect(calls).toEqual([]); expect(errors).toEqual([]);

    // A chip's Open lands here with that result already open.
    await page.goto(`${origin}/?server=todoist-server&result=older`);
    await page.getByText('Opened older for chat-1', {exact: true}).waitFor();
    // A result-only service asked to launch says so plainly, with no form.
    await page.goto(`${origin}/?server=todoist-server&open=home`);
    await page.getByText('Todoist has no screen to open on its own. Try it in chat instead.', {exact: true}).waitFor();
    expect(calls).toEqual([]);
  } finally {await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));}
}, 30_000);

it('opens a standalone screen full screen with no inputs, through approval, and cancels declined or abandoned launches', async () => {
  const prepared: unknown[] = [], launches: string[] = [], cancellations: unknown[] = [];
  let approved = false, effects = 0, declined = 0, holdLaunch = false;
  let releaseLaunch!: () => void;
  const delayedLaunch = new Promise<void>(resolve => {releaseLaunch = resolve;});
  const {server, origin} = await serve(async (method, input) => {
    if (method === 'connectedApps.prepare') {prepared.push(input); return {viewId: `view-${prepared.length}`, invocationId: `invocation-${prepared.length}`};}
    if (method === 'connectedApps.launch') {
      launches.push(input.viewId as string);
      if (holdLaunch) await delayedLaunch;
      if (approved) {effects++; return {kind: 'opened', captureId: `screen-${effects}`};}
      return {kind: 'approval', viewId: input.viewId, ids: ['pending'], preview: {operation: 'Open canvas'}};
    }
    if (method === 'connectedApps.approval') {approved = input.approve as boolean; if (!approved) declined++; return null;}
    if (method === 'connectedApps.cancel') {cancellations.push(input); return null;}
    return undefined;
  });
  const browser = await chromium.launch({executablePath: chromium.executablePath(), headless: true, chromiumSandbox: true});
  try {
    const page = await browser.newPage(), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/?server=canvas-server`);
    const open = page.getByRole('button', {name: 'Open app', exact: true});
    await open.waitFor(); expect(prepared).toEqual([]); expect(effects).toBe(0);
    await page.getByText('What can you do with Canvas?', {exact: false}).waitFor();

    await open.click(); await page.getByText('Allow Canvas to open Canvas?', {exact: true}).waitFor();
    // The page names only the entrypoint. The server opens it with `{}`.
    expect(prepared).toEqual([{serverId: 'canvas-server', name: 'open-canvas'}]); expect(effects).toBe(0);
    await page.getByRole('button', {name: 'Decline', exact: true}).click(); await open.waitFor();
    expect(declined).toBe(1); expect(effects).toBe(0);
    expect(cancellations).toEqual([{viewId: 'view-1', invocationId: 'invocation-1'}]);

    await open.click(); await page.getByText('Allow Canvas to open Canvas?', {exact: true}).waitFor();
    await page.getByRole('button', {name: 'Allow once', exact: true}).click();
    // It fills the page, and the URL now names the screen rather than a launch.
    await page.getByText('Full screen screen-1 for no chat', {exact: true}).waitFor();
    expect(await page.getByRole('heading', {name: 'Canvas'}).count()).toBe(0);
    expect(effects).toBe(1); expect(launches).toEqual(['view-1', 'view-2', 'view-2']);
    expect(await read(page, 'routes')).toEqual(['~connected/canvas-server?screen=screen-1 (replace)']);

    // Back to the page. Its earlier screen reopens full screen without running anything.
    await page.getByRole('button', {name: 'Canvas', exact: true}).click();
    await page.getByRole('heading', {name: 'Canvas'}).waitFor();
    await page.getByRole('button', {name: /Canvas · Canvas/}).click();
    await page.getByText('Full screen earlier-screen for no chat', {exact: true}).waitFor();
    expect(launches).toHaveLength(3);

    // The flyout and ⌘K launch it straight away. Leaving while it opens cancels it.
    approved = false; holdLaunch = true;
    await page.goto(`${origin}/?server=canvas-server&open=open-canvas`);
    await page.getByText('Opening Canvas…', {exact: true}).waitFor();
    await expect.poll(() => launches.length).toBe(4);
    await page.getByRole('button', {name: 'Canvas', exact: true}).click();
    await page.getByRole('heading', {name: 'Canvas'}).waitFor();
    await expect.poll(() => cancellations).toContainEqual({viewId: 'view-3', invocationId: 'invocation-3'});
    releaseLaunch();
    expect(effects).toBe(1); expect(errors).toEqual([]);
  } finally {releaseLaunch(); await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));}
}, 30_000);

it('shows an entrypoint that rejects {} as a plain error, and tries again as a new request', async () => {
  let attempts = 0;
  const {server, origin} = await serve(async method => {
    if (method === 'connectedApps.prepare') return {viewId: `view-${++attempts}`, invocationId: `invocation-${attempts}`};
    if (method === 'connectedApps.launch') return attempts === 1 ? new Error('Invalid arguments: project is required') : {kind: 'opened', captureId: 'screen-ok'};
    if (method === 'connectedApps.cancel') return null;
    return undefined;
  });
  const browser = await chromium.launch({executablePath: chromium.executablePath(), headless: true, chromiumSandbox: true});
  try {
    const page = await browser.newPage(), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/?server=canvas-server&open=open-canvas`);
    await page.getByText('Canvas could not open', {exact: true}).waitFor();
    await page.getByText('Invalid arguments: project is required', {exact: true}).waitFor();
    expect(await page.locator('form, textarea, input').count()).toBe(0);
    await page.getByRole('button', {name: 'Try again', exact: true}).click();
    await page.getByText('Full screen screen-ok for no chat', {exact: true}).waitFor();
    expect(attempts).toBe(2); expect(errors).toEqual([]);
  } finally {await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));}
}, 30_000);
