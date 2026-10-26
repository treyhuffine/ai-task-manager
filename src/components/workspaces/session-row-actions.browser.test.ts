/** The rail's real chat rows (agent tree, Pinned, Recent) with their real styling. Only data hooks are replaced. */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser, type Locator, type Page } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';

interface FixtureWindow extends Window {
  actions: { kind: string; value: unknown }[];
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
  // Pins live in fixture state, so a toggle re-renders the row the way the
  // optimistic cache patch does in the app.
  const fixture = `
    import React, {createContext, useContext, useState} from 'react';
    const Context=createContext(null);
    const record=(kind,value)=>window.actions.push({kind,value});
    export function FixtureProvider({children}) {
      const [pins,setPins]=useState({pinned:'2026-10-20T12:00:00Z','inactive-pinned':'2026-10-01T12:00:00Z'});
      const [activeView,setView]=useState({kind:'home'});
      const value={pins,setPins,activeView,setActiveView:view=>{record('navigate',view);setView(view)}};
      return <Context.Provider value={value}>{children}</Context.Provider>;
    }
    export const useFixture=()=>useContext(Context);
    export function useDashboard(){const f=useFixture();return {...f,activeSessionId:null,activeExecutionId:null,
      streamingSessionIds:new Set(),pendingInputSessionIds:new Set(),backgroundSessionIds:new Set()};}
    export const useWorkspaceSelection=()=>null;
    const setPin=(kind,at)=>()=>{const {setPins}=useFixture();
      return {mutate:id=>{record(kind,id);setPins(prev=>({...prev,[id]:at}))}};};
    export const usePinSession=setPin('pin','2026-10-26T12:00:00Z'), useUnpinSession=setPin('unpin',null);
    export const useMarkSessionRead=()=>({mutate:id=>record('read',id)});
    export const useMarkSessionUnread=()=>({mutate:id=>record('unread',id)});
    export const useArchiveExecution=()=>({archive:input=>record('archive',input.id)});
  `;
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {FixtureProvider,useFixture} from 'fixture-hooks';
      import {SessionRow} from '@/components/workspaces/session-row';
      import {HistoryRow} from '@/components/workspaces/history-row';
      import {SessionHoverProvider} from '@/components/workspaces/session-hover-context';
      window.actions=[];
      const session=(id,label,extra={})=>({id,label,status:'active',workspaceId:'agent',workspaceName:'Review agent',
        workspaceAttachments:[],workspaceEmoji:null,branchName:null,startedAt:'2026-10-26T09:00:00Z',lastActivityAt:'2026-10-26T09:00:00Z',
        lastViewedAt:'2026-10-26T10:00:00Z',lastOutcomeEventAt:null,unreadMarkerAt:null,location:null,executionId:id,...extra});
      function Rows(){
        const {pins}=useFixture();
        const s=(id,label,extra)=>{const row=session(id,label,extra);return {...row,execution:{label,pinnedAt:row.status==='archived'?null:pins[id]??null}};};
        return <>
          <section data-list="agent">
            <SessionRow session={s('fresh','Rework the onboarding checklist so every step has an owner')} density="compact"/>
            <SessionRow session={s('pinned','Pinned chat')} density="compact"/>
            <SessionRow session={s('inactive-pinned','Old pinned chat')} density="compact" inactive/>
          </section>
          <section data-list="pinned">
            <SessionRow session={s('pinned','Pinned chat with a title long enough to need the whole line')} showWorkspaceLabel="Review agent" hidePinMarker/>
          </section>
          <section data-list="recent">
            <HistoryRow session={s('recent','Summarize the quarterly planning notes into one page')}/>
            <HistoryRow session={s('archived','Archived chat',{status:'archived'})}/>
          </section>
        </>;
      }
      createRoot(document.getElementById('root')).render(<FixtureProvider><SessionHoverProvider disabled>
        <aside style={{width:256}}><Rows/></aside><button id="outside">Outside</button>
      </SessionHoverProvider></FixtureProvider>);
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
    plugins: [{ name: 'fixture-data-hooks', setup(api: {
      onResolve(options: { filter: RegExp }, callback: () => { path: string; namespace: string }): void;
      onLoad(options: { filter: RegExp; namespace: string }, callback: () => { contents: string; loader: string; resolveDir: string }): void;
    }) {
      api.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'navigation' }));
      api.onLoad({ filter: /.*/, namespace: 'navigation' }, () => ({ loader: 'tsx', resolveDir: process.cwd(), contents: `export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);` }));
      api.onResolve({ filter: /^(?:fixture-hooks|@\/contexts\/dashboard-context|@\/hooks\/use-(?:workspaces|archive-execution)|\.\/workspace-selection-context)$/ },
        () => ({ path: 'fixture-hooks', namespace: 'fixture' }));
      api.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: fixture, loader: 'tsx', resolveDir: process.cwd() }));
    } }],
  });
  server = http.createServer((req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0]!.text); return; }
    if (req.url === '/app.css') { res.setHeader('Content-Type', 'text/css'); res.end(css.css); return; }
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><link rel="stylesheet" href="/app.css"><style>aside{padding:16px 4px;background:var(--background)}section{margin-bottom:12px}#outside{position:fixed;left:800px;top:40px}</style><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({ executablePath: process.env.RI_REVIEW_CHROMIUM, headless: true });
}, 30_000);

