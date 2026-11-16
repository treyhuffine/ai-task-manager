import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { browserFixture } from '@/test/fixtures/browser-fixture';

// Run with RI_SPACES_BROWSER_TEST=1, like the other task control tests.
const enabled = process.env.RI_SPACES_BROWSER_TEST === '1';
let fixture: Awaited<ReturnType<typeof browserFixture>>;

beforeAll(async () => {
  if (!enabled) return;
  fixture = await browserFixture(`
 import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
 import {TaskRecurrenceField} from './src/components/tasks/task-recurrence-picker';import {TaskRow} from './src/components/tasks/task-row';
 window.changes=[];window.opened=[];const params=new URLSearchParams(location.search);
 function Field(){const [value,setValue]=useState(params.get('value'));return <main><div onClick={()=>window.opened.push('row')}><TaskRecurrenceField value={value} onChange={v=>{window.changes.push(v);setValue(v);}}/></div><button style={{position:'fixed',top:0,right:0}}>Outside</button></main>;}
 function Row(){const [task,setTask]=useState({id:'row',title:'Row task',status:params.get('status')??'todo',hardDeadline:null,resurfaceAfter:null,recurrence:params.get('value'),nextRecurrenceAt:params.get('next'),bodyLen:0,subtaskCount:0});return <TaskRow task={task} onComplete={()=>{}} onSnooze={()=>{}} onArchive={()=>{}} onOpen={id=>window.opened.push(id)} onUpdate={(id,field,value)=>{window.changes.push([field,value]);setTask(t=>({...t,[field]:value}));}}/>;}
 createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}>{params.has('row')?<Row/>:<Field/>}</QueryClientProvider>);
`, [{
    name: 'task-recurrence-data',
    setup(b) {
      const modules: Record<string, string> = {
        'home/home-context': `export const useOptionalHomeContext=()=>({home:{kind:'personal'},capabilities:{privatePlanning:true}});export const useHomeContext=useOptionalHomeContext;`,
        'space-root': `export const useSpace=()=>null;`,
        'shared/area-select': `export const AreaSelect=()=>null;`,
        'tasks/lifecycle-status-control': `export const LifecycleStatusControl=()=>null;`,
        'tasks/task-badges': `export const TaskBadges=()=>null;`,
        'spaces/team-label': `export const TeamLabel=()=>null;`,
      };
      for (const [name, contents] of Object.entries(modules)) {
        b.onResolve({ filter: new RegExp(name + '$') }, () => ({ path: name, namespace: 'data' }));
        b.onLoad({ filter: new RegExp('^' + name + '$'), namespace: 'data' }, () => ({ contents, loader: 'tsx', resolveDir: process.cwd() }));
      }
    },
  }]);
}, 120_000);

afterAll(async () => {
  await fixture?.close();
});

// 1pm on Mon, Nov 16 2026 in Denver.
async function open(path: string): Promise<Page> {
  const page = await fixture.browser.newPage({ timezoneId: 'America/Denver' });
  page.setDefaultTimeout(4000);
  await page.clock.setFixedTime(new Date('2026-11-16T20:00:00Z'));
  await page.goto(fixture.url + path);
  return page;
}
const changes = (page: Page) => page.evaluate('window.changes');

