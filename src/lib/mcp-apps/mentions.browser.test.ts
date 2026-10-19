import { it, expect } from 'vitest';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import http from 'node:http';
import { decodeSource, encodeSource } from '@/lib/chat-sources/reference';
import type { ChatInputEditorHandle } from '@/components/chat/editor/chat-input-editor';
import type { SourceDescriptor } from '@/lib/chat-sources/types';

// Bits & Bolts' @ search, as the composer receives it from `appMentions.search`: its
// library parts as resource links (mcp://bits-and-bolts/parts/<id>), titled by part.
const account = { v: 1 as const, kind: 'integration' as const, toolkitId: 'mcp_bits_bolts', account: { accountId: 'bits_bolts', authConfigId: null } };
const icon = { src: 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2032%2032%22%3E%3Cpath%20d%3D%22M9.5%204.75h13L29%2016l-6.5%2011.25h-13L3%2016z%22%2F%3E%3C%2Fsvg%3E', mimeType: 'image/svg+xml' };
const parts = [
  { id: 'part_keycap_agent', name: 'Translucent agent keycap (1U)', fileName: 'keycap-agent.stl' },
  { id: 'part_joystick', name: 'Codex Micro joystick cap', fileName: 'joystick-cap.stl' },
  { id: 'part_agent_dial', name: 'Codex Micro sculpted dial', fileName: 'agent-dial.stl' },
];
const item = (part: typeof parts[number]) => ({
  sourceRef: encodeSource({ ...account, resource: { uri: `mcp://bits-and-bolts/parts/${part.id}`, title: part.name, name: part.fileName } }),
  uri: `mcp://bits-and-bolts/parts/${part.id}`, title: part.name, name: part.fileName, subtitle: part.fileName, mimeType: 'text/markdown', icons: [],
});
const base: SourceDescriptor = { sourceRef: encodeSource(account), label: 'Bits & Bolts · bits_bolts', chipLabel: 'Bits & Bolts', service: 'Bits & Bolts', accountLabel: 'bits_bolts',
  mark: { kind: 'server' }, groupId: 'mcp_bits_bolts', keywords: [], status: 'ready', chat: true, view: 'available' };

it('lists an app\'s @ search results under the app and inserts the chosen item as a chip', async () => {
  const bundle = await build({ entryPoints: ['src/test/fixtures/source-editor.tsx'], absWorkingDir: process.cwd(), bundle: true, platform: 'browser', format: 'iife', write: false, define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' }, jsx: 'automatic', logLevel: 'silent' });
  const searches: string[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, 'http://fixture');
    if (url.pathname.startsWith('/api/trpc/')) {
      const input = JSON.parse(url.searchParams.get('input') ?? '{}');
      let result: unknown = {};
      if (url.pathname.endsWith('appMentions.search')) {
        searches.push(input.query);
        const matches = parts.filter(part => `${part.id} ${part.name} ${part.fileName}`.toLowerCase().includes(String(input.query).toLowerCase()));
        result = { groups: matches.length ? [{ serverId: 'bits', app: 'Bits & Bolts', icons: [icon], items: matches.map(item) }] : [], skipped: [] };
      } else if (url.pathname.endsWith('chatSources.search')) result = { items: [], total: 0 };
      else if (url.pathname.endsWith('chatSources.resolve')) {
        // What the server derives for a mention: the item on its account.
        result = (input.refs as string[]).map(ref => {
          const decoded = decodeSource(ref);
          const resource = decoded.kind === 'integration' ? decoded.resource : undefined;
          return resource ? { ...base, sourceRef: ref, label: `${resource.title} · ${base.label}`, chipLabel: resource.title, resource: { uri: resource.uri, title: resource.title!, name: resource.name } } : base;
        });
      }
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
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    page.on('pageerror', error => { errors.push(error.message); });
    page.setDefaultTimeout(6000);
    await page.goto(origin);
    const editor = page.locator('.tiptap'); await editor.waitFor(); await editor.click();
    // A bare `@` stays short: no app is asked until something is typed.
    await page.keyboard.type('@');
    await page.locator('.slash-command-popup').waitFor();
    expect(searches).toEqual([]);
    await page.keyboard.type('keycap');
    const row = page.getByRole('button', { name: /Translucent agent keycap \(1U\)/ });
    await row.waitFor();
    await expect.poll(() => page.locator('.slash-command-popup').innerText()).toMatch(/BITS & BOLTS/i);
    // Typing is debounced: the apps are asked for what was typed, not every keystroke.
    expect(searches.length).toBeLessThanOrEqual(2);
    expect(searches.at(-1)).toBe('keycap');
    await page.screenshot({ path: '/tmp/ri-app-mentions-menu.png' });
    await row.click();
    const chip = page.getByRole('button', { name: 'Translucent agent keycap (1U) · Bits & Bolts · bits_bolts, Ready', exact: true });
    await chip.waitFor();
    const markers = JSON.stringify(await page.evaluate(() => (window as unknown as { sourceEditor: { current: ChatInputEditorHandle } }).sourceEditor.current.getMarkerOutput()));
    expect(markers).toContain(item(parts[0]).sourceRef);
    await chip.click();
    await page.getByText('mcp://bits-and-bolts/parts/part_keycap_agent').waitFor();
    await page.screenshot({ path: '/tmp/ri-app-mentions-chip.png' });
    await page.keyboard.press('Escape');
    // `@app:` lists the app's items even before a query, as OpenAI's search allows.
    await editor.click(); await page.keyboard.press('End'); await page.keyboard.type(' @app:');
    await page.getByRole('button', { name: /Codex Micro sculpted dial/ }).waitFor();
    expect(searches).toContain('');
    expect(errors).toEqual([]);
  } finally { await browser.close(); await new Promise<void>(r => server.close(() => r())); }
}, 60000);
