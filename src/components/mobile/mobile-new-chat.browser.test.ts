/**
 * The phone's + sheet lists its choices in order and starts a chat in the
 * actual launcher, which takes touch rules below desktop: Enter adds a line,
 * no keys are hinted at, Start stays above the on-screen keyboard, and Browse
 * closes with Done. Desktop keeps Enter-to-start and its key hints. Real
 * sheet, launcher, picker and editor, with synthetic agents and a recorded
 * start in place of the server.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { BrowserContext, Page, Route } from 'playwright-core';
import { browserFixture } from '@/test/fixtures/browser-fixture';

let fixture: Awaited<ReturnType<typeof browserFixture>>;

const MODULES: Record<string, string> = {
  'next/navigation': `export const useRouter=()=>({push:()=>{},replace:()=>{}});export const usePathname=()=>'/';export const useSearchParams=()=>new URLSearchParams();`,
  'contexts/dashboard-context': `
    import {useSyncExternalStore} from 'react';
    let open=true;const listeners=new Set();
    const set=(v)=>{open=v;listeners.forEach(l=>l());};
    const sub=(l)=>{listeners.add(l);return()=>listeners.delete(l);};
    export const useDashboard=()=>({mobileCreateOpen:useSyncExternalStore(sub,()=>open),setMobileCreateOpen:set,openNote:()=>{},openTask:()=>{},setQuickCaptureOpen:()=>{}});
    export const useOptionalDashboard=()=>null;`,
  'contexts/work-context': `export const useWorkNavigation=()=>({openExecution:(id)=>{window.opened=id;}});export const useOptionalWorkNavigation=()=>null;export const useOptionalWorkActivity=()=>null;`,
  'hooks/use-workspaces': `
    const agents=[
      {id:'roast',name:'Roast lab',emoji:'🔥',attachments:[],areaId:null,isGit:true,cwd:'/tmp/roast',baseBranch:'main'},
      {id:'home',name:'Household',emoji:'🏠',attachments:[],areaId:null,isGit:false,cwd:'/tmp/home',baseBranch:null},
    ];
    const idle={mutate:()=>{},isPending:false};
    export const useWorkspaces=()=>({data:agents});export const useWorkspace=id=>({data:agents.find(a=>a.id===id)});export const useRunOn=()=>({data:undefined});export const useSetDefaultDevice=()=>idle;
    export const useWorkspacePRs=()=>({data:[]});export const useWorkspaceBranches=()=>({data:[],isLoading:false});
    export const useSetUpAgent=()=>idle;export const useSetupPlan=()=>({data:undefined});
    export const useMentionAgents=enabled=>enabled && !new URLSearchParams(location.search).has('noAgents') ? agents.map(a=>({kind:'agent',id:a.id,name:a.name,slug:a.id,purpose:'Helps with '+a.name,picture:{image:null,emoji:a.emoji}})) : [];`,
  'hooks/use-devices': `export const useRunsOnSeveralDevices=()=>false;`,
  'hooks/use-reference-folders': `export const useReferenceFolders=()=>({data:[]});export const useLoadReferenceTree=()=>async()=>[];`,
  'hooks/use-harness-models': `export const useHarnessModels=()=>({models:[]});`,
  'hooks/use-user-state': `export const useUserState=()=>({data:{defaultHarness:'claude',defaultModel:'opus'}});`,
  'hooks/use-default-selection': `export const useDefaultSelection=()=>({harness:'claude',model:'opus',variant:null,effort:null});`,
  'hooks/use-notes': `export const useCreateNote=()=>({mutate:()=>{}});`,
  'hooks/use-tasks': `export const useCreateTask=()=>({mutate:()=>{}});`,
  'hooks/use-start-skill': `export const useStartSkill=()=>({start:()=>{},isPending:false});`,
  'dashboard/area-create-modal': `export const AreaCreateModal=()=>null;`,
  'model-controls': `export const ModelControl=({onChange})=>{window.pickHarness=onChange;return <button type="button">Opus</button>;};`,
  'use-launch-sources': `
    export const useLaunchSuggestions=()=>[];
    const group={id:'task',kind:'task',label:'Your tasks',items:[{kind:'task',key:'t1',title:'Chart roast curves'}],isLoading:false,isFetching:false,error:null};
    export const useLaunchSources=()=>({groups:[group],integrationSources:[],supportedSources:[]});`,
  'executions/start-execution': `export const startExecution=(_qc,input)=>{window.started=input;return {sessionId:'chat-1',done:Promise.resolve()};};`,
};

beforeAll(async () => {
  fixture = await browserFixture(`
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import {TipProvider} from './src/components/ui/tip';
    import {MobileCreateSheet} from './src/components/mobile/mobile-create-sheet';
    import {LaunchModal} from './src/components/workspaces/launcher/launch-modal';
    import {openLauncher} from './src/components/workspaces/launcher/launcher-store';
    document.documentElement.classList.add('dark');window.openLauncher=openLauncher;
    localStorage.setItem('ri.client.apiTransport','http');
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><TipProvider><main className="h-dvh"/><MobileCreateSheet/><LaunchModal/></TipProvider></QueryClientProvider>);
  `, [{ name: 'new-chat-fixture', setup(b) {
    // Each key is the tail of the import it replaces: `@/hooks/use-tasks`,
    // or `./model-controls` from inside the launcher.
    for (const [name, contents] of Object.entries(MODULES)) {
      b.onResolve({ filter: new RegExp(`(^|/)${name}$`) }, () => ({ path: name, namespace: 'new-chat' }));
      b.onLoad({ filter: new RegExp(`^${name}$`), namespace: 'new-chat' }, () => ({ contents, loader: 'tsx', resolveDir: process.cwd() }));
    }
  } }], { css: true });
}, 120_000);

afterAll(async () => { await fixture?.close(); });

async function skillRequests(page: Page, pause = false) {
  const requests: { workspaceId?: string; harness: string }[] = [];
  const references: { workspaceId?: string; kind?: string; q?: string }[] = [];
  let pending: Route | undefined;
  const respond = async (route: Route) => {
    const input = JSON.parse(new URL(route.request().url()).searchParams.get('input')!);
    const { workspaceId, harness } = input.query;
    const name = workspaceId === 'roast' ? (harness === 'codex' ? 'first-principles-codex' : 'first-principles-thinking') : 'weekly-review';
    await route.fulfill({ json: { result: { data: { commands: [{
      id: name, name, description: 'Review the work', source: 'installed-workspace', userInvocable: true, available: true,
      execution: { kind: 'expanded-prompt', provider: harness },
    }], diagnostics: [], inventorySource: 'none' } } } });
  };
  await page.route('**/api/trpc/skills.commands?*', async route => {
    const input = JSON.parse(new URL(route.request().url()).searchParams.get('input')!);
    requests.push(input.query);
    if (pause && input.query.workspaceId === 'roast') pending = route;
    else await respond(route);
  });
  await page.route('**/api/trpc/workspaces.launchPicker?*', async route => {
    const { query } = JSON.parse(new URL(route.request().url()).searchParams.get('input')!);
    references.push(query);
    const tasks = query.kind === 'note' ? [] : [{ id: 'roast-task', title: 'Chart roast curves', status: 'todo' }];
    const notes = query.kind === 'task' ? [] : [{ id: 'roast-note', title: 'Roast checklist' }];
    await route.fulfill({ json: { result: { data: { tasks, notes, totals: { tasks: tasks.length, notes: notes.length } } } } });
  });
  return { requests, references, release: async () => { pause = false; await respond(pending!); } };
}

