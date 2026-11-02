/** Actual Board, HUD, task hooks and drag surface with a small synthetic tRPC server. */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { build } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright-core';
import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest';
import type { TaskListDTO } from '@/lib/api/dto/entity-list';

let browser: Browser;
let server: http.Server;
let base: string;
let tasks: ({ id: string; title: string; status: string; sortKey: string; bodyExcerpt: string; bodyLen: number } & Partial<Pick<TaskListDTO, 'assigneeMemberId' | 'areaId' | 'hardDeadline' | 'createdAt' | 'updatedAt'>>)[];
const mutations: { procedure: string; input: Record<string, string> }[] = [];
const errors: string[] = [];
beforeEach(() => {
  tasks = ['consider', 'todo', 'in_progress', 'done', 'archived'].map((status, i) => ({ id: status, title: `${status} task`, status, sortKey: `a${i}`, bodyExcerpt: '', bodyLen: 0 }));
  mutations.length = 0;
  errors.length = 0;
});

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
  const css = await postcss([require('@tailwindcss/postcss')()]).process(fs.readFileSync('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') });
  const fixture = `
    import {useSyncExternalStore} from 'react';
    const listeners=new Set(); const subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn)};
    let view={kind:'home'};window.destinations=[];
    const navigate=next=>{view=next;window.destinations.push(next);listeners.forEach(fn=>fn())};
    const closeAllSlideouts=()=>{};
    const pending=new Set(['approval','main']);const streaming=new Set(['work']);
    export const useDashboard=()=>({activeView:useSyncExternalStore(subscribe,()=>view),activeSessionId:null,
      streamingSessionIds:streaming,pendingInputSessionIds:pending,backgroundSessionIds:new Set(),closeAllSlideouts,
      openExecution:id=>navigate({kind:'execution',id}),setActiveView:navigate,openAgent:id=>navigate({kind:'agent',id}),openTask:id=>window.destinations.push({kind:'task',id})});
    export const useOptionalDashboard=useDashboard;
    const changed=()=>window.dispatchEvent(new Event('locationchange'));
    const replace=history.replaceState.bind(history);history.replaceState=(...args)=>{replace(...args);changed()};
    const subscribeLocation=fn=>{window.addEventListener('locationchange',fn);return()=>window.removeEventListener('locationchange',fn)};
    export const useSearchParams=()=>new URLSearchParams(useSyncExternalStore(subscribeLocation,()=>location.search));
    const now=new Date().toISOString();const old='2026-01-01T00:00:00Z';
    const session=(id,label,extra={})=>({id,label,status:'active',surfaceKind:null,startedAt:now,lastActivityAt:now,lastOutcomeEventAt:null,unreadMarkerAt:null,lastViewedAt:null,workspaceName:'Builder',workspaceAttachments:[],workspaceEmoji:null,workspaceAreaId:null,...extra});
    const rail={sessions:[session('approval','Ship the board',{waitingOn:'May I publish this?'}),session('reply','Review the work',{lastOutcomeEventAt:now}),session('work','Building now'),session('quiet','Quiet conversation'),session('inactive','Old work',{lastActivityAt:old}),session('import','Settled import',{surfaceKind:'imported_agent'})],mainChats:[{id:'main',workspaceId:'builder',lastOutcomeEventAt:now,unreadMarkerAt:null,lastViewedAt:null,preview:'Ready for review',waitingOn:'Which option do you prefer?'}],resultReviewAttention:[],pendingSessionIds:['approval','main']};
    const agents=[{id:'builder',name:'Builder',attachments:[],emoji:null,areaId:null,purpose:'Build things'}];
    let activityState=new URLSearchParams(location.search).get('fixture')??'ready';
    window.setActivityState=next=>{activityState=next;listeners.forEach(fn=>fn())};
    const refetch=async()=>window.setActivityState('ready');
    export const useRailSessions=()=>{const state=useSyncExternalStore(subscribe,()=>activityState);return {data:state==='ready'?rail:undefined,isPending:state==='loading',isError:state==='error',refetch}};
    export const useWorkspaces=()=>{const state=useSyncExternalStore(subscribe,()=>activityState);return {data:state==='ready'?agents:undefined,isPending:state==='loading',isError:state==='error',refetch}};
    export const useInactivity=()=>({isInactive:s=>s.id==='inactive'});
    export const TeamLabel=()=>null;
    const teamIdentity=()=>({home:new URLSearchParams(location.search).get('home')??'team-a',viewer:new URLSearchParams(location.search).get('viewer')??'owner'});
    export const useHomeContext=()=>({home:{id:teamIdentity().home,kind:'team'},viewer:{id:teamIdentity().viewer},capabilities:{privatePlanning:false,administerMembers:teamIdentity().viewer==='owner'}});
    export const useOptionalHomeContext=()=>new URLSearchParams(location.search).has('teamBoard')?useHomeContext():null;
    export const useHomeStorageScope=()=>new URLSearchParams(location.search).has('teamBoard')?{homeId:teamIdentity().home,viewerId:teamIdentity().viewer}:null;
    export const useHomeDocumentScope=useHomeStorageScope;
    export const usePathname=()=>'/'; export const useRouter=()=>({push:()=>{},replace:()=>{}});
    export const useTeam=()=>({team:{name:'Team'},member:{id:teamIdentity().viewer,name:teamIdentity().viewer}});
    export const useTeamNav=()=>({mine:false,areaId:null,openTask:id=>window.destinations.push({kind:'task',id}),setMine:()=>{},filterArea:()=>{}});

  `;
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
      import {TooltipProvider} from '@/components/ui/tooltip';
      import {TaskBoardModal} from '@/components/tasks/task-board-modal';
      import {TeamBoard} from '@/components/team/team-board';
      import {RailStatusPills} from '@/components/dashboard/rail-status-pills';
      import {openBoard,openTaskBoard} from '@/lib/client/task-board';
      const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
      createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><TooltipProvider>
        {new URLSearchParams(location.search).has('teamBoard') ? <TeamBoard fullPage={!new URLSearchParams(location.search).has('taskList')}/> : <><button onClick={()=>openBoard()}>Board</button><button onClick={()=>openTaskBoard()}>Tasks board</button>
        <RailStatusPills/><TaskBoardModal/></>}
      </TooltipProvider></QueryClientProvider>);
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
    plugins: [{ name: 'fixture-data', setup(api) {
      api.onResolve({filter:/\/team-context$/},()=>({path:'data',namespace:'fixture'}));
      api.onResolve({ filter: /^(@\/contexts\/dashboard-context|next\/navigation|@\/hooks\/use-workspaces|@\/hooks\/use-inactivity|@\/components\/spaces\/team-label|@\/components\/team\/team-context|@\/components\/home\/home-context)$/ }, () => ({ path: 'data', namespace: 'fixture' }));
      api.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: fixture, loader: 'js', resolveDir: process.cwd() }));
    } }],
  });
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://fixture');
    if (url.pathname.startsWith('/api/trpc/')) {
      let body = '';for await (const chunk of req) body += chunk;
      const procedure = url.pathname.slice('/api/trpc/'.length);
      const input = JSON.parse(body || url.searchParams.get('input') || '{}');
      let data: unknown;
      if (procedure === 'transport.capabilities') data = { websocket: false };
      else if (procedure === 'tasks.list') {
        data = tasks.filter(t => !input.status || (Array.isArray(input.status) ? input.status.includes(t.status) : t.status === input.status))
          .sort((a, b) => input.orderBy === 'hardDeadline'
            ? a.hardDeadline === b.hardDeadline ? 0 : !a.hardDeadline ? 1 : !b.hardDeadline ? -1 : a.hardDeadline.localeCompare(b.hardDeadline)
            : a.sortKey.localeCompare(b.sortKey));
      }
      else if (procedure === 'tasks.attention') data = { in_progress: { working: true, agentSessionId: 'work' } };
      else if (procedure === 'areas.list') data = [{ id: 'design', name: 'Design' }, { id: 'launch', name: 'Launch' }];
      else if (procedure === 'team.members') data = [{ id: 'maya', name: 'Maya', active: true }, { id: 'luis', name: 'Luis', active: true }];
      else if (procedure === 'tasks.update') { mutations.push({ procedure, input }); const task = tasks.find(t => t.id === input.id)!; Object.assign(task, input.patch); data = task; }
      else if (procedure === 'tasks.counts') data = { todo: 1, in_progress: 1, done: 1 };
      else if (procedure === 'tasks.transition' || procedure === 'tasks.complete') {
        mutations.push({ procedure, input });
        const task = tasks.find(t => t.id === input.id)!;
        task.status = procedure === 'tasks.complete' ? 'done' : ({ start: 'in_progress', archive: 'archived', move_to_todo: 'todo', move_to_consider: 'consider', return_to_todo: 'todo', reopen: 'todo', restore: 'todo' } as Record<string, string>)[input.command];
        data = { task };
      } else if (procedure === 'tasks.reorder') { mutations.push({ procedure, input }); data = {}; }
      else if (procedure === 'tasks.create') { const task = { id: 'created', sortKey: 'z', bodyExcerpt: '', bodyLen: 0, ...input }; tasks.push(task); data = task; }
      else { errors.push(procedure); data = null; }
      res.setHeader('content-type', 'application/json');res.end(JSON.stringify({ result: { data } }));return;
    }
    if (url.pathname === '/fixture.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].text);return; }
    if (url.pathname === '/fixture.css') { res.setHeader('content-type', 'text/css'); res.end(css.css);return; }
    res.setHeader('content-type', 'text/html');res.end('<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>html,body,#root{height:100%;margin:0}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const executablePath = process.env.RI_REVIEW_CHROMIUM ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find(fs.existsSync);
  if (!executablePath) throw new Error('Chromium is required for Board qualification');
  browser = await chromium.launch({ executablePath, headless: true });
}, 30_000);
afterAll(async () => { await browser?.close();server?.closeAllConnections();if (server) await new Promise<void>(resolve => server.close(() => resolve())); });
async function open(search = '') {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(6000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + search);return page;
}
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Board', exact: true });
const picker = (page: Page) => dialog(page).getByRole('button', { name: /^Columns,/ });

