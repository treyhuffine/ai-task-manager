/**
 * The chat open beside an agent's main chat renames from its header, as the
 * full view's header does: click the title and it becomes a field holding
 * it, selected, in the same place. Enter or leaving saves the execution's
 * title, Escape cancels, an empty field clears it, and an unchanged one
 * saves nothing. The real beside chat, its header and the shared rename in
 * Chromium with the app's CSS. The session, its save and the chat column are
 * fixtures, so no server is behind it: a save lands in the fixture's session
 * the way the refetch after a real one does.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import type { Plugin } from 'esbuild';
import { browserFixture } from '@/test/fixtures/browser-fixture';

const LONG = 'Rework the onboarding checklist so every step names the person who owns it and the day it is due';

const STUBS: Record<string, string> = {
  '@/hooks/use-execution': `
    import { useSyncExternalStore } from 'react';
    const params = new URLSearchParams(location.search);
    const orphan = params.has('orphan');
    const label = params.has('untitled') ? null : params.get('label') ?? 'Roast curve notes';
    let session = {
      id: 'chat-1', type: 'execution', status: 'active', workspaceId: params.get('workspace') ?? 'agent-1',
      executionId: orphan ? null : 'exec-1', label: orphan || params.has('untitled') ? label : 'First chat',
      execution: orphan ? null : { id: 'exec-1', label },
    };
    const listeners = new Set();
    window.__saves = [];
    const subscribe = (f) => { listeners.add(f); return () => listeners.delete(f); };
    export const useSession = () => ({ data: useSyncExternalStore(subscribe, () => session), error: null, fetchStatus: 'idle', refetch() {} });
    export const useUpdateSession = () => ({ mutate(input) {
      window.__saves.push(input);
      const { id, ...patch } = input;
      session = 'executionLabel' in patch
        ? { ...session, execution: { ...session.execution, label: patch.executionLabel } }
        : { ...session, ...patch };
      for (const f of listeners) f();
    } });
    export const useExecutionChats = () => ({ data: { sessions: [] } });
    export const useContinueSession = () => ({ isPending: false, mutate() {} });`,
  '@/components/executions/execution-chat-column': `
    import { jsx } from 'react/jsx-runtime';
    import { useSession } from '@/hooks/use-execution';
    export const useExecutionChat = (id) => {
      const { data } = useSession(id);
      return { session: data, workspace: { id: data.workspaceId, name: data.workspaceId === 'agent-1' ? 'Field Notes' : 'Roast Lab', isGit: false }, isRunning: false, hasBackgroundTasks: false };
    };
    export const useStartExecutionChat = () => ({ start() {}, isPending: false });
    export const ExecutionChatColumn = () => jsx('textarea', { 'aria-label': 'Steer this chat', className: 'flex-1' });`,
  '@/hooks/use-workspaces': `
    export const useMarkSessionRead = () => ({ mutate() {} });
    export const useWorkspace = () => ({ data: null });`,
  '@/hooks/use-user-state': `export const useOrchestratorName = () => 'Ri';`,
  '@/contexts/work-context': `export const useWorkActivity = () => ({ streamingSessionIds: new Set(), pendingInputSessionIds: new Set(), backgroundSessionIds: new Set() });`,
  '@/components/executions/chat-status': `
    import { jsx } from 'react/jsx-runtime';
    export const CHAT_STATUS_DOT = { amber: '', green: '' };
    export const useChatStatus = () => ({ label: 'Idle' });
    export const ChatStatusText = ({ status, className }) => jsx('p', { className, children: status.label });`,
  '@/components/executions/action-bar/execution-action-bar': `export const ExecutionActionBar = () => null;`,
  '@/components/executions/execution-chat-tabs': `export const ExecutionChatsMenu = () => null;`,
  '@/components/executions/execution-transcript': `export const ExecutionTranscript = () => null;`,
  '@/components/executions/workbench/view-request': `export const requestWorkbenchView = () => {};`,
  '@/components/chat/harness-chat': `export const HarnessChatSession = () => null;`,
  '@/components/chat/chat-lookup-state': `export const ChatLookupState = () => null;`,
  '@/lib/entity-refs/open-file-event': `export const useOpenFileListener = () => {};`,
  '@/lib/api/client': `export const apiErrorStatus = () => undefined;`,
};

const stubs: Plugin = {
  name: 'beside-chat-fixtures',
  setup(build) {
    const filter = new RegExp(`^(${Object.keys(STUBS).map((k) => k.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})$`);
    build.onResolve({ filter }, (args) => ({ path: args.path, namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: STUBS[args.path], loader: 'jsx', resolveDir: process.cwd() }));
  },
};

let fixture: Awaited<ReturnType<typeof browserFixture>>;

beforeAll(async () => {
  fixture = await browserFixture(`
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {TipProvider} from './src/components/ui/tip';
    import {AgentBesideChat} from './src/components/agents/agent-beside-chat';
    const width=new URLSearchParams(location.search).get('width')??'520';
    const agent={id:'agent-1',name:'Field Notes'};
    createRoot(document.getElementById('root')).render(
      <TipProvider><div className="flex h-screen flex-col bg-background text-foreground" style={{width:width+"px"}}>
        <AgentBesideChat chatId="chat-1" agent={agent} active onOpenChat={()=>{}} onOpenFull={()=>{}} onClose={()=>{}}/>
      </div></TipProvider>);
  `, [stubs], { css: true });
}, 120_000);

afterAll(async () => { await fixture?.close(); });

async function open(query = '') {
  const page = await fixture.browser.newPage({ viewport: { width: 1280, height: 600 } });
  await page.goto(`${fixture.url}/?${query}`);
  await page.locator('header').waitFor();
  return page;
}

const header = (page: Page) => page.locator('header');
const title = (page: Page) => header(page).locator('h2 button');
const field = (page: Page) => page.getByRole('textbox', { name: 'Chat title' });
const saves = (page: Page) => page.evaluate(() => (window as unknown as { __saves: unknown[] }).__saves);

/** Where the title's first character is drawn, in page pixels. */
const textLeft = (page: Page) => page.evaluate(() => {
  const el = document.querySelector<HTMLElement>('header h2 button, header h2 input')!;
  const style = getComputedStyle(el);
  return el.getBoundingClientRect().left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
});

