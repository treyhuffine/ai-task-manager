import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { build } from 'esbuild';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';

const enabled = process.env.RI_ARTIFACT_BROWSER_TEST === '1';
let browser: Browser;
let server: http.Server;
let address: string;
let output: string;
const lists: { scope: { executionId: string }; cursor?: unknown }[] = [];
const reads: { sessionId: string; path: string }[] = [];
const item = (key: string, sessionId: string, chatLabel: string) => ({ key, name: key, source: { kind: 'session', sessionId, path: `out/${key}` }, sessionId, chatLabel, eventId: key, createdAt: '2026-11-01T00:00:00Z', mimeType: null });

beforeAll(async () => {
  if (!enabled) return;
  output = await fs.mkdtemp(path.join(os.tmpdir(), 'ri-artifacts-view-'));
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React,{useState,useEffect}from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
      import{ArtifactsView}from'./src/components/executions/workbench/artifacts-view';
      import{ArtifactPreviewProvider,useBesideRegion,useBesidePreview}from'./src/components/chat-ui/artifacts/artifact-preview-provider';
      import{BesideFileTab,BesideFileView}from'./src/components/chat-ui/artifacts/artifact-beside';
      import{TipProvider}from'./src/components/ui/tip';
      const client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});
      function View(){const[session,setSession]=useState('current');const[execution,setExecution]=useState('execution');const[active,setActive]=useState(false);const[fileShown,setFileShown]=useState(false);
        const file=useBesidePreview(execution);useBesideRegion(execution,{available:innerWidth>800,side:'right',showing:fileShown&&!!file,show:()=>setFileShown(true)});
        useEffect(()=>{if(!file)setFileShown(false)},[file]);
        return <main style={{height:'90vh',display:'flex',flexDirection:'column'}}>
          <nav><button onClick={()=>setActive(true)}>Artifacts</button><button onClick={()=>setSession('sibling')}>Other chat</button><button onClick={()=>setExecution('empty')}>Other execution</button>
          <BesideFileTab host={execution} active={fileShown} onSelect={()=>setFileShown(true)}/></nav>
          <div style={{flex:1,minHeight:0}}><div hidden={fileShown} style={{height:'100%'}}><ArtifactsView key={execution} sessionId={session} executionId={execution} active={active&&!fileShown} previewHost={execution}/></div>{fileShown&&file&&<BesideFileView host={execution}/>}</div>
        </main>}
      createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><TipProvider><ArtifactPreviewProvider><View/></ArtifactPreviewProvider></TipProvider></QueryClientProvider>);
    ` }, bundle: true, write: false, jsx: 'automatic', platform: 'browser', define: { 'process.env': '{"NODE_ENV":"production"}' },
    plugins: [{ name: 'fixture-client', setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/trpc\/client$/ }, () => ({ path: 'client', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', resolveDir: process.cwd(), contents: `
        import{createTRPCClient,httpLink}from'@trpc/client';import{createTRPCOptionsProxy}from'@trpc/tanstack-react-query';import{QueryClient}from'@tanstack/react-query';
        export const trpcClient=createTRPCClient({links:[httpLink({url:'/api/trpc'})]});export const terminalTRPCClient=trpcClient;
        const client=new QueryClient();export const trpc=createTRPCOptionsProxy({client:trpcClient,queryClient:()=>client});
      ` }));
    } }],
  });
  const css = (await fs.readFile('public/chat-ui-gallery/email.html', 'utf8')).match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  server = http.createServer((request, response) => {
    const url = new URL(request.url!, 'http://fixture');
    const input = JSON.parse(url.searchParams.get('input') || '{}');
    const answer = (data: unknown) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ result: { data } })); };
    if (url.pathname === '/bundle.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(bundle.outputFiles[0].text); return; }
    if (url.pathname === '/api/trpc/artifacts.list') {
      lists.push(input);
      answer(input.scope.executionId === 'empty' ? { items: [], nextCursor: null }
        : input.cursor ? { items: [item('older.csv', 'archived', 'Earlier research')], nextCursor: null }
          : { items: [item('latest.csv', 'current', 'Current chat'), item('latest.csv', 'archived', 'Earlier research')], nextCursor: { createdAt: '2026-11-01T00:00:00Z', id: 'older' } });
      return;
    }
    if (url.pathname === '/api/trpc/filePreviews.read') { reads.push(input); answer({ kind: 'table', sheets: [{ name: 'Sheet', rows: [['Item', 'Quantity'], ['Widget', '5']] }], truncated: false, source: 'Item,Quantity\nWidget,5' }); return; }
    if (url.pathname === '/api/session') { response.writeHead(204); response.end(); return; }
    if (url.pathname.startsWith('/api/')) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', 'text/html'); response.end(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/bundle.js"></script>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const executablePath = [process.env.RI_REVIEW_CHROMIUM, chromium.executablePath(), '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find(file => file && existsSync(file));
  browser = await chromium.launch({ executablePath, headless: true });
}, 90_000);
afterAll(async () => { await browser?.close(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); if (output) await fs.rm(output, { recursive: true, force: true }); });

it.skipIf(!enabled)('loads on demand, deduplicates, pages across chats, previews and returns, and shares cache between chat tabs', async () => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    const initial = lists.length;
    await page.goto(address);
    await page.getByRole('button', { name: 'Artifacts', exact: true }).waitFor();
    expect(lists.length).toBe(initial);
    await page.getByRole('button', { name: 'Artifacts', exact: true }).click();
    await page.getByRole('button', { name: 'Open artifact: latest.csv', exact: true }).waitFor();
    expect(await page.locator('[data-artifact-card]').count()).toBe(1);
    await page.getByRole('button', { name: 'Load older messages', exact: true }).click();
    await page.getByRole('button', { name: 'Open artifact: older.csv', exact: true }).waitFor();
    await page.getByRole('textbox', { name: 'Filter artifacts' }).fill('Earlier research');
    expect(await page.locator('[data-artifact-card]').count()).toBe(1);
    await page.getByRole('button', { name: 'Open artifact: older.csv', exact: true }).click();
    const beside = page.getByRole('region', { name: 'older.csv, beside the chat', exact: true });
    await beside.getByRole('cell', { name: 'Widget', exact: true }).waitFor();
    expect(reads.at(-1)).toMatchObject({ sessionId: 'archived', path: 'out/older.csv' });
    await page.getByRole('button', { name: 'Close older.csv', exact: true }).click();
    await page.getByRole('button', { name: 'Open artifact: older.csv', exact: true }).waitFor();
    const beforeSwitch = lists.length;
    await page.getByRole('button', { name: 'Other chat', exact: true }).click();
    expect(await page.getByRole('textbox', { name: 'Filter artifacts' }).inputValue()).toBe('Earlier research');
    expect(lists.length).toBe(beforeSwitch);
    await page.getByRole('button', { name: 'Other execution', exact: true }).click();
    await page.getByText('No artifacts yet', { exact: true }).waitFor();
    expect(await page.getByRole('textbox', { name: 'Filter artifacts' }).inputValue()).toBe('');
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it.skipIf(!enabled)('opens the same collection in the large viewer on a phone', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.goto(address);
    await page.getByRole('button', { name: 'Artifacts', exact: true }).click();
    await page.getByRole('button', { name: 'Open artifact: latest.csv', exact: true }).click();
    await page.getByRole('dialog').getByRole('cell', { name: 'Widget', exact: true }).waitFor();
    expect(await page.locator('body').evaluate(body => body.scrollWidth > innerWidth + 1)).toBe(false);
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Open artifact: latest.csv', exact: true }).waitFor();
  } finally { await page.close(); }
});
