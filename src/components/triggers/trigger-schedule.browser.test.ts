/** Real schedule controls in Chromium, with only data and harness controls replaced. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';

interface FixtureWindow extends Window {
  changes: Record<string, unknown>[];
  failSave: boolean;
  refreshTrigger: () => void;
}

let server: http.Server;
let browser: Browser;
let base: string;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const { build } = createRequire(require.resolve('tsx/package.json'))('esbuild');
  const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
  const css = await postcss([require('@tailwindcss/postcss')()]).process(
    fs.readFileSync('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') },
  );
  const fixture = `
    import React, {createContext, useContext, useState} from 'react';
    const Context=createContext(null);
    export function FixtureProvider({children}) {
      const kind=new URLSearchParams(location.search).get('kind') || 'cron';
      const [trigger,setTrigger]=useState({id:'fixture-job',name:'Daily briefing',kind,
        prompt:'Keep my instructions',enabled:false,timezone:'America/Denver',
        cronExpression:kind==='cron'?'0 9 * * *':null,intervalSeconds:kind==='every'?90:null,
        runAt:kind==='at'?(location.search.includes('fold')?'2030-11-03T08:30:45.000Z':'2030-10-20T15:30:00.000Z'):null,nextRunAt:null});
      window.refreshTrigger=()=>setTrigger(t=>({...t,prompt:'New instructions from another viewer'}));
      return <Context.Provider value={{trigger,setTrigger}}>{children}</Context.Provider>;
    }
    export const useFixture=()=>useContext(Context);
    export function useUpdateTrigger() {
      const {setTrigger}=useFixture();
      const [error,setError]=useState(null);
      return {isPending:false,error,mutate:(input,options)=>{
        if(window.failSave){setError(new Error('Schedule could not be saved'));return;}
        window.changes.push(input);setTrigger(t=>({...t,...input}));options?.onSuccess?.(input);
      }};
    }
    export const useCreateTrigger=()=>({isPending:false,error:null,mutate:(input,options)=>{
      window.changes.push(input);options.onSuccess({trigger:{id:'created',...input}});
    }});
    export const useWorkspaces=()=>({data:[{id:'agent-id',name:'Briefing agent',emoji:null}]});
    export const useUserState=()=>({data:{defaultHarness:'codex',defaultModel:'gpt-5.5'}});
    export const useHarnessModels=()=>({models:[{id:'gpt-5.5',label:'GPT-5.5'}]});
    export const ModelControl=()=>null;
    export const EffortControl=()=>null;
  `;
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {FixtureProvider,useFixture} from 'fixture-hooks';
      import {TriggerSchedule} from '@/components/triggers/trigger-schedule';
      import {TriggerCreateForm} from '@/components/triggers/trigger-create-form';
      window.changes=[];
      function App(){const {trigger}=useFixture();return <main className="mx-auto max-w-xl p-6">
        {location.search.includes('create')?<TriggerCreateForm onCreated={()=>{}} onCancel={()=>{}}/>:<TriggerSchedule trigger={trigger}/>}
      </main>;}
      createRoot(document.getElementById('root')).render(<FixtureProvider><App/></FixtureProvider>);
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
    plugins: [{ name: 'fixture-data', setup(api: {
      onResolve(options: { filter: RegExp }, callback: () => { path: string; namespace: string }): void;
      onLoad(options: { filter: RegExp; namespace: string }, callback: () => { contents: string; loader: string; resolveDir: string }): void;
    }) {
      api.onResolve({ filter: /^(?:fixture-hooks|@\/hooks\/use-(?:triggers|workspaces|user-state|harness-models)|@\/components\/workspaces\/launcher\/launch-controls)$/ },
        () => ({ path: 'fixture-hooks', namespace: 'fixture' }));
      api.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: fixture, loader: 'tsx', resolveDir: process.cwd() }));
    } }],
  });
  server = http.createServer((req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0]!.text); return; }
    if (req.url === '/app.css') { res.setHeader('Content-Type', 'text/css'); res.end(css.css); return; }
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({
    executablePath: chromium.executablePath(),
    headless: true,
  });
}, 30_000);

afterAll(async () => {
  await browser?.close();
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function open(query = ''): Promise<Page> {
  const page = await browser.newPage({ timezoneId: 'Asia/Tokyo', viewport: { width: 680, height: 1000 } });
  page.setDefaultTimeout(3_000);
  await page.goto(base + query);
  return page;
}

const changes = (page: Page) => page.evaluate(() => (window as unknown as FixtureWindow).changes);

it('edits cron through presets or a raw expression, validates input, and preserves a draft across refreshes', async () => {
  const page = await open();
  try {
    await page.getByRole('button', { name: 'Edit schedule' }).click();
    expect(await page.getByLabel('Frequency').inputValue()).toBe('daily');
    await page.getByLabel('Frequency').selectOption('weekly');
    await page.getByLabel('Day of week').selectOption('5');
    await page.getByLabel('Time', { exact: true }).fill('16:45');
    await page.evaluate(() => (window as unknown as FixtureWindow).refreshTrigger());
    expect(await page.getByLabel('Time', { exact: true }).inputValue()).toBe('16:45');
    await page.getByRole('button', { name: 'Save schedule' }).click();
    expect(await changes(page)).toEqual([{ id: 'fixture-job', cronExpression: '45 16 * * 5', timezone: 'America/Denver' }]);
    expect(await page.getByText('Weekly on Friday at 4:45 PM').isVisible()).toBe(true);
    await page.getByRole('button', { name: 'Edit schedule' }).click();
    await page.getByLabel('Frequency').selectOption('custom');
    await page.getByLabel('Cron expression').fill('bad cron');
    expect(await page.getByRole('button', { name: 'Save schedule' }).isDisabled()).toBe(true);
    expect(await page.getByRole('alert').textContent()).toContain('Expected 5 fields');
    await page.getByLabel('Cron expression').fill('*/15 9-17 * * 1-5');
    await page.getByLabel('Timezone').fill('Bad/Zone');
    expect(await page.getByRole('button', { name: 'Save schedule' }).isDisabled()).toBe(true);
    await page.getByLabel('Timezone').fill('Europe/London');
    await page.getByRole('button', { name: 'Save schedule' }).click();
    expect((await changes(page))[1]).toEqual({ id: 'fixture-job', cronExpression: '*/15 9-17 * * 1-5', timezone: 'Europe/London' });
  } finally { await page.close(); }
});

