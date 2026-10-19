/** Real repo-mention interactions in an isolated composer, without a Home.
 * Run: pnpm exec tsx scripts/reference-mention-browser-smoke.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright-core';
import type {} from '@/test/browser/reference-mention';

const styles = `
* { box-sizing: border-box }
body { margin: 0; background: #141414; color: #eee; font: 13px system-ui }
main { margin: 250px auto 0; width: min(650px, calc(100% - 32px)) }
.caption { color: #999; font-size: 12px; margin-bottom: 8px }
.composer { padding: 14px; border: 1px solid #444; border-radius: 12px; background: #1c1c1c }
.ProseMirror { outline: none; min-height: 24px; line-height: 28px; overflow-wrap: anywhere }
p { margin: 0 }
.node-mentionChip { display: inline }
[data-node-view-wrapper] { display: inline-flex; align-items: center; gap: 4px; padding: 1px 6px; margin: 0 2px; border: 1px solid #444; border-radius: 6px; background: #272727; font-size: 12px }
[data-node-view-wrapper] img { height: 11px; width: 11px }
[data-node-view-wrapper] button { display: inline-flex; padding: 0; width: 14px; height: 14px; color: #888; border: none; background: transparent }
[data-reference-mention-hint] { padding-left: 8px; font-size: 12px; color: #777; pointer-events: none; user-select: none }
.slash-command-popup { position: fixed; z-index: 999 }
.slash-command-menu { background: #222; border: 1px solid #444; border-radius: 8px; padding: 8px; max-height: 240px; overflow-y: auto }
.slash-command-menu button { display: flex; gap: 8px; width: 100%; background: transparent; border: 0; color: #eee; padding: 8px }
main > button { margin-top: 20px }
`;

async function main() {
  const bundle = await build({ entryPoints: ['src/test/browser/reference-mention.tsx'], bundle: true, write: false,
    platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
  const output = path.resolve('.work/reference-mention');
  await fs.mkdir(output, { recursive: true });
  let cases = 0;
  for (const [engine, browserType] of [['chromium', chromium], ['webkit', webkit]] as const) {
    const browser = await browserType.launch({ headless: true });
    try {
      for (const width of [1000, 320]) {
        const page = await browser.newPage({ viewport: { width, height: 700 } });
        page.setDefaultTimeout(4000);
        await page.addInitScript({ content: 'window.__name = fn => fn;' });
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('http://editor.test/**', route => route.fulfill(route.request().url().includes('bundle.js')
          ? { contentType: 'text/javascript', body: bundle.outputFiles[0].text }
          : route.request().url().includes('/symbols-icons/')
            ? { contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="#aaa" d="M1 3h5l2 2h7v9H1z"/></svg>' }
            : { contentType: 'text/html', body: `<html><meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles}</style><script defer src="/bundle.js"></script></html>` }));
        await page.goto('http://editor.test/');
        await page.waitForFunction(() => 'referenceMentionFixture' in window);
        const chip = page.locator('.node-mentionChip');
        const hint = page.locator('[data-reference-mention-hint]');
        const reset = async () => {
          await page.evaluate(() => window.referenceMentionFixture.reset());
          await page.locator('.ProseMirror').focus();
        };
        const selectRepo = async (alias = 'agentex') => {
          await page.keyboard.type(`@${alias}`);
          await page.locator('.slash-command-popup button').filter({ hasText: `@${alias}` }).first().waitFor();
          assert.equal(await chip.count(), 0, 'Typing a matching name still requires selection');
          await page.keyboard.press('Enter');
          await chip.waitFor();
        };

        await reset();
        await page.keyboard.type('@agentex');
        await page.locator('.slash-command-popup button').filter({ hasText: '@agentex' }).first().waitFor();
        assert.equal(await chip.count(), 0);
        assert.equal(await hint.count(), 0);
        assert.equal(await page.evaluate(() => window.referenceMentionFixture.output()), '@agentex');
        await page.keyboard.press('Enter');
        await chip.waitFor().catch(async error => { throw new Error(JSON.stringify({ errors,
          document: await page.evaluate(() => window.referenceMentionFixture.json()), html: await page.locator('.ProseMirror').innerHTML(),
        }), { cause: error }); });
        assert.equal(await chip.innerText(), 'agentex');
        assert.equal(await hint.innerText(), 'Or type / for a specific file');
        await page.evaluate(() => window.referenceMentionFixture.settleSearches());
        assert.equal(await page.locator('.slash-command-popup').count(), 0);
        assert.equal(await page.evaluate(() => window.referenceMentionFixture.treeLoads()), 0);
        assert.equal(await page.evaluate(() => window.referenceMentionFixture.output()), '@/code/agentex');
        assert(!JSON.stringify(await page.evaluate(() => window.referenceMentionFixture.json())).includes('Or type'));
        await page.screenshot({ path: path.join(output, `${engine}-${width}-mentioned.png`) });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.deepEqual(await page.evaluate(() => window.referenceMentionFixture.submitted()), []);
        cases++;

        await page.keyboard.type(' please find the tests');
        assert.equal(await chip.count(), 1);
        assert.equal(await hint.count(), 0);
        assert.equal(await page.evaluate(() => window.referenceMentionFixture.output()), '@/code/agentex please find the tests');
        await page.keyboard.press('Enter');
        assert.deepEqual(await page.evaluate(() => window.referenceMentionFixture.submitted()), ['@/code/agentex please find the tests']);
        cases++;

        // The hint never needs confirming or dismissing before sending.
        await reset();
        await selectRepo();
        assert.equal(await hint.count(), 1);
        await page.keyboard.press('Enter');
        assert.deepEqual(await page.evaluate(() => window.referenceMentionFixture.submitted()), ['@/code/agentex']);
        cases++;

        await reset();
        await page.keyboard.type('@agentex/');
        await page.locator('.slash-command-popup button').filter({ hasText: 'index.ts' }).waitFor();
        assert.equal(await chip.count(), 0);
        assert.equal(await hint.count(), 0);
        await page.keyboard.press('Enter');
        await chip.waitFor();
        assert.equal(await page.evaluate(() => window.referenceMentionFixture.output()), '@/code/agentex/src/index.ts ');
        cases++;

        await reset();
        await page.keyboard.type('@age');
        const repo = page.locator('.slash-command-popup button').filter({ hasText: '@agentex' }).first();
        await repo.click();
        await chip.waitFor();
        assert.equal(await page.locator('.slash-command-popup').count(), 0);
        assert.equal(await hint.count(), 1);
        assert.equal(await page.evaluate(() => window.referenceMentionFixture.treeLoads()), 0);
        await page.keyboard.type('/');
        await page.locator('.slash-command-popup button').filter({ hasText: 'index.ts' }).waitFor();
        cases++;

        for (const [alias, expected] of [['agentex-tools', '/code/tools'], ['agentex.docs', '/code/docs']] as const) {
          await reset();
          await selectRepo(alias);
          assert.equal(await chip.innerText(), alias);
          assert.equal(await page.evaluate(() => window.referenceMentionFixture.output()), `@${expected}`);
          cases++;
        }

        await page.keyboard.press('Backspace');
        assert.equal(await chip.count(), 0);
        assert.equal(await page.evaluate(() => window.referenceMentionFixture.output()), '@agentex.docs');
        await page.keyboard.press('Backspace');
        assert.equal(await page.evaluate(() => window.referenceMentionFixture.output()), '@agentex.doc');
        cases++;

        await reset();
        await selectRepo('remote');
        assert.equal(await hint.count(), 0);
        assert.equal(await page.evaluate(() => window.referenceMentionFixture.treeLoads()), 0);
        cases++;

        await reset();
        await page.evaluate(() => window.referenceMentionFixture.insert('@agentex'));
        await page.locator('.slash-command-popup button').filter({ hasText: '@agentex' }).first().waitFor();
        assert.equal(await chip.count(), 0);
        await page.keyboard.press('Tab');
        await hint.waitFor();
        await page.getByRole('button', { name: 'Outside editor' }).click();
        assert.equal(await hint.count(), 0);
        assert.equal(await chip.count(), 1);
        assert.deepEqual(errors, [], `${engine}-${width}: browser errors`);
        cases++;
        await page.close();
      }
    } finally { await browser.close(); }
  }
  console.log(`PASS ${cases} repo-mention cases in Chromium and WebKit. Screenshots: ${output}`);
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
