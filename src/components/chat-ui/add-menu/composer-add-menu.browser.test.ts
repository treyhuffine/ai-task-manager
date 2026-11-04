import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { chromium, webkit, type Browser, type BrowserContextOptions, type Page } from 'playwright-core';
import http from 'node:http';
import type {} from '@/test/fixtures/add-menu-composer';

// The composer's + on a phone and a computer, with the real editor
// (`src/test/fixtures/add-menu-composer.tsx`), in Chromium and WebKit. A phone
// answers one question about a file, in its own sheet: Ri used to ask the same
// thing first. Playwright can't draw that sheet, but the file chooser it
// reports is what opens it, and an input with no `capture` or `accept` is what
// gives the sheet all of its choices.
const engines = [['chromium', chromium], ['webkit', webkit]] as const;
const phone: BrowserContextOptions = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const computer: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };

let server: http.Server;
let origin: string;

beforeAll(async () => {
  const bundle = await build({
    entryPoints: ['src/test/fixtures/add-menu-composer.tsx'], absWorkingDir: process.cwd(), bundle: true, platform: 'browser', format: 'iife', write: false,
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

async function open(browser: Browser, options: BrowserContextOptions, query = '') {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => { errors.push(error.message); });
  page.setDefaultTimeout(6000);
  await page.goto(`${origin}/${query}`);
  await page.waitForFunction(() => 'addMenu' in window);
  return { page, errors, close: () => context.close() };
}

const plus = (page: Page) => page.getByRole('button', { name: 'Add to this chat' });
const row = (page: Page, name: string) => page.getByRole('menuitem', { name });
const editor = (page: Page) => page.locator('.ProseMirror[contenteditable="true"]');
const editorHasFocus = (page: Page) => page.evaluate(() => !!document.activeElement?.classList.contains('ProseMirror'));
const text = (page: Page) => page.evaluate(() => window.addMenu.text());

describe.each(engines)('the + menu in %s', (_name, engine) => {
  let browser: Browser;
  beforeAll(async () => { browser = await engine.launch({ headless: true }); }, 60_000);
  afterAll(async () => { await browser?.close(); });

  it('asks a phone about files once, through its own sheet', async () => {
    const { page, errors, close } = await open(browser, phone);
    let choosers = 0;
    page.on('filechooser', () => { choosers++; });

    await plus(page).tap();
    await expect.poll(() => page.getByRole('menuitem').allTextContents()).toEqual(['Files and photos', 'Mention@', 'Skills/', 'Extra row']);
    for (const asked of ['Take Photo', 'Photo Library', 'Choose File']) expect(await page.getByText(asked).count()).toBe(0);
    const box = await page.getByRole('menu').boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);

    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), row(page, 'Files and photos').tap()]);
    expect(chooser.isMultiple()).toBe(true);
    // Nothing narrows the sheet, or skips it for the camera.
    expect(await page.locator('input[type="file"]').evaluate(input => [input.getAttribute('accept'), input.getAttribute('capture')])).toEqual([null, null]);

    await chooser.setFiles([
      { name: 'one.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('one') },
      { name: 'two.pdf', mimeType: 'application/pdf', buffer: Buffer.from('two') },
    ]);
    await expect.poll(() => page.evaluate(() => window.addMenu.picked())).toEqual(['one.jpg', 'two.pdf']);
    expect(choosers).toBe(1);
    await expect.poll(() => row(page, 'Files and photos').count()).toBe(0);
    // Attaching a photo doesn't raise the keyboard.
    expect(await editorHasFocus(page)).toBe(false);
    expect(errors).toEqual([]);
    await close();
  }, 30_000);

  it('opens the @ menu on a phone, with focus in the editor for its keyboard', async () => {
    const { page, errors, close } = await open(browser, phone);
    await plus(page).tap();
    await row(page, 'Mention').tap();
    await expect.poll(() => text(page)).toBe('@');
    expect(await editorHasFocus(page)).toBe(true);
    await page.getByText('README.md').locator('visible=true').first().waitFor();
    await expect.poll(() => row(page, 'Mention').count()).toBe(0);
    expect(await editorHasFocus(page)).toBe(true);
    expect(errors).toEqual([]);
    await close();
  }, 30_000);

  it('runs a skill on what is already written, since a skill has to open the message', async () => {
    const { page, errors, close } = await open(browser, computer);
    await editor(page).click();
    await page.keyboard.type('fix login');
    await plus(page).click();
    await row(page, 'Skills').click();
    await expect.poll(() => text(page)).toBe('/fix login');
    const review = page.locator('.chat-slash-menu').locator('visible=true').getByText('review').first();
    await review.click();
    await expect.poll(() => text(page)).toBe('/review fix login');
    expect(errors).toEqual([]);
    await close();
  }, 30_000);

  it('searches with a command already typed instead of starting a second one', async () => {
    const { page, close } = await open(browser, computer);
    await editor(page).click();
    await page.keyboard.type('/rev');
    await plus(page).click();
    await row(page, 'Skills').click();
    await expect.poll(() => text(page)).toBe('/rev');
    await page.locator('.chat-slash-menu').locator('visible=true').getByText('review').first().click();
    await expect.poll(() => text(page)).toBe('/review');
    await close();
  }, 30_000);

  it('starts a mention after typed text with the space it needs', async () => {
    const { page, close } = await open(browser, computer);
    await editor(page).click();
    await page.keyboard.type('hello');
    await plus(page).click();
    await row(page, 'Mention').click();
    await expect.poll(() => text(page)).toBe('hello @');
    await page.getByText('README.md').locator('visible=true').first().waitFor();
    await close();
  }, 30_000);

  it('leaves no skills row where there is no / menu', async () => {
    const { page, close } = await open(browser, computer, '?skills=0');
    await plus(page).click();
    await expect.poll(() => page.getByRole('menuitem').allTextContents()).toEqual(['Files and photos', 'Mention@', 'Extra row']);
    await close();
  }, 30_000);

  it('gives the next Enter back to the message on a computer, and picks a file on one click', async () => {
    const { page, close } = await open(browser, computer);
    await editor(page).click();
    await page.keyboard.type('send me');
    await plus(page).click();
    await page.keyboard.press('Escape');
    await expect.poll(() => editorHasFocus(page)).toBe(true);
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.addMenu.sent())).toEqual(['send me']);

    await plus(page).click();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), row(page, 'Files and photos').click()]);
    await chooser.setFiles({ name: 'desk.png', mimeType: 'image/png', buffer: Buffer.from('desk') });
    await expect.poll(() => page.evaluate(() => window.addMenu.picked())).toEqual(['desk.png']);
    await expect.poll(() => editorHasFocus(page)).toBe(true);
    await close();
  }, 30_000);

  it('keeps focus on a field clicked outside the menu', async () => {
    const { page, close } = await open(browser, computer);
    await page.evaluate(() => {
      const field = document.createElement('input');
      field.id = 'elsewhere';
      document.querySelector('main')!.append(field);
    });
    await plus(page).click();
    await page.locator('#elsewhere').click();
    await expect.poll(() => row(page, 'Mention').count()).toBe(0);
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('elsewhere');
    await close();
  }, 30_000);
});
