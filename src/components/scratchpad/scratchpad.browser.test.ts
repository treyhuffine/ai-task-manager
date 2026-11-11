/** The real scratchpad and editor, with synthetic storage and entity mutations. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import { browserFixture } from '@/test/fixtures/browser-fixture';

let fixture: Awaited<ReturnType<typeof browserFixture>>;

beforeAll(async () => {
  fixture = await browserFixture(`
    import React, {useEffect, useRef} from 'react';
    import {createRoot} from 'react-dom/client';
    import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
    import {ScratchpadButton, ScratchpadColumn, ScratchpadSheet, ScratchpadShortcut} from '@/components/scratchpad/scratchpad-host';
    import {registerComposer} from '@/components/chat/editor/composer-focus';
    function App() {
      const message=useRef(null);
      useEffect(()=>registerComposer({el:message.current,focus:()=>message.current.focus(),insert:text=>{
        message.current.value+=text;
        message.current.focus();
      }}),[]);
      return <QueryClientProvider client={new QueryClient()}>
        <div className="flex h-dvh flex-col">
          <header className="flex h-12 shrink-0 items-center justify-end border-b p-2"><ScratchpadButton /></header>
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <main className="flex min-w-0 flex-1 flex-col">
              <header className="border-b px-6 py-4 text-sm font-semibold">Launch review <span className="ml-2 font-normal text-muted-foreground">Sample chat</span></header>
              <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 p-6 text-sm leading-relaxed">
                <div className="ml-auto max-w-md rounded-xl bg-muted px-4 py-3">Review the launch checklist and help me decide what to work on next.</div>
                <div><p className="mb-3 font-semibold">Start with the two things that unblock the launch:</p><ol className="ml-5 list-decimal space-y-2"><li>Finish the release notes and choose the screenshots.</li><li>Walk through onboarding on your phone.</li></ol><p className="mt-4 text-muted-foreground">Keep any loose thoughts on the scratchpad while you work.</p></div>
              </div>
              <div className="mx-auto mb-5 w-[calc(100%-3rem)] max-w-3xl rounded-xl border p-4"><input ref={message} aria-label="Message" placeholder="Message" className="w-full bg-transparent outline-none" /></div>
            </main>
            <div className="hidden min-h-0 lg:contents"><ScratchpadColumn /></div>
          </div>
          <ScratchpadSheet /><ScratchpadShortcut />
        </div>
      </QueryClientProvider>;
    }
    createRoot(document.getElementById('root')).render(<App />);
  `, [{
    name: 'scratchpad-data',
    setup(api) {
      api.onResolve({ filter: /^@\/(hooks\/use-(scratchpad|tasks|notes|stream)|components\/home\/home-context)$/ },
        () => ({ path: 'scratchpad-data', namespace: 'fixture' }));
      api.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
        loader: 'tsx', resolveDir: process.cwd(), contents: `
          import {useEffect, useState, useSyncExternalStore} from 'react';
          import {ScratchpadSaver} from '@/lib/client/scratchpad-saver';
          window.moves=[];
          window.writes=[];
          let record={body:'Call the printer\\n\\nReview the launch checklist\\n\\n## This week\\n\\n- [ ] Outline the release notes\\n- [ ] Choose the launch screenshots\\n- [ ] Try onboarding on my phone\\n\\n## Later\\n\\n- Collect feedback from the first users\\n- Review the calendar layout',updatedAt:'2026-11-11T09:00:00Z'};
          export const useOptionalHomeContext=()=>({capabilities:{privatePlanning:true}});
          export const useHomeStorageScope=()=>null;
          export const useLaptopHome=()=>null;
          export function useScratchpad() {
            const [saver]=useState(()=>{
              const saver=new ScratchpadSaver(async input=>{
                window.writes.push(input);
                record={body:input.body,updatedAt:'2026-11-11T10:00:00Z'};
                return {record,merged:false};
              },()=>localStorage);
              saver.observe(record);
              return saver;
            });
            const snapshot=useSyncExternalStore(saver.subscribe,saver.snapshot,saver.snapshot);
            useEffect(()=>saver.attach(),[saver]);
            return {saver,snapshot,loadError:null,retry:()=>{}};
          }
          const mutation=kind=>({mutateAsync:async input=>{
            window.moves.push({kind,input});
            return {id:'made-'+kind,...input};
          }});
          export const useCreateTask=()=>mutation('task');
          export const useCreateNote=()=>mutation('note');
          export const useCreateStream=()=>mutation('stream');
        `,
      }));
    },
  }], { css: true });
}, 60_000);

afterAll(async () => { await fixture?.close(); });

async function open(viewport = { width: 1440, height: 900 }): Promise<Page> {
  const page = await fixture.browser.newPage({ viewport, hasTouch: viewport.width < 1024 });
  await page.goto(fixture.url);
  await page.getByRole('button', { name: 'Scratchpad', exact: true }).click();
  await page.locator('[data-scratchpad] .tiptap').waitFor();
  if (viewport.width < 1024) {
    await page.getByRole('dialog').evaluate(async el => {
      await Promise.all(el.getAnimations().map(animation => animation.finished));
    });
  }
  return page;
}

const editor = (page: Page) => page.locator('[data-scratchpad] .tiptap');

async function expand(page: Page) {
  await page.getByRole('button', { name: 'Expand the scratchpad' }).click();
  await page.getByRole('dialog', { name: 'Scratchpad' }).evaluate(async el => {
    await Promise.all(el.getAnimations().map(animation => animation.finished));
  });
}

async function capture(page: Page, name: string) {
  const directory = process.env.RI_SCRATCHPAD_SCREENSHOTS;
  if (!directory) return;
  await fs.mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${name}.png`) });
}

describe('scratchpad quick view and expansion', () => {
  it('uses the narrow column for writing and keeps the actions reachable', async () => {
    const page = await open();
    try {
      const pad = page.locator('[data-scratchpad]');
      const box = await pad.boundingBox();
      expect(box!.width).toBeLessThanOrEqual(340);
      const writing = await editor(page).boundingBox();
      expect(writing!.width).toBeGreaterThan(300);
      for (const name of ['Task', 'Note', 'Stream', 'Chat']) {
        const button = page.getByRole('button', { name, exact: true });
        const action = await button.boundingBox();
        expect(action!.height).toBeGreaterThanOrEqual(32);
        expect(action!.y + action!.height).toBeLessThanOrEqual(900);
        expect(action!.x).toBeGreaterThanOrEqual(box!.x);
        expect(action!.x + action!.width).toBeLessThanOrEqual(box!.x + box!.width);
      }
      expect(await page.locator('[data-scratchpad] .drag-handle').isVisible()).toBe(false);
      await capture(page, 'desktop-side-by-side');
      await page.getByRole('button', { name: 'Close the scratchpad' }).click();
      await capture(page, 'desktop-closed');
    } finally { await page.close(); }
  });

  it('keeps the same editor, selection and undo history when expanding', async () => {
    const page = await open();
    try {
      await editor(page).locator('p').first().click();
      await page.keyboard.type(' today');
      await page.keyboard.press('ControlOrMeta+a');
      const selection = () => page.evaluate(() => getSelection()?.toString());
      const selected = await selection();
      expect(selected).toContain('Call the printer');
      const original = await editor(page).elementHandle();
      await expand(page);
      expect(await original!.evaluate(el => el.isConnected)).toBe(true);
      expect(await selection()).toBe(selected);
      expect((await page.locator('[data-scratchpad]').boundingBox())!.width).toBeGreaterThan(900);
      expect(await page.evaluate(() => document.body.style.pointerEvents)).toBe('none');
      await editor(page).press('ControlOrMeta+z');
      expect(await editor(page).textContent()).not.toContain(' today');
      await editor(page).press('Escape');
      expect((await page.locator('[data-scratchpad]').boundingBox())!.width).toBeLessThanOrEqual(340);
      await expect.poll(() => page.getByRole('dialog').count()).toBe(0);
      await editor(page).press('Escape');
      expect(await page.locator('[data-scratchpad]').count()).toBe(0);
    } finally { await page.close(); }
  });

  it('moves the selected line after expansion and preserves the other text', async () => {
    const page = await open();
    try {
      await editor(page).locator('p').first().click();
      await expand(page);
      await page.getByRole('button', { name: 'Stream', exact: true }).click();
      expect(await page.evaluate(() => (window as unknown as { moves: unknown[] }).moves)).toEqual([
        { kind: 'stream', input: { rawText: 'Call the printer', source: 'capture', media: 'text' } },
      ]);
      expect(await editor(page).textContent()).not.toContain('Call the printer');
      expect(await editor(page).textContent()).toContain('Review the launch checklist');
    } finally { await page.close(); }
  });

  it('returns from the slideout to quick view and keeps typing after closing and reopening', async () => {
    const page = await open();
    try {
      await expand(page);
      await editor(page).locator('p').first().click();
      await page.keyboard.type(' today');
      const draft = await editor(page).textContent();
      await page.getByRole('button', { name: 'Close the scratchpad' }).click();
      await expect.poll(() => page.getByRole('dialog').count()).toBe(0);
      expect(await editor(page).textContent()).toBe(draft);
      await page.getByRole('button', { name: 'Scratchpad', exact: true }).click();
      await page.getByRole('button', { name: 'Scratchpad', exact: true }).click();
      expect(await page.getByRole('button', { name: 'Expand the scratchpad' }).count()).toBe(1);
      expect(await editor(page).textContent()).toBe(draft);
    } finally { await page.close(); }
  });

  it('keeps actions in view while a long pad scrolls', async () => {
    const page = await open({ width: 1024, height: 600 });
    try {
      await editor(page).fill(Array.from({ length: 60 }, (_, i) => `Planning item ${i + 1}: write down the next step`).join('\n'));
      await expand(page);
      await editor(page).press('ControlOrMeta+End');
      const writing = page.locator('.scratchpad-editor');
      expect(await writing.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
      for (const name of ['Task', 'Note', 'Stream', 'Chat']) {
        const box = await page.getByRole('button', { name, exact: true }).boundingBox();
        expect(box!.y + box!.height).toBeLessThanOrEqual(600);
        expect(box!.x).toBeGreaterThan(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(1024);
      }
    } finally { await page.close(); }
  });

  it('dismisses on the backdrop and traps keyboard focus inside the slideout', async () => {
    const page = await open();
    try {
      await expand(page);
      await capture(page, 'desktop-modal');
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
      }
      await page.mouse.click(100, 300);
      await expect.poll(() => page.getByRole('dialog').count()).toBe(0);
      expect(await page.getByRole('button', { name: 'Expand the scratchpad' }).count()).toBe(1);
      expect(await editor(page).evaluate(el => el === document.activeElement)).toBe(true);
    } finally { await page.close(); }
  });

  it('sends a line to chat and returns focus to its message box', async () => {
    const page = await open();
    try {
      await editor(page).locator('p').first().click();
      await expand(page);
      await page.getByRole('button', { name: 'Chat', exact: true }).click();
      await expect.poll(() => page.getByRole('dialog').count()).toBe(0);
      const message = page.getByRole('textbox', { name: 'Message' });
      expect(await message.inputValue()).toBe('Call the printer ');
      expect(await message.evaluate(el => el === document.activeElement)).toBe(true);
      expect(await editor(page).textContent()).toContain('Call the printer');
    } finally { await page.close(); }
  });

  it('returns to quick view with the scratchpad shortcut', async () => {
    const page = await open();
    try {
      await expand(page);
      await editor(page).press('ControlOrMeta+Shift+j');
      await expect.poll(() => page.getByRole('dialog').count()).toBe(0);
      expect(await page.getByRole('button', { name: 'Expand the scratchpad' }).count()).toBe(1);
    } finally { await page.close(); }
  });

  it('resizes the slideout from its left edge', async () => {
    const page = await open();
    try {
      await expand(page);
      const dialog = page.getByRole('dialog');
      const before = (await dialog.boundingBox())!.width;
      const handle = (await page.getByRole('separator', { name: 'Resize the scratchpad' }).boundingBox())!;
      await page.mouse.move(handle.x + handle.width / 2, 300);
      await page.mouse.down();
      await page.mouse.move(handle.x - 180, 300, { steps: 8 });
      await page.mouse.up();
      expect((await dialog.boundingBox())!.width).toBeGreaterThan(before + 150);
      expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(1440);
      expect(await editor(page).textContent()).toContain('Call the printer');
    } finally { await page.close(); }
  });

  it.each([320, 390, 820])('fits a %ipx sheet with touch sized actions', async width => {
    const page = await open({ width, height: 780 });
    try {
      expect(await page.getByRole('button', { name: 'Expand the scratchpad' }).count()).toBe(0);
      const pad = await page.locator('[data-scratchpad]').boundingBox();
      expect(pad!.width).toBeLessThanOrEqual(width);
      for (const name of ['Task', 'Note', 'Stream', 'Chat']) {
        const button = await page.getByRole('button', { name, exact: true }).boundingBox();
        expect(button!.height).toBeGreaterThanOrEqual(40);
        expect(button!.x).toBeGreaterThanOrEqual(0);
        expect(button!.x + button!.width).toBeLessThanOrEqual(width);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await capture(page, width === 820 ? 'tablet-sheet' : `phone-${width}`);
      await editor(page).press('Escape');
      await expect.poll(() => page.locator('[data-scratchpad]').count()).toBe(0);
    } finally { await page.close(); }
  });

  it.each([320, 390, 1440])('keeps the empty placeholder on one line at %ipx', async width => {
    const page = await open({ width, height: 780 });
    try {
      await editor(page).fill('');
      const placeholder = editor(page).locator('.is-empty[data-placeholder]').first();
      expect(await placeholder.getAttribute('data-placeholder')).toBe('Write a note…');
      const style = await placeholder.evaluate(el => {
        const hint = getComputedStyle(el, '::before');
        return { whiteSpace: hint.whiteSpace, overflow: hint.overflow, height: parseFloat(hint.height), lineHeight: parseFloat(hint.lineHeight), width: parseFloat(hint.width), available: el.clientWidth };
      });
      expect(style.whiteSpace).toBe('nowrap');
      expect(style.overflow).toBe('hidden');
      expect(style.height).toBeGreaterThan(0);
      expect(style.height).toBeLessThanOrEqual(style.lineHeight + 1);
      expect(style.width).toBeLessThanOrEqual(style.available + 1);
      await capture(page, `empty-${width}`);
      if (width === 1440) {
        await expand(page);
        await capture(page, 'empty-modal');
      }
    } finally { await page.close(); }
  });
});