/** A phone whose visual viewport the test can shrink, the way an on-screen keyboard does. */
async function phone(): Promise<{ context: BrowserContext; page: Page }> {
  const context = await fixture.browser.newContext({ viewport: { width: 390, height: 664 }, hasTouch: true, isMobile: true });
  await context.addInitScript(() => {
    let keyboard = 0;
    const viewport = new EventTarget();
    Object.defineProperties(viewport, {
      height: { get: () => window.innerHeight - keyboard },
      width: { get: () => window.innerWidth },
      offsetTop: { get: () => 0 },
      offsetLeft: { get: () => 0 },
      scale: { get: () => 1 },
    });
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => viewport });
    (window as unknown as { setKeyboard: (px: number) => void }).setKeyboard = (px) => { keyboard = px; viewport.dispatchEvent(new Event('resize')); };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  page.on('pageerror', (e) => console.error(e.message));
  await skillRequests(page);
  await page.goto(fixture.url);
  return { context, page };
}

const editor = (page: Page) => page.locator('[role=dialog] .ProseMirror[contenteditable="true"]');
const bottomOf = async (page: Page, name: RegExp) => { const box = (await page.getByRole('button', { name }).boundingBox())!; return box.y + box.height; };

it('starts a chat from the phone + sheet with touch rules', async () => {
  const { context, page } = await phone();
  try {
    // Start work first, then make a thing, then set up. Search lives in the top bar.
    const choices = await page.getByRole('dialog').getByRole('button').evaluateAll((buttons) => buttons.map((b) => (b as HTMLElement).innerText.split('\n')[0].trim()));
    expect(choices).toEqual(['New chat', 'Quick capture', 'Task', 'Note', 'Area', 'Connect a service', 'New skill', 'Add MCP server']);

    await page.getByRole('button', { name: /New chat/ }).tap();
    await expect.poll(() => page.getByText('Quick capture').count()).toBe(0);
    await page.getByRole('button', { name: /Pick an agent/ }).waitFor();
    await expect.poll(() => editor(page).evaluate((el) => el.contains(document.activeElement))).toBe(true);

    // Enter is a new line on a phone, and nothing hints at keys.
    await editor(page).pressSequentially('Plan the next roast');
    await page.keyboard.press('Enter');
    await editor(page).pressSequentially('and log it');
    expect(await editor(page).locator('br:not(.ProseMirror-trailingBreak)').count()).toBe(1);
    expect(await page.evaluate(() => (window as unknown as { started?: unknown }).started)).toBeUndefined();
    expect(await page.locator('[role=dialog] kbd').count()).toBe(0);

    // The keyboard comes up: Start stays above it.
    await page.evaluate(() => (window as unknown as { setKeyboard: (px: number) => void }).setKeyboard(300));
    await expect.poll(() => bottomOf(page, /^Start/)).toBeLessThanOrEqual(664 - 300);

    // Start with no agent asks for one.
    await page.getByRole('button', { name: /^Start/ }).tap();
    await page.getByRole('option', { name: /Roast lab/ }).tap();
    await page.getByRole('button', { name: /Roast lab/ }).waitFor();

    // Browse opens with the keyboard down, keeps its list, and Done closes it.
    await page.evaluate(() => (window as unknown as { setKeyboard: (px: number) => void }).setKeyboard(0));
    await page.getByRole('button', { name: /Browse/ }).tap();
    await page.getByText('Chart roast curves').waitFor();
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('INPUT');
    await page.getByRole('button', { name: 'Done' }).tap();
    await expect.poll(() => page.locator('[data-launcher-browse]').count()).toBe(0);

    // The close button stays on the first row, however the controls wrap.
    const close = (await page.getByRole('button', { name: 'Close' }).boundingBox())!;
    const agent = (await page.getByRole('button', { name: /Roast lab/ }).boundingBox())!;
    expect(Math.abs(close.y + close.height / 2 - (agent.y + agent.height / 2))).toBeLessThan(8);

    await page.getByRole('button', { name: /^Start/ }).tap();
    await expect.poll(() => page.evaluate(() => (window as unknown as { opened?: string }).opened)).toBe('chat-1');
    const started = await page.evaluate(() => (window as unknown as { started: { workspaceId: string; message: { content: string } } }).started);
    expect(started.workspaceId).toBe('roast');
    expect(started.message.content).toContain('Plan the next roast');
    expect(started.message.content).toContain('and log it');
    await expect.poll(() => page.getByRole('dialog').count()).toBe(0);
  } finally {
    await context.close();
  }
}, 60_000);