it.skipIf(!enabled)('types or picks a repeat, and only a cadence it can follow saves', async () => {
  const page = await open('/');
  try {
    const input = page.getByRole('textbox', { name: 'Repeat', exact: true });
    const reading = page.locator('[aria-live="polite"]');
    const outside = page.getByRole('button', { name: 'Outside', exact: true });
    const field = (label: string) => page.getByRole('button', { name: `Repeat: ${label}`, exact: true });

    // Typed text shows what it read, and saves its short form on Enter.
    await field('Never').click();
    await expect.poll(() => input.evaluate((el) => el === document.activeElement)).toBe(true);
    expect(await input.inputValue()).toBe('');
    await input.fill('every 2 weeks');
    await expect.poll(() => reading.textContent()).toBe('Every 2 weeks');
    await input.press('Enter');
    await input.waitFor({ state: 'detached' });
    expect(await changes(page)).toEqual(['2w']);

    // Reopened, it starts from the saved repeat, marked among the common ones.
    // A pick saves at once, and clicks inside don't reach the row behind.
    await field('Every 2 weeks').click();
    expect(await input.inputValue()).toBe('Every 2 weeks');
    expect(await page.getByRole('button', { name: 'Every 2 weeks', exact: true }).getAttribute('aria-pressed')).toBe('true');
    const rowClicks = await page.evaluate('window.opened.length');
    await page.getByRole('button', { name: 'Monthly', exact: true }).click();
    await input.waitFor({ state: 'detached' });
    expect(await changes(page)).toEqual(['2w', 'monthly']);
    expect(await page.evaluate('window.opened.length')).toBe(rowClicks);

    // A weekday schedule is not a repeat Ri can follow: Enter holds, leaving changes nothing.
    await field('Monthly').click();
    await input.fill('every monday');
    await expect.poll(() => reading.textContent()).toBe('Not a repeat');
    await input.press('Enter');
    expect(await input.isVisible()).toBe(true);
    await outside.click();
    await input.waitFor({ state: 'detached' });
    expect(await changes(page)).toEqual(['2w', 'monthly']);

    // Escape leaves it as it was.
    await field('Monthly').click();
    await input.fill('daily');
    await input.press('Escape');
    await input.waitFor({ state: 'detached' });
    expect(await changes(page)).toEqual(['2w', 'monthly']);

    // Readable text saves on leaving.
    await field('Monthly').click();
    await input.fill('3d');
    await outside.click();
    await input.waitFor({ state: 'detached' });
    expect(await changes(page)).toEqual(['2w', 'monthly', '3d']);

    // It can stop repeating.
    await field('Every 3 days').click();
    await page.getByRole('button', { name: 'Don’t repeat', exact: true }).click();
    await input.waitFor({ state: 'detached' });
    expect(await changes(page)).toEqual(['2w', 'monthly', '3d', null]);
    await field('Never').waitFor();
  } finally {
    await page.close();
  }
}, 25_000);

it.skipIf(!enabled)('keeps saved wording when the same cadence is picked, and shows it', async () => {
  const page = await open('/?value=' + encodeURIComponent('Yearly, only if applicable'));
  try {
    const field = page.getByRole('button', { name: 'Repeat: Yearly', exact: true });
    await field.click();
    await page.getByText('Saved as “Yearly, only if applicable”', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Yearly', exact: true }).click();
    await page.getByRole('textbox', { name: 'Repeat', exact: true }).waitFor({ state: 'detached' });
    expect(await changes(page)).toEqual([]);
    await field.click();
    await page.getByRole('button', { name: 'Every 3 months', exact: true }).click();
    expect(await changes(page)).toEqual(['3m']);
  } finally {
    await page.close();
  }
}, 25_000);

it.skipIf(!enabled)('sets a repeat from the row menu, and a resting row says when it comes back', async () => {
  const menu = async (page: Page) => {
    await page.getByText('Row task', { exact: true }).hover();
    await page.locator('button:has(svg.lucide-ellipsis)').click();
  };
  let page = await open('/?row');
  try {
    await menu(page);
    await page.getByRole('menuitem', { name: 'Repeat', exact: true }).click();
    const input = page.getByRole('textbox', { name: 'Repeat', exact: true });
    await expect.poll(() => input.evaluate((el) => el === document.activeElement)).toBe(true);
    await page.waitForTimeout(400);
    expect(await input.evaluate((el) => el === document.activeElement)).toBe(true);
    await page.getByRole('button', { name: 'Weekly', exact: true }).click();
    await input.waitFor({ state: 'detached' });
    expect(await changes(page)).toEqual([['recurrence', 'weekly']]);
    await page.getByRole('button', { name: 'Repeats weekly', exact: true }).waitFor();
    expect(await page.evaluate('window.opened')).toEqual([]);
  } finally {
    await page.close();
  }

  page = await open('/?row&value=weekly&next=2026-11-17');
  try {
    const chip = page.getByRole('button', { name: 'Repeats weekly. Next one Tue, Nov 17', exact: true });
    expect((await chip.textContent())?.trim()).toBe('Weekly · Tomorrow');
    await chip.hover();
    await page.getByText('Next one Tue, Nov 17', { exact: true }).first().waitFor();
  } finally {
    await page.close();
  }

  // Due today, it doesn't rest.
  page = await open('/?row&value=weekly&next=2026-11-16');
  try {
    expect((await page.getByRole('button', { name: 'Repeats weekly', exact: true }).textContent())?.trim()).toBe('Weekly');
  } finally {
    await page.close();
  }

  // Consider is not a commitment, so it can't repeat.
  page = await open('/?row&status=consider');
  try {
    await menu(page);
    await page.getByRole('menuitem', { name: 'Set deadline', exact: true }).waitFor();
    expect(await page.getByRole('menuitem', { name: 'Repeat', exact: true }).count()).toBe(0);
  } finally {
    await page.close();
  }
}, 40_000);