it('edits a one-time calendar date in its saved timezone and keeps failures retryable', async () => {
  const page = await open('?kind=at');
  try {
    await page.getByRole('button', { name: 'Edit schedule' }).click();
    expect(await page.getByLabel('Date', { exact: true }).inputValue()).toBe('2030-10-20');
    expect(await page.getByLabel('Time', { exact: true }).inputValue()).toBe('09:30');
    await page.getByLabel('Date', { exact: true }).fill('2020-01-01');
    expect(await page.getByRole('button', { name: 'Save schedule' }).isDisabled()).toBe(true);
    await page.getByLabel('Date', { exact: true }).fill('2030-12-20');
    await page.getByLabel('Time', { exact: true }).fill('14:15');
    await page.evaluate(() => { (window as unknown as FixtureWindow).failSave = true; });
    await page.getByRole('button', { name: 'Save schedule' }).click();
    expect(await page.getByRole('alert').textContent()).toContain('could not be saved');
    expect(await page.getByLabel('Date', { exact: true }).inputValue()).toBe('2030-12-20');
    await page.evaluate(() => { (window as unknown as FixtureWindow).failSave = false; });
    await page.getByRole('button', { name: 'Save schedule' }).click();
    expect(await changes(page)).toEqual([{ id: 'fixture-job', cronExpression: null, runAt: '2030-12-20T21:15:00.000Z', timezone: 'America/Denver' }]);
  } finally { await page.close(); }
});

it('cancels without saving and edits existing intervals without changing their kind', async () => {
  const page = await open('?kind=every');
  try {
    await page.getByRole('button', { name: 'Edit schedule' }).click();
    expect(await page.getByLabel('Interval (seconds)').inputValue()).toBe('90');
    await page.getByLabel('Interval (seconds)').fill('120');
    await page.getByRole('button', { name: 'Cancel' }).click();
    expect(await changes(page)).toEqual([]);
    await page.getByRole('button', { name: 'Edit schedule' }).click();
    expect(await page.getByLabel('Interval (seconds)').inputValue()).toBe('90');
    await page.getByLabel('Interval (seconds)').fill('120');
    await page.getByRole('button', { name: 'Save schedule' }).click();
    expect(await changes(page)).toEqual([{ id: 'fixture-job', cronExpression: null, intervalSeconds: 120, timezone: 'America/Denver' }]);
  } finally { await page.close(); }
});

it('preserves the saved instant when re-saving a one-time job in a repeated daylight saving hour', async () => {
  const page = await open('?kind=at&fold');
  try {
    await page.getByRole('button', { name: 'Edit schedule' }).click();
    expect(await page.getByLabel('Time', { exact: true }).inputValue()).toBe('01:30');
    expect(await page.getByText(/Sun, Nov 3, 2030, 1:30 AM MST/).isVisible()).toBe(true);
    await page.getByRole('button', { name: 'Save schedule' }).click();
    expect((await changes(page))[0]?.runAt).toBe('2030-11-03T08:30:45.000Z');
  } finally { await page.close(); }
});

it('creates a one-time job using the calendar and time picker, and fits a narrow screen', async () => {
  const page = await open('?create');
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByLabel('Name', { exact: false }).fill('One-time briefing');
    await page.getByLabel('Description', { exact: false }).fill('Prepare before the meeting');
    await page.getByPlaceholder("Check my calendar for today's meetings", { exact: false }).fill('Prepare the briefing.');
    await page.getByLabel('Frequency').selectOption('once');
    await page.getByLabel('Date', { exact: true }).fill('2030-10-20');
    await page.getByLabel('Time', { exact: true }).fill('09:30');
    await page.getByLabel('Timezone').fill('America/Denver');
    expect(await page.getByText('Runs once', { exact: true }).isVisible()).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (process.env.RI_SCHEDULE_SCREENSHOT) await page.screenshot({ path: process.env.RI_SCHEDULE_SCREENSHOT, fullPage: true });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    expect(await changes(page)).toEqual([expect.objectContaining({
      name: 'One-time briefing', kind: 'at', runAt: '2030-10-20T15:30:00.000Z',
      cronExpression: null, intervalSeconds: null, timezone: 'America/Denver', workspaceId: 'agent-id',
    })]);
  } finally { await page.close(); }
});
