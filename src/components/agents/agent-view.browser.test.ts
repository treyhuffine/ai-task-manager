/**
 * The agent view's terminal and tools work as an execution's do
 * (docs/agents-view-spec.md §10): the labeled Terminal and Tools buttons in
 * the header, ⌃` and ⌃. from anywhere (a focused text field too), the
 * terminal as a drawer across the bottom in the agent's own folder, the
 * floating box with its Terminal row while the tools are closed, expand and
 * Escape, ⌘P to Files, and open or closed kept per agent. The phone has no
 * terminal. The real view, header, tools, box, splits and compiled CSS in
 * Chromium. Data hooks, the chat, the tabs' contents and the shell are
 * fixtures, so no server is behind it.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import type { Plugin } from 'esbuild';
import { browserFixture } from '@/test/fixtures/browser-fixture';

const STUBS: Record<string, string> = {
  '@/hooks/use-workspaces': `
    const names = { 'agent-1': 'Field Notes', 'agent-2': 'Roast Lab' };
    export const useWorkspace = (id) => ({ data: { id, name: names[id] ?? id, status: 'active', cwd: '/Users/maya/code/' + id, isGit: true, emoji: null, attachments: [], areaId: null }, error: null, fetchStatus: 'idle', refetch() {} });
    export const useRunOn = () => ({ data: null });`,
  '@/hooks/use-agent': `
    export const useAgentExecutions = () => ({ working: [], needsYou: [] });
    export const useAgentPreviews = () => ({ data: { previews: [] } });`,
  '@/hooks/use-main-chat': `export const useMainChat = (scope) => ({ data: { session: { id: 'main-' + scope } } });`,
  '@/hooks/use-areas': `export const useAreas = () => ({ data: [] });`,
  '@/components/home/home-context': `
    export const useHomeStorageScope = () => null;
    export const useOptionalHomeContext = () => null;`,
  '@/components/workspaces/launcher/launcher-store': `export const openLauncher = () => {};`,
  '@/components/chat-ui/artifacts/artifact-preview-provider': `
    export const useBesidePreview = () => null;
    export const useBesideRegion = () => {};
    export const useArtifactPreviewStore = () => ({});`,
  '@/components/chat-ui/artifacts/artifact-beside': `
    export const BesideFileTab = () => null;
    export const BesideFileView = () => null;
    export const BesideFileClose = () => null;`,
  '@/components/chat-ui/artifacts/artifact-preview-parts': `
    export const PreviewIcon = () => null;
    export const previewName = () => '';`,
  // The drawer imports it relatively.
  '../execution-terminal-panel': `
    import { jsx, jsxs } from 'react/jsx-runtime';
    export function ExecutionTerminalPanel({ source, onToggleCollapsed, collapseTitle, headerExtra }) {
      return jsxs('div', { 'data-terminal': JSON.stringify(source), className: 'flex h-full flex-col bg-black text-white', children: [
        jsx('span', { children: 'Shell in ' + source.workspaceId }), headerExtra,
        jsx('button', { type: 'button', 'aria-label': collapseTitle, onClick: onToggleCollapsed, children: 'Hide' }),
      ] });
    }`,
  './agent-chat-panel': `
    import { jsx, jsxs } from 'react/jsx-runtime';
    export function AgentChatPanel({ workspace, overlay }) {
      return jsxs('div', { 'data-main-chat': workspace.id, className: '@container/chat relative flex h-full min-h-0 flex-1 flex-col', children: [
        jsx('textarea', { 'aria-label': 'Message ' + workspace.name }), overlay,
      ] });
    }`,
  './agent-overview': `import { jsx } from 'react/jsx-runtime'; export const AgentOverview = () => jsx('p', { children: 'Overview body' });`,
  './agent-files': `import { jsx } from 'react/jsx-runtime'; export const AgentFiles = () => jsx('input', { 'data-tree-search': '', 'aria-label': 'Search files' });`,
  './agent-preview': `import { jsx } from 'react/jsx-runtime'; export const AgentPreview = () => jsx('p', { children: 'Preview body' });`,
  './agent-setup': `import { jsx } from 'react/jsx-runtime'; export const AgentSetup = () => jsx('p', { children: 'Setup body' });`,
  './agent-beside-chat': `
    export const AgentBesideChat = () => null;
    export const BesideChatTabLabel = () => null;
    export const useBesideChatSummary = () => ({ title: '', dot: null });`,
};

const stubs: Plugin = {
  name: 'agent-view-fixtures',
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
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import {TipProvider} from './src/components/ui/tip';
    import {WorkContext} from './src/contexts/work-context';
    import {AgentView} from './src/components/agents/agent-view';
    const params=new URLSearchParams(location.search);
    const agent=params.get('agent')??'agent-1';
    // A narrower view than the window: a squeezed window beside the rail, still the desktop layout.
    const width=params.get('width');
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    const navigation={openAgent(){},openExecution(){},openTask(){},openNote(){},goHome(){}};
    const activity={activeSessionId:null,streamingSessionIds:new Set(),backgroundSessionIds:new Set(),pendingInputSessionIds:new Set(),setActiveExecutionId(){},setSessionStreaming(){}};
    createRoot(document.getElementById('root')).render(
      <QueryClientProvider client={client}><TipProvider><WorkContext navigation={navigation} activity={activity}>
        <div className="flex h-screen bg-background text-foreground" style={width?{width:width+'px'}:undefined}><AgentView workspaceId={agent}/></div>
      </WorkContext></TipProvider></QueryClientProvider>);
  `, [stubs], { css: true });
}, 120_000);

afterAll(async () => { await fixture?.close(); });

async function open(width: number, agent = 'agent-1', page?: Page, viewWidth?: number) {
  const p = page ?? await fixture.browser.newPage({ viewport: { width, height: 900 } });
  await p.goto(`${fixture.url}/?agent=${agent}${viewWidth ? `&width=${viewWidth}` : ''}`);
  await p.locator(`[data-main-chat="${agent}"]`).first().waitFor();
  return p;
}

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const pressed = async (page: Page, name: string) => (await button(page, name).getAttribute('aria-pressed')) === 'true';
const drawer = (page: Page) => page.locator('[data-terminal]');
const toolTabs = (page: Page) => page.getByRole('tablist', { name: 'Agent tools' });
const box = (page: Page) => page.getByRole('group', { name: 'Field Notes tools' }).first();

it('toggles the terminal drawer with ⌃` and the header button, in the agent folder, below the chat and tools', async () => {
  const page = await open(1440);
  try {
    expect(await pressed(page, 'Terminal')).toBe(false);
    expect(await drawer(page).count()).toBe(0);

    // From a focused text field too, as in an execution.
    await page.getByLabel('Message Field Notes').focus();
    await page.keyboard.press('Control+Backquote');
    await drawer(page).waitFor();
    expect(await pressed(page, 'Terminal')).toBe(true);
    expect(JSON.parse((await drawer(page).getAttribute('data-terminal'))!)).toEqual({ kind: 'workspace', workspaceId: 'agent-1' });
    // Across the whole bottom: under the chat and the tools, full width.
    const [chatBox, toolsBox, termBox] = await Promise.all([
      page.locator('[data-main-chat]').boundingBox(),
      toolTabs(page).boundingBox(),
      drawer(page).boundingBox(),
    ]);
    expect(termBox!.y).toBeGreaterThanOrEqual(chatBox!.y + chatBox!.height - 1);
    expect(termBox!.y).toBeGreaterThan(toolsBox!.y);
    expect(termBox!.width).toBeGreaterThan(1400);

    await page.keyboard.press('Control+Backquote');
    await drawer(page).waitFor({ state: 'detached' });
    expect(await pressed(page, 'Terminal')).toBe(false);

    await button(page, 'Terminal').click();
    await drawer(page).waitFor();
    // The drawer's own hide, as in an execution.
    await page.getByRole('button', { name: 'Hide the terminal. Shells keep running.' }).click();
    await drawer(page).waitFor({ state: 'detached' });

    // Expand fills the view, and the chat and tools come back after.
    await button(page, 'Terminal').click();
    await page.getByRole('button', { name: 'Expand the terminal' }).click();
    await page.locator('[data-main-chat]').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Restore the terminal height' }).click();
    await page.locator('[data-main-chat]').waitFor({ state: 'visible' });
  } finally {
    await page.close();
  }
}, 60_000);

it('toggles the tools with ⌃. and the header button, with the box and its Terminal row while closed', async () => {
  const page = await open(1440);
  try {
    expect(await pressed(page, 'Tools')).toBe(true);
    await toolTabs(page).waitFor();
    expect(await toolTabs(page).getByRole('tab').allTextContents()).toEqual(['Overview', 'Files', 'Preview', 'Setup']);
    expect(await box(page).count()).toBe(0);

    await page.getByLabel('Message Field Notes').focus();
    await page.keyboard.press('Control+Period');
    await toolTabs(page).waitFor({ state: 'hidden' });
    expect(await pressed(page, 'Tools')).toBe(false);
    await box(page).waitFor();
    // The execution box's rows, with the terminal after Files.
    expect(await box(page).getByRole('button').allTextContents()).toEqual([
      'Overview', `Files${'⌘P'}`, `Terminal${'⌃`'}`, 'Preview', 'Setup',
    ]);

    // Its Terminal row opens the drawer below and says so, without opening the tools.
    await box(page).getByRole('button', { name: /^Terminal/ }).click();
    await drawer(page).waitFor();
    await box(page).getByRole('button', { name: /Open below/ }).waitFor();
    expect(await pressed(page, 'Tools')).toBe(false);

    await page.keyboard.press('Control+Period');
    await toolTabs(page).waitFor();
    expect(await box(page).count()).toBe(0);

    await button(page, 'Tools').click();
    await toolTabs(page).waitFor({ state: 'hidden' });
    // A box row opens the tools on that tool.
    await box(page).getByRole('button', { name: 'Setup' }).click();
    await toolTabs(page).waitFor();
    expect(await toolTabs(page).getByRole('tab', { selected: true }).textContent()).toBe('Setup');
  } finally {
    await page.close();
  }
}, 60_000);

it('expands the tools over the chat, and Escape restores, then closes them', async () => {
  const page = await open(1440);
  try {
    await page.getByRole('button', { name: 'Expand the panel' }).click();
    await page.locator('[data-main-chat]').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Bring the chat back' }).waitFor();

    await page.locator('body').click({ position: { x: 5, y: 890 } });
    await page.keyboard.press('Escape');
    await page.locator('[data-main-chat]').waitFor({ state: 'visible' });
    await toolTabs(page).waitFor();

    await page.keyboard.press('Escape');
    await toolTabs(page).waitFor({ state: 'hidden' });

    // Double-clicking a tab expands, as in an execution. The panel's × closes.
    await button(page, 'Tools').click();
    await toolTabs(page).getByRole('tab', { name: 'Overview' }).dblclick();
    await page.locator('[data-main-chat]').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Close the panel' }).click();
    await toolTabs(page).waitFor({ state: 'hidden' });
    await page.locator('[data-main-chat]').waitFor({ state: 'visible' });

    // Escape stays in a text field.
    await button(page, 'Tools').click();
    await page.getByLabel('Message Field Notes').focus();
    await page.keyboard.press('Escape');
    expect(await toolTabs(page).isVisible()).toBe(true);
  } finally {
    await page.close();
  }
}, 60_000);

it('⌘P opens the tools on Files and focuses the tree search', async () => {
  const page = await open(1440);
  try {
    await page.keyboard.press('Control+Period');
    await toolTabs(page).waitFor({ state: 'hidden' });
    await page.keyboard.press('Meta+p');
    await toolTabs(page).waitFor();
    expect(await toolTabs(page).getByRole('tab', { selected: true }).textContent()).toBe('Files');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Search files');
  } finally {
    await page.close();
  }
}, 60_000);

it('keeps the terminal and tools open or closed per agent, across a reload', async () => {
  const page = await open(1440, 'agent-1');
  try {
    await page.keyboard.press('Control+Backquote');
    await page.keyboard.press('Control+Period');
    await drawer(page).waitFor();
    await toolTabs(page).waitFor({ state: 'hidden' });

    await open(1440, 'agent-1', page);
    await drawer(page).waitFor();
    expect(await pressed(page, 'Terminal')).toBe(true);
    expect(await pressed(page, 'Tools')).toBe(false);

    // Another agent has its own: tools open, no terminal.
    await open(1440, 'agent-2', page);
    expect(await pressed(page, 'Terminal')).toBe(false);
    expect(await pressed(page, 'Tools')).toBe(true);
    expect(await drawer(page).count()).toBe(0);
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('ri.agent.workbench.agent')))).toEqual(['ri.agent.workbench.agent-1']);
  } finally {
    await page.close();
  }
}, 60_000);

it('has no terminal on a phone, as an execution has none', async () => {
  const page = await open(390);
  try {
    await page.getByRole('tab', { name: 'Chat' }).waitFor();
    expect(await button(page, 'Terminal').count()).toBe(0);
    await page.keyboard.press('Control+Backquote');
    await page.waitForTimeout(200);
    expect(await drawer(page).count()).toBe(0);
    // ⌃. switches panes there.
    await page.keyboard.press('Control+Period');
    await page.waitForFunction(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent === 'Tools');
  } finally {
    await page.close();
  }
}, 60_000);

it('keeps the drawer in one-pane mode on the desktop layout, under the Chat / Tools switch', async () => {
  const page = await open(1280, 'agent-1', undefined, 760);
  try {
    await page.getByRole('tab', { name: 'Chat' }).waitFor();
    // The switch stands in for the Tools toggle. The Terminal toggle stays.
    expect(await button(page, 'Tools').count()).toBe(0);
    expect(await pressed(page, 'Terminal')).toBe(false);
    await page.keyboard.press('Control+Backquote');
    await drawer(page).waitFor();
    const [chatBox, termBox] = await Promise.all([page.locator('[data-main-chat]').boundingBox(), drawer(page).boundingBox()]);
    expect(termBox!.y).toBeGreaterThanOrEqual(chatBox!.y + chatBox!.height - 1);
    // ⌃. switches panes, and the drawer stays.
    await page.keyboard.press('Control+Period');
    await page.waitForFunction(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent === 'Tools');
    expect(await drawer(page).isVisible()).toBe(true);
    await button(page, 'Terminal').click();
    await drawer(page).waitFor({ state: 'detached' });
  } finally {
    await page.close();
  }
}, 60_000);
