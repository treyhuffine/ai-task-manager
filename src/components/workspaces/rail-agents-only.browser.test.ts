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
 * agree), that resting on an agent opens nothing while its Show chats opens
 * Recent on that agent's chats, that hovering an
 * agent opens no tooltip while its hover actions keep theirs, that Agents
 * first is unchanged, and that chats are selected to archive in the list
 * you're on, under each agent on Agents, in every rail style and the collapsed
 * rail's flyout.
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
/** Session mutations the page sent, as `readPost:<id>` (`:dismiss` for an explicit Mark as read) / `unreadPost:<id>` / `archivePost:<id>`. */
let sent: string[] = [];
/**
 * Archive requests wait here until a test answers them: archived, or refused
 * with uncommitted files for the ids in `dirty`. Unforced only, so Archive
 * anyway archives.
 */
let heldArchives: { id: string; force: boolean; answer: (dirty?: string[]) => void }[] = [];
const answerArchives = (dirty: string[] = []) => {
  for (const held of heldArchives.splice(0)) held.answer(dirty);
};

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
      import {useRailTab} from '@/lib/client/rail-tab';
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
      import {AgentOverview} from '@/components/agents/agent-overview';
      import {AgentsFlyout} from '@/components/workspaces/rail-strip';
      import {useDashboard} from '@/contexts/dashboard-context';
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
      const chat=(id,workspaceId,label,{unread=false,pinnedAt=null,minutesAgo=5,turnStatus=null}={})=>({
        id,label,status:'active',harness:'claude',workspaceId,workspaceName:workspaces.find(w=>w.id===workspaceId).name,
        workspaceAttachments:[],workspaceEmoji:null,workspaceIsGit:true,branchName:null,location:null,
        startedAt:at(minutesAgo+55),lastActivityAt:at(minutesAgo),lastOutcomeEventAt:at(minutesAgo),
        lastViewedAt:unread?at(minutesAgo+5):at(minutesAgo-4),unreadMarkerAt:null,
        executionId:id,execution:{label,pinnedAt},turnStatus,
      });
      // Status lines its agents set at the end of their turns (docs/chat-status-lines.md).
      const ask=(line,effort,unblocks=null)=>({line,needsYou:true,effort,unblocks,at:at(5)});
      const report=(line)=>({line,needsYou:false,effort:null,unblocks:null,at:at(5)});
      const main=(id,workspaceId,preview,{unread=false}={})=>({
        id,workspaceId,preview,waitingOn:null,lastOutcomeEventAt:at(5),unreadMarkerAt:null,lastViewedAt:unread?at(10):at(1),
      });
      const sessions=[
        chat('ri-1','ri','Rail agents-only trial'),
        chat('ri-2','ri','Fix flaky gallery smoke',{turnStatus:report('Fixed the flaky smoke, nothing needed')}),
        chat('web-1','web','Fix login bug'),
        chat('web-2','web','Update pricing copy'),
        chat('fin-1','fin','Reconcile Amex',{unread:true,turnStatus:ask('Pick a category for the two Amex refunds','quick',"October's close")}),
        chat('fin-2','fin','Import Chase CSV',{unread:true}),
        chat('fin-3','fin','Tax estimate',{pinnedAt:at(30)}),
        // Untouched past the week: inactive.
        chat('web-3','web','Audit old landing pages',{minutesAgo:12*24*60}),
        chat('ri-3','ri','Prune stale worktrees',{minutesAgo:30*24*60}),
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
      // Where archiving the chat on screen leaves to.
      const navigation={openAgent:(id)=>window.actions.push({kind:'leave',value:id}),openExecution:noop,openTask:noop,openNote:noop,goHome:()=>window.actions.push({kind:'leave',value:'home'})};
      const activity={streamingSessionIds:new Set(['ri-1','fin-3','res-main']),backgroundSessionIds:new Set(),pendingInputSessionIds:new Set(['web-1']),setActiveExecutionId:noop,setSessionStreaming:noop};
      // The chat on screen, as the dashboard has it.
      function Work({children}){
        const {activeSessionId,activeExecutionId}=useDashboard();
        return <WorkContext navigation={navigation} activity={{...activity,activeSessionId,activeExecutionId}}>{children}</WorkContext>;
      }
      // The tab lives where the real rail keeps it, so an agent's Show chats can switch it.
      function Rail(){
        const {tab,setTab}=useRailTab();
        return <WorkspaceSelectionProvider>
          <RailListHeader tab={tab} onSelect={setTab}/>
          <RailListBody tab={tab}/>
        </WorkspaceSelectionProvider>;
      }
      // The wide rail's scroller as the rail lays it out: the header sticks in
      // the same scroller as the list.
      function ScrollingRail(){
        const [tab,setTab]=useState('workspace');
        return <WorkspaceSelectionProvider>
          <div className="h-32">Places</div>
          <div className="sticky top-0 z-30 bg-background"><RailListHeader tab={tab} onSelect={setTab}/></div>
          <RailListBody tab={tab} stickyHeaderHeight={32}/>
        </WorkspaceSelectionProvider>;
      }
      // The wide rail's list, or the collapsed strip's Agents button.
      const railKind=new URLSearchParams(location.search).get('rail');
      const strip=railKind==='strip';
      // The agent view's Chats tab, for one agent, beside the rail.
      const chatsTab=new URLSearchParams(location.search).get('panel')==='chats';
      createRoot(document.getElementById('root')).render(
        <QueryClientProvider client={client}><TooltipProvider><ConfirmProvider>
          <Work><SessionHoverProvider disabled>
            {strip
              ? <aside className="flex h-screen w-[44px] flex-col items-center pt-2 border-r border-border bg-background"><AgentsFlyout/></aside>
              : railKind==='scroller'
                ? <aside data-rail-scroller className="h-screen w-[256px] overflow-y-auto border-r border-border bg-background"><ScrollingRail/></aside>
                : <aside className="w-[256px] min-h-screen border-r border-border bg-background"><Rail/></aside>}
            <div data-chat-bar className="fixed left-[300px] top-4 flex items-center gap-1.5"><ReadStateButton sessionId="notes-main"/></div>
            {chatsTab && <div data-chats-tab className="fixed left-[300px] top-12 w-[320px] bg-background"><AgentOverview workspace={workspaces.find(w=>w.id==='fin')} onSelectTab={noop}/></div>}
          </SessionHoverProvider></Work>
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
          // An explicit Mark as read dismisses the chat's status line too.
          const dismiss = body.includes('"dismiss":true') ? ':dismiss' : '';
          for (const id of body.match(/"id":"([^"]+)"/g) ?? []) sent.push(`${kind}:${id.slice(6, -1)}${dismiss}`);
        }
        if (url.pathname.includes('sessions.archivePost')) {
          const id = /"id":"([^"]+)"/.exec(body)![1]!;
          const force = body.includes('"force":true');
          sent.push(`archivePost:${id}${force ? ':force' : ''}`);
          res.setHeader('content-type', 'application/json');
          heldArchives.push({ id, force, answer: (dirty = []) => {
            if (force || !dirty.includes(id)) { res.end(JSON.stringify({ result: { data: {} } })); return; }
            // The archive route's refusal, as the tRPC adapter carries it.
            res.statusCode = 409;
            res.end(JSON.stringify({ error: { message: 'Uncommitted files', code: -32603, data: { httpStatus: 409, body: {
              error: 'DirtyWorktreeError', code: 'dirty_worktree', message: 'Uncommitted files', label: id === 'web-1' ? 'Fix login bug' : id,
              files: [{ path: 'src/login.ts', change: 'changed' }], omitted: 0,
            } } } }));
          } });
          return;
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
  { rail = 'wide', view, height = 760, touch = false }: { rail?: 'wide' | 'strip' | 'scroller'; view?: View; height?: number; touch?: boolean } = {},
): Promise<{ page: Page; errors: string[] }> {
  sent = [];
  heldArchives = [];
  // Touch is a tablet's: the collapsed rail, fingers on the flyout's rows.
  const page = await browser.newPage({ viewport: { width: 640, height }, deviceScaleFactor: 2, hasTouch: touch });
  page.setDefaultTimeout(5_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(({ style, view }) => {
    localStorage.setItem('ri.client.railStyle', style);
    if (view) Object.assign(window, { initialView: view });
  }, { style, view });
  await page.goto(`${base}/?theme=${theme}&rail=${rail}`);
  if (rail !== 'strip') await page.getByRole('button', { name: 'Open Docs', exact: true }).waitFor();
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
      // The Agents | Recent switch, then Pinned. No Needs you. Selecting
      // chats to archive is here too, though it selects them on Recent.
      expect(await page.getByRole('tab').allInnerTexts()).toEqual(['Agents', 'Recent']);
      expect(await page.getByText('Needs you', { exact: true }).count()).toBe(0);
      expect(await page.getByRole('button', { name: 'Select chats to archive' }).count()).toBe(1);
      expect(await page.getByRole('button', { name: 'New agent' }).count()).toBe(1);
      const switchTop = (await page.getByRole('tablist').boundingBox())!.y;
      const pinnedTop = (await page.getByText('Pinned', { exact: true }).boundingBox())!.y;
      expect(switchTop).toBeLessThan(pinnedTop);

      // No chat sits under an agent, and the chats waiting on you are one
      // Unread row with their count under the pin, not a list.
      const chatRows = await page.locator('[role="button"][tabindex="0"]:not([aria-roledescription])').allInnerTexts();
      expect(chatRows).toHaveLength(1);
      expect(chatRows[0]).toContain('Tax estimate');
      const unread = page.getByRole('button', { name: /^Unread/ });
      expect((await unread.innerText()).replace(/\s+/g, ' ').trim()).toBe('Unread 2');
      const unreadTop = (await unread.boundingBox())!.y;
      const firstAgentTop = (await page.getByText('Ri', { exact: true }).first().boundingBox())!.y;
      expect(pinnedTop).toBeLessThan(unreadTop);
      expect(unreadTop).toBeLessThan(firstAgentTop);

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
    await expect.poll(() => sent).toEqual(['readPost:ri-main:dismiss']);

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
    await expect.poll(() => sent).toEqual(['readPost:notes-main:dismiss']);
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
    // Yesterday's archived chat is recent work. Three weeks ago is inactive,
    // with two active chats untouched past the week.
    await recent.getByText('Ship the v1 pricing page').waitFor();
    expect(await recent.getByText('Fix login bug').count()).toBeGreaterThan(0);
    expect(await recent.getByText('Old migration cleanup').count()).toBe(0);
    await recent.getByText('3 inactive hidden').waitFor();
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

it('peeks the Unread chats from its row, and a chat there shows its latest messages beside it', async () => {
  const { page, errors } = await open('agentsOnly');
  try {
    // Resting on the row peeks the chats beside the rail.
    await page.getByRole('button', { name: /^Unread/ }).hover();
    const flyout = page.getByRole('dialog', { name: 'Unread' });
    await flyout.waitFor();
    const rows = flyout.locator('nav [role="button"][tabindex="0"]');
    expect((await rows.allInnerTexts()).map((t) => t.split('\n')[0])).toEqual(['Reconcile Amex', 'Import Chase CSV']);

    // Resting on a chat there shows its latest messages beside the flyout.
    await rows.first().hover();
    const preview = page.getByRole('dialog', { name: 'Session preview' });
    await preview.waitFor();
    const flyoutBox = (await flyout.boundingBox())!;
    expect((await preview.boundingBox())!.x).toBeGreaterThanOrEqual(flyoutBox.x + flyoutBox.width - 1);
    await page.screenshot({ path: '/tmp/ri-rail-unread-flyout.png', clip: { x: 0, y: 0, width: 900, height: 560 } });

    // Moving onto the preview holds the flyout, and a click in it is no
    // click outside.
    const box = (await preview.boundingBox())!;
    await page.mouse.move(flyoutBox.x + flyoutBox.width - 4, box.y + 20, { steps: 2 });
    await page.mouse.move(box.x + 40, box.y + 20, { steps: 4 });
    await page.waitForTimeout(500);
    expect(await flyout.isVisible()).toBe(true);
    await page.mouse.click(box.x + 40, box.y + 20);
    await page.waitForTimeout(300);
    expect(await flyout.isVisible()).toBe(true);

    // Esc puts it away.
    await page.keyboard.press('Escape');
    await flyout.waitFor({ state: 'hidden' });
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});

it('narrows Unread to one agent from the flyout, and lets go when that agent has nothing left', async () => {
  const { page, errors } = await open('agentsOnly');
  try {
    // Waiting: Finances' two, Ri's one, and an inactive one of Website's.
    const setWaiting = (ids: string[]) => page.evaluate((ids) => {
      const client = (window as unknown as { queryClient: import('@tanstack/react-query').QueryClient }).queryClient;
      const { sessions } = client.getQueryData<{ sessions: { id: string }[] }>(['sessions', 'rail'])!;
      client.setQueryData(['sessions', 'needs-review'], ids.map((id) => sessions.find((s) => s.id === id)));
    }, ids);
    await setWaiting(['fin-1', 'fin-2', 'ri-2', 'web-3']);

    // A peek shows every agent's chats, and the filter says so.
    const row = page.getByRole('button', { name: /^Unread/ });
    await row.hover();
    const flyout = page.getByRole('dialog', { name: 'Unread' });
    await flyout.waitFor();
    const titles = async () => (await flyout.locator('nav [role="button"][tabindex="0"]').allInnerTexts()).map((t) => t.split('\n')[0]);
    expect(await titles()).toEqual(['Reconcile Amex', 'Import Chase CSV', 'Fix flaky gallery smoke']);
    const filter = flyout.getByRole('button', { name: 'Show unread chats from one agent' });
    expect(await filter.innerText()).toBe('All agents');
    // A closing list is still the top layer, and still has what you typed.
    const listClosed = () => page.getByPlaceholder('Find an agent…').waitFor({ state: 'hidden' });

    // Its list has only the agents with a chat here, in the rail's order.
    await filter.click();
    const options = page.getByRole('option');
    await options.first().waitFor();
    expect((await options.allInnerTexts()).map((t) => t.split('\n').at(-1))).toEqual(['All agents', 'Ri', 'Website', 'Finances']);
    await page.screenshot({ path: '/tmp/ri-rail-unread-filter-list.png', clip: { x: 0, y: 0, width: 640, height: 400 }, animations: 'disabled' });

    // Esc closes the list and leaves the flyout, which pressing inside it held.
    await page.keyboard.press('Escape');
    await listClosed();
    await page.mouse.move(620, 700, { steps: 4 });
    await page.waitForTimeout(400);
    expect(await flyout.isVisible()).toBe(true);

    // Picking one narrows the list and its count, not the row's. The rows
    // stop repeating the agent the filter names.
    await filter.click();
    await page.getByRole('option', { name: 'Finances' }).click();
    const narrowed = flyout.getByRole('button', { name: 'Showing unread chats from Finances. Change agent' });
    await narrowed.waitFor();
    await listClosed();
    expect(await titles()).toEqual(['Reconcile Amex', 'Import Chase CSV']);
    const header = narrowed.locator('xpath=..');
    expect((await header.innerText()).replace(/\s+/g, ' ').trim()).toBe('UNREAD 💵 Finances 2');
    expect(await flyout.locator('nav').innerText()).not.toContain('· Finances');
    expect((await row.innerText()).replace(/\s+/g, ' ').trim()).toBe('Unread 3');
    expect(await flyout.locator('nav').innerText()).not.toContain('inactive');
    await page.screenshot({ path: '/tmp/ri-rail-unread-filtered.png', clip: { x: 0, y: 0, width: 640, height: 400 } });

    // One click outside closes it, even after pressing inside. It outlives
    // the flyout and the row, since opening a chat closes one and collapsing
    // the rail remounts the other.
    await page.mouse.click(620, 700);
    await flyout.waitFor({ state: 'hidden' });
    await page.getByRole('tab', { name: 'Recent' }).click();
    await row.waitFor({ state: 'detached' });
    await page.getByRole('tab', { name: 'Agents' }).click();
    await row.click();
    await narrowed.waitFor();
    expect(await titles()).toEqual(['Reconcile Amex', 'Import Chase CSV']);

    // Typing finds an agent, and an inactive-only agent's chats wait behind
    // the fold, as they do with no filter.
    await narrowed.click();
    await page.getByPlaceholder('Find an agent…').fill('web');
    await page.keyboard.press('Enter');
    await flyout.getByRole('button', { name: 'Showing unread chats from Website. Change agent' }).waitFor();
    await listClosed();
    expect(await titles()).toEqual([]);
    expect(await flyout.locator('nav').innerText()).toContain('1 inactive');

    // Back to everyone's from the list's top.
    await flyout.getByRole('button', { name: 'Showing unread chats from Website. Change agent' }).click();
    await page.getByRole('option', { name: 'All agents' }).click();
    await filter.waitFor();
    await listClosed();
    expect(await titles()).toEqual(['Reconcile Amex', 'Import Chase CSV', 'Fix flaky gallery smoke']);

    // That agent's last chat read, the filter lets go, and doesn't come back
    // on its own when the agent next has one.
    await filter.click();
    await page.getByRole('option', { name: 'Finances' }).click();
    await narrowed.waitFor();
    await setWaiting(['ri-2', 'web-3']);
    await filter.waitFor();
    expect(await titles()).toEqual(['Fix flaky gallery smoke']);
    await setWaiting(['fin-1', 'ri-2', 'web-3']);
    await expect.poll(titles).toEqual(['Reconcile Amex', 'Fix flaky gallery smoke']);
    expect(await filter.innerText()).toBe('All agents');

    // A long name gives way, so the count stays in the flyout.
    await page.evaluate(() => {
      const client = (window as unknown as { queryClient: import('@tanstack/react-query').QueryClient }).queryClient;
      client.setQueryData<{ id: string; name: string }[]>(['workspaces', { status: 'active' }], (list) =>
        list!.map((w) => (w.id === 'ri' ? { ...w, name: 'Ri, the app and everything it ships with' } : w)));
    });
    await filter.click();
    await page.getByRole('option', { name: /Ri, the app/ }).click();
    const long = flyout.getByRole('button', { name: /^Showing unread chats from Ri, the app/ });
    await long.waitFor();
    const flyoutBox = (await flyout.boundingBox())!;
    const countBox = (await long.locator('xpath=following-sibling::span').boundingBox())!;
    expect(countBox.x + countBox.width).toBeLessThanOrEqual(flyoutBox.x + flyoutBox.width);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});

it("narrows Unread from the collapsed rail's Agents flyout, and stays narrowed when that closes", async () => {
  const { page, errors } = await open('agentsOnly', 'dark', { rail: 'strip' });
  try {
    await page.evaluate(() => {
      const client = (window as unknown as { queryClient: import('@tanstack/react-query').QueryClient }).queryClient;
      const { sessions } = client.getQueryData<{ sessions: { id: string }[] }>(['sessions', 'rail'])!;
      client.setQueryData(['sessions', 'needs-review'], ['fin-1', 'ri-2'].map((id) => sessions.find((s) => s.id === id)));
    });
    const openUnread = async () => {
      await page.getByRole('button', { name: /^Agents/ }).click();
      await page.getByRole('dialog', { name: 'Agents' }).getByRole('button', { name: /^Unread/ }).click();
      const flyout = page.getByRole('dialog', { name: 'Unread' });
      await flyout.waitFor();
      return flyout;
    };
    const flyout = await openUnread();
    await flyout.getByRole('button', { name: 'Show unread chats from one agent' }).click();
    await page.getByRole('option', { name: 'Finances' }).click();
    const narrowed = flyout.getByRole('button', { name: 'Showing unread chats from Finances. Change agent' });
    await narrowed.waitFor();
    await page.getByPlaceholder('Find an agent…').waitFor({ state: 'hidden' });
    const rows = flyout.locator('nav [role="button"][tabindex="0"]');
    expect((await rows.allInnerTexts()).map((t) => t.split('\n')[0])).toEqual(['Reconcile Amex']);
    await page.screenshot({ path: '/tmp/ri-rail-unread-filter-strip.png', clip: { x: 0, y: 0, width: 640, height: 400 } });

    // The list unmounts with the Agents flyout. The filter doesn't.
    await page.mouse.click(630, 700);
    await page.getByRole('dialog', { name: 'Agents' }).waitFor({ state: 'hidden' });
    await openUnread();
    await narrowed.waitFor();
    expect((await rows.allInnerTexts()).map((t) => t.split('\n')[0])).toEqual(['Reconcile Amex']);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});

it('shows status lines under chat titles in Unread and Recent, and Mark as read dismisses one', async () => {
  const { page, errors } = await open('agentsOnly');
  try {
    // In Unread, the ask has its line, and the size of your part ends the
    // metadata line, naming you so it can't pass for how long ago.
    await page.getByRole('button', { name: /^Unread/ }).click();
    const flyout = page.getByRole('dialog', { name: 'Unread' });
    const amex = flyout.locator('nav [role="button"][tabindex="0"]', { hasText: 'Reconcile Amex' }).first();
    expect(await amex.locator('[data-chat-status="needs-you"]').innerText()).toBe('Pick a category for the two Amex refunds');
    const size = amex.locator('[data-chat-ask-size]');
    expect(await size.innerText()).toBe('Quick for you');
    // A chip, so it reads as an indicator and not one more piece of metadata.
    expect(await size.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    // Gray: amber is for what wants you, and the row's dot says that.
    expect(await size.getAttribute('class')).not.toContain('amber');
    await page.screenshot({ path: '/tmp/ri-rail-status-lines.png', clip: { x: 0, y: 0, width: 560, height: 520 } });

    // Mark as read dismisses it: the server is told so, and it leaves Unread.
    await amex.hover();
    await amex.getByRole('button', { name: 'Session actions' }).click();
    await page.getByRole('menuitem', { name: 'Mark as read' }).click();
    await expect.poll(() => sent).toContain('readPost:fin-1:dismiss');
    await expect.poll(async () => (await flyout.locator('nav').innerText())).not.toContain('Reconcile Amex');
    await page.keyboard.press('Escape');

    // In Recent, a report takes the agent's place on the second line.
    await page.getByRole('tab', { name: 'Recent' }).click();
    const smoke = page.locator('aside [role="button"]', { hasText: 'Fix flaky gallery smoke' }).first();
    expect(await smoke.locator('[data-chat-status="fyi"]').innerText()).toBe('Fixed the flaky smoke, nothing needed');
    // Recent is what happened, so it leaves the size to Unread.
    expect(await page.locator('aside [data-chat-ask-size]').count()).toBe(0);
    await page.screenshot({ path: '/tmp/ri-rail-recent-status.png', clip: { x: 0, y: 0, width: 256, height: 520 } });
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});

it("opens nothing on rest, and its chats button slides its chats out with previews", async () => {
  const { page, errors } = await open('agentsOnly');
  try {
    // Resting on an agent with chats used to slide them out. Not here.
    await page.getByText('Finances', { exact: true }).hover();
    await page.waitForTimeout(600);
    const flyout = page.getByRole('dialog', { name: 'Finances chats' });
    expect(await flyout.count()).toBe(0);

    // Resting on its chats button doesn't either. A click does, right there.
    const button = agentRow(page, 'Finances').getByRole('button', { name: 'Finances chats', exact: true });
    await button.hover();
    await page.getByRole('tooltip').filter({ hasText: "View agent's chats" }).first().waitFor();
    expect(await flyout.count()).toBe(0);
    await button.click();
    await flyout.waitFor();
    expect(await page.getByRole('tab', { name: 'Agents' }).getAttribute('aria-selected')).toBe('true');
    const rows = flyout.locator('nav [role="button"][tabindex="0"]');
    expect((await rows.allInnerTexts()).map((t) => t.split('\n')[0])).toEqual(['Reconcile Amex', 'Import Chase CSV', 'Tax estimate']);
    expect(await rows.first().locator('[data-chat-status="needs-you"]').innerText()).toBe('Pick a category for the two Amex refunds');

    // Resting on a chat shows its latest messages beside the flyout.
    await rows.first().hover();
    const preview = page.getByRole('dialog', { name: 'Session preview' });
    await preview.waitFor();
    const flyoutBox = (await flyout.boundingBox())!;
    expect((await preview.boundingBox())!.x).toBeGreaterThanOrEqual(flyoutBox.x + flyoutBox.width - 1);
    await page.screenshot({ path: '/tmp/ri-rail-agent-chats.png', clip: { x: 0, y: 0, width: 900, height: 560 } });

    // A click opened it, so the pointer leaving doesn't close it. Esc does.
    await page.mouse.move(880, 700);
    await page.waitForTimeout(500);
    expect(await flyout.isVisible()).toBe(true);
    await page.keyboard.press('Escape');
    await flyout.waitFor({ state: 'hidden' });
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});

it("shows the status line and the size chip in the agent's Chats tab", async () => {
  const { page, errors } = await open('agentsOnly');
  try {
    await page.goto(`${base}/?theme=dark&panel=chats`);
    const tab = page.locator('[data-chats-tab]');
    const amex = tab.locator('[role="button"]', { hasText: 'Reconcile Amex' }).first();
    await amex.waitFor();
    expect(await amex.locator('[data-chat-status="needs-you"]').innerText()).toBe('Pick a category for the two Amex refunds');
    expect(await amex.locator('[data-chat-ask-size]').innerText()).toBe('Quick for you');
    // A chat with no status keeps the row it had.
    const chase = tab.locator('[role="button"]', { hasText: 'Import Chase CSV' }).first();
    expect(await chase.locator('[data-chat-status]').count()).toBe(0);
    await page.waitForTimeout(250);
    await page.screenshot({ path: '/tmp/ri-agent-chats-tab.png', clip: { x: 290, y: 40, width: 350, height: 300 } });
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

// ─── Selecting chats to archive ──────────────────────────────────────────

/** The chats active right now and touched within the week, by name. */
const RECENT_ACTIVE = [
  'Fix flaky gallery smoke', 'Fix login bug', 'Import Chase CSV', 'Rail agents-only trial',
  'Reconcile Amex', 'Tax estimate', 'Update pricing copy',
];
const INACTIVE_ACTIVE = ['Audit old landing pages', 'Prune stale worktrees'];

const ROW = '[data-select-row]';
/** The selectable rows, top to bottom: each chat's name and whether it's ticked. */
const ticks = (page: Page, within = 'body') =>
  page.locator(within).locator(ROW).evaluateAll((rows) =>
    rows.map((row) => ({ name: row.querySelector('.truncate')!.textContent!, ticked: row.getAttribute('aria-pressed') === 'true' })));
const ticked = async (page: Page, within = 'body') => (await ticks(page, within)).filter((r) => r.ticked).map((r) => r.name);
const tickRow = (page: Page, name: string, within = 'body') => page.locator(within).locator(ROW, { hasText: name });
const selectedCount = (page: Page) => page.getByText(/^\d+ selected$/).innerText();
const archivePosts = () => sent.filter((s) => s.startsWith('archivePost:')).sort();
/** Each agent showing while selecting, with its chats' names sorted. */
const agentSections = (page: Page, within = 'body') =>
  page.locator(within).locator('section[data-agent-id]').evaluateAll((sections) =>
    sections.map((section) => [
      (section as HTMLElement).dataset.agentId,
      Array.from(section.querySelectorAll('[data-select-row]'), (row) => row.querySelector('.truncate')!.textContent!).sort(),
    ]));
const agentCheck = (page: Page, name: string) => page.getByRole('checkbox', { name: `All ${name} chats` });

const UNFOLDED = [
  ['ri', ['Fix flaky gallery smoke', 'Rail agents-only trial']],
  ['web', ['Fix login bug', 'Update pricing copy']],
  ['fin', ['Import Chase CSV', 'Reconcile Amex', 'Tax estimate']],
];

for (const style of ['agentsOnly', 'agents', 'classic'] as const) {
  it(`selects chats to archive under each agent in ${style}, and stays on the list you're on`, async () => {
    const { page, errors } = await open(style);
    try {
      // A folded agent unfolds for this too.
      await page.evaluate(() => {
        const client = (window as unknown as { queryClient: import('@tanstack/react-query').QueryClient }).queryClient;
        client.setQueryData<{ id: string; collapsed: boolean }[]>(['workspaces', { status: 'active' }], (all) =>
          all?.map((w) => (w.id === 'web' ? { ...w, collapsed: true } : w)));
      });
      const select = page.getByRole('button', { name: 'Select chats to archive' });
      await select.click();
      await page.getByText('0 selected', { exact: true }).waitFor();
      expect(await page.getByRole('tablist').count()).toBe(0);
      // The agents, in their order, each with its chats under it. Ones with
      // no chats (Research, Notes, Docs) have nothing to tick.
      expect(await agentSections(page)).toEqual(UNFOLDED);
      expect(await page.locator('[aria-roledescription="sortable"]').count()).toBe(0);
      // Pins, Unread and archived work step aside. Inactive chats wait in folds.
      expect(await page.getByText('Pinned', { exact: true }).count()).toBe(0);
      expect(await page.getByRole('button', { name: /^Unread/ }).count()).toBe(0);
      expect(await page.getByText('Needs you', { exact: true }).count()).toBe(0);
      expect(await page.getByText('Ship the v1 pricing page').count()).toBe(0);
      expect(await page.getByText('1 inactive hidden').count()).toBe(2);
      expect(await ticked(page)).toEqual([]);
      expect(await page.getByRole('button', { name: 'Archive', exact: true }).isDisabled()).toBe(true);

      await page.getByRole('button', { name: 'Cancel' }).click();
      await page.getByRole('tab', { name: 'Agents', selected: true }).waitFor();
      expect(await page.locator('[aria-roledescription="sortable"]').count()).toBe(6);
      expect(await page.locator(ROW).count()).toBe(0);

      // From Recent it stays on Recent, each row still showing its agent.
      await page.getByRole('tab', { name: 'Recent' }).click();
      await page.getByText('Ship the v1 pricing page').waitFor();
      await select.click();
      await page.getByText('0 selected', { exact: true }).waitFor();
      expect(await page.locator('section[data-agent-id]').count()).toBe(0);
      expect(await page.getByText('Ship the v1 pricing page').count()).toBe(0);
      expect((await ticks(page)).map((r) => r.name).sort()).toEqual(RECENT_ACTIVE);
      expect(await tickRow(page, 'Fix login bug').innerText()).toMatch(/^W/);
      await page.getByRole('button', { name: 'Cancel' }).click();
      await page.getByRole('tab', { name: 'Recent', selected: true }).waitFor();
      await page.getByText('Ship the v1 pricing page').waitFor();
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  });
}

it('ticks a row per click and a range with Shift across agents', async () => {
  const { page, errors } = await open('agentsOnly');
  try {
    await page.getByRole('button', { name: 'Select chats to archive' }).click();
    // A click ticks rather than opens, and a second unticks.
    await tickRow(page, 'Fix login bug').click();
    expect(await ticked(page)).toEqual(['Fix login bug']);
    expect(await selectedCount(page)).toBe('1 selected');
    await tickRow(page, 'Fix login bug').click();
    expect(await ticked(page)).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { actions: { kind: string }[] }).actions.filter((a) => a.kind === 'navigate'))).toEqual([]);

    // Shift-click ticks every row from the last one ticked, past the agent
    // between them, and unticks a range the same way.
    const order = (await ticks(page)).map((r) => r.name);
    await tickRow(page, order[0]!).click();
    await tickRow(page, order[3]!).click({ modifiers: ['Shift'] });
    expect(await ticked(page)).toEqual(order.slice(0, 4));
    expect(await selectedCount(page)).toBe('4 selected');
    await tickRow(page, order[1]!).click({ modifiers: ['Shift'] });
    expect(await ticked(page)).toEqual(order.slice(0, 1));
    // Shift selects no text on the way.
    expect(await page.evaluate(() => getSelection()?.toString())).toBe('');
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});

it("ticks all of an agent's chats from its check, leaving what's working", async () => {
  const { page, errors } = await open('agentsOnly');
  try {
    await page.getByRole('button', { name: 'Select chats to archive' }).click();
    const finances = agentCheck(page, 'Finances');
    expect(await finances.getAttribute('aria-checked')).toBe('false');
    await page.getByText('3 chats', { exact: true }).first().waitFor();

    // Tax estimate is working, so one click leaves it running.
    await finances.click();
    expect((await ticked(page)).sort()).toEqual(['Import Chase CSV', 'Reconcile Amex']);
    expect(await finances.getAttribute('aria-checked')).toBe('true');
    await page.getByText('2 of 3 selected').waitFor();
    // Ticking it yourself still archives it.
    await tickRow(page, 'Tax estimate').click();
    await page.getByText('3 of 3 selected').waitFor();
    // One unticked: part of the agent.
    await tickRow(page, 'Reconcile Amex').click();
    expect(await finances.getAttribute('aria-checked')).toBe('mixed');
    await finances.click();
    expect(await finances.getAttribute('aria-checked')).toBe('true');
    await finances.click();
    expect(await ticked(page)).toEqual([]);

    // An agent's inactive chats count, and its fold opens to show them.
    await agentCheck(page, 'Website').click();
    await page.getByText('1 inactive shown').waitFor();
    expect((await ticked(page)).sort()).toEqual(['Audit old landing pages', 'Fix login bug', 'Update pricing copy']);
    await page.keyboard.press('Enter');
    expect(await ticked(page)).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});

it('ticks every inactive chat in one click, and selecting leaves the folds as they were remembered', async () => {
  const { page, errors } = await open('agentsOnly');
  try {
    const select = page.getByRole('button', { name: 'Select chats to archive' });
    await select.click();
    // Across the agents, opening each fold to show what's ticked.
    await page.getByRole('button', { name: 'Select all 2 inactive chats' }).click();
    expect(await page.getByText('1 inactive shown').count()).toBe(2);
    expect((await ticked(page)).sort()).toEqual(INACTIVE_ACTIVE);
    expect(await selectedCount(page)).toBe('2 selected');
    expect(await page.getByText('Old migration cleanup').count()).toBe(0);
    await page.mouse.move(600, 700);
    await page.screenshot({ path: '/tmp/ri-rail-select-under-agents.png', clip: { x: 0, y: 0, width: 256, height: 760 } });

    // All ticked, it unticks them. One unticked, it offers them all again.
    await page.getByRole('button', { name: 'Deselect all 2 inactive chats' }).click();
    expect(await ticked(page)).toEqual([]);
    await page.getByRole('button', { name: 'Select all 2 inactive chats' }).click();
    await tickRow(page, 'Prune stale worktrees').click();
    await page.getByRole('button', { name: 'Select all 2 inactive chats' }).waitFor();

    // One agent's fold has its own, for only its chat.
    await tickRow(page, 'Audit old landing pages').click();
    await page.getByRole('button', { name: 'Select all 1 inactive chat', exact: true }).first().click();
    expect((await ticked(page)).length).toBe(1);

    // Folds opened while selecting are forgotten on leaving.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await select.click();
    expect(await page.getByText('1 inactive hidden').count()).toBe(2);
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('inactive:')))).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});

it('archives exactly the selection, leaving the open chat and the rows on the click, then folds back', async () => {
  const { page, errors } = await open('agentsOnly');
  try {
    await page.getByRole('button', { name: 'Select chats to archive' }).click();
    // Website's "Update pricing copy" is the chat on screen.
    await tickRow(page, 'Update pricing copy').click();
    await tickRow(page, 'Fix login bug').click();
    await page.getByRole('button', { name: 'Select all 2 inactive chats' }).click();
    await page.getByRole('button', { name: 'Archive', exact: true }).click();

    // On the click, with the requests still out: the open chat is left for
    // its agent, and the rows are gone, taking Website with its last chat.
    await expect.poll(archivePosts).toEqual(['archivePost:ri-3', 'archivePost:web-1', 'archivePost:web-2', 'archivePost:web-3']);
    expect(await page.evaluate(() => (window as unknown as { actions: { kind: string; value: unknown }[] }).actions.filter((a) => a.kind === 'leave')))
      .toEqual([{ kind: 'leave', value: 'web' }]);
    await expect.poll(() => agentSections(page)).toEqual([UNFOLDED[0], UNFOLDED[2]]);
    expect(heldArchives).toHaveLength(4);

    // Archived: the agents fold back, and nothing more was sent.
    answerArchives();
    await page.getByRole('tab', { name: 'Agents', selected: true }).waitFor();
    expect(archivePosts()).toHaveLength(4);
    expect(await page.locator(ROW).count()).toBe(0);
    expect(await page.locator('[aria-roledescription="sortable"]').count()).toBe(6);

    // Recent has them, as archived.
    await page.getByRole('tab', { name: 'Recent' }).click();
    const row = page.locator('[role="button"]', { hasText: 'Fix login bug' });
    await row.waitFor();
    expect(await row.evaluate((el) => getComputedStyle(el).opacity)).toBe('0.6');
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});

it('names the chats with uncommitted files, and Archive anyway archives only those', async () => {
  const { page, errors } = await open('agentsOnly', 'dark', { view: { kind: 'home' } });
  try {
    await page.getByRole('button', { name: 'Select chats to archive' }).click();
    await tickRow(page, 'Fix login bug').click();
    await tickRow(page, 'Reconcile Amex').click();
    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    await expect.poll(archivePosts).toEqual(['archivePost:fin-1', 'archivePost:web-1']);
    answerArchives(['web-1']);

    const dialog = page.getByRole('alertdialog');
    await dialog.waitFor();
    expect(await dialog.innerText()).toContain('"Fix login bug" has work that isn\'t committed');
    expect(await dialog.innerText()).toContain('login.ts');
    await dialog.getByRole('button', { name: 'Archive anyway' }).click();
    await expect.poll(() => sent.filter((s) => s.endsWith(':force'))).toEqual(['archivePost:web-1:force']);
    answerArchives();
    await page.getByRole('tab', { name: 'Agents', selected: true }).waitFor();
    expect(archivePosts()).toEqual(['archivePost:fin-1', 'archivePost:web-1', 'archivePost:web-1:force']);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});

it('leaves selection on Esc in the rail, and leaves Esc elsewhere alone', async () => {
  const { page, errors } = await open('agentsOnly');
  try {
    const select = page.getByRole('button', { name: 'Select chats to archive' });
    // Straight after pressing Select, before anything has focus.
    await select.click();
    await page.getByText('0 selected', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: 'Agents', selected: true }).waitFor();

    // With a row ticked, focus on it.
    await select.click();
    await tickRow(page, 'Fix login bug').click();
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: 'Agents', selected: true }).waitFor();

    // Focus outside the rail (the chat bar): its Esc isn't the rail's.
    await select.click();
    await tickRow(page, 'Fix login bug').click();
    await page.locator('[data-chat-bar] button').first().focus();
    await page.keyboard.press('Escape');
    expect(await selectedCount(page)).toBe('1 selected');
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});

it("selects under the agents in the collapsed rail's flyout by touch, where Esc leaves selection before the flyout", async () => {
  const { page, errors } = await open('agentsOnly', 'dark', { rail: 'strip', touch: true, view: { kind: 'home' } });
  try {
    await page.getByRole('button', { name: /^Agents/ }).tap();
    const flyout = page.getByRole('dialog', { name: 'Agents' });
    await flyout.getByRole('button', { name: 'Select chats to archive' }).tap();
    await flyout.getByText('0 selected', { exact: true }).waitFor();
    expect(await agentSections(page, '[data-rail-flyout]')).toEqual(UNFOLDED);

    // A tap ticks, and Select all needs no hover.
    await tickRow(page, 'Fix login bug', '[data-rail-flyout]').tap();
    await flyout.getByRole('button', { name: 'Select all 2 inactive chats' }).tap();
    expect((await ticked(page, '[data-rail-flyout]')).sort()).toEqual(['Audit old landing pages', 'Fix login bug', 'Prune stale worktrees']);
    await agentCheck(page, 'Finances').tap();
    expect((await ticked(page, '[data-rail-flyout]')).length).toBe(5);
    await page.screenshot({ path: '/tmp/ri-rail-flyout-select-under-agents.png', clip: { x: 0, y: 0, width: 320, height: 760 } });

    // The first Esc leaves selection, and the flyout stays. The next closes it.
    await page.keyboard.press('Escape');
    await flyout.getByRole('tab', { name: 'Agents', selected: true }).waitFor();
    expect(await flyout.isVisible()).toBe(true);
    await page.keyboard.press('Escape');
    await flyout.waitFor({ state: 'hidden' });

    // Archive from it: the rows go on the tap, and the agents fold back.
    await page.getByRole('button', { name: /^Agents/ }).tap();
    await flyout.getByRole('button', { name: 'Select chats to archive' }).tap();
    await tickRow(page, 'Reconcile Amex', '[data-rail-flyout]').tap();
    await flyout.getByRole('button', { name: 'Archive', exact: true }).tap();
    await expect.poll(archivePosts).toEqual(['archivePost:fin-1']);
    await tickRow(page, 'Reconcile Amex', '[data-rail-flyout]').waitFor({ state: 'detached' });
    expect(heldArchives).toHaveLength(1);
    answerArchives();
    await flyout.getByRole('tab', { name: 'Agents', selected: true }).waitFor();
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});

it('keeps the agent in view while its chats scroll', async () => {
  const { page, errors } = await open('agentsOnly', 'dark', { rail: 'strip', height: 240, view: { kind: 'home' } });
  try {
    await page.getByRole('button', { name: /^Agents/ }).click();
    const flyout = page.getByRole('dialog', { name: 'Agents' });
    await flyout.getByRole('button', { name: 'Select chats to archive' }).click();
    await agentCheck(page, 'Ri').waitFor();
    const list = flyout.locator('.overflow-y-auto').first();
    await list.evaluate((el) => { el.scrollTop = 70; });
    await expect.poll(async () => (await agentCheck(page, 'Ri').boundingBox())!.y).toBe((await list.boundingBox())!.y);
    // Solid, so its chats pass under it unseen.
    const fill = await agentCheck(page, 'Ri').evaluate((el) => getComputedStyle(el.parentElement!).backgroundColor);
    expect(fill).not.toBe('rgba(0, 0, 0, 0)');
    await page.screenshot({ path: '/tmp/ri-rail-select-sticky-agent.png', clip: { x: 0, y: 0, width: 320, height: 240 } });
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});

it('keeps the agent under the toolbar in the wide rail, where the header sticks in the same scroller', async () => {
  const { page, errors } = await open('agentsOnly', 'dark', { rail: 'scroller', height: 300, view: { kind: 'home' } });
  try {
    await page.getByRole('button', { name: 'Select chats to archive' }).click();
    await agentCheck(page, 'Ri').waitFor();
    await page.locator('[data-rail-scroller]').evaluate((el) => { el.scrollTop = 220; });
    // Touching the toolbar's foot, whatever height the toolbar comes to.
    const toolbar = (await page.locator('div[data-rail-list]').first().boundingBox())!;
    expect(toolbar.y).toBe(0);
    await expect.poll(async () => (await agentCheck(page, 'Ri').boundingBox())!.y).toBe(toolbar.y + toolbar.height);
    await page.screenshot({ path: '/tmp/ri-rail-select-sticky-wide.png', clip: { x: 0, y: 0, width: 256, height: 300 } });
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});
