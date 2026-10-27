/**
 * The empty composer shows its whole placeholder, however long and however
 * narrow the panel, with the caret at the first character and the wording
 * clear of the ⌘I hint wherever that hint shows. Typed text keeps the full
 * width. Real composer and the app's compiled CSS in Chromium, with no server
 * behind it (its queries fail and it renders without their data).
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { browserFixture } from '@/test/fixtures/browser-fixture';
import { DEFAULT_COMPOSER_PLACEHOLDER } from './execution-composer';

let fixture: Awaited<ReturnType<typeof browserFixture>>;

beforeAll(async () => {
  fixture = await browserFixture(`
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import {TipProvider} from './src/components/ui/tip';
    import {WorkContext} from './src/contexts/work-context';
    import {ExecutionComposer} from './src/components/executions/execution-composer';
    const params=new URLSearchParams(location.search);
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    const navigation={openAgent(){},openExecution(){},openTask(){},openNote(){},goHome(){}};
    const activity={activeSessionId:null,streamingSessionIds:new Set(),backgroundSessionIds:new Set(),pendingInputSessionIds:new Set(),setActiveExecutionId(){},setSessionStreaming(){}};
    createRoot(document.getElementById('root')).render(
      <QueryClientProvider client={client}><TipProvider><WorkContext navigation={navigation} activity={activity}>
        <main className="bg-background text-foreground p-4">{Array.from({length:Number(params.get('count')??1)},(_,i)=><div key={i} data-panel style={{width:params.get('width')+'px'}}>
          <ExecutionComposer sessionId="" autoFocus={false} permissionMode="auto_all" harness={null} model={null} effort={null}
            placeholder={params.get('placeholder')??undefined} onSend={()=>{}}/>
        </div>)}</main>
      </WorkContext></TipProvider></QueryClientProvider>);
  `, [], { css: true });
}, 120_000);

afterAll(async () => { await fixture?.close(); });

const LONG = 'Ask your agent to do any work. You can @mention agents, apps, files, tasks, or notes. Reference PRs with @# or use a slash to run /skills';

/** Where the empty editor puts its placeholder, its caret line and the hint, in page pixels. */
async function measure(page: Page) {
  return page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>('.ProseMirror')!;
    const p = editor.querySelector<HTMLElement>('p.is-editor-empty')!;
    const before = getComputedStyle(p, '::before');
    const paragraph = p.getBoundingClientRect();
    const box = editor.getBoundingClientRect();
    const caret = p.querySelector('br')!.getBoundingClientRect();
    const hint = [...document.querySelectorAll<HTMLElement>('span')].find(el => el.textContent?.endsWith('to focus'));
    const hintBox = hint && getComputedStyle(hint).display !== 'none' ? hint.getBoundingClientRect() : null;
    return {
      placeholder: before.content,
      // The float starts at the paragraph's top left. Its text ends at its right padding.
      placeholderBottom: paragraph.top + parseFloat(before.height),
      placeholderTextRight: paragraph.left + parseFloat(before.width) - parseFloat(before.paddingRight),
      lineHeight: parseFloat(getComputedStyle(p).lineHeight),
      placeholderHeight: parseFloat(before.height),
      editorBottom: box.bottom - parseFloat(getComputedStyle(editor).paddingBottom),
      editorHeight: box.height,
      scrolls: editor.scrollHeight > editor.clientHeight,
      caret: { left: caret.left - paragraph.left, top: caret.top - paragraph.top },
      hintLeft: hintBox?.left ?? null,
    };
  });
}

