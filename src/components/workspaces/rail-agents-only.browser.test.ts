/**
 * The agents-only rail trial (docs/rail-agents-first.md#agents-only-trial)
 * against an isolated fixture: the real rail list (`RailListHeader` and
 * `RailListBody`) and the agent chat bar's `ReadStateButton`, with the real
 * data hooks over a seeded query cache and only the dashboard context
 * stubbed. The API answers nothing, so a mutation shows through its
 * optimistic patch, and the server records what was sent.
 *
 * Checks that agents only lists agents and nothing else, each with only its
 * own state, that an agent can be marked read or unread from the rail and
 * from its chat bar (and both agree), that resting on an agent peeks at its
 * chats, and that Agents first is unchanged.
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

const dashboard = `
  import {createContext, useContext} from 'react';
  const record=(kind,value)=>window.actions.push({kind,value});
  export const DashboardProvider=({children})=>children;
  export function useDashboard(){
    return {
      activeView:{kind:'execution',id:'web-2'},
      activeSessionId:'web-2',
      activeExecutionId:'web-2',
      streamingSessionIds:new Set(['ri-1','fin-3','res-main']),
      pendingInputSessionIds:new Set(['web-1']),
      backgroundSessionIds:new Set(),
      setActiveView:(view)=>record('navigate',view),
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
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
      import {TooltipProvider} from '@/components/ui/tooltip';
      import {ConfirmProvider} from '@/components/ui/confirm-dialog';
      import {WorkContext} from '@/contexts/work-context';
      import {RailListBody,RailListHeader} from '@/components/workspaces/rail-list';
      import {WorkspaceSelectionProvider} from '@/components/workspaces/workspace-selection-context';
      import {SessionHoverProvider} from '@/components/workspaces/session-hover-context';
      import {ReadStateButton} from '@/components/chat-ui/read-state-button';
      window.actions=[];
      const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity},mutations:{retry:false}}});
      const at=(minutesAgo)=>new Date(Date.now()-minutesAgo*60_000).toISOString();
      const agent=(id,name,emoji,purpose)=>({id,name,emoji,purpose,attachments:[],areaId:null,collapsed:false,isGit:true,status:'active'});
      const workspaces=[
        agent('ri','Ri','🛠️','Builds Ri'),
        agent('web','Website','🌐','Runs the marketing site'),
        agent('fin','Finances','💵','Keeps the books'),
        agent('res','Research','🔬','Reads papers'),
        agent('notes','Notes','📝','Files meeting notes'),
        agent('docs','Docs','📚','Keeps the product docs current'),
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
      // The chat the agent view's chat bar shows: Notes's main chat, read.
      client.setQueryData(['session','notes-main'],{...main('notes-main','notes','Filed the meeting notes.'),status:'active',label:null,executionId:null});
      const noop=()=>{};
      const navigation={openAgent:noop,openExecution:noop,openTask:noop,openNote:noop,goHome:noop};
      const activity={activeSessionId:null,streamingSessionIds:new Set(['ri-1','fin-3','res-main']),backgroundSessionIds:new Set(),pendingInputSessionIds:new Set(['web-1']),setActiveExecutionId:noop,setSessionStreaming:noop};
      createRoot(document.getElementById('root')).render(
        <QueryClientProvider client={client}><TooltipProvider><ConfirmProvider>
          <WorkContext navigation={navigation} activity={activity}><SessionHoverProvider disabled>
            <aside className="w-[256px] min-h-screen border-r border-border bg-background">
              <WorkspaceSelectionProvider>
                <RailListHeader tab="workspace" onSelect={noop}/>
                <RailListBody tab="workspace"/>
              </WorkspaceSelectionProvider>
            </aside>
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

async function open(style: 'agentsOnly' | 'agents', theme: 'dark' | 'light' = 'dark'): Promise<{ page: Page; errors: string[] }> {
  sent = [];
  const page = await browser.newPage({ viewport: { width: 640, height: 760 }, deviceScaleFactor: 2 });
  page.setDefaultTimeout(5_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript((value) => localStorage.setItem('ri.client.railStyle', value), style);
  await page.goto(`${base}/?theme=${theme}`);
  await page.getByRole('button', { name: 'Open Docs', exact: true }).waitFor();
  return { page, errors };
}

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

const menu = async (page: Page, name: string) => {
  await page.getByText(name, { exact: true }).hover();
  await page.getByRole('button', { name: `${name} actions`, exact: true }).click();
  return page.getByRole('menu');
};

for (const theme of ['dark', 'light'] as const) {
  it(`lists agents and nothing else, each with only its own state (${theme})`, async () => {
    const { page, errors } = await open('agentsOnly', theme);
    try {
      // No switch, no Needs you, no archive selection: Pinned, then Agents.
      expect(await page.getByRole('tablist').count()).toBe(0);
      expect(await page.getByText('Needs you').count()).toBe(0);
      expect(await page.getByRole('button', { name: 'Select chats to archive' }).count()).toBe(0);
      expect(await page.getByRole('button', { name: 'New agent' }).count()).toBe(1);
      const pinnedTop = (await page.getByText('Pinned', { exact: true }).boundingBox())!.y;
      const agentsTop = (await page.getByText('Agents', { exact: true }).boundingBox())!.y;
      expect(pinnedTop).toBeLessThan(agentsTop);

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
        { name: 'Docs', line: 'Keeps the product docs current' },
      ]);
      // Bold only when the agent itself wants you.
      expect(Number(await nameWeight(page, 'Ri'))).toBeGreaterThanOrEqual(600);
      expect(Number(await nameWeight(page, 'Website'))).toBeLessThan(600);
      expect(Number(await nameWeight(page, 'Finances'))).toBeLessThan(600);
      expect(Number(await nameWeight(page, 'Research'))).toBeLessThan(600);
      // The open chat has no row, so its agent is lit.
      const fill = (name: string) =>
        page.locator('[aria-roledescription="sortable"]', { has: page.getByText(name, { exact: true }) })
          .evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(await fill('Website')).not.toBe('rgba(0, 0, 0, 0)');
      expect(await fill('Notes')).toBe('rgba(0, 0, 0, 0)');

      await page.screenshot({ path: `/tmp/ri-rail-agents-only-${theme}.png`, clip: { x: 0, y: 0, width: 256, height: 520 } });
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  });
}

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

it('leaves agents first as it was', async () => {
  const { page, errors } = await open('agents');
  try {
    expect(await page.getByRole('tablist', { name: 'Rail list' }).count()).toBe(1);
    expect(await page.getByText('Needs you').count()).toBe(1);
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