afterAll(async () => {
  await browser?.close();
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

const actions = (page: Page) => page.evaluate(() => (window as unknown as FixtureWindow).actions);
const clearActions = (page: Page) => page.evaluate(() => { (window as unknown as FixtureWindow).actions = []; });
const row = (page: Page, list: string, name: RegExp) =>
  page.locator(`[data-list="${list}"] > [role="button"]`).filter({ hasText: name });
const box = async (locator: Locator) => {
  const b = await locator.boundingBox();
  expect(b).not.toBeNull();
  return b!;
};
/** The rail's own control under a point, as a click there would find it. */
const hitAt = (page: Page, x: number, y: number) =>
  page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px!, py!);
    return el?.closest('button,[role="button"]')?.getAttribute('aria-label') ?? 'row';
  }, [x, y]);
/**
 * The action buttons that can be seen, left to right: not faded out, and not
 * clipped by the folded cluster they sit in. Geometry rather than hit testing,
 * since an open menu turns pointer events off for the rest of the page.
 */
const visibleActions = (target: Locator) =>
  target.locator('button').evaluateAll(buttons => buttons
    .filter((b) => {
      const own = b.getBoundingClientRect();
      const clip = b.parentElement!.getBoundingClientRect();
      const center = own.x + own.width / 2;
      return b.checkVisibility({ opacityProperty: true })
        && getComputedStyle(b.parentElement!).opacity === '1'
        && center > clip.left && center < clip.right;
    })
    .sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x)
    .map(b => b.getAttribute('aria-label')));

async function open(page: Page) {
  page.setDefaultTimeout(3_000);
  page.on('pageerror', error => console.error(error.message));
  await page.goto(base);
  await row(page, 'agent', /Pinned chat/).waitFor();
  await page.locator('#outside').hover();
}

async function failWith(page: Page, error: unknown): Promise<never> {
  await page.screenshot({ path: path.join(os.tmpdir(), 'session-row-actions-failure.png') });
  console.error({ actions: await actions(page), body: await page.locator('body').innerText() });
  throw error;
}

it('shows the pin beside ⋯ on hover, in every rail list, and keeps the rest of the row in place', async () => {
  const page = await browser.newPage();
  try {
    await open(page);
    if (process.env.RI_ROW_ACTIONS_SCREENSHOT) await page.screenshot({ path: `${process.env.RI_ROW_ACTIONS_SCREENSHOT}-rest.png` });
    const cases: { list: string; name: RegExp; expected: string[] }[] = [
      { list: 'agent', name: /Rework the onboarding/, expected: ['Pin to top', 'Session actions'] },
      { list: 'agent', name: /^Pinned chat/, expected: ['Unpin', 'Session actions'] },
      { list: 'agent', name: /Old pinned chat/, expected: ['Archive', 'Unpin', 'Session actions'] },
      { list: 'pinned', name: /Pinned chat with/, expected: ['Unpin', 'Session actions'] },
      { list: 'recent', name: /Summarize the quarterly/, expected: ['Pin to top', 'Session actions'] },
      // Archived chats can't be pinned.
      { list: 'recent', name: /Archived chat/, expected: ['Session actions'] },
    ];
    for (const { list, name, expected } of cases) {
      const target = row(page, list, name);
      const rest = await box(target);
      const menu = target.getByRole('button', { name: 'Session actions' });
      const menuAtRest = await box(menu);
      // At rest nothing on the row is a button: the far end opens the chat.
      expect(await visibleActions(target), `${name} at rest`).toEqual([]);
      expect(await hitAt(page, menuAtRest.x + menuAtRest.width / 2, menuAtRest.y + menuAtRest.height / 2)).toBe('row');

      await target.hover({ position: { x: 40, y: rest.height / 2 } });
      await expect.poll(() => visibleActions(target), { message: `${name} on hover` }).toEqual(expected);
      if (process.env.RI_ROW_ACTIONS_SCREENSHOT) {
        await page.screenshot({ path: `${process.env.RI_ROW_ACTIONS_SCREENSHOT}-hover-${list}-${expected.join('+').replace(/ /g, '')}.png` });
      }
      // ⋯ stays exactly where it was, the pin sits right beside it, and the
      // row keeps its height.
      expect(await box(menu)).toEqual(menuAtRest);
      expect(await box(target)).toEqual(rest);
      const buttons = await Promise.all(expected.map(label => box(target.getByRole('button', { name: label, exact: true }))));
      for (let i = 1; i < buttons.length; i++) expect(buttons[i]!.x).toBeCloseTo(buttons[i - 1]!.x + buttons[i - 1]!.width, 0);
      // The title truncates before the actions instead of running under them.
      const title = await target.locator('span.truncate').first().evaluate(el => el.getBoundingClientRect().right);
      expect(title).toBeLessThanOrEqual(buttons[0]!.x + 0.5);
      await page.locator('#outside').hover();
      await expect.poll(() => visibleActions(target)).toEqual([]);
    }
    expect(await actions(page)).toEqual([]);
  } catch (error) { await failWith(page, error); } finally { await page.close(); }
}, 30_000);