it.each([
  { label: 'default, narrow panel', width: 300, placeholder: null },
  { label: 'default, wide panel', width: 720, placeholder: null },
  { label: 'long, narrow panel', width: 300, placeholder: LONG },
  { label: 'long, wide panel', width: 720, placeholder: LONG },
])('shows the whole placeholder clear of the focus hint: $label', async ({ width, placeholder }) => {
  const page = await fixture.browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.goto(`${fixture.url}/?width=${width}${placeholder ? `&placeholder=${encodeURIComponent(placeholder)}` : ''}`);
    await page.locator('.ProseMirror p.is-editor-empty').waitFor();
    const empty = await measure(page);
    expect(empty.placeholder).toBe(JSON.stringify(placeholder ?? DEFAULT_COMPOSER_PLACEHOLDER));
    // Every line is inside the box, and the box doesn't scroll to reach one.
    expect(empty.placeholderBottom).toBeLessThanOrEqual(empty.editorBottom + 0.5);
    expect(empty.scrolls).toBe(false);
    // The caret sits at the first character, not under the placeholder.
    expect(Math.abs(empty.caret.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(empty.caret.top)).toBeLessThanOrEqual(1);
    expect(empty.hintLeft).not.toBeNull();
    expect(empty.placeholderTextRight).toBeLessThanOrEqual(empty.hintLeft!);
    if (!placeholder) {
      // The short wording takes one line on a wide panel and at most two on a narrow one.
      expect(Math.round(empty.placeholderHeight / empty.lineHeight)).toBeLessThanOrEqual(width >= 720 ? 1 : 2);
    }
    await page.screenshot({ path: `/tmp/ri-composer-placeholder-${width}-${placeholder ? 'long' : 'default'}.png`, clip: { x: 0, y: 0, width: width + 32, height: 200 } });

    // Clicking in hides the hint but keeps the wording where it was.
    await page.locator('.ProseMirror').click();
    const focused = await measure(page);
    expect(focused.hintLeft).toBeNull();
    expect(focused.editorHeight).toBe(empty.editorHeight);
    expect(focused.placeholderTextRight).toBe(empty.placeholderTextRight);

    // Typed text runs past the hint's corner, using the full width.
    await page.keyboard.type('word '.repeat(60));
    const firstLineRight = await page.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector('.ProseMirror p')!);
      return Math.max(...[...range.getClientRects()].map(rect => rect.right));
    });
    expect(firstLineRight).toBeGreaterThan(empty.hintLeft!);
  } finally {
    await page.close();
  }
});

it('keeps the room only in the composer ⌘I reaches, when two are on screen', async () => {
  const page = await fixture.browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.goto(`${fixture.url}/?width=600&count=2`);
    await page.locator('.ProseMirror p.is-editor-empty').nth(1).waitFor();
    const state = () => page.evaluate(() => [...document.querySelectorAll('[data-panel]')].map(panel => ({
      hint: [...panel.querySelectorAll('span')].some(el => el.textContent?.endsWith('to focus') && getComputedStyle(el).display !== 'none'),
      room: getComputedStyle(panel.querySelector('.ProseMirror p')!, '::before').paddingRight,
    })));
    // The first on screen is the target until another is focused.
    expect(await state()).toEqual([{ hint: true, room: '66px' }, { hint: false, room: '0px' }]);
    await page.locator('.ProseMirror').nth(1).click();
    expect(await state()).toEqual([{ hint: false, room: '0px' }, { hint: false, room: '66px' }]);
  } finally {
    await page.close();
  }
});

it('leaves the phone layout, which has no hint, the full width', async () => {
  const page = await fixture.browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.goto(`${fixture.url}/?width=358`);
    await page.locator('.ProseMirror p.is-editor-empty').waitFor();
    const empty = await measure(page);
    expect(empty.hintLeft).toBeNull();
    expect(empty.scrolls).toBe(false);
    expect(empty.placeholderBottom).toBeLessThanOrEqual(empty.editorBottom + 0.5);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.ProseMirror p')!, '::before').paddingRight)).toBe('0px');
    await page.screenshot({ path: '/tmp/ri-composer-placeholder-phone.png', clip: { x: 0, y: 0, width: 390, height: 200 } });
  } finally {
    await page.close();
  }
});
