/** Real rows, Radix layers, drag sensors and styling. Only data hooks are replaced. */
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
  fixture: { patch: (value: Record<string, unknown>) => void; navigate: (view: { kind: string; id?: string }) => void };
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
    const rows=[
      {id:'older',label:'Older recent chat',startedAt:'2026-10-07T12:00:00Z'},
      {id:'latest',label:'Latest chat',startedAt:'2026-10-08T12:00:00Z'},
      {id:'inactive',label:'Inactive chat',startedAt:'2025-01-01T12:00:00Z'},
      {id:'archived',label:'Archived chat',status:'archived'},
      {id:'other',label:'Other agent chat',workspaceId:'other-agent'},
    ].map(s=>({status:'active',workspaceId:'agent',startedAt:'2026-10-06T12:00:00Z',
      lastViewedAt:null,lastOutcomeEventAt:null,unreadMarkerAt:null,
      executionId:s.id,execution:{label:s.label,pinnedAt:null},...s}));
    const record=(kind,value)=>window.actions.push({kind,value});
    const isInactive=s=>s.id==='inactive';
    export function FixtureProvider({children}) {
      const [state,setState]=useState({collapsed:true,selecting:false,empty:false,many:false});
      const [activeView,navigate]=useState({kind:'home'});
      window.fixture={patch:patch=>setState(prev=>({...prev,...patch})),navigate};
      const value={state,activeView,setActiveView:view=>{record('navigate',view);navigate(view)},
        workspace:{id:'agent',name:'Review agent',purpose:null,isGit:true,attachments:[],emoji:null,areaId:null,collapsed:state.collapsed},
        sessions:state.empty?[]:state.many?[...rows,...Array.from({length:80},(_,i)=>({
          ...rows[0],id:'extra-'+i,label:'Chat '+i,executionId:'extra-'+i,execution:{label:'Chat '+i,pinnedAt:null},
        }))]:rows,
        openAgent:id=>{record('agent',id);navigate({kind:'agent',id})},
        update:input=>{record('update',input);setState(prev=>({...prev,collapsed:input.collapsed}))},
      };
      return <Context.Provider value={value}>{children}</Context.Provider>;
    }
    export const useFixture=()=>useContext(Context);
    export function useDashboard(){const f=useFixture();return {...f,activeSessionId:f.activeView.kind==='execution'?f.activeView.id:null,
      activeExecutionId:f.activeView.kind==='execution'?f.activeView.id:null,
      streamingSessionIds:new Set(['latest']),pendingInputSessionIds:new Set(),backgroundSessionIds:new Set()};}
    export const useRailSessions=()=>({data:{sessions:useFixture().sessions,mainChats:[]}});
    export const useWorkspaceSessions=()=>({data:null});
    export const useUpdateWorkspace=()=>({mutate:useFixture().update});
    export const useAgentViewMode=()=>({opensView:true});
    export const useWorkspaceSelection=()=>({selecting:useFixture().state.selecting,isSelected:()=>false,toggle:()=>{}});
    export const useAreas=()=>({data:[]});
    export const useInactivity=()=>({stored:null,isInactive,partition:ss=>({active:ss.filter(s=>!isInactive(s)),inactive:ss.filter(isInactive)})});
    export const useSetInactiveAfterDays=()=>({mutate:days=>record('inactive-after',days)});
    const mutation=()=>({mutate:id=>record('mutation',id)});
    export const useMarkSessionRead=mutation, useMarkSessionUnread=mutation, usePinSession=mutation, useUnpinSession=mutation;
    export const useArchiveExecution=()=>({archive:input=>record('archive',input)});
  `;
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {DndContext, PointerSensor, useSensor, useSensors} from '@dnd-kit/core';
      import {SortableContext} from '@dnd-kit/sortable';
      import {FixtureProvider,useFixture} from 'fixture-hooks';
      import {AgentRailRow} from '@/components/workspaces/agent-rail-row';
      import {WorkspaceRow} from '@/components/workspaces/workspace-row';
      import {RailFlyout} from '@/components/workspaces/rail-flyout';
      import {SessionHoverProvider} from '@/components/workspaces/session-hover-context';
      window.actions=[];
      const params=new URLSearchParams(location.search);
      function Rows(){
        const {workspace}=useFixture();
        const sensors=useSensors(useSensor(PointerSensor,{activationConstraint:{distance:4}}));
        const Row=params.get('style')==='classic'?WorkspaceRow:AgentRailRow;
        return <DndContext sensors={sensors} onDragStart={()=>window.actions.push({kind:'drag',value:true})}>
          <SortableContext items={['agent']}><div id="agent-row"><Row workspace={workspace}
            onOpenSettings={id=>window.actions.push({kind:'setup',value:id})}
            onCreateExecution={id=>window.actions.push({kind:'create',value:id})}
            onOpenLauncher={id=>window.actions.push({kind:'launcher',value:id})}/></div></SortableContext>
        </DndContext>;
      }
      function App(){return <FixtureProvider><SessionHoverProvider>
        <aside style={{width:params.has('nested')?44:256}}>
          {params.has('nested')?<RailFlyout contentLabel="Agents" trigger={({ref})=><button ref={ref}>Agents</button>}>
            <Rows/>
          </RailFlyout>:<>
            <RailFlyout contentLabel="Apps" onClick={()=>{}} trigger={({ref})=><button ref={ref}>Apps</button>}>
              <div className="min-h-8 border-b">Apps</div><nav>Example app</nav>
            </RailFlyout><Rows/>
          </>}
        </aside><button id="outside">Outside</button>
      </SessionHoverProvider></FixtureProvider>;}
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
    plugins: [{ name: 'fixture-data-hooks', setup(api: {
      onResolve(options: { filter: RegExp }, callback: () => { path: string; namespace: string }): void;
      onLoad(options: { filter: RegExp; namespace: string }, callback: () => { contents: string; loader: string; resolveDir: string }): void;
    }) {
      api.onResolve({ filter: /^(?:fixture-hooks|@\/contexts\/dashboard-context|@\/hooks\/use-(?:workspaces|inactivity|areas|archive-execution)|@\/lib\/client\/agent-view-mode|\.\/workspace-selection-context)$/ },
        () => ({ path: 'fixture-hooks', namespace: 'fixture' }));
      api.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: fixture, loader: 'tsx', resolveDir: process.cwd() }));
    } }],
  });
  server = http.createServer((req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0]!.text); return; }
    if (req.url === '/app.css') { res.setHeader('Content-Type', 'text/css'); res.end(css.css); return; }
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><link rel="stylesheet" href="/app.css"><style>aside{position:fixed;inset:24px auto 16px 0;padding:16px 4px;background:var(--background)}#agent-row{margin-top:200px}#outside{position:fixed;left:800px;top:40px}</style><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({
    executablePath: path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell'),
    headless: true,
  });
}, 30_000);

afterAll(async () => {
  await browser?.close();
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

const nameButton = (page: Page) => page.locator('#agent-row button').filter({ hasText: /^Review agent$/ });
const flyout = (page: Page) => page.getByRole('dialog', { name: 'Review agent chats', exact: true });
const actions = (page: Page) => page.evaluate(() => (window as unknown as FixtureWindow).actions);

async function expectFullHeight(panel: Locator, rail: Locator) {
  const bounds = await rail.boundingBox();
  expect(bounds).not.toBeNull();
  await expect.poll(async () => (await panel.boundingBox())?.height).toBeCloseTo(bounds!.height, 1);
  await expect.poll(async () => (await panel.boundingBox())?.x).toBeCloseTo(bounds!.x + bounds!.width, 1);
  expect((await panel.boundingBox())?.y).toBeCloseTo(bounds!.y, 1);
  expect(await panel.evaluate(el => ({
    radius: getComputedStyle(el).borderTopRightRadius,
    maxHeight: getComputedStyle(el).maxHeight,
  }))).toEqual({ radius: '0px', maxHeight: 'none' });
}

it.each(['agents', 'classic'])('%s: chooses a collapsed chat without unfolding, and preserves navigation and dismissal', async (style) => {
  const page = await browser.newPage();
  page.setDefaultTimeout(3_000);
  page.on('pageerror', error => console.error(error.message));
  try {
    await page.goto(`${base}/?style=${style}`);
    await nameButton(page).waitFor();
    // Apps uses the default shared layout. Both choosers must match the
    // rail even when their trigger is much farther down the list.
    await page.getByRole('button', { name: 'Apps', exact: true }).hover();
    const apps = page.getByRole('dialog', { name: 'Apps', exact: true });
    await apps.waitFor();
    await expectFullHeight(apps, page.locator('aside'));
    await page.locator('#outside').hover();
    await apps.waitFor({ state: 'hidden' });
    const header = page.locator('#agent-row .group').first();
    // Crossing a row briefly never opens a menu.
    await header.hover();
    await page.locator('#outside').hover();
    await page.waitForTimeout(250);
    expect(await flyout(page).count()).toBe(0);
    // Hover the icon rather than the name to exercise the whole header.
    await header.locator('button').first().hover();
    await flyout(page).waitFor();
    await expectFullHeight(flyout(page), page.locator('aside'));
    const nav = flyout(page).getByRole('navigation');
    expect(await nav.locator('[role="button"]').allTextContents()).toEqual(expect.arrayContaining([
      expect.stringContaining('Latest chat'), expect.stringContaining('Older recent chat'),
    ]));
    expect(await nav.locator('[role="button"]').first().textContent()).toContain('Latest chat');
    expect(await nav.getByText('Other agent chat').count()).toBe(0);
    expect(await nav.getByText('Archived chat').count()).toBe(0);
    expect(await nav.getByText('Inactive chat', { exact: true }).count()).toBe(0);
    await nav.getByRole('button', { name: /Latest chat/ }).hover();
    await page.waitForTimeout(300);
    expect(await flyout(page).isVisible()).toBe(true);
    expect(await flyout(page).getAttribute('data-state')).toBe('open');
    await page.locator('#outside').hover();
    await flyout(page).waitFor({ state: 'hidden' });
    await header.hover();
    await flyout(page).waitFor();
    await nav.getByRole('button', { name: /Older recent chat/ }).click();
    await flyout(page).waitFor({ state: 'hidden' });
    expect(await actions(page)).toEqual([{ kind: 'navigate', value: { kind: 'execution', id: 'older' } }]);
    // Picking the already open chat dismisses the chooser as well.
    await header.hover();
    await flyout(page).waitFor();
    await nav.getByRole('button', { name: /Older recent chat/ }).click();
    await flyout(page).waitFor({ state: 'hidden' });
    // The ordinary name click still goes to the agent exactly once.
    await nameButton(page).click();
    expect((await actions(page)).filter(a => a.kind === 'agent')).toEqual([{ kind: 'agent', value: 'agent' }]);
    // Keyboard enters the chooser while Enter on the name retains its destination.
    await nameButton(page).focus();
    await page.keyboard.press('ArrowRight');
    await flyout(page).waitFor();
    expect(await flyout(page).evaluate(el => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await flyout(page).waitFor({ state: 'hidden' });
    expect(await nameButton(page).evaluate(el => el === document.activeElement)).toBe(true);
    // Selecting, expanding and empty agents never expose duplicate rows.
    for (const patch of [{ selecting: true }, { selecting: false, collapsed: false }, { collapsed: true, empty: true }]) {
      await page.evaluate(p => (window as unknown as FixtureWindow).fixture.patch(p), patch);
      await header.hover();
      await page.waitForTimeout(250);
      expect(await flyout(page).count()).toBe(0);
    }
    expect((await actions(page)).some(a => a.kind === 'drag' || a.kind === 'update')).toBe(false);
  } catch (error) {
    await page.screenshot({ path: path.join(os.tmpdir(), 'agent-chats-flyout-failure.png') });
    console.error({ actions: await actions(page), body: await page.locator('body').innerText() });
    throw error;
  } finally { await page.close(); }
}, 20_000);

it('keeps inactive chats and nested menus usable, including inside the collapsed rail', async () => {
  const page = await browser.newPage();
  page.setDefaultTimeout(3_000);
  page.on('pageerror', error => console.error(error.message));
  try {
    await page.goto(`${base}/?nested=1`);
    await page.getByRole('button', { name: 'Agents', exact: true }).hover();
    await page.getByRole('dialog', { name: 'Agents', exact: true }).waitFor();
    await nameButton(page).hover();
    await flyout(page).waitFor();
    await expectFullHeight(flyout(page), page.getByRole('dialog', { name: 'Agents', exact: true }));
    await flyout(page).getByRole('button', { name: /Latest chat/ }).hover();
    await page.waitForTimeout(300);
    expect(await flyout(page).isVisible()).toBe(true);
    expect(await flyout(page).getAttribute('data-state')).toBe('open');
    // A nested menu must dismiss before either flyout, and never start a drag.
    await flyout(page).getByRole('button', { name: /Latest chat/ }).getByRole('button', { name: 'Session actions' }).click();
    await page.getByRole('menu').waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('menu').waitFor({ state: 'hidden' });
    expect(await flyout(page).isVisible()).toBe(true);
    await flyout(page).getByRole('button', { name: /1 inactive hidden/ }).click();
    await flyout(page).getByText('Inactive chat', { exact: true }).waitFor();
    await flyout(page).getByRole('button', { name: /Inactive chat/ }).click();
    await flyout(page).waitFor({ state: 'hidden' });
    expect(await page.getByRole('dialog', { name: 'Agents', exact: true }).count()).toBe(0);
    expect(await actions(page)).toEqual([{ kind: 'navigate', value: { kind: 'execution', id: 'inactive' } }]);
  } catch (error) {
    await page.screenshot({ path: path.join(os.tmpdir(), 'agent-chats-flyout-failure.png') });
    console.error({ actions: await actions(page), body: await page.locator('body').innerText() });
    throw error;
  } finally { await page.close(); }
}, 20_000);

it('scrolls long chat lists below a fixed header and follows the rail height on resize', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(3_000);
  try {
    await page.goto(base);
    await nameButton(page).waitFor();
    await page.evaluate(() => (window as unknown as FixtureWindow).fixture.patch({ many: true }));
    await nameButton(page).hover();
    const panel = flyout(page);
    await panel.waitFor();
    await expectFullHeight(panel, page.locator('aside'));
    const header = panel.locator(':scope > div').first();
    const headerTop = (await header.boundingBox())!.y;
    const nav = panel.getByRole('navigation');
    expect(await nav.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    await nav.hover();
    await nav.evaluate(el => { el.scrollTop = el.scrollHeight; });
    expect((await header.boundingBox())!.y).toBe(headerTop);
    expect(await nav.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await expectFullHeight(panel, page.locator('aside'));
    await page.setViewportSize({ width: 1280, height: 480 });
    await expectFullHeight(panel, page.locator('aside'));
    expect(await nav.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    if (process.env.RI_FLYOUT_SCREENSHOT) await page.screenshot({ path: process.env.RI_FLYOUT_SCREENSHOT });
    expect(await actions(page)).toEqual([]);
  } finally { await page.close(); }
}, 20_000);
