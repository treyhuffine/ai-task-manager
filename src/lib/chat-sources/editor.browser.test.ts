import { it, expect } from 'vitest';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { encodeSource, sourceMarker } from './reference';
import type { ChatInputEditorHandle } from '@/components/chat/editor/chat-input-editor';
import type { SourceDescriptor } from './types';

it('qualifies source picking, exact account drill-down, draft restore, both outputs and mobile chips in Chromium', async () => {
  const sources: SourceDescriptor[] = ['Work', 'Personal'].map(account => ({ sourceRef: encodeSource({ v: 1, kind: 'integration', toolkitId: 'mail', account: { accountId: account, authConfigId: null } }), label: `Mail · ${account}`, accountLabel: account, service: 'Mail', groupId: 'mail', keywords: [account], status: 'ready', chat: true, view: 'none' }));
  const bundle = await build({ entryPoints: ['src/test/fixtures/source-editor.tsx'], absWorkingDir: process.cwd(), bundle: true, platform: 'browser', format: 'iife', write: false, define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}'  }, jsx: 'automatic', logLevel: 'silent' });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, 'http://fixture');
    if (url.pathname.startsWith('/api/trpc/')) {
      const input = JSON.parse(url.searchParams.get('input') ?? '{}');
      const result = url.pathname.endsWith('chatSources.search') ? { items: input.groupId || input.query ? sources.filter(s => !input.query || s.label.toLowerCase().includes(input.query.toLowerCase())).map(source => ({ kind: 'source', source })) : [{ kind: 'sourceGroup', groupId: 'mail', label: 'Mail', count: 2 }], total: input.groupId ? 2 : 1 } : url.pathname.endsWith('chatSources.resolve') ? sources.filter(s => input.refs?.includes(s.sourceRef)) : {};
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ result: { data: result } })); return;
    }
    if (url.pathname === '/fixture.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
    res.setHeader('content-type', 'text/html'); res.end('<html><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const executablePath = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find(fs.existsSync);
  if (!executablePath) throw new Error('Chromium is required for composer qualification');
  const browser = await chromium.launch({ executablePath, headless: true });
  const errors: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', error => { errors.push(error.message); });
    page.setDefaultTimeout(6000);
    await page.goto(origin);
    const editor = page.locator('.tiptap'); await editor.waitFor(); await editor.click();
    await page.keyboard.type('@app:');
    await page.locator('.slash-command-popup').waitFor();
    await page.getByRole('button', { name: /Mail.*2 accounts/ }).click();
    await page.getByRole('button', { name: /Mail · Work.*Chat/ }).click();
    await page.getByRole('button', { name: 'Mail · Work, Ready', exact: true }).waitFor();
    const output = await page.evaluate(() => {
      const handle = (window as unknown as { sourceEditor: { current: { getMarkerOutput(): unknown; getUiMessageParts(): unknown; snapshot(): unknown } } }).sourceEditor.current;
      return { markers: handle.getMarkerOutput(), parts: handle.getUiMessageParts(), snapshot: handle.snapshot() };
    });
    expect(JSON.stringify(output.markers)).toContain(sources[0].sourceRef);
    expect(JSON.stringify(output.parts)).toContain(sources[0].sourceRef);
    expect(JSON.stringify(output)).not.toContain(sources[1].sourceRef);
    await page.reload();
    await page.getByRole('button', { name: 'Mail · Work, Ready', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Mail · Work, Ready', exact: true }).click();
    await page.getByRole('button', { name: 'Manage accounts', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Remove Mail · Work reference', exact: true }).click();
    expect(await page.locator('[data-source-chip]').count()).toBe(0);
    await editor.click(); await page.keyboard.type('@app:Work');
    await page.getByRole('button', { name: /Mail · Work.*Chat/ }).waitFor();
    await editor.evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true, bubbles: true })));
    expect(await page.locator('[data-source-chip]').count()).toBe(0);
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Mail · Work, Ready', exact: true }).waitFor();
    await page.screenshot({ path: path.join('/tmp', 'ri-source-mentions-mobile.png') });
    await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
    await page.getByRole('button', { name: /Mail.*2 accounts/ }).waitFor();
    expect(await editor.innerText()).toContain('@app:');
    await page.keyboard.press('Escape');
    await page.evaluate(() => (window as unknown as { sourceEditor: { current: ChatInputEditorHandle } }).sourceEditor.current.clear());
    await editor.click();
    await editor.evaluate((el, marker) => {
      const data = new DataTransfer(); data.setData('text/plain', marker);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, sourceMarker(sources[0].sourceRef));
    await page.getByRole('button', { name: 'Mail · Work, Ready', exact: true }).waitFor();
    await page.evaluate(() => (window as unknown as { sourceEditor: { current: ChatInputEditorHandle } }).sourceEditor.current.focus({ end: true }));
    await page.keyboard.type(' @file:README');
    await page.getByRole('button', { name: /README.md/ }).click();
    await page.keyboard.type('@task:Plan');
    await page.getByRole('button', { name: /Plan trip/ }).click();
    const mixed = await page.evaluate(() => (window as unknown as { sourceEditor: { current: ChatInputEditorHandle } }).sourceEditor.current.getMarkerOutput());
    expect(JSON.stringify(mixed)).toContain(sources[0].sourceRef);
    expect(JSON.stringify(mixed)).toContain('@README.md');
    expect(JSON.stringify(mixed)).toContain('[[task:test-task]]');
    await page.reload();
    await page.getByRole('button', { name: 'Mail · Work, Ready', exact: true }).waitFor();
    expect(JSON.stringify(await page.evaluate(() => (window as unknown as { sourceEditor: { current: ChatInputEditorHandle } }).sourceEditor.current.getMarkerOutput()))).toBe(JSON.stringify(mixed));
    // A response belonging to the previous chat must not replace the new picker.
    let releaseSlow: (() => Promise<void>) | undefined;
    let sawSlow!: () => void;
    const slowStarted = new Promise<void>(resolve => { sawSlow = resolve; });
    await page.route('**/api/trpc/chatSources.search*', route => {
      const input = JSON.parse(new URL(route.request().url()).searchParams.get('input') ?? '{}');
      if (input.query !== 'slow') return route.continue();
      releaseSlow = () => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ result: { data: { items: [{ kind: 'source', source: sources[0] }], total: 1 } } }) }).catch(() => {});
      sawSlow();
    });
    await page.evaluate(() => (window as unknown as { sourceEditor: { current: ChatInputEditorHandle } }).sourceEditor.current.clear());
    await editor.click(); await page.keyboard.type('@app:slow');
    await slowStarted;
    await page.evaluate(() => (window as unknown as { changeSourceChat(id: string): void }).changeSourceChat('01900222-2222-7222-8222-222222222222'));
    await expect.poll(async () => (await editor.innerText()).trim()).toBe('');
    await editor.click(); await page.keyboard.type('@connector:Personal');
    await page.getByRole('button', { name: /Mail · Personal.*Chat/ }).waitFor();
    await releaseSlow!();
    expect(await page.getByRole('button', { name: /Mail · Work.*Chat/ }).count()).toBe(0);
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Mail · Personal, Ready', exact: true }).waitFor();
    expect(errors).toEqual([]);
    fs.writeFileSync('/tmp/ri-source-browser-version.txt', browser.version());
  } finally { await browser.close(); await new Promise<void>(r => server.close(() => r())); }
}, 60000);
