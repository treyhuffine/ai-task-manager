import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { browserFixture } from '@/test/fixtures/browser-fixture';

// RI_BACKGROUND_TASKS_BROWSER_TEST=1 RI_REVIEW_CHROMIUM=<chromium> pnpm exec vitest run src/components/dashboard/background-tasks-pill.browser.test.ts
const enabled = process.env.RI_BACKGROUND_TASKS_BROWSER_TEST === '1';
let fixture: Awaited<ReturnType<typeof browserFixture>> | undefined;

beforeAll(async () => {
  if (!enabled) return;
  fixture = await browserFixture(`
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {TopHud} from './src/components/dashboard/top-hud';
    import {TipProvider} from './src/components/ui/tip';
    document.documentElement.className=new URLSearchParams(location.search).get('theme')??'dark';
    if(location.search.includes('desktop'))document.documentElement.dataset.riDesktop='darwin';
    window.picked=[];
    createRoot(document.getElementById('root')).render(<TipProvider><TopHud/></TipProvider>);
  `, [{ name: 'background-hud-data', setup(builder) {
    const modules: Record<string, string> = {
      'contexts/dashboard-context': `export const useDashboard=()=>({activeView:{kind:'execution',id:'open'},activeSessionId:'open',setActiveView:view=>window.picked.push(view),goHome:()=>{},openExecution:()=>{}});`,
      'hooks/use-latest-execution': `export const useLatestExecutionId=()=>null;`,
      'hooks/use-activity-buckets': `
        import {useSyncExternalStore} from 'react';
        let buckets={needsApproval:[],unread:[],working:[],waiting:[]};
        const listeners=new Set();
        window.setActivityBuckets=value=>{buckets=value;listeners.forEach(fn=>fn());};
        export const useActivityBuckets=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>buckets);
      `,
      'hooks/use-areas': `export const useAreas=()=>({data:[]});`,
      'hooks/use-workspaces': `
        import {useSyncExternalStore} from 'react';
        const row=(id,label,taskCount,workspaceName='Build Ri',location=null)=>({id,label,taskCount,workspaceName,workspaceEmoji:null,workspaceAttachments:[],workspaceAreaId:null,executionId:id,executionLabel:null,location});
        let data={backgroundChats:[row('sibling','Long test run',2),row('main',null,1,null),row('remote','Research',1,'Research',{name:'MacBook',isHome:false})]};
        const listeners=new Set();
        window.setBackgroundChats=chats=>{data={backgroundChats:chats};listeners.forEach(fn=>fn());};
        export const useRailSessions=()=>({data:useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>data)});
      `,
      'lib/client/task-board': `export const openBoard=value=>window.board=value;`,
      'components/workspaces/agent-attention-row': `export const AgentAttentionRow=()=>null;`,
      'components/home/home-context': `export const useOptionalHomeContext=()=>null;`,
      'components/calendar/work/work-hud-pill': `import React from 'react';import{Users}from'lucide-react';export const WorkHudPill=()=> <button className="flex h-7 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-2 text-[11px]"><Users size={12}/><span>32h</span><span className="hud-work-label"><span className="hud-work-detail">of </span>human work<span className="hud-work-detail"> today</span></span></button>;`,
      'components/calendar/hud-day-button': `import React from 'react';import{Calendar}from'lucide-react';export const HudDayButton=()=> <button className="flex h-7 min-w-0 items-center gap-1.5 overflow-hidden text-[11px]"><Calendar size={12}/><span className="truncate">Product discussion and planning with the team</span><span className="shrink-0">in 14m</span></button>;`,
      'components/desktop/desktop-nav-buttons': `import React from 'react';import{ArrowLeft,ArrowRight}from'lucide-react';export const DesktopNavButtons=()=>document.documentElement.dataset.riDesktop?<div className="flex shrink-0 gap-0.5"><button aria-label="Back" className="p-1"><ArrowLeft size={14}/></button><button aria-label="Forward" className="p-1"><ArrowRight size={14}/></button></div>:null;`,
      'components/scratchpad/scratchpad-host': `export const ScratchpadButton=()=>null;`,
      'rate-limits-pill': `export const RateLimitsPill=()=>null;`,
      'budget-warning-pill': `export const BudgetWarningPill=()=>null;`,
      'create-menu': `import React from 'react';import{Plus}from'lucide-react';export const CreateMenu=()=> <button aria-label="Create" className="hud-create flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-border px-2 text-[11px]"><Plus size={14}/><span className="hud-create-label">Create</span></button>;`,
      'next/link': `import React from 'react';export default function Link(props){return <a {...props}/>;}`,
    };
    for (const [name, contents] of Object.entries(modules)) {
      builder.onResolve({ filter: new RegExp(name + '$') }, () => ({ path: name, namespace: 'background-data' }));
      builder.onLoad({ filter: new RegExp('^' + name + '$'), namespace: 'background-data' }, () => ({ contents, loader: 'tsx', resolveDir: process.cwd() }));
    }
  } }], { css: true });
}, 60_000);

