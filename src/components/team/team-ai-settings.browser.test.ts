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
      import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
      import {TeamAiSection} from './src/components/team/team-ai-settings';
      window.calls = [];
      window.teamAiStatus = {enabled:true,state:'ready',authMode:'subscription',hasApiKey:false};
      createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><TeamAiSection /></QueryClientProvider>);
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env': '{"NODE_ENV":"development"}' },
    plugins: [{ name: 'isolated-team-ai-settings', setup(b) {
      b.onResolve({ filter: /lib\/trpc\/client$/ }, () => ({ path: 'api', namespace: 'fixture' }));
      b.onResolve({ filter: /team-context$/ }, () => ({ path: 'context', namespace: 'fixture' }));
      b.onResolve({ filter: /team-chat$/ }, () => ({ path: 'chat', namespace: 'fixture' }));
      b.onResolve({ filter: /ui\/confirm-dialog$/ }, () => ({ path: 'confirm', namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ loader: 'tsx', resolveDir: process.cwd(), contents:
        path === 'context' ? `export const useTeam=()=>({team:{name:'Acme'},member:{role:'owner'}});`
          : path === 'confirm' ? `export const useConfirm=()=>async()=>true;`
            : path === 'chat' ? `import {useQuery} from '@tanstack/react-query'; export const useTeamAiStatus=()=>useQuery({queryKey:['status'],queryFn:async()=>({...window.teamAiStatus})});`
              : `
                export const trpc={team:{ai:{status:{queryKey:()=>['status']},chats:{list:{queryKey:()=>['chats']}}}}};
                export const trpcClient={team:{ai:{
                  configure:{mutate:input=>new Promise((resolve,reject)=>{
                    window.calls.push(input);
                    window.finish=()=>{window.teamAiStatus={...window.teamAiStatus,...input,hasApiKey:window.teamAiStatus.hasApiKey||Boolean(input.apiKey)};delete window.teamAiStatus.apiKey;resolve({});};
                    window.fail=()=>reject(new Error('Save failed'));
                  })},
                  forgetKey:{mutate:async()=>{window.teamAiStatus.hasApiKey=false;}},
                  refreshAuth:{mutate:async()=>({})},setEnabled:{mutate:async()=>({})}
                }}};
              `,
      }));
    } }],
  });
  server = http.createServer((req, res) => {
    res.setHeader('content-type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/bundle.js' ? bundle.outputFiles[0].text : '<div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.RI_REVIEW_CHROMIUM });
}, 90_000);

afterAll(async () => {
  await browser?.close();
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
});

it.skipIf(!enabled)('requires an explicit save for API billing, clears the acknowledged key and can switch back or remove it', async () => {
  const page = await browser.newPage();
  page.setDefaultTimeout(5_000);
  try {
    await page.goto(address);
    const auth = page.getByRole('combobox', { name: 'Authentication' });
    const password = page.locator('input[type=password]');
    const save = page.getByRole('button', { name: 'Save authentication', exact: true });
    await auth.waitFor();
    expect(await auth.inputValue()).toBe('subscription');
    expect(await password.count()).toBe(0);
    await auth.selectOption('api_key');
    expect(await save.isDisabled()).toBe(true);
    expect(await page.evaluate('window.calls')).toEqual([]);
    await password.fill('sk-ant-browser-fixture');
    await save.click();
    await page.waitForFunction('window.calls.length === 1');
    expect(await password.isDisabled()).toBe(true);
    expect(await page.evaluate('window.calls[0]')).toEqual({ authMode: 'api_key', apiKey: 'sk-ant-browser-fixture' });
    await page.evaluate('window.finish()');
    await page.getByText('On. Uses the saved Anthropic API key.', { exact: true }).waitFor();
    expect(await password.inputValue()).toBe('');
    await auth.selectOption('subscription');
    await save.click();
    await page.waitForFunction('window.calls.length === 2');
    expect(await page.evaluate('window.calls[1]')).toEqual({ authMode: 'subscription' });
    await page.evaluate('window.finish()');
    await page.getByText('On. Uses the Claude Code subscription signed in on this team’s host.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Remove key', exact: true }).click();
    await page.getByRole('button', { name: 'Remove key', exact: true }).waitFor({ state: 'detached' });
    expect(await auth.inputValue()).toBe('subscription');
    expect(await password.count()).toBe(0);
  } finally { await page.close(); }
}, 20_000);

it.skipIf(!enabled)('retains an unacknowledged key after a failed save and leaves subscription active', async () => {
  const page = await browser.newPage();
  page.setDefaultTimeout(5_000);
  try {
    await page.goto(address);
    await page.getByRole('combobox', { name: 'Authentication' }).selectOption('api_key');
    const password = page.locator('input[type=password]');
    await password.fill('sk-ant-unsaved-fixture');
    await page.getByRole('button', { name: 'Save authentication', exact: true }).click();
    await page.waitForFunction('window.calls.length === 1');
    await page.evaluate('window.fail()');
    await page.getByRole('button', { name: 'Save authentication', exact: true }).waitFor();
    expect(await password.inputValue()).toBe('sk-ant-unsaved-fixture');
    expect(await page.evaluate('window.teamAiStatus.authMode')).toBe('subscription');
  } finally { await page.close(); }
}, 20_000);
