/**
 * The agents-only rail trial (docs/rail-agents-first.md#agents-only-trial)
 * against an isolated fixture: the real rail list (`RailListHeader` and
 * `RailListBody`) and the agent chat bar's `ReadStateButton`, with the real
 * data hooks over a seeded query cache and only the dashboard context
 * stubbed. The API answers nothing, so a mutation shows through its
 * optimistic patch, and the server records what was sent.
 *
 * Checks that agents only lists agents with no chat rows, each with its own
 * state and counts of its chats that need you or are working, that Recent
 * lists recent chats of any status with inactive ones folded, that an agent
 * can be marked read or unread from the rail and from its chat bar (and both
 * agree), that resting on an agent peeks at its chats, that hovering an
 * agent opens no tooltip while its hover actions keep theirs, and that
 * Agents first is unchanged.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { build } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';

let server: http.Server;
let browser: Browser;
let base: string;
/** Session mutations the page sent, as `readPost:<id>` / `unreadPost:<id>`. */
let sent: string[] = [];

/**
 * The view on screen is Website's "Update pricing copy" chat, unless a test
 * starts on another (`initialView`) or opens one (`window.openView`). An
 * execution view carries the execution its chat belongs to, as ExecutionView
 * reports it.
 */
const dashboard = `
  import {useSyncExternalStore} from 'react';
  const record=(kind,value)=>window.actions.push({kind,value});
  const listeners=new Set();
  let view=window.initialView??{kind:'execution',id:'web-2',executionId:'web-2'};
  window.openView=(next)=>{view=next;listeners.forEach((listener)=>listener());};
  const subscribe=(listener)=>{listeners.add(listener);return()=>listeners.delete(listener);};
  const activity={
    streamingSessionIds:new Set(['ri-1','fin-3','res-main']),
    pendingInputSessionIds:new Set(['web-1']),
    backgroundSessionIds:new Set(),
  };
  export const DashboardProvider=({children})=>children;
  export function useDashboard(){
    const v=useSyncExternalStore(subscribe,()=>view);
    const chat=v.kind==='execution';
    return {
      ...activity,
      activeView:chat?{kind:'execution',id:v.id}:v,
      activeSessionId:chat?v.id:null,
      activeExecutionId:chat?(v.executionId??null):null,
      setActiveView:(next)=>record('navigate',next),
      openAgent:(id)=>record('openAgent',id),
    };
  }
  export const useOptionalDashboard=useDashboard;
`;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
  const css = await postcss([require('@tailwindcss/postcss')()]).process(fs.readFileSync('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') });
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React, {useState} from 'react';
      import {trpc} from '@/lib/trpc/client';
      import {createRoot} from 'react-dom/client';
      import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
      import {TooltipProvider} from '@/components/ui/tooltip';
      import {ConfirmProvider} from '@/components/ui/confirm-dialog';
      import {WorkContext} from '@/contexts/work-context';
      import {RailListBody,RailListHeader} from '@/components/workspaces/rail-list';
      import {WorkspaceSelectionProvider} from '@/components/workspaces/workspace-selection-context';
      import {SessionHoverProvider} from '@/components/workspaces/session-hover-context';
      import {ReadStateButton} from '@/components/chat-ui/read-state-button';
      import {AgentsFlyout} from '@/components/workspaces/rail-strip';
      window.actions=[];
      const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity},mutations:{retry:false}}});
      window.queryClient=client;
      const at=(minutesAgo)=>new Date(Date.now()-minutesAgo*60_000).toISOString();
      const agent=(id,name,emoji,purpose)=>({id,name,emoji,purpose,attachments:[],areaId:null,collapsed:false,isGit:true,status:'active'});
      const workspaces=[
        agent('ri','Ri','🛠️','Builds Ri'),
        agent('web','Website','🌐','Runs the marketing site'),
        agent('fin','Finances','💵','Keeps the books'),
        agent('res','Research','🔬','Reads papers'),
        agent('notes','Notes','📝','Files meeting notes'),
        agent('docs','Docs','📚','Keeps the product docs current with every release, changelog included'),
      ];
      // read: viewed after its last outcome. unread: an outcome since.
      const chat=(id,workspaceId,label,{unread=false,pinnedAt=null}={})=>({
        id,label,status:'active',workspaceId,workspaceName:workspaces.find(w=>w.id===workspaceId).name,
        workspaceAttachments:[],workspaceEmoji:null,workspaceIsGit:true,branchName:null,location:null,
        startedAt:at(60),lastActivityAt:at(5),lastOutcomeEventAt:at(5),lastViewedAt:unread?at(10):at(1),unreadMarkerAt:null,
        executionId:id,execution:{label,pinnedAt},
      });
      const main=(id,workspaceId,preview,{unread=false}={})=>({
        id,workspaceId,preview,waitingOn:null,lastOutcomeEventAt:at(5),unreadMarkerAt:null,lastViewedAt:unread?at(10):at(1),
      });
      const sessions=[
        chat('ri-1','ri','Rail agents-only trial'),
        chat('ri-2','ri','Fix flaky gallery smoke'),
        chat('web-1','web','Fix login bug'),
        chat('web-2','web','Update pricing copy'),
        chat('fin-1','fin','Reconcile Amex',{unread:true}),
        chat('fin-2','fin','Import Chase CSV',{unread:true}),
        chat('fin-3','fin','Tax estimate',{pinnedAt:at(30)}),
      ];
      client.setQueryData(['workspaces',{status:'active'}],workspaces);
      client.setQueryData(['sessions','rail'],{sessions,mainChats:[
        main('ri-main','ri','Merged the schedules fix. Want me to restart dev?',{unread:true}),
        main('web-main','web','Deployed the preview build.'),
        main('fin-main','fin','Categorized October.'),
        main('res-main','res','Reading the three papers now.'),
        main('notes-main','notes','Filed the meeting notes.'),
      ]});
      client.setQueryData(['sessions','needs-review'],sessions.filter(s=>s.id==='fin-1'||s.id==='fin-2'));
      // Chats go inactive after a week. Recent's feed adds archived work:
      // one from yesterday, one from three weeks ago.
      client.setQueryData(trpc.userState.list.queryKey({}),{executionInactiveAfterDays:7});
      const archived=(id,workspaceId,label,minutesAgo)=>({...chat(id,workspaceId,label),status:'archived',
        startedAt:at(minutesAgo+60),lastActivityAt:at(minutesAgo),lastOutcomeEventAt:at(minutesAgo),lastViewedAt:at(minutesAgo)});
      client.setQueryData(['sessions','history'],{sessions:[...sessions,
        archived('web-old','web','Ship the v1 pricing page',24*60),
        archived('ri-old','ri','Old migration cleanup',21*24*60),
      ]});
      // The chat the agent view's chat bar shows: Notes's main chat, read.
      client.setQueryData(['session','notes-main'],{...main('notes-main','notes','Filed the meeting notes.'),status:'active',label:null,executionId:null});
      // Chats the rail doesn't list, as the chat view loads them: Ri's
      // archived one from Recent, and one of Docs's opened from search.
      client.setQueryData(['session','ri-old'],archived('ri-old','ri','Old migration cleanup',21*24*60));
      client.setQueryData(['session','docs-old'],archived('docs-old','docs','Release notes for 2.3',30*24*60));
      const noop=()=>{};
      const navigation={openAgent:noop,openExecution:noop,openTask:noop,openNote:noop,goHome:noop};
      const activity={activeSessionId:null,streamingSessionIds:new Set(['ri-1','fin-3','res-main']),backgroundSessionIds:new Set(),pendingInputSessionIds:new Set(['web-1']),setActiveExecutionId:noop,setSessionStreaming:noop};
      function Rail(){
        const [tab,setTab]=useState('workspace');
        return <WorkspaceSelectionProvider>
          <RailListHeader tab={tab} onSelect={setTab}/>
          <RailListBody tab={tab}/>
        </WorkspaceSelectionProvider>;
      }
      // The wide rail's list, or the collapsed strip's Agents button.
      const strip=new URLSearchParams(location.search).get('rail')==='strip';
      createRoot(document.getElementById('root')).render(
        <QueryClientProvider client={client}><TooltipProvider><ConfirmProvider>
          <WorkContext navigation={navigation} activity={activity}><SessionHoverProvider disabled>
            {strip
              ? <aside className="flex h-screen w-[44px] flex-col items-center pt-2 border-r border-border bg-background"><AgentsFlyout/></aside>
              : <aside className="w-[256px] min-h-screen border-r border-border bg-background"><Rail/></aside>}
            <div data-chat-bar className="fixed left-[300px] top-4 flex items-center gap-1.5"><ReadStateButton sessionId="notes-main"/></div>
          </SessionHoverProvider></WorkContext>
        </ConfirmProvider></TooltipProvider></QueryClientProvider>);
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
    plugins: [{
      name: 'fixture-dashboard',
      setup(api) {
        api.onResolve({ filter: /^@\/contexts\/dashboard-context$/ }, () => ({ path: 'dashboard', namespace: 'fixture' }));
        api.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' }));
        api.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          loader: 'tsx',
          resolveDir: process.cwd(),
          contents: args.path === 'dashboard'
            ? dashboard
            : 'export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);export const useRouter=()=>({push(){},replace(){},back(){},prefetch(){}});',
        }));
      },
    }],
  });
  server = http.createServer((req, res) => {
    const url = new URL(req.url!, 'http://fixture');
    if (url.pathname === '/fixture.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0]!.text); return; }
    if (url.pathname === '/fixture.css') { res.setHeader('content-type', 'text/css'); res.end(css.css); return; }
    if (url.pathname.startsWith('/api/')) {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        for (const kind of ['readPost', 'unreadPost'] as const) {
          if (!url.pathname.includes(`sessions.${kind}`)) continue;
          for (const id of body.match(/"id":"([^"]+)"/g) ?? []) sent.push(`${kind}:${id.slice(6, -1)}`);
        }
        res.statusCode = 404;
        res.end();
      });
      return;
    }
    const theme = url.searchParams.get('theme') === 'light' ? '' : 'dark';
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><html class="${theme}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body class="bg-background"><div id="root"></div><script src="/fixture.js"></script></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const executablePath = process.env.RI_REVIEW_CHROMIUM
    ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find(fs.existsSync);
  browser = await chromium.launch({ executablePath, headless: true });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

type View = { kind: 'execution'; id: string; executionId?: string } | { kind: 'agent'; id: string } | { kind: 'home' };

async function open(
  style: 'agentsOnly' | 'agents' | 'classic',
  theme: 'dark' | 'light' = 'dark',
  { rail = 'wide', view, height = 760 }: { rail?: 'wide' | 'strip'; view?: View; height?: number } = {},
): Promise<{ page: Page; errors: string[] }> {
  sent = [];
  const page = await browser.newPage({ viewport: { width: 640, height }, deviceScaleFactor: 2 });
  page.setDefaultTimeout(5_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(({ style, view }) => {
    localStorage.setItem('ri.client.railStyle', style);
    if (view) Object.assign(window, { initialView: view });
  }, { style, view });
  await page.goto(`${base}/?theme=${theme}&rail=${rail}`);
  if (rail === 'wide') await page.getByRole('button', { name: 'Open Docs', exact: true }).waitFor();
  else await page.getByRole('button', { name: /^Agents/ }).waitFor();
  return { page, errors };
}

/** Open another view, as navigating does. */
const openView = (page: Page, view: View) =>
  page.evaluate((next) => (window as unknown as { openView: (v: View) => void }).openView(next), view);

/** Each agent's name and second line, top to bottom. */
const agentLines = (page: Page) =>
  page.locator('[aria-roledescription="sortable"]').evaluateAll((rows) =>
    rows.map((row) => {
      const lines = Array.from(row.querySelectorAll('button.flex-1 > span')).map((s) => s.textContent);
      return { name: lines[0], line: lines[1] ?? null };
    }),
  );

const nameWeight = (page: Page, name: string) =>
  page.locator('button.flex-1 > span:first-child', { hasText: new RegExp(`^${name}$`) }).evaluate((el) => getComputedStyle(el).fontWeight);

const agentRow = (page: Page, name: string) =>
  page.locator('[aria-roledescription="sortable"]', { has: page.getByText(name, { exact: true }) });

/** Each agent's visible chat counts, by kind. */
const countsOf = (page: Page) =>
  page.locator('[aria-roledescription="sortable"]').evaluateAll((rows) =>
    Object.fromEntries(rows.map((row) => [
      row.querySelector('button.flex-1 > span')!.textContent,
      Object.fromEntries(Array.from(row.querySelectorAll<HTMLElement>('[data-count]'))
        .filter((el) => el.checkVisibility())
        .map((el) => [el.dataset.count, el.textContent])),
    ])),
  );

/**
 * The agents that look selected, by name, with what their buttons say to a
 * screen reader (`aria-current`), and the fill they share. `within` narrows
 * to one list, such as the Agents flyout.
 */
const marked = async (page: Page, within = 'body') => {
  const rows = await page.locator(within).locator('[aria-roledescription="sortable"]').evaluateAll((els) =>
    els.map((row) => ({
      name: (row.querySelector('button.flex-1 > span') ?? row.querySelector('button.flex-1'))!.textContent,
      fill: getComputedStyle(row).backgroundColor,
      current: Array.from(row.querySelectorAll('button[aria-current]')).map((b) => b.getAttribute('aria-current')),
    })),
  );
  // Nothing unmarked is announced as current.
  for (const row of rows) if (row.fill === 'rgba(0, 0, 0, 0)') expect(row.current, row.name ?? '').toEqual([]);
  const lit = rows.filter((row) => row.fill !== 'rgba(0, 0, 0, 0)');
  return { agents: lit.map(({ name, current }) => ({ name, current })), fills: [...new Set(lit.map((row) => row.fill))] };
};

/** The rail's selected fill, read off an agent whose own page is open. */
const selectedFill = async (page: Page) => {
  await openView(page, { kind: 'agent', id: 'notes' });
  await expect.poll(async () => (await marked(page)).agents).toEqual([{ name: 'Notes', current: expect.any(Array) }]);
  const [fill] = (await marked(page)).fills;
  return fill;
};

const menu = async (page: Page, name: string) => {
  await page.getByText(name, { exact: true }).hover();
  await page.getByRole('button', { name: `${name} actions`, exact: true }).click();
  return page.getByRole('menu');
};

for (const theme of ['dark', 'light'] as const) {
  it(`lists agents with no chat rows, each with its own state and its chats' counts (${theme})`, async () => {
    const { page, errors } = await open('agentsOnly', theme);
    try {
      // The Agents | Recent switch, then Pinned. No Needs you, and no archive
      // selection, since no chat rows are listed to select.
      expect(await page.getByRole('tab').allInnerTexts()).toEqual(['Agents', 'Recent']);
      expect(await page.getByText('Needs you', { exact: true }).count()).toBe(0);
      expect(await page.getByRole('button', { name: 'Select chats to archive' }).count()).toBe(0);
      expect(await page.getByRole('button', { name: 'New agent' }).count()).toBe(1);
      const switchTop = (await page.getByRole('tablist').boundingBox())!.y;
      const pinnedTop = (await page.getByText('Pinned', { exact: true }).boundingBox())!.y;
      expect(switchTop).toBeLessThan(pinnedTop);

      // The pin is the only chat row.
      const chatRows = await page.locator('[role="button"][tabindex="0"]:not([aria-roledescription])').allInnerTexts();
      expect(chatRows).toHaveLength(1);
      expect(chatRows[0]).toContain('Tax estimate');

      // Each agent says what it said. Its chats' states stay off the rail,
      // though Website has one waiting and Finances two unread.
      expect(await agentLines(page)).toEqual([
        { name: 'Ri', line: 'Merged the schedules fix. Want me to restart dev?' },
        { name: 'Website', line: 'Deployed the preview build.' },
        { name: 'Finances', line: 'Categorized October.' },
        { name: 'Research', line: 'Thinking…' },
        { name: 'Notes', line: 'Filed the meeting notes.' },
        { name: 'Docs', line: 'Keeps the product docs current with every release, changelog included' },
      ]);
      // Bold only when the agent itself wants you.
      expect(Number(await nameWeight(page, 'Ri'))).toBeGreaterThanOrEqual(600);
      expect(Number(await nameWeight(page, 'Website'))).toBeLessThan(600);
      expect(Number(await nameWeight(page, 'Finances'))).toBeLessThan(600);
      expect(Number(await nameWeight(page, 'Research'))).toBeLessThan(600);
      // The open chat has no row, so its agent is marked, and only it.
      expect((await marked(page)).agents).toEqual([{ name: 'Website', current: ['true', 'true'] }]);

      // Its chats count at the row's end: amber need you (pulsing while one
      // is blocked), green working. The agent's own main chat doesn't count.
      expect(await countsOf(page)).toEqual({
        Ri: { working: '1' },
        Website: { 'needs-you': '1' },
        Finances: { 'needs-you': '2', working: '1' },
        Research: {},
        Notes: {},
        Docs: {},
      });
      expect(await agentRow(page, 'Website').locator('[data-count="needs-you"]').getAttribute('class')).toContain('animate-pulse');
      expect(await agentRow(page, 'Finances').locator('[data-count="needs-you"]').getAttribute('class')).not.toContain('animate-pulse');
      expect(await agentRow(page, 'Finances').getByText('2 chats need you, 1 working').count()).toBe(1);

      await page.screenshot({ path: `/tmp/ri-rail-agents-only-${theme}.png`, clip: { x: 0, y: 0, width: 256, height: 520 } });
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  });
}

for (const theme of ['dark', 'light'] as const) {
  it(`marks the agent you're in like its own page, and moves the mark as you go (${theme})`, async () => {
    const { page, errors } = await open('agentsOnly', theme);
    try {
      // Off the rows, so no hover fill.
      await page.mouse.move(600, 700);
      // Website's chat is open: Website looks selected, said as current.
      expect((await marked(page)).agents).toEqual([{ name: 'Website', current: ['true', 'true'] }]);
      const chatFill = (await marked(page)).fills[0];
      await page.screenshot({ path: `/tmp/ri-rail-open-chat-${theme}.png`, clip: { x: 0, y: 0, width: 256, height: 420 } });

      // Its own page has the same look, said as the page.
      await openView(page, { kind: 'agent', id: 'web' });
      await expect.poll(async () => (await marked(page)).agents).toEqual([{ name: 'Website', current: ['page', 'page'] }]);
      expect((await marked(page)).fills).toEqual([chatFill]);
      expect(await selectedFill(page)).toBe(chatFill);

      // Another agent's chat moves the mark there.
      await openView(page, { kind: 'execution', id: 'fin-2', executionId: 'fin-2' });
      await expect.poll(async () => (await marked(page)).agents).toEqual([{ name: 'Finances', current: ['true', 'true'] }]);

      // A later chat of Ri's execution, which the rail knows by its first chat.
      await openView(page, { kind: 'execution', id: 'ri-1-later', executionId: 'ri-1' });
      await expect.poll(async () => (await marked(page)).agents).toEqual([{ name: 'Ri', current: ['true', 'true'] }]);

      // An archived chat the rail doesn't list: the chat's own row says whose.
      await openView(page, { kind: 'execution', id: 'docs-old' });
      await expect.poll(async () => (await marked(page)).agents).toEqual([{ name: 'Docs', current: ['true', 'true'] }]);

      // Home is in no agent.
      await openView(page, { kind: 'home' });
      await expect.poll(async () => (await marked(page)).agents).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  });
}

for (const style of ['agents', 'classic'] as const) {
  it(`marks the agent in ${style} only while its open chat has no row showing`, async () => {
    const { page, errors } = await open(style);
    try {
      await page.mouse.move(600, 700);
      // The chat's own row is the selection, so the agent isn't marked too.
      const chatRow = page.locator('[role="button"][tabindex="0"]:not([aria-roledescription])', { hasText: 'Update pricing copy' }).first();
      expect(await chatRow.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
      expect((await marked(page)).agents).toEqual([]);
      const current = style === 'agents' ? ['true', 'true'] : ['true'];

      // With Website's chats hidden, the agent carries the mark.
      await page.evaluate(() => {
        const client = (window as unknown as { queryClient: import('@tanstack/react-query').QueryClient }).queryClient;
        client.setQueryData<{ id: string; collapsed: boolean }[]>(['workspaces', { status: 'active' }], (all) =>
          all?.map((w) => (w.id === 'web' ? { ...w, collapsed: true } : w)));
      });
      await expect.poll(async () => (await marked(page)).agents).toEqual([{ name: 'Website', current }]);

      // An archived chat has no row under its agent, though its agent's list shows.
      await openView(page, { kind: 'execution', id: 'ri-old' });
      await expect.poll(async () => (await marked(page)).agents).toEqual([{ name: 'Ri', current }]);
      await page.screenshot({ path: `/tmp/ri-rail-open-chat-${style}.png`, clip: { x: 0, y: 0, width: 256, height: 520 } });
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  });
}

it("marks the agent you're in in the collapsed rail's Agents flyout, and scrolls to it", async () => {
  // Short enough that Docs, the last agent, opens below the fold.
  const { page, errors } = await open('agentsOnly', 'dark', { rail: 'strip', height: 300, view: { kind: 'execution', id: 'docs-old' } });
  try {
    await page.getByRole('button', { name: /^Agents/ }).click();
    const flyout = page.getByRole('dialog', { name: 'Agents' });
    await flyout.getByText('Docs', { exact: true }).waitFor();
    await page.mouse.move(600, 290);
    await expect.poll(async () => (await marked(page, '[data-rail-flyout]')).agents).toEqual([{ name: 'Docs', current: ['true', 'true'] }]);

    // The list opened scrolled, with Docs whole inside it.
    const list = flyout.locator('.overflow-y-auto').first();
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    const box = (await list.boundingBox())!;
    const docs = (await flyout.locator('[data-agent-id="docs"]').boundingBox())!;
    expect(docs.y).toBeGreaterThanOrEqual(box.y);
    expect(docs.y + docs.height).toBeLessThanOrEqual(box.y + box.height);
    await page.screenshot({ path: '/tmp/ri-rail-flyout-scrolled.png', clip: { x: 0, y: 0, width: 320, height: 300 } });

    // Scrolling it yourself sticks: nothing pulls it back.
    await list.hover();
    await page.mouse.wheel(0, -1000);
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(0);
    await page.setViewportSize({ width: 640, height: 320 });
    await page.waitForTimeout(200);
    expect(await list.evaluate((el) => el.scrollTop)).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});

it("leaves a list that fits where it is in the flyout, its agent marked", async () => {
  const { page, errors } = await open('agentsOnly', 'dark', { rail: 'strip' });
  try {
    await page.getByRole('button', { name: /^Agents/ }).click();
    const flyout = page.getByRole('dialog', { name: 'Agents' });
    await flyout.getByText('Website', { exact: true }).waitFor();
    await page.mouse.move(600, 700);
    await expect.poll(async () => (await marked(page, '[data-rail-flyout]')).agents).toEqual([{ name: 'Website', current: ['true', 'true'] }]);
    expect(await flyout.locator('.overflow-y-auto').first().evaluate((el) => el.scrollTop)).toBe(0);
    await page.screenshot({ path: '/tmp/ri-rail-flyout-open-chat.png', clip: { x: 0, y: 0, width: 320, height: 520 } });
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});

it('marks an agent read or unread from its rail menu, its main chat only', async () => {
  const { page, errors } = await open('agentsOnly');
  try {
    // Ri has a new reply. Read clears it, and nothing under it.
    await (await menu(page, 'Ri')).getByRole('menuitem', { name: 'Mark as read' }).click();
    await expect.poll(async () => Number(await nameWeight(page, 'Ri'))).toBeLessThan(600);
    await expect.poll(() => sent).toEqual(['readPost:ri-main']);

    // Notes is quiet. Unread marks its main chat: bold, with its line.
    sent = [];
    expect(Number(await nameWeight(page, 'Notes'))).toBeLessThan(600);
    await (await menu(page, 'Notes')).getByRole('menuitem', { name: 'Mark as unread' }).click();
    await expect.poll(async () => Number(await nameWeight(page, 'Notes'))).toBeGreaterThanOrEqual(600);
    await expect.poll(() => sent).toEqual(['unreadPost:notes-main']);
    // And it reads back as unread, so the menu offers Mark as read.
    expect(await (await menu(page, 'Notes')).getByRole('menuitem', { name: 'Mark as read' }).count()).toBe(1);
    await page.keyboard.press('Escape');

    // An agent with no main chat has nothing to mark.
    const docs = await menu(page, 'Docs');
    expect(await docs.getByRole('menuitem').allInnerTexts()).toEqual(['New chat', 'Agent setup']);
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});

it("marks the chat you're reading unread from its chat bar, and the rail agrees", async () => {
  const { page, errors } = await open('agentsOnly');
  try {
    const bar = page.locator('[data-chat-bar]');
    await bar.getByRole('button', { name: 'Mark unread' }).click();
    // The bar says so, and the agent lights up in the rail.
    await bar.getByRole('button', { name: 'Unread, mark read' }).waitFor();
    await expect.poll(async () => Number(await nameWeight(page, 'Notes'))).toBeGreaterThanOrEqual(600);
    await expect.poll(() => sent).toEqual(['unreadPost:notes-main']);
    await page.screenshot({ path: '/tmp/ri-chat-bar-unread.png', clip: { x: 0, y: 0, width: 420, height: 520 } });

    // A click on it reads it again, in both places.
    sent = [];
    await bar.getByRole('button', { name: 'Unread, mark read' }).click();
    await bar.getByRole('button', { name: 'Mark unread' }).waitFor();
    await expect.poll(async () => Number(await nameWeight(page, 'Notes'))).toBeLessThan(600);
    await expect.poll(() => sent).toEqual(['readPost:notes-main']);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});

it('gives the counts way to the actions on hover', async () => {
  const { page, errors } = await open('agentsOnly');
  try {
    await page.getByText('Finances', { exact: true }).hover();
    await agentRow(page, 'Finances').getByRole('button', { name: 'New chat', exact: true }).waitFor();
    expect((await countsOf(page)).Finances).toEqual({});
    await page.mouse.move(600, 700);
    await expect.poll(async () => (await countsOf(page)).Finances).toEqual({ 'needs-you': '2', working: '1' });
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});

it('lists recent chats of any status in Recent, and folds the inactive ones', async () => {
  const { page, errors } = await open('agentsOnly');
  try {
    await page.getByRole('tab', { name: 'Recent' }).click();
    const recent = page.locator('aside');
    // Yesterday's archived chat is recent work. Three weeks ago is inactive.
    await recent.getByText('Ship the v1 pricing page').waitFor();
    expect(await recent.getByText('Fix login bug').count()).toBeGreaterThan(0);
    expect(await recent.getByText('Old migration cleanup').count()).toBe(0);
    await recent.getByText('1 inactive hidden').waitFor();
    // New agent belongs to the Agents list.
    expect(await page.getByRole('button', { name: 'New agent' }).count()).toBe(0);
    await page.screenshot({ path: '/tmp/ri-rail-recent.png', clip: { x: 0, y: 0, width: 256, height: 760 } });

    await recent.getByRole('button', { name: /Show/ }).last().click();
    await recent.getByText('Old migration cleanup').waitFor();
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});

it("peeks at an agent's chats when you rest on it", async () => {
  const { page, errors } = await open('agentsOnly');
  try {
    await page.getByText('Finances', { exact: true }).hover();
    const peek = page.getByRole('navigation', { name: 'Finances chats' });
    await peek.waitFor();
    const rows = await peek.locator('[role="button"]').allInnerTexts();
    expect(rows.join('\n')).toContain('Reconcile Amex');
    expect(rows.join('\n')).toContain('Import Chase CSV');
    expect(rows.join('\n')).toContain('Tax estimate');
    await page.screenshot({ path: '/tmp/ri-rail-agents-only-peek.png', clip: { x: 0, y: 0, width: 600, height: 520 } });
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});

it('opens no tooltip on an agent, only on its hover actions', async () => {
  const { page, errors } = await open('agentsOnly');
  try {
    const row = (name: string) =>
      page.locator('[aria-roledescription="sortable"]', { has: page.getByText(name, { exact: true }) });
    // Longer than the tooltip's open delay (500ms).
    const settle = () => page.waitForTimeout(900);

    // The icon used to say the presence ("Thinking"). Research has no chats,
    // so no peek opens over it either.
    await page.getByRole('button', { name: 'Research: Thinking', exact: true }).hover();
    await settle();
    expect(await page.getByRole('tooltip').count()).toBe(0);

    // Docs's line is cut off, which used to show the name and line whole.
    await row('Docs').getByText('Docs', { exact: true }).hover();
    const line = row('Docs').getByText(/^Keeps the product docs current/);
    expect(await line.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await settle();
    expect(await page.getByRole('tooltip').count()).toBe(0);
    await page.screenshot({ path: '/tmp/ri-rail-agent-hover.png', clip: { x: 0, y: 0, width: 420, height: 520 } });

    // Its hover actions still say what they do.
    await row('Docs').getByRole('button', { name: 'New chat', exact: true }).hover();
    await page.getByRole('tooltip').filter({ hasText: 'shift-click' }).first().waitFor();
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});

it('leaves agents first as it was', async () => {
  const { page, errors } = await open('agents');
  try {
    expect(await page.getByRole('tablist', { name: 'Rail list' }).count()).toBe(1);
    expect(await page.getByText('Needs you', { exact: true }).count()).toBe(1);
    // Each row shows only its own state: the agent's line is its own.
    const lines = await agentLines(page);
    expect(lines.find((l) => l.name === 'Website')?.line).toBe('Deployed the preview build.');
    expect(lines.find((l) => l.name === 'Finances')?.line).toBe('Categorized October.');
    expect(await page.getByText('Fix login bug').count()).toBeGreaterThan(0);
    // Mark as unread is on the agent here too, for the agent itself.
    expect(await (await menu(page, 'Notes')).getByRole('menuitem', { name: 'Mark as unread' }).count()).toBe(1);
    await page.keyboard.press('Escape');
    await page.screenshot({ path: '/tmp/ri-rail-agents-first.png', clip: { x: 0, y: 0, width: 256, height: 760 } });
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});
