/**
 * The composer reads its chat when a person engages with it, not when it merely
 * takes focus: it focuses itself on arrival, and that must leave an unread chat
 * unread. Real composer in Chromium with no server behind it, so a read shows up
 * as the request it sends.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { browserFixture } from '@/test/fixtures/browser-fixture';

let fixture: Awaited<ReturnType<typeof browserFixture>>;

beforeAll(async () => {
  fixture = await browserFixture(`
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import {TipProvider} from './src/components/ui/tip';
    import {WorkContext} from './src/contexts/work-context';
    import {ExecutionComposer} from './src/components/executions/execution-composer';
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    const read=new URLSearchParams(location.search).has('read');
    client.setQueryData(['sessions','rail'],{sessions:[{id:'chat-a',lastOutcomeEventAt:'2026-11-06T11:00:00.000Z',unreadMarkerAt:null,lastViewedAt:read?'2026-11-06T12:00:00.000Z':'2026-11-06T10:00:00.000Z'}]});
    const navigation={openAgent(){},openExecution(){},openTask(){},openNote(){},goHome(){}};
    const activity={activeSessionId:null,streamingSessionIds:new Set(),backgroundSessionIds:new Set(),pendingInputSessionIds:new Set(),setActiveExecutionId(){},setSessionStreaming(){}};
    createRoot(document.getElementById('root')).render(
      <QueryClientProvider client={client}><TipProvider><WorkContext navigation={navigation} activity={activity}>
        <main className="bg-background text-foreground p-4" style={{width:640}}>
          <ExecutionComposer sessionId="chat-a" permissionMode="auto_all" harness={null} model={null} effort={null} onSend={()=>{}}/>
        </main>
      </WorkContext></TipProvider></QueryClientProvider>);
  `, [], { css: true });
}, 120_000);

afterAll(async () => { await fixture?.close(); });

const EDITOR = '.ProseMirror[contenteditable="true"]';

async function open(query = '') {
  const page = await fixture.browser.newPage({ viewport: { width: 1280, height: 800 } });
  const reads: string[] = [];
  page.on('request', (request) => { if (request.url().includes('sessions.readPost')) reads.push(request.url()); });
  await page.goto(`${fixture.url}/${query}`);
  // Arriving, the composer takes focus by itself.
  await page.waitForFunction((selector) => !!document.activeElement?.closest(selector), EDITOR);
  await page.waitForTimeout(300);
  return { page, reads };
}

const settled = (page: Page) => page.waitForTimeout(300);

it('stays unread when the composer focuses itself on arrival', async () => {
  const { page, reads } = await open();
  try {
    expect(reads).toEqual([]);
  } finally { await page.close(); }
});

it('stays unread when the composer regains focus, as when you come back to the window', async () => {
  const { page, reads } = await open();
  try {
    await page.evaluate((selector) => {
      const editor = document.querySelector<HTMLElement>(selector)!;
      editor.blur();
      editor.focus();
    }, EDITOR);
    await settled(page);
    expect(await page.evaluate((selector) => !!document.activeElement?.closest(selector), EDITOR)).toBe(true);
    expect(reads).toEqual([]);
  } finally { await page.close(); }
});

it('reads when you click into the composer, though it already has focus', async () => {
  const { page, reads } = await open();
  try {
    await page.locator(EDITOR).click();
    await expect.poll(() => reads.length).toBe(1);
  } finally { await page.close(); }
});

it('reads once when you start typing, without a click', async () => {
  const { page, reads } = await open();
  try {
    await page.keyboard.type('hello', { delay: 20 });
    await expect.poll(() => reads.length).toBe(1);
    await settled(page);
    expect(reads.length).toBe(1);
    expect(await page.locator(EDITOR).innerText()).toContain('hello');
  } finally { await page.close(); }
});

it('reads when you paste', async () => {
  const { page, reads } = await open();
  try {
    await page.evaluate((selector) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', 'pasted');
      document.querySelector(selector)!.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
    }, EDITOR);
    await expect.poll(() => reads.length).toBe(1);
  } finally { await page.close(); }
});

it('sends nothing for a chat that is already read', async () => {
  const { page, reads } = await open('?read');
  try {
    await page.locator(EDITOR).click();
    await page.keyboard.type('hi');
    await settled(page);
    expect(reads).toEqual([]);
  } finally { await page.close(); }
});