afterAll(async () => { await fixture?.close(); });

it.skipIf(!enabled).each(['dark', 'light'])('shows just an icon and task count, with keyboard access and exact chat navigation (%s)', async theme => {
  const page = await fixture!.browser.newPage({ viewport: { width: 1180, height: 440 }, deviceScaleFactor: 2 });
  page.setDefaultTimeout(5_000);
  try {
    await page.goto(`${fixture!.url}/?theme=${theme}`);
    const trigger = page.getByRole('button', { name: 'Background tasks: 4' });
    await trigger.waitFor();
    expect(await trigger.innerText()).toBe('4');
    expect(await trigger.locator('svg').count()).toBe(1);
    await trigger.hover();
    await page.getByRole('tooltip', { name: 'Background tasks' }).waitFor();
    await trigger.focus();
    await page.keyboard.press('Enter');
    const card = page.locator('[data-slot="popover-content"]');
    await card.waitFor();
    await page.getByRole('tooltip').waitFor({ state: 'hidden' });
    expect(await card.getByRole('button').count()).toBe(3);
    expect(await card.innerText()).toContain('Main chat');
    expect(await card.innerText()).toContain('MacBook');
    expect(await card.innerText()).toContain('Restarting Ri interrupts background tasks running on this server.');
    const output = process.env.RI_ARTIFACT_SCREENSHOTS ?? path.join(os.tmpdir(), 'ri-background-tasks');
    await fs.mkdir(output, { recursive: true });
    await page.screenshot({ path: path.join(output, `background-tasks-${theme}.png`), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await card.waitFor({ state: 'hidden' });
    expect(await trigger.evaluate(node => node === document.activeElement)).toBe(true);
    await trigger.click();
    await card.getByRole('button', { name: /Long test run/ }).click();
    expect(await page.evaluate('window.picked')).toEqual([{ kind: 'execution', id: 'sibling' }]);
    await card.waitFor({ state: 'hidden' });
    await trigger.click();
    await card.getByRole('button', { name: /Main chat/ }).click();
    expect(await page.evaluate('window.picked.at(-1)')).toEqual({ kind: 'execution', id: 'main' });
  } finally { await page.close(); }
});

it.skipIf(!enabled).each(['dark', 'light'])('uses the same stable, dim zero as the other status pills after completion (%s)', async theme => {
  const page = await fixture!.browser.newPage();
  page.setDefaultTimeout(5_000);
  try {
    await page.goto(`${fixture!.url}/?theme=${theme}`);
    const active = page.getByRole('button', { name: 'Background tasks: 4' });
    await active.waitFor();
    const position = await active.boundingBox();
    await active.click();
    await page.evaluate('window.setBackgroundChats([])');
    await page.getByRole('button', { name: /^Background tasks:/ }).waitFor({ state: 'hidden' });
    await page.locator('[data-slot="popover-content"]').waitFor({ state: 'hidden' });
    const empty = page.locator('[aria-label="Background tasks: 0"]');
    await empty.waitFor();
    expect(await empty.innerText()).toBe('0');
    expect(await empty.evaluate(node => node.tagName)).toBe('SPAN');
    expect(await empty.getAttribute('class')).toBe(await page.locator('[aria-label="Working: 0"]').getAttribute('class'));
    expect((await empty.boundingBox())?.x).toBe(position?.x);
    expect(await empty.evaluate(node => getComputedStyle(node).opacity)).toBe('0.3');
    const output = process.env.RI_ARTIFACT_SCREENSHOTS ?? path.join(os.tmpdir(), 'ri-background-tasks');
    await fs.mkdir(output, { recursive: true });
    await page.locator('[data-desktop-titlebar]').screenshot({ path: path.join(output, `background-tasks-zero-${theme}.png`), animations: 'disabled' });
    await page.evaluate(`window.setBackgroundChats([{id:'next',label:'Next test',taskCount:1,workspaceName:'Build Ri',workspaceEmoji:null,workspaceAttachments:[],workspaceAreaId:null,location:null}])`);
    const trigger = page.getByRole('button', { name: 'Background tasks: 1' });
    await trigger.waitFor();
    expect(await trigger.getAttribute('aria-expanded')).toBe('false');
  } finally { await page.close(); }
});

it.skipIf(!enabled)('keeps the existing Working popover, chat navigation and Board action on the shared status pattern', async () => {
  const page = await fixture!.browser.newPage();
  page.setDefaultTimeout(5_000);
  try {
    await page.goto(fixture!.url);
    await page.getByRole('button', { name: 'Background tasks: 4' }).waitFor();
    await page.evaluate(`window.setActivityBuckets({needsApproval:[],unread:[],waiting:[],working:[{kind:'execution',id:'working',session:{id:'working',execution:{label:'Review the build'},workspaceName:'Build Ri',workspaceAttachments:[],workspaceEmoji:null,workspaceAreaId:null}}]})`);
    const trigger = page.getByRole('button', { name: 'Working: 1' });
    await trigger.click();
    const card = page.locator('[data-slot="popover-content"]');
    await card.getByRole('button', { name: /Review the build/ }).click();
    expect(await page.evaluate('window.picked')).toEqual([{ kind: 'execution', id: 'working' }]);
    await card.waitFor({ state: 'hidden' });
    await trigger.click();
    await card.getByRole('button', { name: 'Expand Working in Board' }).click();
    await card.waitFor({ state: 'hidden' });
    await expect.poll(() => page.evaluate('window.board')).toEqual({ focusBucket: 'working' });
  } finally { await page.close(); }
});

it.skipIf(!enabled)('fits the actual top HUD at tablet and desktop widths, including Mac window controls', async () => {
  for (const desktop of [false, true]) {
    const page = await fixture!.browser.newPage({ viewport: { width: 1440, height: 440 } });
    try {
      await page.goto(`${fixture!.url}/?theme=dark${desktop ? '&desktop=1' : ''}`);
      await page.getByRole('button', { name: 'Background tasks: 4' }).waitFor();
      for (const width of [1440, 1180, 1024, 900, 832, 768]) {
        await page.setViewportSize({ width, height: 440 });
        const layout = await page.locator('[data-desktop-titlebar]').evaluate(header => {
          const row = header.querySelector('.top-hud-row')!;
          const bounds = header.getBoundingClientRect();
          const buttons = [...header.querySelectorAll('button')];
          let right = bounds.left;
          const overlaps = buttons.some(button => {
            const box = button.getBoundingClientRect();
            const overlap = box.left < right - 1 || box.right > bounds.right + 1;
            right = box.right;
            return overlap;
          });
          return { overflows: row.scrollWidth > row.clientWidth + 1, overlaps };
        });
        expect(layout, `${desktop ? 'Mac' : 'browser'} at ${width}px`).toEqual({ overflows: false, overlaps: false });
      }
    } finally { await page.close(); }
  }
});
