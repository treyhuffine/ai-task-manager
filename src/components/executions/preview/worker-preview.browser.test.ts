import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';

const enabled = process.env.RI_SPACES_BROWSER_TEST === '1';
let browser: Browser, server: http.Server, address: string;
beforeAll(async () => {
  if (!enabled) return;
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
    import{usePreviewController}from'./src/components/executions/preview/use-preview-controller';import{PreviewView}from'./src/components/executions/preview/preview-view';import{RunView}from'./src/components/executions/preview/run-view';
    import{SettingsDestinationProvider}from'./src/components/settings/settings-destination';
    function App(){const[tab,setTab]=useState('preview');const c=usePreviewController('execution','agent');return <div className="flex h-dvh flex-col"><nav className="flex gap-4 border-b p-3"><button onClick={()=>setTab('run')}>Run tab</button><button onClick={()=>setTab('preview')}>Preview tab</button></nav><main className="min-h-0 flex-1">{tab==='run'?<RunView controller={c} onOpenPreview={()=>setTab('preview')}/>:<PreviewView controller={c} onOpenRun={()=>setTab('run')}/>}</main></div>}
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><SettingsDestinationProvider value={()=>null}><App/></SettingsDestinationProvider></QueryClientProvider>);
  ` }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env': '{"NODE_ENV":"development"}' },
    plugins: [{ name: 'server-preview-fixture', setup(b) {
      for (const [filter, name] of [[/home-context$/, 'home'], [/hooks\/use-workspaces$/, 'workspace'], [/lib\/trpc\/client$/, 'api'], [/preview\/resolve-iframe-src$/, 'reachability']] as const) b.onResolve({ filter }, () => ({ path: name, namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ loader: 'tsx', resolveDir: process.cwd(), contents: {
        reachability: `import{resolvePreviewSrc as resolve}from './src/lib/preview/resolve-iframe-src.ts';export{safePreviewUrl}from './src/lib/preview/resolve-iframe-src.ts';export const pickReachability=()=> 'remote'; export const resolvePreviewSrc=state=>resolve(state,{hostname:'remote.example.test',protocol:location.protocol,origin:location.origin});`,
        home: `export const useOptionalHomeContext=()=>({home:{id:'team',kind:'team'},viewer:{id:'member'},capabilities:{privatePlanning:false,configureAgents:new URLSearchParams(location.search).get('role')==='owner'}});export const useHomeStorageScope=()=>({homeId:'team',viewerId:'member'});`,
        workspace: `import{useQuery}from'@tanstack/react-query';export const useWorkspace=()=>useQuery({queryKey:['workspace'],queryFn:async()=>({id:'agent',startCommand:'pnpm dev',setupCommand:null})});export const useUpdateWorkspace=()=>({mutateAsync:async()=>{},isPending:false});`,
        api: `window.previewCalls=[];window.teamSettingsCalls=0;let status='idle',urls=[];
          const snapshot=()=>({executionId:'execution',service:null,previewName:'shared-app',assignedPort:43111,serverStatus:status,port:status==='running'?43111:null,message:null,localUrl:null,pinned:false,activeRemoteProviderId:'manual',activeRemoteProviderLabel:'Server preview',remoteUrl:urls[0]?.url??null,remoteError:null,manualUrls:urls,setupStatus:null,setupError:null,elsewhere:null});
          export const trpcClient={executions:{previewStatusGet:{query:async()=>snapshot()},previewStartPost:{mutate:async({body})=>{window.previewCalls.push(body);if(!body.resolveOnly)status='running';return snapshot();}},previewStopPost:{mutate:async()=>{status='stopped';return snapshot();}},previewUrlsPut:{mutate:async({body})=>{urls=body.urls;return{urls};}},previewLogsGet:{query:async()=>({cursor:1,lines:[{seq:1,at:'2026-10-20T00:00:00Z',stream:'stdout',line:'Team server app listening'}]})}},preview:{settingsGet:{query:async()=>{window.teamSettingsCalls++;return {providers:[],activeProvider:'manual',beamd:{connected:false}};}}}};const factory=path=>new Proxy(()=>{},{get:(_t,k)=>k==='queryKey'||k==='pathKey'?input=>[...path,input]:factory([...path,String(k)])});export const trpc=factory([]);`,
      }[path]! }));
    } }],
  });
  const require = createRequire(import.meta.url), postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
  const cssFile = path.resolve('src/app/globals.css');
  const css = await postcss([require('@tailwindcss/postcss')({ base: process.cwd() })]).process(fs.readFileSync(cssFile, 'utf8'), { from: cssFile });
  server = http.createServer((request, response) => { response.setHeader('content-type', request.url === '/bundle.js' ? 'text/javascript' : request.url === '/style.css' ? 'text/css' : 'text/html'); response.end(request.url === '/bundle.js' ? bundle.outputFiles[0].text : request.url === '/style.css' ? css.css : '<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.RI_REVIEW_CHROMIUM });
}, 90_000);
afterAll(async () => { await browser?.close(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); });

it.skipIf(!enabled).each([390, 1280])('shares Run and Preview at %ipx, starts only on request with the Team server settings', async width => {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.setDefaultTimeout(5000);
  await page.route('https://preview.example.test/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Shared preview fixture</h1>' }));
  try {
    await page.goto(address);
    await page.getByPlaceholder('https://abc.ngrok.app').waitFor();
    expect(await page.evaluate('window.previewCalls.length')).toBe(0); expect(await page.evaluate('window.teamSettingsCalls')).toBeGreaterThan(0);
    expect(await page.getByText(/Beamd/).count()).toBe(0);
    await page.getByRole('button', { name: 'Run tab', exact: true }).click();
    expect(await page.getByRole('button', { name: 'Edit command', exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await page.getByRole('button', { name: 'Stop', exact: true }).waitFor();
    if(width>=512)await page.getByText('localhost:43111', { exact: false }).waitFor();
    await page.getByText('Team server app listening', { exact: true }).waitFor();
    expect(await page.evaluate('window.previewCalls.filter(call=>!call.resolveOnly).length')).toBe(1);
    expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
    if (process.env.RI_ARTIFACT_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.RI_ARTIFACT_SCREENSHOTS, `worker-run-${width}.png`) });
    await page.getByRole('button', { name: 'Preview tab', exact: true }).click();
    await page.getByPlaceholder('https://abc.ngrok.app').fill(address + '/app');
    await page.getByRole('button', { name: 'Save URL', exact: true }).click();
    await page.getByText('Choose an HTTP or HTTPS preview URL on a different origin from Ri.', { exact: true }).waitFor();
    expect(await page.locator('iframe[title="Preview"]').count()).toBe(0);
    await page.getByPlaceholder('https://abc.ngrok.app').fill('https://preview.example.test/app');
    await page.getByRole('button', { name: 'Save URL', exact: true }).click();
    await page.frameLocator('iframe[title="Preview"]').getByText('Shared preview fixture').waitFor();
    expect(await page.evaluate('window.previewCalls.filter(call=>!call.resolveOnly).length')).toBe(1);
    expect(await page.getByRole('button', { name: 'Open on your phone', exact: true }).count()).toBe(0);
    expect(await page.evaluate('window.teamSettingsCalls')).toBeGreaterThan(0);
    if (process.env.RI_ARTIFACT_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.RI_ARTIFACT_SCREENSHOTS, `worker-preview-${width}.png`) });
    await page.getByRole('button', { name: 'Run tab', exact: true }).click();
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await page.getByRole('button', { name: 'Start', exact: true }).waitFor();
  } finally { await page.close(); }
}, 40_000);