it('keeps Enter-to-start and key hints on desktop', async () => {
  const context = await fixture.browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  try {
    await skillRequests(page);
    await page.goto(fixture.url);
    await page.keyboard.press('Escape');
    await expect.poll(() => page.getByText('Quick capture').count()).toBe(0);
    await page.evaluate(() => (window as unknown as { openLauncher: (seed: { workspaceId: null }) => void }).openLauncher({ workspaceId: null }));
    await editor(page).waitFor();
    expect(await page.locator('[role=dialog] kbd').count()).toBe(2);
    await editor(page).pressSequentially('Plan the next roast');
    await page.keyboard.press('Enter');
    // Enter submits: with no agent picked, that opens the picker.
    await page.getByRole('option', { name: /Roast lab/ }).waitFor();
    expect(await editor(page).locator('br:not(.ProseMirror-trailingBreak)').count()).toBe(0);
  } finally {
    await context.close();
  }
}, 60_000);

it('loads skills before creating a chat and updates an open /f picker when discovery lands', async () => {
  const context = await fixture.browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const skills = await skillRequests(page, true);
  try {
    await page.goto(fixture.url);
    await page.keyboard.press('Escape');
    await page.evaluate(() => (window as unknown as { openLauncher: (seed: { workspaceId: string }) => void }).openLauncher({ workspaceId: 'roast' }));
    await editor(page).pressSequentially('/f');
    await page.getByText('No matching skills', { exact: true }).waitFor();
    await expect.poll(() => skills.requests).toEqual([{ workspaceId: 'roast', harness: 'claude' }]);
    expect(await page.evaluate(() => 'started' in window)).toBe(false);

    // No extra keystroke: the query response fills the already open picker.
    await skills.release();
    await page.locator('.chat-slash-menu').getByRole('button', { name: /first-principles-thinking/ }).waitFor();
    expect(await editor(page).innerText()).toBe('/f');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => 'started' in window)).toBe(false);
    await editor(page).pressSequentially('Review this approach');
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => (window as unknown as { started?: { message: { content: string } } }).started?.message.content)).toBe('/first-principles-thinking Review this approach');
    expect(errors).toEqual([]);
  } finally { await context.close(); }
}, 60_000);

