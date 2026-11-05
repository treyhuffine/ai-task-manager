/** The real heartbeat settings in Chromium, in both hosts, with only data hooks and the model list replaced. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

interface FixtureWindow extends Window {
  patches: Record<string, unknown>[];
  setSaved: (patch: Record<string, unknown>) => void;
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
    import React, {useState} from 'react';
    const query=new URLSearchParams(location.search);
    const CHECK_INS=query.has('history')?[
      {runId:'r1',at:new Date().toISOString(),completedAt:null,status:'completed',outcome:'told',handOffFailed:false,chatSessionId:'c1',changedCount:2,summary:'Told Rye: The contract expires today.',errorMessage:null},
      {runId:'r2',at:new Date().toISOString(),completedAt:null,status:'completed',outcome:'quiet',handOffFailed:false,chatSessionId:'c2',changedCount:0,summary:'Nothing needed',errorMessage:null},
      {runId:'r3',at:new Date().toISOString(),completedAt:null,status:'failed',outcome:null,handOffFailed:false,chatSessionId:null,changedCount:0,summary:null,errorMessage:'Run exceeded 1800s timeout'},
    ]:[];
    const saved={triggerId:'heartbeat',enabled:query.has('on'),instructions:'Look at my tasks.',instructionsAreDefault:false,
      intervalSeconds:Number(query.get('seconds')||1800),activeHoursStart:query.get('start'),activeHoursEnd:query.get('end'),
      timezone:'America/Denver',provider:'claude',model:'opus',effort:null,serviceTier:null,deliverResultTo:[],
      nextCheckInAt:null,running:false,lastCheckIn:null,recentCheckIns:CHECK_INS,disabledReason:null,consecutiveFailures:0};
    let listener=null;
    let config=saved;
    window.patches=[];
    window.setSaved=(patch)=>{config={...config,...patch};listener?.(config);};
    export function useHeartbeat(){
      const [data,setData]=useState(config);
      listener=setData;
      return {data,isLoading:false,error:null};
    }
    export const useUpdateHeartbeat=()=>({isPending:false,mutate:(patch)=>{window.patches.push(patch);window.setSaved(patch);}});
    export const useCheckInNow=()=>({isPending:false,mutate:()=>{}});
    export const useUserState=()=>({data:{timezone:'America/Denver'}});
    export const useOrchestratorName=()=>'Rye';
    export const useHarnessModels=()=>({models:[{id:'opus',label:'Opus'}]});
    export const useDefaultSelection=()=>null;
    export const useSettingsLink=()=>null;
    export const useHomeStorageScope=()=>null;
    export const useLaptopHome=()=>null;
    export const closeSettings=()=>{};
    export const AwakeNote=()=>null;
    export const MakeDefaultRow=()=>null;
    export const ProviderIcon=()=>null;
    export const HarnessIcon=()=>null;
    export const useRouter=()=>({push:()=>{}});
    export default function Link({href,children,...rest}){return <a href={href} {...rest}>{children}</a>;}
    export function VisibleModelOptions(){
      return <div data-testid="model-list">{Array.from({length:40},(_,i)=><div key={i} className="px-3 py-1.5 text-sm">Model {i+1}</div>)}</div>;
    }
  `;
  const stubbed = [
    '@/hooks/use-heartbeat', '@/hooks/use-user-state', '@/hooks/use-harness-models', '@/hooks/use-default-selection',
    '@/components/settings/settings-destination', '@/components/home/home-context', '@/components/settings/settings-store',
    '@/components/triggers/awake-note', '@/components/settings/make-default-row', '@/components/settings/harness-connection-ui',
    '@/components/settings/visible-model-options', 'next/link', 'next/navigation',
  ];
  const stubFilter = new RegExp(`^(?:fixture-data|${stubbed.join('|')})$`);
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {Dialog} from '@/components/ui/dialog';
      import {Sheet,SheetContent,SheetHeader,SheetTitle,SheetDescription} from '@/components/ui/sheet';
      import {SettingsPanel} from '@/components/settings/settings-panel';
      import {HeartbeatSettings} from '@/components/heartbeat/heartbeat-settings';
      function App(){
        if(location.search.includes('sheet')) return <Sheet open><SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader><SheetTitle>Heartbeat</SheetTitle><SheetDescription>A check-in.</SheetDescription></SheetHeader>
          <div className="px-4 pb-6"><HeartbeatSettings compact onNavigate={()=>{}}/></div>
        </SheetContent></Sheet>;
        return <Dialog open><SettingsPanel title="Heartbeat" description="A check-in." navigation={<nav className="w-52 shrink-0 border-r border-border">Nav</nav>}>
          <HeartbeatSettings onNavigate={()=>{}}/>
        </SettingsPanel></Dialog>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
    plugins: [{ name: 'fixture-data', setup(api: {
      onResolve(options: { filter: RegExp }, callback: () => { path: string; namespace: string }): void;
      onLoad(options: { filter: RegExp; namespace: string }, callback: () => { contents: string; loader: string; resolveDir: string }): void;
    }) {
      api.onResolve({ filter: stubFilter }, () => ({ path: 'fixture-data', namespace: 'fixture' }));
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
  browser = await chromium.launch({ executablePath: process.env.RI_REVIEW_CHROMIUM, headless: true });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function open(query = '', viewport = { width: 1280, height: 720 }): Promise<Page> {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(3_000);
  await page.goto(`${base}/${query}`);
  await page.getByRole('switch', { name: 'Heartbeat' }).waitFor();
  return page;
}

const patches = (page: Page) => page.evaluate(() => (window as unknown as FixtureWindow).patches);
const every = (page: Page) => page.getByLabel('How often it checks in');
const unit = (page: Page) => page.getByLabel('Unit');

/**
 * The share of the open model menu a person can actually reach. It samples a
 * grid across the menu's box and asks the browser what's on top at each point,
 * so clipping by any ancestor counts, not just the menu's own size. It also
 * returns the gap to the button, since a menu can be whole but in the wrong place.
 */
