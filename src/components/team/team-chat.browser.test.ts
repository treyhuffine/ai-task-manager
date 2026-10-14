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
      import { createRoot } from 'react-dom/client';
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
      import { TipProvider } from './src/components/ui/tip';
      import { TeamChat } from './src/components/team/team-chat';
      window.sends = [];
      window.pendingSends = [];
      window.pendingEvents = [];
      createRoot(document.getElementById('root')).render(
        <QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
          <TipProvider><TeamChat /></TipProvider>
        </QueryClientProvider>);
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env': '{"NODE_ENV":"development"}' }, loader: { '.css': 'empty' },
    plugins: [{
      name: 'isolated-team-chat-api',
      setup(b) {
        b.onResolve({ filter: /lib\/trpc\/client$/ }, () => ({ path: 'api', namespace: 'review' }));
        b.onResolve({ filter: /team-context$/ }, () => ({ path: 'context', namespace: 'review' }));
        b.onResolve({ filter: /ai-elements\/message$/ }, () => ({ path: 'message', namespace: 'review' }));
        b.onLoad({ filter: /.*/, namespace: 'review' }, ({ path }) => ({
          loader: 'tsx', resolveDir: process.cwd(), contents: path === 'api' ? `
            const status = {enabled:true,state:'ready',mainChatId:'A',reason:null};
            const chats = [{id:'A',label:'Chat A',main:true},{id:'B',label:'Chat B',main:false}];
            const option = (key, data) => ({queryOptions:()=>({queryKey:[key],queryFn:async()=>data})});
            export const trpc = {team:{ai:{status:option('status',status),chats:{list:option('chats',chats)}}}};
            export const trpcClient = {team:{ai:{
              events:{query:async ({chatId,after,before})=>{
                if (location.search.includes('held')) return new Promise(resolve => window.pendingEvents.push(resolve));
                const history = location.search.includes('history');
                const events = !history || after !== undefined ? [] : before === undefined
                  ? [{id:'recent',cursor:201,source:'user',content:'Recent message'}]
                  : [{id:'oldest',cursor:1,source:'user',content:'Earliest message'}];
                return {chat:chats.find(c=>c.id===chatId),events,turns:[],cursor:201,
                  oldestCursor:events[0]?.cursor??null,hasOlder:history&&before===undefined};
              }},
              chats:{create:{mutate:async()=>({id:'C',label:'Chat C'})}},
              send:{mutate:input=>new Promise((resolve,reject)=>{
                window.sends.push(input); window.pendingSends.push({resolve,reject});
              })},
              stop:{mutate:async()=>({ok:true})}
            }}};
          ` : path === 'context' ? `
            import {useState} from 'react';
            export const useTeam = ()=>({team:{id:'team',name:'Acme'},member:{id:'member',name:'Maya',role:'member'}});
            export function useTeamNav(){const [chatId,openChat]=useState('A');return {chatId,openChat};}
          ` : `export const MessageResponse = ({children}) => children;`,
        }));
      },
    }],
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

it.skipIf(!enabled)('keeps newer typing when an earlier send is acknowledged', async () => {
  const page = await browser.newPage();
  page.setDefaultTimeout(4_000);
  try {
    await page.goto(address);
    const input = page.getByRole('textbox', { name: 'Message to Team AI' });
    await input.fill('First message');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.waitForFunction('window.sends.length === 1');
    await input.fill('A newer draft');
    await page.evaluate('window.pendingSends[0].resolve({})');
    await page.getByRole('button', { name: 'Send', exact: true }).waitFor();
    expect(await input.inputValue()).toBe('A newer draft');
  } finally { await page.close(); }
}, 20_000);

it.skipIf(!enabled)('keeps drafts and retries with their original chat', async () => {
  const page = await browser.newPage();
  page.setDefaultTimeout(4_000);
  try {
    await page.goto(address);
    const input = page.getByRole('textbox', { name: 'Message to Team AI' });
    await input.fill('Draft A');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.waitForFunction('window.sends.length === 1');
    await page.evaluate('window.pendingSends[0].reject(new Error("Reply lost"))');
    await page.getByRole('button', { name: 'Retry', exact: true }).waitFor();
    await page.getByRole('combobox', { name: 'Chat', exact: true }).selectOption('B');
    expect(await input.inputValue()).toBe('');
    await input.fill('Draft B');
    await page.getByRole('combobox', { name: 'Chat', exact: true }).selectOption('A');
    expect(await input.inputValue()).toBe('Draft A');
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.waitForFunction('window.sends.length === 2');
    expect(await page.evaluate('window.sends[1]')).toEqual(await page.evaluate('window.sends[0]'));
    await page.evaluate('window.pendingSends[1].resolve({})');
  } finally { await page.close(); }
}, 20_000);

it.skipIf(!enabled)('lets members read history before the latest page', async () => {
  const page = await browser.newPage();
  page.setDefaultTimeout(4_000);
  try {
    await page.goto(`${address}?history`);
    await page.getByText('Recent message', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Load earlier messages' }).click();
    await page.getByText('Earliest message', { exact: true }).waitFor();
    expect(await page.getByText('Recent message', { exact: true }).count()).toBe(1);
    expect(await page.getByRole('button', { name: 'Load earlier messages' }).count()).toBe(0);
  } finally { await page.close(); }
}, 20_000);

it.skipIf(!enabled)('coalesces a send refresh while a transcript request is already in flight', async () => {
  const page = await browser.newPage();
  page.setDefaultTimeout(4_000);
  try {
    await page.goto(`${address}?held`);
    await page.waitForFunction('window.pendingEvents.length === 1');
    await page.getByRole('textbox', { name: 'Message to Team AI' }).fill('Refresh after send');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.waitForFunction('window.pendingSends.length === 1');
    await page.evaluate('window.pendingSends[0].resolve({})');
    await page.getByRole('button', { name: 'Send', exact: true }).waitFor();
    expect(await page.evaluate('window.pendingEvents.length')).toBe(1);
    await page.evaluate(`window.pendingEvents[0]({chat:{id:'A',label:'Chat A'},events:[],turns:[],cursor:0,oldestCursor:null,hasOlder:false})`);
    await page.waitForFunction('window.pendingEvents.length === 2');
  } finally { await page.close(); }
}, 20_000);