it('turns the title into a field holding it, selected, where the title was', async () => {
  const page = await open();
  try {
    expect(await title(page).textContent()).toBe('Roast curve notes');
    const before = { left: await textLeft(page), header: (await header(page).boundingBox())!.height };

    await title(page).click();
    await field(page).waitFor();
    expect(await field(page).inputValue()).toBe('Roast curve notes');
    // Focused a frame after it mounts.
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Chat title');
    const state = await page.evaluate(() => {
      const input = document.activeElement as HTMLInputElement;
      return { focused: input.getAttribute('aria-label'), start: input.selectionStart, end: input.selectionEnd };
    });
    expect(state).toEqual({ focused: 'Chat title', start: 0, end: 'Roast curve notes'.length });
    // The text doesn't jump and the header doesn't grow.
    expect(Math.abs((await textLeft(page)) - before.left)).toBeLessThanOrEqual(0.5);
    expect((await header(page).boundingBox())!.height).toBe(before.header);
    await page.screenshot({ path: '/tmp/ri-beside-rename-editing.png', clip: { x: 0, y: 0, width: 540, height: 80 } });
  } finally {
    await page.close();
  }
});

it('saves the execution title on Enter, once', async () => {
  const page = await open();
  try {
    await title(page).click();
    await field(page).fill('  Roast curve, second pass ');
    await field(page).press('Enter');
    await field(page).waitFor({ state: 'detached' });
    expect(await title(page).textContent()).toBe('Roast curve, second pass');
    expect(await saves(page)).toEqual([{ id: 'chat-1', executionLabel: 'Roast curve, second pass' }]);
    await page.screenshot({ path: '/tmp/ri-beside-rename-saved.png', clip: { x: 0, y: 0, width: 540, height: 80 } });
  } finally {
    await page.close();
  }
});