it('pins and unpins in one click each, without opening the chat, and leaves Pin out of ⋯', async () => {
  const page = await browser.newPage();
  try {
    await open(page);
    const target = row(page, 'agent', /Rework the onboarding/);
    await target.hover();
    await target.getByRole('button', { name: 'Pin to top' }).click();
    // The pinned mark is filled and the button now unpins, on the same spot.
    const unpin = target.getByRole('button', { name: 'Unpin' });
    await unpin.waitFor();
    if (process.env.RI_ROW_ACTIONS_SCREENSHOT) await page.screenshot({ path: `${process.env.RI_ROW_ACTIONS_SCREENSHOT}-hover-pinned.png` });
    await unpin.click();
    await target.getByRole('button', { name: 'Pin to top' }).waitFor();
    // Recent's rows pin the same way.
    const recent = row(page, 'recent', /Summarize the quarterly/);
    await recent.hover();
    await recent.getByRole('button', { name: 'Pin to top' }).click();
    await recent.getByRole('button', { name: 'Unpin' }).waitFor();
    expect(await actions(page)).toEqual([
      { kind: 'pin', value: 'fresh' }, { kind: 'unpin', value: 'fresh' }, { kind: 'pin', value: 'recent' },
    ]);

    await clearActions(page);
    await target.hover();
    await target.getByRole('button', { name: 'Session actions' }).click();
    const menu = page.getByRole('menu');
    await menu.waitFor();
    if (process.env.RI_ROW_ACTIONS_SCREENSHOT) await page.screenshot({ path: `${process.env.RI_ROW_ACTIONS_SCREENSHOT}-menu.png` });
    expect((await menu.getByRole('menuitem').allTextContents()).map(t => t.trim())).toEqual(['Mark as unread', 'Archive']);
    // While the menu is open the actions stay, wherever the pointer goes.
    // The menu is modal, so the pointer just moves: nothing else takes it.
    await page.mouse.move(900, 300, { steps: 4 });
    await page.waitForTimeout(300);
    expect(await visibleActions(target)).toEqual(['Pin to top', 'Session actions']);
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden' });
    // The inactive row's quick Archive still works.
    const old = row(page, 'agent', /Old pinned chat/);
    await old.hover();
    await old.getByRole('button', { name: 'Archive' }).click();
    expect(await actions(page)).toEqual([{ kind: 'archive', value: 'inactive-pinned' }]);
  } catch (error) { await failWith(page, error); } finally { await page.close(); }
}, 20_000);

it('reaches the pin from the keyboard, and Enter on it pins rather than opening the chat', async () => {
  const page = await browser.newPage();
  try {
    await open(page);
    const target = row(page, 'agent', /Rework the onboarding/);
    await target.focus();
    await page.keyboard.press('Tab');
    expect(await target.getByRole('button', { name: 'Pin to top' }).evaluate(el => el === document.activeElement)).toBe(true);
    await expect.poll(() => visibleActions(target)).toEqual(['Pin to top', 'Session actions']);
    await page.keyboard.press('Enter');
    await target.getByRole('button', { name: 'Unpin' }).waitFor();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await page.getByRole('menu').waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('menu').waitFor({ state: 'hidden' });
    // Enter on the row itself still opens the chat.
    await target.focus();
    await page.keyboard.press('Enter');
    expect(await actions(page)).toEqual([
      { kind: 'pin', value: 'fresh' }, { kind: 'navigate', value: { kind: 'execution', id: 'fresh' } },
    ]);
  } catch (error) { await failWith(page, error); } finally { await page.close(); }
}, 20_000);
