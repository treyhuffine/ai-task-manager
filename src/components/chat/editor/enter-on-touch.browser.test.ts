import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { chromium, webkit, type Browser, type BrowserContextOptions, type Page } from 'playwright-core';
import http from 'node:http';
import type {} from '@/test/fixtures/touch-composer';

// Enter in a chat composer follows the input device, not the width: on a
// phone or tablet it adds a line and Send sends, on a computer it sends and
// Shift+Enter adds a line. The @ and / menus pick on Enter either way. Real
// composers (`src/test/fixtures/touch-composer.tsx`) in Chromium and WebKit,
// with Playwright's touch emulation, which reports `(hover: none) and
// (pointer: coarse)` the way a phone does.
const engines = [['chromium', chromium], ['webkit', webkit]] as const;

const devices: { name: string; touch: boolean; options: BrowserContextOptions }[] = [
  { name: 'a phone', touch: true, options: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
  // As wide as the desktop layout, which used to send on Enter here.
  { name: 'a tablet held sideways', touch: true, options: { viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true } },
  { name: 'a computer', touch: false, options: { viewport: { width: 1280, height: 800 } } },
  // As narrow as a phone, which used to add a line on Enter here.
  { name: 'a narrow window on a computer', touch: false, options: { viewport: { width: 390, height: 800 } } },
];

let server: http.Server;
let origin: string;

beforeAll(async () => {
  const bundle = await build({
    entryPoints: ['src/test/fixtures/touch-composer.tsx'], absWorkingDir: process.cwd(), bundle: true, platform: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' }, jsx: 'automatic', loader: { '.css': 'empty' }, logLevel: 'silent',
  });
  server = http.createServer((req, res) => {
    if (req.url === '/fixture.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}, 120_000);

afterAll(async () => { await new Promise<void>(resolve => server?.close(() => resolve())); });

async function open(browser: Browser, options: BrowserContextOptions) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => { errors.push(error.message); });
  page.setDefaultTimeout(6000);
  await page.goto(origin);
  await page.waitForFunction(() => 'touchComposer' in window);
  return { context, page, errors };
}

function boxes(page: Page, touch: boolean) {
  const field = (label: string) => page.locator(`section[aria-label="${label}"] .ProseMirror[contenteditable="true"]`);
  const popup = page.locator('.slash-command-popup');
  // A finger taps where a mouse clicks. Both land the caret in the editor.
  const press = (target: ReturnType<typeof field>) => (touch ? target.tap() : target.click());
  return {
    composer: field('Composer'),
    editor: field('Editor'),
    feedback: field('Feedback'),
    send: page.getByRole('button', { name: 'Send message' }),
    popup,
    row: (text: string) => popup.locator('[data-mention-index], button').filter({ hasText: text }).first(),
    press,
    sent: () => page.evaluate(() => window.touchComposer.sent()),
    text: (box: 'editor' | 'feedback') => page.evaluate(b => window.touchComposer.text(b), box),
    reset: () => page.evaluate(() => window.touchComposer.reset()),
  };
}

describe.each(engines)('Enter in a chat composer in %s', (_engine, browserType) => {
  let browser: Browser;
  beforeAll(async () => { browser = await browserType.launch({ headless: true }); }, 60_000);
  afterAll(async () => { await browser?.close(); });

  it.each(devices.filter(device => device.touch))('adds a line on $name, and Send sends', async ({ options }) => {
    const { context, page, errors } = await open(browser, options);
    try {
      const ui = boxes(page, true);
      expect(await page.evaluate(() => matchMedia('(hover: none) and (pointer: coarse)').matches)).toBe(true);

      // The composer every chat uses: Enter is the return key, Send sends both lines.
      await ui.press(ui.composer);
      await page.keyboard.type('first');
      await page.keyboard.press('Enter');
      await page.keyboard.type('second');
      expect(await ui.composer.locator('br:not(.ProseMirror-trailingBreak)').count()).toBe(1);
      expect(await ui.sent()).toEqual([]);
      await ui.send.tap();
      await expect.poll(ui.sent).toEqual([{ box: 'composer', text: 'first\nsecond' }]);
      // A keyboard connected to the tablet still sends with ⌘↩ (Ctrl+Enter elsewhere).
      await ui.press(ui.composer);
      await page.keyboard.type('again');
      await page.keyboard.press('ControlOrMeta+Enter');
      await expect.poll(ui.sent).toEqual([{ box: 'composer', text: 'first\nsecond' }, { box: 'composer', text: 'again' }]);

      // Enter picks the highlighted @ item rather than adding a line or sending.
      await ui.reset();
      await ui.press(ui.editor);
      await page.keyboard.type('@trash');
      await ui.row('Take out trash').waitFor();
      await page.keyboard.press('Enter');
      await expect.poll(() => ui.text('editor')).toBe('[[task:task-trash]]');
      await ui.popup.waitFor({ state: 'hidden' });
      // With the menu closed, Enter is a new line again.
      await page.keyboard.type('please');
      await page.keyboard.press('Enter');
      await page.keyboard.type('today');
      await expect.poll(() => ui.text('editor')).toBe('[[task:task-trash]] please\ntoday');
      expect(await ui.sent()).toEqual([]);

      // And the / menu's highlighted skill.
      await ui.reset();
      await ui.press(ui.editor);
      await page.keyboard.type('/rev');
      await ui.row('review').waitFor();
      await page.keyboard.press('Enter');
      await expect.poll(() => ui.text('editor')).toBe('/review');
      expect(await ui.sent()).toEqual([]);

      // Escape closes an open menu and leaves the text as typed.
      await ui.reset();
      await ui.press(ui.editor);
      await page.keyboard.type('@');
      await ui.row('Take out trash').waitFor();
      await page.keyboard.press('Escape');
      await ui.popup.waitFor({ state: 'hidden' });
      expect(await ui.text('editor')).toBe('@');
      expect(await ui.sent()).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  }, 60_000);

  it.each(devices.filter(device => !device.touch))('sends on $name, and Shift+Enter adds a line', async ({ options }) => {
    const { context, page, errors } = await open(browser, options);
    try {
      const ui = boxes(page, false);
      expect(await page.evaluate(() => matchMedia('(hover: none) and (pointer: coarse)').matches)).toBe(false);

      await ui.press(ui.composer);
      await page.keyboard.type('first');
      await page.keyboard.press('Shift+Enter');
      await page.keyboard.type('second');
      expect(await ui.sent()).toEqual([]);
      // Send names the key that sends.
      await ui.send.hover();
      await expect.poll(() => page.getByRole('tooltip').innerText()).toMatch(/Send\s*Enter/);
      await page.keyboard.press('Enter');
      await expect.poll(ui.sent).toEqual([{ box: 'composer', text: 'first\nsecond' }]);

      // Enter picks from the @ menu first, then sends once it's closed.
      await ui.press(ui.editor);
      await page.keyboard.type('@trash');
      await ui.row('Take out trash').waitFor();
      await page.keyboard.press('Enter');
      await expect.poll(() => ui.text('editor')).toBe('[[task:task-trash]]');
      await page.keyboard.type('please');
      await page.keyboard.press('Enter');
      await expect.poll(ui.sent).toEqual([{ box: 'composer', text: 'first\nsecond' }, { box: 'editor', text: '[[task:task-trash]] please' }]);

      // A box told to take lines keeps them on a computer too, and ⌘↩ sends it.
      await ui.reset();
      await ui.press(ui.feedback);
      await page.keyboard.type('more');
      await page.keyboard.press('Enter');
      await page.keyboard.type('detail');
      await expect.poll(() => ui.text('feedback')).toBe('more\ndetail');
      expect(await ui.sent()).toEqual([]);
      await page.keyboard.press('ControlOrMeta+Enter');
      await expect.poll(ui.sent).toEqual([{ box: 'feedback', text: 'more\ndetail' }]);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  }, 60_000);
});