it('saves when the field is left, and Escape keeps the old title', async () => {
  const page = await open();
  try {
    await title(page).click();
    await field(page).fill('Abandoned name');
    await field(page).press('Escape');
    await field(page).waitFor({ state: 'detached' });
    expect(await title(page).textContent()).toBe('Roast curve notes');
    expect(await saves(page)).toEqual([]);

    await title(page).click();
    await field(page).fill('Named by leaving');
    await page.getByLabel('Steer this chat').click();
    await field(page).waitFor({ state: 'detached' });
    expect(await title(page).textContent()).toBe('Named by leaving');
    expect(await saves(page)).toEqual([{ id: 'chat-1', executionLabel: 'Named by leaving' }]);
  } finally {
    await page.close();
  }
});

it('saves nothing for an unchanged title, and clears it when emptied', async () => {
  const page = await open();
  try {
    await title(page).click();
    await field(page).press('Enter');
    await field(page).waitFor({ state: 'detached' });
    expect(await saves(page)).toEqual([]);

    await title(page).click();
    await field(page).fill('   ');
    await field(page).press('Enter');
    await field(page).waitFor({ state: 'detached' });
    expect(await saves(page)).toEqual([{ id: 'chat-1', executionLabel: null }]);
    // With no execution title it shows the chat's own, as everywhere else.
    expect(await title(page).textContent()).toBe('First chat');
  } finally {
    await page.close();
  }
});

it('opens an empty field for an untitled chat', async () => {
  const page = await open('untitled=1');
  try {
    expect(await title(page).textContent()).toBe('Untitled chat');
    await title(page).click();
    expect(await field(page).inputValue()).toBe('');
    await field(page).fill('Named at last');
    await field(page).press('Enter');
    expect(await saves(page)).toEqual([{ id: 'chat-1', executionLabel: 'Named at last' }]);
  } finally {
    await page.close();
  }
});

it('renames an orphaned chat, whose execution is gone, by its own title', async () => {
  const page = await open('orphan=1');
  try {
    await title(page).click();
    await field(page).fill('Kept anyway');
    await field(page).press('Enter');
    await field(page).waitFor({ state: 'detached' });
    expect(await saves(page)).toEqual([{ id: 'chat-1', label: 'Kept anyway' }]);
    expect(await title(page).textContent()).toBe('Kept anyway');
  } finally {
    await page.close();
  }
});

it('shows a cut-off title whole on hover, and renames it in full', async () => {
  const page = await open(`width=320&label=${encodeURIComponent(LONG)}`);
  try {
    await title(page).hover();
    await page.getByRole('tooltip').waitFor();
    expect(await page.getByRole('tooltip').textContent()).toContain(LONG);

    await title(page).click();
    expect(await field(page).inputValue()).toBe(LONG);
    // The field takes the row, not the cut-off title's width.
    const [h2, input] = await Promise.all([header(page).locator('h2').boundingBox(), field(page).boundingBox()]);
    expect(input!.width).toBeGreaterThan(h2!.width - 12);
  } finally {
    await page.close();
  }
});

it('keeps the other agent named before a chat from another agent', async () => {
  const page = await open('workspace=agent-2');
  try {
    const h2 = header(page).locator('h2');
    expect(await h2.textContent()).toBe('Roast Lab ›\u00a0Roast curve notes');
    // A space between the › and the title, kept at the end of the name's line.
    const gap = await page.evaluate(() => {
      const text = [...document.querySelector('header h2 span')!.childNodes].find((node) => node.textContent!.includes('›'))!;
      const range = document.createRange();
      const at = text.textContent!.indexOf('›');
      range.setStart(text, at);
      range.setEnd(text, at + 1);
      const button = document.querySelector<HTMLElement>('header h2 button')!;
      return button.getBoundingClientRect().left + parseFloat(getComputedStyle(button).paddingLeft) - range.getBoundingClientRect().right;
    });
    expect(gap).toBeGreaterThan(2);
    await title(page).click();
    await field(page).waitFor();
    expect(await h2.textContent()).toBe('Roast Lab ›\u00a0');
    await page.screenshot({ path: '/tmp/ri-beside-rename-elsewhere.png', clip: { x: 0, y: 0, width: 540, height: 80 } });
    await field(page).press('Escape');
  } finally {
    await page.close();
  }
});
