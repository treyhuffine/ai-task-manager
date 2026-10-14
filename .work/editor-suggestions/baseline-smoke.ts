/** Real browser regression for editor menus. Uses an isolated Tiptap fixture,
 * not a Home. Run: pnpm exec tsx scripts/editor-suggestions-browser-smoke.ts
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit, type Page } from 'playwright-core';
import type {} from '@/test/browser/suggestion-popup';

const styles = `
* { box-sizing: border-box }
body { margin: 0; background: #141414; color: #eee; font: 16px sans-serif }
.host { position: fixed; left: 10%; top: 80px; width: 80%; height: 620px; border: 2px solid #666 }
.translated { transform: translate(15px, 30px) }
.scaled { transform: translate(15px, 30px) scale(.95) }
.slideout { inset: 0 0 0 auto; height: 100%; width: 90%; transform: translateX(0) }
.popover { transform: translate(10px, 20px) }
.scroll { height: 100%; overflow: auto; padding: 20px }
.before { height: 220px }
.after { height: 800px }
.ProseMirror { outline: none; border: 1px solid #888; padding: 10px; min-height: 50px }
p { margin: 0; line-height: 24px }
.slash-command-popup { position: fixed; z-index: 999 }
.menu { background: #222; border: 1px solid #888; border-radius: 8px; max-height: 320px; overflow: auto; min-width: 240px }
.menu button { display: block; width: 100%; height: 32px; text-align: left; background: transparent; color: inherit; border: none }
@media (max-width: 600px) { .host { left: 0; width: 100%; top: 70px; height: 550px } .translated, .scaled { transform: translateY(15px) } .slideout { top: 0; height: 100% } .scroll { padding: 12px } }
`;

async function geometry(page: Page) {
  return page.evaluate(() => {
    const rect = (element: Element) => {
      const r = element.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    return {
      popup: rect(document.querySelector('.slash-command-popup')!),
      anchor: rect(document.querySelector('[data-decoration-id]')!),
      editor: rect(document.querySelector('.ProseMirror')!),
      viewport: { top: visualViewport?.offsetTop ?? 0, left: visualViewport?.offsetLeft ?? 0,
        width: visualViewport?.width ?? innerWidth, height: visualViewport?.height ?? innerHeight },
    };
  });
}

async function anchored(page: Page, label: string, slash: boolean) {
  // Positioning and async React rendering finish on separate browser turns.
  await page.waitForFunction(() => {
    const p = document.querySelector('.slash-command-popup');
    const a = document.querySelector('[data-decoration-id]');
    if (!p || !a || !p.querySelector('button')) return false;
    const popup = p.getBoundingClientRect(), anchor = a.getBoundingClientRect();
    return Math.min(Math.abs(anchor.top - popup.bottom), Math.abs(popup.top - anchor.bottom)) < 10;
  }).catch(async error => { throw new Error(`${label}: menu detached from trigger: ${JSON.stringify(await geometry(page))}`, { cause: error }); });
  const { popup, editor, viewport } = await geometry(page);
  assert(popup.left >= viewport.left + 7 && popup.right <= viewport.left + viewport.width - 7, `${label}: fits horizontally`);
  assert(popup.top >= viewport.top + 7 && popup.bottom <= viewport.top + viewport.height - 7, `${label}: fits visible viewport`);
  if (!slash) assert(Math.abs(popup.width - Math.min(editor.width, viewport.width - 16)) < 3, `${label}: matches composer width`);
}

async function main() {
  const bundle = await build({ entryPoints: ['src/test/browser/suggestion-popup.tsx'], bundle: true, write: false,
    platform: 'browser', format: 'iife', plugins: [{ name: 'baseline-renderer', setup(b) { b.onLoad({filter: /suggestion\/renderer\.ts$/}, () => ({ contents: execFileSync('git', ['show', 'HEAD:src/components/chat/editor/suggestion/renderer.ts'], {encoding: 'utf8'}), loader: 'ts' })); } }], jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
  const output = path.resolve('.work/editor-suggestions');
  await fs.mkdir(output, { recursive: true });
  const engines = [
    ['chromium', chromium],
    ['webkit', webkit],
  ] as const;
  let cases = 0;
  for (const [engine, browserType] of engines) {
    const browser = await browserType.launch({ headless: true,
      ...(engine === 'chromium' && process.env.RI_BROWSER_EXECUTABLE ? { executablePath: process.env.RI_BROWSER_EXECUTABLE } : {}),
    });
    try {
      for (const width of [1440, 390, 320]) {
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        const page = await context.newPage();
        page.setDefaultTimeout(4000);
        // tsx preserves names when it serializes nested evaluation functions.
        await page.addInitScript({ content: 'window.__name = fn => fn;' });
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('http://editor.test/**', route => route.fulfill(route.request().url().includes('bundle.js')
          ? { contentType: 'text/javascript', body: bundle.outputFiles[0].text }
          : { contentType: 'text/html', body: `<html><meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles}</style><script defer src="/bundle.js"></script></html>` }));
        for (const mode of ['plain-dialog']) {
          for (const slash of [false, true]) {
            const label = `${engine}-${width}-${mode}-${slash ? 'slash' : 'mention'}`;
            await page.goto(`http://editor.test/?mode=${mode}&menu=${slash ? 'slash' : 'mention'}`);
            await page.waitForFunction(() => 'fixture' in window);
            await page.evaluate(() => window.fixture.open());
            await anchored(page, label, slash);
            await page.locator('.scroll').evaluate(element => { element.scrollTop += 30; });
            await anchored(page, `${label} scrolled`, slash);
            await page.evaluate(() => window.fixture.open('large'));
            await anchored(page, `${label} large results`, slash);
            // A keyboard changes the visible viewport without changing the
            // layout viewport. Exercise its resize event and available space.
            await page.evaluate(offsetTop => {
              Object.defineProperties(visualViewport, { height: { configurable: true, value: 400 },
                offsetTop: { configurable: true, value: offsetTop } });
              visualViewport!.dispatchEvent(new Event('resize'));
            }, engine === 'webkit' ? 0 : 25);
            await anchored(page, `${label} keyboard`, slash);
            assert.equal(await page.locator('.menu').evaluate(element => [element, element.parentElement!]
              .some(el => el.scrollHeight > el.clientHeight)), true, `${label}: long list scrolls`);
            await page.screenshot({ path: path.join(output, `${label}.png`) });
            // Mouse picks keep editor focus. Escape dismisses only the menu.
            await page.getByRole('button', { name: 'Result 1', exact: true }).click();
            await page.waitForFunction(() => !document.querySelector('.slash-command-popup'));
            assert.match(await page.locator('.ProseMirror').innerText(), /Result 1/);
            await page.evaluate(() => window.fixture.open());
            await anchored(page, label, slash);
            await page.keyboard.press('Escape');
            assert.equal(await page.locator('.slash-command-popup').count(), 0);
            await page.keyboard.type('a');
            assert.equal(await page.locator('.slash-command-popup').count(), 0, `${label}: dismissed token stays dismissed`);
            await page.evaluate(() => window.fixture.open());
            await anchored(page, label, slash);
            await page.evaluate(() => window.fixture.dispose());
            assert.equal(await page.locator('.slash-command-popup').count(), 0, `${label}: teardown removes popup`);
            cases++;
          }
        }
        assert.deepEqual(errors, [], `${engine}-${width}: browser errors`);
        await context.close();
      }
    } finally { await browser.close(); }
  }
  console.log(`PASS ${cases} editor menu cases in Chromium and WebKit. Screenshots: ${output}`);
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