async function openModelMenu(page: Page) {
  // The dialog's zoom animation has to finish before its box stops moving.
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: /^Model and settings/ }).click();
  const menu = page.locator('[data-slot="popover-content"]');
  await menu.getByTestId('model-list').waitFor();
  await page.waitForTimeout(100);
  return page.evaluate(() => {
    const el = document.querySelector('[data-slot="popover-content"]') as HTMLElement;
    const box = el.getBoundingClientRect();
    const button = document.querySelector('button[aria-label^="Model and settings"]')!.getBoundingClientRect();
    let hits = 0;
    const samples = 10;
    for (let x = 0; x < samples; x += 1) {
      for (let y = 0; y < samples; y += 1) {
        const at = document.elementFromPoint(box.left + ((x + 0.5) / samples) * box.width, box.top + ((y + 0.5) / samples) * box.height);
        if (at && el.contains(at)) hits += 1;
      }
    }
    return {
      reachable: hits / (samples * samples),
      insideViewport: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
      height: box.height,
      gap: Math.min(Math.abs(box.top - button.bottom), Math.abs(button.top - box.bottom)),
    };
  });
}

describe('the model menu shows whole', () => {
  it.each([
    ['in the settings dialog on a tall screen', '', { width: 1440, height: 1200 }],
    ['in the settings dialog', '', { width: 1280, height: 720 }],
    ['in a short settings dialog', '', { width: 1280, height: 480 }],
    ['in the settings dialog on a phone', '', { width: 390, height: 780 }],
    ['in the deck sheet', '?sheet', { width: 1280, height: 720 }],
  ] as const)('%s', async (_name, query, viewport) => {
    const page = await open(query, viewport);
    try {
      const menu = await openModelMenu(page);
      expect(menu.reachable).toBe(1);
      expect(menu.insideViewport).toBe(true);
      expect(menu.gap).toBeLessThan(12);
      expect(menu.height).toBeGreaterThan(100);
    } finally { await page.close(); }
  });

  it('scrolls its own long list with the wheel', async () => {
    const page = await open();
    try {
      await openModelMenu(page);
      const menu = page.locator('[data-slot="popover-content"]');
      await menu.hover();
      await page.mouse.wheel(0, 300);
      await expect.poll(() => menu.evaluate((el) => {
        const scrollers = [el, ...el.querySelectorAll('*')];
        return Math.max(...scrollers.map((node) => node.scrollTop));
      })).toBeGreaterThan(0);
    } finally { await page.close(); }
  });
});

