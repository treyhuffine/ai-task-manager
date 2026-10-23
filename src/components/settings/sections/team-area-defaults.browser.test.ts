import http from 'node:http';
import { build } from 'esbuild';
import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';

const enabled = process.env.RI_SPACES_BROWSER_TEST === '1';
let browser: Browser;
let server: http.Server;
let address: string;
beforeAll(async () => {
  if (!enabled) return;
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
      import {TeamAreaDefaults} from './src/components/settings/sections/team-area-defaults';
      window.calls=[];window.rules=[];
      createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><TeamAreaDefaults teamId="stable-team" connected /></QueryClientProvider>);
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env': '{"NODE_ENV":"development"}' },
    plugins: [{ name: 'private-defaults-fixture', setup(b) {
      const fixtures: Record<string, string> = {
        'use-areas': `export const useAreas=()=>({data:[{id:'family',name:'Family',status:'active'},{id:'travel',name:'Travel',status:'active'}]});`,
        'client-cache': `export const invalidateTeamContent=()=>{};`,
        'trpc/client': `
          const key=(name,input)=>[name,input];
          const procedure=(name,fn)=>({queryOptions:input=>({queryKey:key(name,input),queryFn:()=>fn(input)}),queryKey:input=>key(name,input)});
          const records=[{entityType:'task',id:'one',title:'New unorganized task',areaId:'family',requiresReview:false},{entityType:'note',id:'old',title:'Older note',areaId:'family',requiresReview:true}];
          export const trpc={spaces:{areaDefaults:{
            list:procedure('rules',()=>window.rules.slice()),sourceAreas:procedure('sources',()=>[{id:'source-travel',name:'Travel'}]),preview:procedure('preview',()=>{window.calls.push({operation:'preview'});return records;})
          }}};
          export const trpcClient={spaces:{areaDefaults:{
            set:{mutate:async input=>{window.calls.push({operation:'set',...input});window.rules=window.rules.filter(r=>r.sourceAreaId!==input.sourceAreaId);if(input.areaId)window.rules.push({...input,id:'rule'});return null;}},
            applyExisting:{mutate:async input=>{window.calls.push({operation:'apply',...input});return {changed:input.selected.length};}}
          }}};
        `,
      };
      b.onResolve({ filter: /.*/ }, (args) => {
        const key = Object.keys(fixtures).find((key) => args.path.endsWith('/' + key));
        return key ? { path: key, namespace: 'fixture' } : undefined;
      });
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: fixtures[path], loader: 'tsx', resolveDir: process.cwd() }));
    } }],
  });
  server = http.createServer((req, res) => {
    res.setHeader('content-type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/bundle.js' ? bundle.outputFiles[0].text : '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.RI_REVIEW_CHROMIUM });
}, 90_000);
afterAll(async () => { await browser?.close(); if (server) await new Promise<void>((resolve) => server.close(() => resolve())); });

it.skipIf(!enabled)('separates future defaults from explicit review and applies only the chosen references', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.goto(address);
    await page.getByRole('combobox', { name: 'Personal Area default for Whole team' }).selectOption('family');
    await page.waitForFunction('window.calls.some(c=>c.operation==="set")');
    expect(await page.evaluate('window.calls.filter(c=>c.operation==="apply"||c.operation==="preview")')).toEqual([]);
    await page.getByRole('button', { name: 'Review existing unorganized work' }).click();
    await page.getByText('New unorganized task → Family', { exact: true }).waitFor();
    expect(await page.getByRole('checkbox').count()).toBe(2);
    expect(await page.getByRole('checkbox').nth(0).isChecked()).toBe(false);
    expect(await page.getByRole('checkbox').nth(1).isChecked()).toBe(false);
    expect(await page.getByRole('button', { name: 'Apply to 0 selected' }).isDisabled()).toBe(true);
    await page.getByRole('checkbox').nth(0).check();
    await page.getByRole('button', { name: 'Apply to 1 selected' }).click();
    await page.waitForFunction('window.calls.some(c=>c.operation==="apply")');
    expect(await page.evaluate('window.calls.find(c=>c.operation==="apply")')).toEqual({ operation: 'apply', teamId: 'stable-team', sourceAreaId: null, selected: [{ entityType: 'task', id: 'one', areaId: 'family' }] });
  } finally { await page.close(); }
}, 20_000);