it('remembers the selected view and independent column choices across close/reopen and reload, including all hidden', async () => {
  const page = await open();
  try {
    await page.getByRole('button', { name: 'Board', exact: true }).click();
    expect(await dialog(page).getByRole('button', { name: 'Agent Activity', exact: true }).getAttribute('aria-pressed')).toBe('true');
    await picker(page).click();await page.getByRole('menuitemcheckbox', { name: 'Working', exact: true }).click();await page.keyboard.press('Escape');
    await dialog(page).getByRole('button', { name: 'Tasks', exact: true }).click();
    expect(await picker(page).innerText()).toContain('3/5');
    expect(await dialog(page).getByText('done task', { exact: true }).count()).toBe(0);
    await picker(page).click();await page.getByRole('menuitemcheckbox', { name: 'Done', exact: true }).click();await page.keyboard.press('Escape');
    await dialog(page).getByRole('button', { name: 'Close Board' }).click();
    await expect.poll(() => page.evaluate(() => document.activeElement?.textContent)).toBe('Board');
    await page.getByRole('button', { name: 'Board', exact: true }).click();
    await dialog(page).getByText('done task', { exact: true }).waitFor();
    await page.reload();await dialog(page).getByText('done task', { exact: true }).waitFor();
    await dialog(page).getByRole('button', { name: 'Agent Activity', exact: true }).click();
    expect(await dialog(page).getByRole('region', { name: 'Working', exact: true }).count()).toBe(0);
    await picker(page).click();
    for (const name of ['Needs approval', 'Unread', 'Waiting response']) await page.getByRole('menuitemcheckbox', { name, exact: true }).click();
    await page.keyboard.press('Escape');await dialog(page).getByText('All columns are hidden').waitFor();
    await page.reload();await dialog(page).getByText('All columns are hidden').waitFor();
    await dialog(page).getByRole('button', { name: 'Show all columns' }).click();
    expect(await picker(page).innerText()).toContain('4/4');
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it('expands a hidden HUD bucket without changing saved columns, matches counts and opens both conversation destinations', async () => {
  const page = await open();
  try {
    await page.evaluate(() => localStorage.setItem('ri.board.columns.activity', '["working"]'));
    await page.getByRole('button', { name: 'Needs approval: 2', exact: true }).click();
    await page.getByRole('button', { name: 'Expand Needs approval in Board' }).click();
    await dialog(page).getByRole('region', { name: 'Needs approval', exact: true }).waitFor();
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Needs approval');
    expect(await page.evaluate(() => localStorage.getItem('ri.board.columns.activity'))).toBe('["working"]');
    expect(await dialog(page).getByRole('region', { name: 'Needs approval', exact: true }).getByRole('button').count()).toBe(2);
    await dialog(page).getByRole('button', { name: /Builder's main chat/ }).click();
    expect(await page.evaluate(() => (window as unknown as { destinations: unknown[] }).destinations)).toEqual([{ kind: 'agent', id: 'builder' }]);
    await page.getByRole('button', { name: 'Board', exact: true }).click();
    expect(await dialog(page).getByRole('region', { name: 'Needs approval', exact: true }).count()).toBe(0);
    await picker(page).click();await page.getByRole('menuitem', { name: 'Show all columns' }).click();
    await dialog(page).getByRole('button', { name: /Building now/ }).click();
    expect(await page.evaluate(() => (window as unknown as { destinations: unknown[] }).destinations)).toEqual([{ kind: 'agent', id: 'builder' }, { kind: 'execution', id: 'work' }]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it('keeps task drag, lifecycle creates and chat links working with Done and Archived hidden', async () => {
  const page = await open('?board=1');
  try {
    const card = dialog(page).getByRole('button', { name: /^todo task\. todo\./ });
    await card.waitFor();
    // Keyboard drag across visible columns invokes the same semantic Start action.
    await card.focus();await page.keyboard.press('Space');
    // Let the keyboard sensor measure droppables before the first move.
    await page.waitForTimeout(100);
    await page.keyboard.press('ArrowRight');await page.waitForTimeout(100);
    await page.keyboard.press('Space');
    await expect.poll(() => mutations.filter(m => m.procedure === 'tasks.transition').map(m => m.input.command)).toEqual(['start']);
    expect(await picker(page).innerText()).toContain('3/5');
    await dialog(page).getByRole('button', { name: 'Add task', exact: true }).nth(2).click();
    const input = dialog(page).getByRole('textbox', { name: 'Start a task…' });
    await input.fill('Created in progress');await input.press('Enter');
    await expect.poll(() => mutations.filter(m => m.procedure === 'tasks.transition').map(m => m.input.id)).toContain('created');
    await dialog(page).getByRole('button', { name: "Open the agent's chat" }).first().click();
    expect(await page.evaluate(() => (window as unknown as { destinations: unknown[] }).destinations)).toEqual([{ kind: 'execution', id: 'work' }]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});


it('shows loading and recoverable errors at phone width without overflowing the page', async () => {
  const page = await open('?board=activity&fixture=loading');
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await dialog(page).waitFor();
    expect(await dialog(page).locator('[aria-busy="true"]').count()).toBe(4);
    expect(await dialog(page).getByText('No conversations here', { exact: true }).count()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.evaluate(() => (window as unknown as { setActivityState: (state: string) => void }).setActivityState('error'));
    await dialog(page).getByRole('alert').waitFor();
    await dialog(page).getByRole('button', { name: 'Try again', exact: true }).click();
    await dialog(page).getByRole('button', { name: /Ship the board/ }).waitFor();
    expect(await dialog(page).getByRole('alert').count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it('follows explicit view navigation and browser back/forward without losing the task-context entry', async () => {
  const page = await open();
  try {
    await page.getByRole('button', { name: 'Board', exact: true }).waitFor();
    await page.evaluate(() => { history.pushState(null, '', '?board=activity'); dispatchEvent(new PopStateEvent('popstate')); });
    await dialog(page).waitFor();
    expect(await dialog(page).getByRole('button', { name: 'Agent Activity', exact: true }).getAttribute('aria-pressed')).toBe('true');
    await page.evaluate(() => { history.pushState(null, '', '?board=tasks'); dispatchEvent(new PopStateEvent('popstate')); });
    await expect.poll(() => dialog(page).getByRole('button', { name: 'Tasks', exact: true }).getAttribute('aria-pressed')).toBe('true');
    await page.goBack();
    await expect.poll(() => dialog(page).getByRole('button', { name: 'Agent Activity', exact: true }).getAttribute('aria-pressed')).toBe('true');
    await page.goForward();
    await expect.poll(() => dialog(page).getByRole('button', { name: 'Tasks', exact: true }).getAttribute('aria-pressed')).toBe('true');
    await dialog(page).getByRole('button', { name: 'Agent Activity', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Tasks board', exact: true }).click();
    expect(await dialog(page).getByRole('button', { name: 'Tasks', exact: true }).getAttribute('aria-pressed')).toBe('true');
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});


it('Team hosts keep Done and agent activity by default, with column choices scoped to Home and viewer', async () => {
  const page = await open('?teamBoard&home=team-a&viewer=owner');
  try {
    const teamPicker = () => page.getByRole('button', { name: /^Columns,/ });
    await teamPicker().waitFor();
    expect(await teamPicker().getAttribute('aria-label')).toBe('Columns, 4 of 5 visible');
    await page.getByText('done task', { exact: true }).waitFor();
    await page.getByRole('button', { name: "Open the agent's chat" }).waitFor();
    await teamPicker().click(); await page.getByRole('menuitemcheckbox', { name: 'Done', exact: true }).click(); await page.keyboard.press('Escape');
    expect(await teamPicker().getAttribute('aria-label')).toBe('Columns, 3 of 5 visible');
    for (const destination of ['?teamBoard&home=team-a&viewer=member', '?teamBoard&home=team-b&viewer=owner']) {
      await page.goto(base + destination); await teamPicker().waitFor();
      expect(await teamPicker().getAttribute('aria-label')).toBe('Columns, 4 of 5 visible');
      await page.getByText('done task', { exact: true }).waitFor();
    }
    await page.goto(base + '?teamBoard&home=team-a&viewer=owner'); await teamPicker().waitFor();
    expect(await teamPicker().getAttribute('aria-label')).toBe('Columns, 3 of 5 visible');
    expect(await page.getByText('done task', { exact: true }).count()).toBe(0);
    await page.goto(base + '?board=1'); await picker(page).waitFor();
    expect(await picker(page).getAttribute('aria-label')).toBe('Columns, 3 of 5 visible');
    expect(await page.evaluate(() => localStorage.getItem('ri.tasks.board:team-a:owner:columns'))).toBe('["consider","todo","current"]');
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});


it('groups Team list tasks, sorts deadlines within groups, collapses and remembers member preferences', async () => {
  tasks.push({ id: 'second-todo', title: 'Earlier deadline', status: 'todo', sortKey: 'a5', hardDeadline: '2026-11-01', assigneeMemberId: 'maya', areaId: 'design', bodyExcerpt: '', bodyLen: 0 });
  Object.assign(tasks.find(task => task.id === 'todo')!, { hardDeadline: '2026-11-10', assigneeMemberId: 'luis', areaId: 'launch' });
  const page = await open('?teamBoard=1&taskList=1');
  try {
    await page.getByRole('button', { name: 'Group by Status', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Open board', exact: true }).waitFor();
    expect(await page.getByRole('group', { name: 'Task view', exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: 'Todo, 2 tasks', exact: true }).waitFor();
    const rowTitles = () => page.locator('[data-index] p.line-clamp-2').allTextContents();
    await expect.poll(rowTitles).toEqual(['in_progress task', 'Earlier deadline', 'todo task', 'consider task', 'done task', 'archived task']);
    await page.getByRole('button', { name: 'Todo, 2 tasks', exact: true }).click();
    await expect.poll(rowTitles).toEqual(['in_progress task', 'consider task', 'done task', 'archived task']);
    await page.getByRole('button', { name: 'Todo, 2 tasks', exact: true }).click();
    await page.getByRole('button', { name: 'Group by Status', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Assignee', exact: true }).click();
    await page.getByRole('button', { name: 'Luis, 1 task', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Maya, 1 task', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Unassigned, 4 tasks', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Sort by Deadline', exact: true }).click();
    await page.getByRole('menuitemradio', { name: /^Priority Order/ }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Group by Assignee', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Sort by Priority Order', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Group by Assignee', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Area', exact: true }).click();
    await page.getByRole('button', { name: 'Design, 1 task', exact: true }).waitFor();
    await page.getByRole('button', { name: 'No area, 4 tasks', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Group by Area', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'No grouping', exact: true }).click();
    expect(await page.getByRole('button', { name: /, [0-9]+ tasks$/ }).count()).toBe(0);
    await page.goto(base + '?teamBoard=1&taskList=1&viewer=member');
    await page.getByRole('button', { name: 'Group by Status', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Sort by Deadline', exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    const openBoard = page.getByRole('button', { name: 'Open board', exact: true });
    expect(await openBoard.isVisible()).toBe(true);
    await openBoard.click();
    expect(new URL(page.url()).searchParams.get('board')).toBe('tasks');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it('reorders within a list group, rejects cross-group drops and persists order after flattening', async () => {
  tasks.push({ id: 'second-todo', title: 'Second todo', status: 'todo', sortKey: 'a5', bodyExcerpt: '', bodyLen: 0 });
  const page = await open('?teamBoard=1&taskList=1');
  const row = (title: string) => page.getByText(title, { exact: true }).locator('xpath=../..');
  async function drag(from: string, to: string) {
    const source = row(from); await source.hover();
    const handle = await source.locator('button').first().boundingBox();
    const target = (await row(to).boundingBox())!;
    await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + 35, target.y + target.height / 2, { steps: 12 });
    await page.mouse.up();
  }
  try {
    await page.getByRole('button', { name: 'Todo, 2 tasks', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Sort by Deadline', exact: true }).click();
    await page.getByRole('menuitemradio', { name: /^Priority Order/ }).click();
    await drag('Second todo', 'todo task');
    await expect.poll(() => mutations.filter(m => m.procedure === 'tasks.update').length).toBe(1);
    expect(mutations[0].input.id).toBe('second-todo');
    await page.reload();
    await expect.poll(() => page.locator('[data-index] p.line-clamp-2').allTextContents()).toEqual(['in_progress task', 'Second todo', 'todo task', 'consider task', 'done task', 'archived task']);
    await drag('Second todo', 'in_progress task');
    await page.waitForTimeout(150);
    expect(mutations.filter(m => m.procedure === 'tasks.update')).toHaveLength(1);
    expect(tasks.find(task => task.id === 'second-todo')!.status).toBe('todo');
    await page.getByRole('button', { name: 'Group by Status', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'No grouping', exact: true }).click();
    await drag('todo task', 'consider task');
    await expect.poll(() => mutations.filter(m => m.procedure === 'tasks.update').length).toBe(2);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