describe('the on and off switch', () => {
  it('is named for what it turns on, and says what that means while off', async () => {
    const page = await open();
    try {
      await expect.poll(() => page.getByText('Check in regularly').count()).toBe(0);
      await page.getByText(/^Off\. When it's on, an agent goes through your work/).waitFor();
      await page.getByRole('switch', { name: 'Heartbeat' }).click();
      expect(await patches(page)).toEqual([{ enabled: true }]);
    } finally { await page.close(); }
  });
});

describe('recent check-ins', () => {
  it('says so when there are none', async () => {
    const page = await open();
    try {
      await page.getByText('Recent check-ins').waitFor();
      await page.getByText('None yet.').waitFor();
      expect(await page.getByRole('link', { name: 'History' }).getAttribute('href')).toBe('/triggers/heartbeat');
    } finally { await page.close(); }
  });

  it('lists what each one did, opens its chat, and links to what it changed', async () => {
    const page = await open('?history');
    try {
      const told = page.getByRole('link', { name: /The contract expires today/ });
      expect(await told.getAttribute('href')).toBe('/?session=c1');
      expect(await page.getByRole('link', { name: 'Changes (2)' }).getAttribute('href')).toBe('/runs/r1');
      await page.getByText('Nothing needed').waitFor();
      expect(await page.getByRole('link', { name: /^Changes/ }).count()).toBe(1);
      // A failed one that never got a chat still says why, with nothing to open.
      await page.getByText('Run exceeded 1800s timeout').waitFor();
      expect(await page.getByRole('link', { name: /1800s/ }).count()).toBe(0);
    } finally { await page.close(); }
  });

  it('no longer offers a report to read', async () => {
    const page = await open('?history');
    try {
      expect(await page.getByRole('button', { name: 'Report' }).count()).toBe(0);
    } finally { await page.close(); }
  });
});

describe('how often', () => {
  it('reads the saved interval in its largest whole unit', async () => {
    const page = await open('?seconds=7200');
    try {
      expect(await every(page).inputValue()).toBe('2');
      expect(await unit(page).locator('option:checked').textContent()).toBe('hours');
    } finally { await page.close(); }
  });

  it('saves a typed number when it is finished, not on every keystroke', async () => {
    const page = await open();
    try {
      expect(await every(page).inputValue()).toBe('30');
      await every(page).fill('45');
      expect(await patches(page)).toEqual([]);
      await every(page).press('Enter');
      expect(await patches(page)).toEqual([expect.objectContaining({ intervalSeconds: 2700 })]);
    } finally { await page.close(); }
  });

  it('keeps the number when the unit changes, and names one of a unit in the singular', async () => {
    const page = await open();
    try {
      await every(page).fill('1');
      await unit(page).selectOption('3600');
      expect(await patches(page)).toEqual([expect.objectContaining({ intervalSeconds: 3600 })]);
      expect(await every(page).inputValue()).toBe('1');
      expect(await unit(page).locator('option:checked').textContent()).toBe('hour');
    } finally { await page.close(); }
  });

  it('holds a number under the floor unsaved, says why, and lets the unit rescue it', async () => {
    const page = await open();
    try {
      await every(page).fill('2');
      // Still typing: this could be on its way to 20.
      expect(await page.getByRole('alert').count()).toBe(0);
      await every(page).blur();
      await page.getByText("At least 5 minutes. This one isn't saved.").waitFor();
      expect(await patches(page)).toEqual([]);
      // "2 hours" is on its way: the person typed the number first.
      await unit(page).selectOption({ label: 'hours' });
      expect(await patches(page)).toEqual([expect.objectContaining({ intervalSeconds: 7200 })]);
      expect(await page.getByText('At least 5 minutes').count()).toBe(0);
    } finally { await page.close(); }
  });

  it('goes back to the saved value when the number is left empty', async () => {
    const page = await open();
    try {
      await every(page).fill('');
      await every(page).blur();
      expect(await every(page).inputValue()).toBe('30');
      expect(await patches(page)).toEqual([]);
    } finally { await page.close(); }
  });

  it('stops at the floor when a smaller unit would go under it', async () => {
    const page = await open('?seconds=3600');
    try {
      await unit(page).selectOption('60');
      expect(await every(page).inputValue()).toBe('5');
      expect(await patches(page)).toEqual([expect.objectContaining({ intervalSeconds: 300 })]);
    } finally { await page.close(); }
  });

  it('takes a fraction, and leaves a number just typed as it was typed', async () => {
    const page = await open();
    try {
      await every(page).fill('120');
      await every(page).press('Enter');
      expect(await every(page).inputValue()).toBe('120');
      expect(await unit(page).locator('option:checked').textContent()).toBe('minutes');
      await unit(page).selectOption('3600');
      await every(page).fill('1.5');
      await every(page).press('Enter');
      expect((await patches(page)).at(-1)).toEqual(expect.objectContaining({ intervalSeconds: 5400 }));
      expect(await every(page).inputValue()).toBe('1.5');
    } finally { await page.close(); }
  });

  it('reads a fractional interval back in the unit that holds it', async () => {
    const page = await open('?seconds=5400');
    try {
      expect(await every(page).inputValue()).toBe('90');
      expect(await unit(page).locator('option:checked').textContent()).toBe('minutes');
    } finally { await page.close(); }
  });

  it('follows a change saved somewhere else', async () => {
    const page = await open();
    try {
      await page.evaluate(() => (window as unknown as FixtureWindow).setSaved({ intervalSeconds: 14400 }));
      await expect.poll(() => every(page).inputValue()).toBe('4');
      expect(await unit(page).locator('option:checked').textContent()).toBe('hours');
    } finally { await page.close(); }
  });

  it('keeps an interval only the API can set readable', async () => {
    const page = await open('?seconds=1830');
    try {
      expect(await every(page).inputValue()).toBe('1830');
      expect(await unit(page).locator('option:checked').textContent()).toBe('seconds');
    } finally { await page.close(); }
  });
});

describe('hours', () => {
  it('runs around the clock unless limited, with no times or timezone in the way', async () => {
    const page = await open();
    try {
      expect(await page.getByLabel('When it may check in').locator('option:checked').textContent()).toBe('24/7');
      expect(await page.getByLabel('From').count()).toBe(0);
      await page.getByLabel('When it may check in').selectOption({ label: 'Between' });
      expect(await patches(page)).toEqual([expect.objectContaining({ activeHoursStart: '09:00', activeHoursEnd: '21:00' })]);
      expect(await page.getByLabel('From').inputValue()).toBe('09:00');
      await page.getByLabel('When it may check in').selectOption({ label: '24/7' });
      expect((await patches(page))[1]).toEqual(expect.objectContaining({ activeHoursStart: null, activeHoursEnd: null }));
      expect(await page.getByLabel('From').count()).toBe(0);
    } finally { await page.close(); }
  });

  it('keeps hours someone already set', async () => {
    const page = await open('?start=08:00&end=18:00');
    try {
      expect(await page.getByLabel('When it may check in').locator('option:checked').textContent()).toBe('Between');
      expect(await page.getByLabel('From').inputValue()).toBe('08:00');
      expect(await page.getByLabel('To').inputValue()).toBe('18:00');
    } finally { await page.close(); }
  });
});