it('changes the skill list with the chosen agent and harness and opens it from +', async () => {
  const context = await fixture.browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  const skills = await skillRequests(page);
  try {
    await page.goto(fixture.url);
    await page.keyboard.press('Escape');
    await page.evaluate(() => (window as unknown as { openLauncher: (seed: { workspaceId: null }) => void }).openLauncher({ workspaceId: null }));
    await editor(page).pressSequentially('/');
    await page.locator('.chat-slash-menu').getByRole('button', { name: /weekly-review/ }).waitFor();
    await page.getByRole('button', { name: /Pick an agent/ }).click();
    await page.getByRole('option', { name: /Roast lab/ }).click();
    await expect.poll(() => skills.requests.at(-1)).toEqual({ workspaceId: 'roast', harness: 'claude' });
    await page.locator('.chat-slash-menu').getByRole('button', { name: /first-principles-thinking/ }).waitFor();
    expect(await page.locator('.chat-slash-menu').getByText(/weekly-review/).count()).toBe(0);

    await page.evaluate(() => (window as unknown as { pickHarness: (pick: unknown) => void }).pickHarness({ harness: 'codex', model: 'gpt-test', variant: null, effort: null }));
    await page.locator('.chat-slash-menu').getByRole('button', { name: /first-principles-codex/ }).waitFor();
    expect(skills.requests.at(-1)).toEqual({ workspaceId: 'roast', harness: 'codex' });
    expect(await editor(page).innerText()).toBe('/');

    await editor(page).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Add to this chat' }).click();
    await page.getByRole('menuitem', { name: 'Skills' }).click();
    await page.locator('.chat-slash-menu').getByRole('button', { name: /first-principles-codex/ }).click();
    expect(await editor(page).innerText()).toBe('/first-principles-codex ');
    expect(await page.evaluate(() => 'started' in window)).toBe(false);
  } finally { await context.close(); }
}, 60_000);

it.each([
  { label: 'Tasks', prefix: 'task:', result: 'Chart roast curves', marker: '[[task:roast-task]]' },
  { label: 'Notes', prefix: 'note:', result: 'Roast checklist', marker: '[[note:roast-note]]' },
  { label: 'Agents', prefix: 'agent:', result: 'Household', marker: '[[agent:home]]' },
])('adds $label to the first message from + before an agent or chat exists', async ({ label, prefix, result, marker }) => {
  const { context, page } = await phone();
  try {
    await page.getByRole('button', { name: /New chat/ }).tap();
    await page.getByRole('button', { name: /Pick an agent/ }).waitFor();
    await editor(page).pressSequentially('Use this');
    await page.getByRole('button', { name: 'Add to this chat' }).tap();
    const menu = (await page.getByRole('menu').boundingBox())!;
    expect(menu.y).toBeGreaterThanOrEqual(0);
    expect(menu.y + menu.height).toBeLessThanOrEqual(664);
    await page.getByRole('menuitem', { name: label, exact: true }).tap();
    await expect.poll(() => editor(page).innerText()).toBe(`Use this @${prefix}`);
    await page.locator('.slash-command-popup').getByText(result, { exact: true }).tap();
    expect(await page.evaluate(() => 'started' in window)).toBe(false);
    await page.getByRole('button', { name: /^Start/ }).tap();
    await page.getByRole('option', { name: /Roast lab/ }).tap();
    await page.getByRole('button', { name: /^Start/ }).tap();
    await expect.poll(() => page.evaluate(() => (window as unknown as { started?: { message: { content: string } } }).started?.message.content)).toBe(`Use this ${marker}`);
  } finally { await context.close(); }
}, 60_000);

it('keeps the launch menu focused on context and omits unavailable agents', async () => {
  const context = await fixture.browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  await skillRequests(page);
  try {
    await page.goto(`${fixture.url}?noAgents`);
    await page.getByRole('button', { name: /New chat/ }).click();
    // Skills has loaded, so all available rows can be inspected together.
    await page.getByRole('button', { name: 'Add to this chat' }).click();
    await page.getByRole('menuitem', { name: 'Skills' }).waitFor();
    expect(await page.getByRole('menuitem').allTextContents()).toEqual(['Files and photos', 'Tasks', 'Notes', 'Mention anything@', 'Skills/']);
    expect(await page.getByRole('button', { name: /Browse/ }).count()).toBe(1);
  } finally { await context.close(); }
}, 60_000);
