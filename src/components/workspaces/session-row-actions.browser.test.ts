/**
 * The rail's real chat rows (agent tree, Pinned, Recent) with their real
 * styling, and the real archive flow behind them (its dialog and toasts).
 * Only data hooks are replaced: archive requests are held until a test
 * settles them, so it can see what happens on the click and what happens
 * when the request returns.
 */
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
  requests: { resolve: (value: unknown) => void; reject: (reason: unknown) => void }[];
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
    import React, {createContext, useContext, useMemo, useState} from 'react';
    import {WorkContext} from '@/contexts/work-context';
    const Context=createContext(null);
    const record=(kind,value)=>window.actions.push({kind,value});
    export function FixtureProvider({children}) {
      const [pins,setPins]=useState({pinned:'2026-10-20T12:00:00Z','inactive-pinned':'2026-10-01T12:00:00Z'});
      const [activeView,setView]=useState({kind:'home'});
      // The chat on screen: "fresh". Leaving it clears it, as the dashboard does.
      const [openChat,setOpenChat]=useState('fresh');
      const navigation=useMemo(()=>({
        openAgent:id=>{record('openAgent',id);setOpenChat(null)},
        goHome:()=>{record('goHome',null);setOpenChat(null)},
        openExecution:id=>{record('openExecution',id);setOpenChat(id)},
        openTask:()=>{},openNote:()=>{},
      }),[]);
      const activity={activeSessionId:openChat,activeExecutionId:openChat,streamingSessionIds:new Set(),
        backgroundSessionIds:new Set(),pendingInputSessionIds:new Set(),setActiveExecutionId:()=>{},setSessionStreaming:()=>{}};
      const value={pins,setPins,activeView,setActiveView:view=>{record('navigate',view);setView(view)}};
      return <Context.Provider value={value}><WorkContext navigation={navigation} activity={activity}>{children}</WorkContext></Context.Provider>;
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
    export const useArchiveSession=()=>({isPending:false,mutateAsync:({id,force})=>{
      record(force?'archive anyway':'archive',id);
      return new Promise((resolve,reject)=>window.requests.push({resolve,reject}));
    }});
    export const dirtyWorktreeOf=err=>err?.dirty??null;
  `;
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {FixtureProvider,useFixture} from 'fixture-hooks';
      import {SessionRow} from '@/components/workspaces/session-row';
      import {HistoryRow} from '@/components/workspaces/history-row';
      import {SessionHoverProvider} from '@/components/workspaces/session-hover-context';
      import {ConfirmProvider} from '@/components/ui/confirm-dialog';
      import {Toaster} from 'sonner';
      window.actions=[];
      window.requests=[];
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
      createRoot(document.getElementById('root')).render(<ConfirmProvider><FixtureProvider><SessionHoverProvider disabled>
        <aside style={{width:256}}><Rows/></aside><button id="outside">Outside</button>
      </SessionHoverProvider></FixtureProvider><Toaster/></ConfirmProvider>);
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
    plugins: [{ name: 'fixture-data-hooks', setup(api: {
      onResolve(options: { filter: RegExp }, callback: () => { path: string; namespace: string }): void;
      onLoad(options: { filter: RegExp; namespace: string }, callback: () => { contents: string; loader: string; resolveDir: string }): void;
    }) {
      api.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'navigation' }));
      api.onLoad({ filter: /.*/, namespace: 'navigation' }, () => ({ loader: 'tsx', resolveDir: process.cwd(), contents: `export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);` }));
      api.onResolve({ filter: /^(?:fixture-hooks|@\/contexts\/dashboard-context|@\/hooks\/use-workspaces|\.\/workspace-selection-context)$/ },
        () => ({ path: 'fixture-hooks', namespace: 'fixture' }));
      // The icon theme is fetched at install time, and icons aren't what's under test.
      api.onResolve({ filter: /^@\/lib\/file-icons$/ }, () => ({ path: 'file-icons', namespace: 'file-icons' }));
      api.onLoad({ filter: /.*/, namespace: 'file-icons' }, () => ({ loader: 'tsx', resolveDir: process.cwd(), contents: `export const fileIconUrl=()=>'';export const folderIconUrl=()=>'';` }));
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

/** Settle the latest held archive request: done, refused for uncommitted files, or failed. */
const settle = (page: Page, outcome: 'archived' | 'dirty' | 'failed') => page.evaluate((how) => {
  const request = (window as unknown as FixtureWindow).requests.at(-1)!;
  if (how === 'archived') request.resolve({});
  else if (how === 'dirty') request.reject({ dirty: { label: null, files: [{ path: 'notes/draft.md', change: 'untracked' }], omitted: 0 } });
  else request.reject(new Error('The device is away'));
}, outcome);
/** Long enough for a settled request's follow-ups (dialog, toast, any navigation) to have run. */
const afterSettling = (page: Page) => page.waitForTimeout(200);

async function archiveFromMenu(page: Page, list: string, name: RegExp) {
  const target = row(page, list, name);
  await target.hover();
  await target.getByRole('button', { name: 'Session actions' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await page.getByRole('menu').waitFor({ state: 'hidden' });
}

const OPEN_CHAT = /Rework the onboarding/;
const OPEN_CHAT_LABEL = 'Rework the onboarding checklist so every step has an owner';

it('archiving the open chat leaves for its agent on the click, and the request returning moves nobody', async () => {
  const page = await browser.newPage();
  try {
    await open(page);
    await archiveFromMenu(page, 'agent', OPEN_CHAT);
    // On the click, with the request still out.
    const leftOnClick = [{ kind: 'openAgent', value: 'agent' }, { kind: 'archive', value: 'fresh' }];
    expect(await actions(page)).toEqual(leftOnClick);
    await settle(page, 'archived');
    await afterSettling(page);
    expect(await actions(page)).toEqual(leftOnClick);

    // A chat that isn't on screen is archived where it is, and the view stays.
    await clearActions(page);
    await archiveFromMenu(page, 'recent', /Summarize the quarterly/);
    expect(await actions(page)).toEqual([{ kind: 'archive', value: 'recent' }]);
    await settle(page, 'archived');
    await afterSettling(page);
    expect(await actions(page)).toEqual([{ kind: 'archive', value: 'recent' }]);
  } catch (error) { await failWith(page, error); } finally { await page.close(); }
}, 20_000);

it('asks about uncommitted files after leaving, names the chat, and only Review moves the person', async () => {
  const page = await browser.newPage();
  try {
    await open(page);
    const dialog = page.getByRole('alertdialog');
    const leftOnClick = [{ kind: 'openAgent', value: 'agent' }, { kind: 'archive', value: 'fresh' }];

    // Cancel: they stay where they went, and the chat is kept.
    await archiveFromMenu(page, 'agent', OPEN_CHAT);
    expect(await actions(page)).toEqual(leftOnClick);
    await settle(page, 'dirty');
    await dialog.waitFor();
    if (process.env.RI_ROW_ACTIONS_SCREENSHOT) await page.screenshot({ path: `${process.env.RI_ROW_ACTIONS_SCREENSHOT}-archive-dialog.png` });
    expect(await dialog.innerText()).toContain(`"${OPEN_CHAT_LABEL}" has work that isn't committed`);
    expect(await dialog.innerText()).toContain('notes/draft.md');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await dialog.waitFor({ state: 'hidden' });
    await afterSettling(page);
    expect(await actions(page)).toEqual(leftOnClick);

    // Archive anyway: forced where they are. The chat isn't on screen now.
    await clearActions(page);
    await archiveFromMenu(page, 'agent', OPEN_CHAT);
    await settle(page, 'dirty');
    await dialog.getByRole('button', { name: 'Archive anyway' }).click();
    await dialog.waitFor({ state: 'hidden' });
    await settle(page, 'archived');
    await afterSettling(page);
    expect(await actions(page)).toEqual([{ kind: 'archive', value: 'fresh' }, { kind: 'archive anyway', value: 'fresh' }]);

    // Review changes: the one move, back to the chat to see the files.
    await clearActions(page);
    await archiveFromMenu(page, 'agent', OPEN_CHAT);
    await settle(page, 'dirty');
    await dialog.getByRole('button', { name: 'Review changes' }).click();
    await dialog.waitFor({ state: 'hidden' });
    await afterSettling(page);
    expect(await actions(page)).toEqual([{ kind: 'archive', value: 'fresh' }, { kind: 'openExecution', value: 'fresh' }]);
  } catch (error) { await failWith(page, error); } finally { await page.close(); }
}, 20_000);

it('a failed archive is a toast naming the chat, and nobody moves again', async () => {
  const page = await browser.newPage();
  try {
    await open(page);
    await archiveFromMenu(page, 'agent', OPEN_CHAT);
    await settle(page, 'failed');
    const toast = page.locator('[data-sonner-toast]');
    await toast.waitFor();
    expect(await toast.innerText()).toContain(`Couldn't archive "${OPEN_CHAT_LABEL}"`);
    expect(await toast.innerText()).toContain('The device is away');
    expect(await actions(page)).toEqual([{ kind: 'openAgent', value: 'agent' }, { kind: 'archive', value: 'fresh' }]);
  } catch (error) { await failWith(page, error); } finally { await page.close(); }
}, 20_000);
