/**
 * The phone's + sheet lists its choices in order and starts a chat in the
 * actual launcher, which takes touch rules below desktop: Enter adds a line,
 * no keys are hinted at, Start stays above the on-screen keyboard, and Browse
 * closes with Done. Desktop keeps Enter-to-start and its key hints. Real
 * sheet, launcher, picker and editor, with synthetic agents and a recorded
 * start in place of the server.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { BrowserContext, Page } from 'playwright-core';
import { browserFixture } from '@/test/fixtures/browser-fixture';

let fixture: Awaited<ReturnType<typeof browserFixture>>;

const MODULES: Record<string, string> = {
  'contexts/dashboard-context': `
    import {useSyncExternalStore} from 'react';
    let open=true;const listeners=new Set();
    const set=(v)=>{open=v;listeners.forEach(l=>l());};
    const sub=(l)=>{listeners.add(l);return()=>listeners.delete(l);};
    export const useDashboard=()=>({mobileCreateOpen:useSyncExternalStore(sub,()=>open),setMobileCreateOpen:set,openNote:()=>{},openTask:()=>{},setQuickCaptureOpen:()=>{}});
    export const useOptionalDashboard=()=>null;`,
  'contexts/work-context': `export const useWorkNavigation=()=>({openExecution:(id)=>{window.opened=id;}});`,
  'hooks/use-workspaces': `
    const agents=[
      {id:'roast',name:'Roast lab',emoji:'🔥',attachments:[],areaId:null,isGit:true,cwd:'/tmp/roast',baseBranch:'main'},
      {id:'home',name:'Household',emoji:'🏠',attachments:[],areaId:null,isGit:false,cwd:'/tmp/home',baseBranch:null},
    ];
    const idle={mutate:()=>{},isPending:false};
    export const useWorkspaces=()=>({data:agents});export const useRunOn=()=>({data:undefined});export const useSetDefaultDevice=()=>idle;
    export const useWorkspacePRs=()=>({data:[]});export const useWorkspaceBranches=()=>({data:[],isLoading:false});
    export const useSetUpAgent=()=>idle;export const useSetupPlan=()=>({data:undefined});`,
  'hooks/use-devices': `export const useRunsOnSeveralDevices=()=>false;`,
  'hooks/use-reference-folders': `export const useReferenceFolders=()=>({data:[]});export const useLoadReferenceTree=()=>async()=>[];`,
  'hooks/use-harness-models': `export const useHarnessModels=()=>({models:[]});`,
  'hooks/use-user-state': `export const useUserState=()=>({data:{defaultHarness:'claude',defaultModel:'opus'}});`,
  'hooks/use-default-selection': `export const useDefaultSelection=()=>({harness:'claude',model:'opus',variant:null,effort:null});`,
  'hooks/use-notes': `export const useCreateNote=()=>({mutate:()=>{}});`,
  'hooks/use-tasks': `export const useCreateTask=()=>({mutate:()=>{}});`,
  'hooks/use-start-skill': `export const useStartSkill=()=>({start:()=>{},isPending:false});`,
  'dashboard/area-create-modal': `export const AreaCreateModal=()=>null;`,
  'model-controls': `export const ModelControl=()=><button type="button">Opus</button>;`,
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
