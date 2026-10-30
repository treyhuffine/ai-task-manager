import { it, expect } from 'vitest';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright-core';
import http from 'node:http';
import type {} from '@/test/fixtures/mention-kinds-editor';

declare global {
  interface Window {
    mentionKinds: { text(): string; sent(): string[]; reset(): void };
  }
}

// The @ menu's kind chips, kind suggestions and keys, in the real composer
// (`src/test/fixtures/mention-kinds-editor.tsx`), in Chromium and WebKit.
const engines = [['chromium', chromium], ['webkit', webkit]] as const;

async function serve() {
  const bundle = await build({ entryPoints: ['src/test/fixtures/mention-kinds-editor.tsx'], absWorkingDir: process.cwd(), bundle: true, platform: 'browser', format: 'iife', write: false, define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' }, jsx: 'automatic', logLevel: 'silent' });
  const server = http.createServer((req, res) => {
    if (req.url === '/fixture.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
    res.setHeader('content-type', 'text/html');
    res.end('<html><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}

it.each(engines)('narrows the @ menu by kind with chips, arrows and typed names in %s', async (_name, browserType) => {
  const { server, origin } = await serve();
  const browser = await browserType.launch({ headless: true });
  const errors: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
    page.on('pageerror', error => { errors.push(error.message); });
    page.setDefaultTimeout(6000);
    await page.goto(origin);
    await page.waitForFunction(() => 'mentionKinds' in window);

    const popup = page.locator('.slash-command-popup');
    const chips = popup.locator('[role="toolbar"] button');
    const chip = (label: string) => chips.filter({ hasText: new RegExp(`^${label}$`) });
    const rows = popup.locator('[data-mention-index]');
    const row = (text: string) => rows.filter({ hasText: text });
    const selected = popup.locator('[data-mention-index][data-selected]');
    const focusedChip = popup.locator('[data-kind-chip][data-focused]');
    const text = () => page.evaluate(() => window.mentionKinds.text());
    const sent = () => page.evaluate(() => window.mentionKinds.sent());
    const editor = page.locator('.ProseMirror[contenteditable="true"]');
    // Clicked, not focused from code: that focus lands a frame later, after
    // the first key.
    const reset = async () => {
      await page.evaluate(() => window.mentionKinds.reset());
      await editor.click();
    };
    const type = (keys: string) => page.keyboard.type(keys);
    // The list lands asynchronously: wait for what it should show before any key.
    const shows = (text: string) => row(text).first().waitFor();
    const pressed = () => popup.locator('[data-kind-chip][aria-pressed="true"]').innerText();

    // Right after `@`: every kind as a chip, All pressed, and a hint that
    // names every prefix.
    await reset();
    await type('@');
    await shows('Take out trash');
    expect(await chips.allInnerTexts()).toEqual(['All', 'Tasks', 'Notes', 'Agents', 'Apps', 'Connectors', 'Files', 'PRs']);
    expect(await pressed()).toBe('All');
    const hint = (await popup.innerText()).replace(/\s+/g, ' ');
    for (const prefix of ['task:', 'note:', 'agent:', 'app:', 'connector:', 'file:', '#']) expect(hint).toContain(prefix);
    expect(hint).toContain('to search one kind');

    // A click narrows exactly as typing the prefix does: the prefix is the text.
    await chip('Tasks').click();
    await expect.poll(text).toBe('@task:');
    await expect.poll(pressed).toBe('Tasks');
    await expect.poll(() => rows.allInnerTexts()).toEqual(['Take out trash', 'Tax returnIn progress', 'Deploy keys']);
    await chip('Notes').click();
    await expect.poll(text).toBe('@note:');
    await shows('Notes from standup');
    expect(await row('Take out trash').count()).toBe(0);
    await chip('PRs').click();
    await expect.poll(text).toBe('@#');
    await shows('Add SEO footer');
    await chip('All').click();
    await expect.poll(text).toBe('@');
    await shows('Take out trash');
    await shows('README.md');

    // A chip keeps the search, and the search goes on inside the kind.
    await type('dep');
    await shows('Deploy keys');
    await chip('Tasks').click();
    await expect.poll(text).toBe('@task:dep');
    await type('loy');
    await expect.poll(text).toBe('@task:deploy');
    await shows('Deploy keys');
    expect(await rows.count()).toBe(1);

    // Keyboard: ← → move between the chips while nothing is searched, Enter
    // applies one, and the results lose their highlight meanwhile.
    await reset();
    await type('@');
    await shows('Take out trash');
    expect(await selected.count()).toBe(1);
    await page.keyboard.press('ArrowRight');
    expect(await focusedChip.innerText()).toBe('Tasks');
    expect(await selected.count()).toBe(0);
    await page.keyboard.press('ArrowRight');
    expect(await focusedChip.innerText()).toBe('Notes');
    await page.keyboard.press('ArrowLeft');
    expect(await focusedChip.innerText()).toBe('Tasks');
    await page.keyboard.press('Enter');
    await expect.poll(text).toBe('@task:');
    await expect.poll(pressed).toBe('Tasks');
    expect(await sent()).toEqual([]);
    // From the pressed chip, ← lands on All, and All takes the prefix away.
    await shows('Deploy keys');
    await page.keyboard.press('ArrowLeft');
    expect(await focusedChip.innerText()).toBe('All');
    await page.keyboard.press('Tab');
    await expect.poll(text).toBe('@');
    await shows('README.md');
    // The ends wrap around.
    await page.keyboard.press('ArrowLeft');
    expect(await focusedChip.innerText()).toBe('PRs');
    await page.keyboard.press('ArrowRight');
    expect(await focusedChip.innerText()).toBe('All');

    // ↓ leaves the chips for the results where they were, ↑ ↓ move through
    // them as before, and Enter picks a result rather than sending.
    await page.keyboard.press('ArrowDown');
    expect(await focusedChip.count()).toBe(0);
    expect(await selected.innerText()).toBe('Scratchpadfor this session');
    await page.keyboard.press('ArrowDown');
    expect(await selected.innerText()).toBe('Take out trash');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    expect(await selected.innerText()).toBe('Take out trash');
    await page.keyboard.press('Enter');
    await expect.poll(text).toBe('[[task:task-trash]]');
    expect(await sent()).toEqual([]);
    // With the menu closed, Enter sends.
    await type('please');
    await page.keyboard.press('Enter');
    await expect.poll(sent).toEqual(['[[task:task-trash]] please']);

    // Escape with a chip focused closes the menu and leaves the text.
    await reset();
    await type('@');
    await shows('Take out trash');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Escape');
    await expect.poll(() => popup.count()).toBe(0);
    expect(await text()).toBe('@');

    // Once a search is typed, ← → move the caret again, so a typo can be fixed.
    await reset();
    await type('@dpe');
    await shows('Deploy keys').catch(() => {});
    await popup.waitFor();
    await page.keyboard.press('ArrowLeft');
    expect(await focusedChip.count()).toBe(0);
    await page.keyboard.press('Backspace');
    await page.keyboard.press('ArrowRight');
    await type('p');
    await expect.poll(text).toBe('@dep');
    await shows('Deploy keys');

    // Typing a kind's name offers it on top. Tab completes it and the search
    // continues inside that kind.
    await reset();
    await type('@ta');
    await shows('Search tasks');
    expect(await rows.first().innerText()).toBe('Search taskstask:');
    expect(await selected.innerText()).toBe('Search taskstask:');
    // The tasks it starts like stay listed below it.
    await shows('Take out trash');
    await page.keyboard.press('Tab');
    await expect.poll(text).toBe('@task:');
    await expect.poll(pressed).toBe('Tasks');
    await type('tak');
    await expect.poll(text).toBe('@task:tak');
    await expect.poll(() => rows.allInnerTexts()).toEqual(['Take out trash']);
    await page.keyboard.press('Enter');
    await expect.poll(text).toBe('[[task:task-trash]]');
    expect(await sent()).toEqual([]);

    // Enter completes it too, for every kind a two-letter start names.
    for (const [typed, completed, label] of [['no', '@note:', 'Search notes'], ['ag', '@agent:', 'Search agents'], ['ap', '@app:', 'Search apps'], ['co', '@connector:', 'Search connectors'], ['fi', '@file:', 'Search files'], ['pr', '@#', 'Search pull requests']]) {
      await reset();
      await type(`@${typed}`);
      await shows(label);
      expect(await selected.innerText()).toContain(label);
      await page.keyboard.press('Enter');
      await expect.poll(text).toBe(completed);
    }
    expect(await sent()).toEqual([]);

    // Mentioning a task whose title starts like a kind stays easy: one ↓ from
    // the suggestion, or one more letter and it is the top result again.
    await reset();
    await type('@ta');
    await shows('Take out trash');
    await page.keyboard.press('ArrowDown');
    expect(await selected.innerText()).toBe('Take out trash');
    await page.keyboard.press('Enter');
    await expect.poll(text).toBe('[[task:task-trash]]');
    await reset();
    await type('@tak');
    await shows('Take out trash');
    expect(await row('Search tasks').count()).toBe(0);
    await page.keyboard.press('Enter');
    await expect.poll(text).toBe('[[task:task-trash]]');
    // A note named like the kind itself: the note is one ↓ away.
    await reset();
    await type('@notes');
    await shows('Notes from standup');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect.poll(text).toBe('[[note:note-standup]]');
    expect(await sent()).toEqual([]);

    // A kind with nothing in it still shows the chips, and the arrows still work.
    await reset();
    await type('@connector:');
    await popup.getByText('No connectors yet').waitFor();
    expect(await pressed()).toBe('Connectors');
    await page.keyboard.press('ArrowRight');
    expect(await focusedChip.innerText()).toBe('Files');
    await page.keyboard.press('Enter');
    await expect.poll(text).toBe('@file:');
    await shows('README.md');

    // A path is about files, so it shows no chips.
    await reset();
    await type('@src/');
    await shows('page.tsx');
    expect(await chips.count()).toBe(0);

    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    server.close();
  }
}, 120_000);
