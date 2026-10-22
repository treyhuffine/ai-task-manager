import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

// RI_USAGE_BROWSER_TEST=1 pnpm exec vitest run src/components/dashboard/rate-limits-pill.browser.test.ts
const enabled = process.env.RI_USAGE_BROWSER_TEST === '1';
vi.setConfig({ testTimeout: 20_000 });
let browser: Browser;
let server: http.Server;
let address: string;

beforeAll(async () => {
  if (!enabled) return;
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
      import {RateLimitsPill} from './src/components/dashboard/rate-limits-pill';
      document.documentElement.className = location.search.includes('dark') ? 'dark' : '';
      createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><div style={{padding:16,display:'flex',height:56,borderBottom:'1px solid var(--border)'}}><RateLimitsPill/></div></QueryClientProvider>);
      `,
    },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env': '{"NODE_ENV":"production"}' },
    plugins: [{ name: 'usage-api-fixture', setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/(trpc\/client|realtime\/page-stream)$/ }, args => ({ path: args.path, namespace: 'usage-fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'usage-fixture' }, () => ({ loader: 'js', contents: `
        const f = window.usageFixture ??= {
          get:0, read:0, lastRead:0, listeners:new Set(),
          preference:JSON.parse(localStorage.getItem('usage-preference') ?? '{"usageWarnings":null}'),
          harnesses:['claude','codex'].map((harness,index)=>({harness,name:index?'Codex':'Claude Code',observedAt:new Date().toISOString(),buckets:[{id:index?'primary':'seven_day',durationMs:index?18000000:604800000,owner:{kind:'account'},applicability:{kind:'all_models'},observedAt:new Date().toISOString(),usedPercent:index?94:84,resetAt:new Date(Date.now()+3600000).toISOString()}]}))
        };
        const key = ['usage-fixture'];
        const snapshot = () => structuredClone({harnesses:f.harnesses,stale:Date.now()-f.lastRead>=120000});
        export const trpc = {harness:{rateLimitsGet:{queryKey:()=>key,queryOptions:()=>({queryKey:key,queryFn:async()=>{f.get++;return snapshot();}})},rateLimitsPost:{mutationOptions:options=>({mutationFn:async()=>{f.read++;f.lastRead=Date.now();for(const entry of f.harnesses){entry.observedAt=new Date().toISOString();for(const bucket of entry.buckets)bucket.observedAt=entry.observedAt;}return {...snapshot(),stale:false};},...options})}}};
        export const trpcClient = {userState:{list:{query:async()=>structuredClone(f.preference)},update:{mutate:async({body})=>{f.preference={...f.preference,...body};localStorage.setItem('usage-preference',JSON.stringify(f.preference));return structuredClone(f.preference);}}}};
        export const pageStream = () => ({subscribeGlobal(listener){f.listeners.add(listener);return ()=>f.listeners.delete(listener);}});
      ` }));
    } }],
  });
  const gallery = await fs.readFile(path.resolve('public/chat-ui-gallery/model-menu.html'), 'utf8');
  const css = gallery.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  server = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<style>${css}body{margin:0;background:var(--background);color:var(--foreground)}</style><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ headless: true });
}, 90_000);

afterAll(async () => {
  await browser?.close();
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
});

async function openPage(dark = false, width = 736) {
  const page = await browser.newPage({ viewport: { width, height: 460 } });
  await page.clock.install();
  page.setDefaultTimeout(5000);
  await page.goto(address + (dark ? '/?dark' : '/'));
  await page.waitForFunction('window.usageFixture?.read === 1');
  await page.getByRole('button', { name: /^Usage\./ }).waitFor();
  return page;
}

async function counts(page: Page) {
  return page.evaluate('({get:usageFixture.get,read:usageFixture.read})') as Promise<{ get: number; read: number }>;
}

it.skipIf(!enabled)('renders compact stacked marks in both themes, with keyboard and pinned hover access', async () => {
  await fs.mkdir('work/usage-alert-exploration', { recursive: true });
  for (const dark of [false, true]) {
    const page = await openPage(dark, 390);
    const button = page.getByRole('button', { name: /^Usage\./ });
    const logo = button.locator('svg[aria-label="Codex"]');
    expect(await logo.getAttribute('width')).toBe('12');
    const channels = await logo.evaluate(node => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d')!;
      context.fillStyle = getComputedStyle(node).fill;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
    });
    expect(channels).toEqual([122, 157, 255]);
    expect(await button.locator('.font-mono').first().evaluate(node => getComputedStyle(node).fontSize)).toBe('10px');
    await page.screenshot({ path: `work/usage-alert-exploration/implemented-${dark ? 'dark' : 'light'}.png` });
    await button.focus();
    await page.keyboard.press('Enter');
    const toggle = page.getByRole('switch', { name: 'Show usage warnings' });
    await toggle.waitFor();
    expect(await toggle.getAttribute('aria-checked')).toBe('true');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await expect.poll(() => button.evaluate(node => node === document.activeElement)).toBe(true);
    await button.hover();
    await page.getByRole('dialog').waitFor();
    await button.click();
    await page.mouse.move(350, 430);
    await page.waitForTimeout(200);
    expect(await page.getByRole('dialog').count()).toBe(1);
    await page.screenshot({ path: `work/usage-alert-exploration/implemented-card-${dark ? 'dark' : 'light'}.png` });
    await page.close();
  }
});

it.skipIf(!enabled)('polls every two minutes while visible, resumes immediately, and receives live usage', async () => {
  const page = await openPage();
  const initial = await counts(page);
  await page.clock.fastForward(119_000);
  expect((await counts(page)).read).toBe(initial.read);
  await page.clock.fastForward(1_100);
  await page.waitForFunction('usageFixture.read === 2');
  await page.evaluate("Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange',{bubbles:true}))");
  const hidden = await counts(page);
  await page.clock.fastForward(240_000);
  expect(await counts(page)).toEqual(hidden);
  await page.evaluate("Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange',{bubbles:true}))");
  await page.clock.runFor(50);
  await page.waitForFunction('usageFixture.read === 3');
  await page.evaluate("usageFixture.harnesses[1].buckets[0].usedPercent=97;for(const listener of usageFixture.listeners)listener('rate_limits_updated',{});");
  await page.clock.runFor(200);
  await page.getByRole('button', { name: /Codex, 5-hour, 97 percent/ }).waitFor();
  expect((await counts(page)).read).toBe(3);
  await page.close();
});

it.skipIf(!enabled)('persists the warning toggle while keeping usage accessible and pausing closed-card polling', async () => {
  const page = await openPage();
  await page.getByRole('button', { name: /^Usage\./ }).click();
  await page.getByRole('switch', { name: 'Show usage warnings' }).click();
  await page.getByRole('button', { name: 'Usage', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  const disabled = await counts(page);
  await page.clock.fastForward(240_000);
  expect(await counts(page)).toEqual(disabled);
  await page.reload();
  await page.getByRole('button', { name: 'Usage', exact: true }).waitFor();
  expect((await counts(page)).get).toBe(0);
  await page.getByRole('button', { name: 'Usage', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  expect(await page.getByRole('switch', { name: 'Show usage warnings' }).getAttribute('aria-checked')).toBe('false');
  await page.close();
});

it.skipIf(!enabled)('clears a badge at its reset time between provider polls', async () => {
  const page = await openPage();
  await page.evaluate("for(const entry of usageFixture.harnesses)for(const bucket of entry.buckets)bucket.resetAt=new Date(Date.now()+1000).toISOString();for(const listener of usageFixture.listeners)listener('rate_limits_updated',{});");
  await page.clock.runFor(200);
  await page.clock.runFor(1000);
  await page.getByRole('button', { name: 'Usage', exact: true }).waitFor();
  expect((await counts(page)).read).toBe(1);
  await page.close();
});
