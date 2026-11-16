import { afterAll, beforeAll, expect, it } from 'vitest';
import { browserFixture } from '@/test/fixtures/browser-fixture';

let fixture: Awaited<ReturnType<typeof browserFixture>>;

declare global {
  interface Window {
    testComposer: {
      text(): string;
      clear(): void;
      openSkills(): void;
      parts(): { parts: { type: string; text?: string }[] };
      finishCommands(): void;
      finishEntities(): void;
    };
  }
}

beforeAll(async () => {
  fixture = await browserFixture(`
    import React, { useEffect, useRef, useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
    import { ChatInputEditor, type ChatInputEditorHandle } from './src/components/chat/editor/chat-input-editor';
    import { TipProvider } from './src/components/ui/tip';

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let resolveEntities = null;

    function Fixture() {
      const ref = useRef<ChatInputEditorHandle | null>(null);
      const [commands, setCommands] = useState([]);
      const [commandsLoading, setCommandsLoading] = useState(true);

      useEffect(() => {
        Object.assign(window, {
          testComposer: {
            text: () => ref.current?.getMarkerOutput().text ?? '',
            clear: () => ref.current?.clear(),
            openSkills: () => ref.current?.openSkillMenu(),
            parts: () => ref.current?.getUiMessageParts(),
            finishCommands: () => {
              setCommands(['review', 'ship'].map(name => (
                {
                  id: name,
                  name,
                  description: name === 'review' ? 'Review the current diff' : 'Ship the current diff',
                  source: 'installed-user',
                  userInvocable: true,
                  available: true,
                  execution: { kind: 'provider-slash', provider: 'claude', commandText: '/' + name },
                }
              )));
              setCommandsLoading(false);
            },
            finishEntities: () => {
              resolveEntities?.({
                tasks: [{ kind: 'task', id: 't1', title: 'Async task', status: 'todo' }],
                notes: [],
                totals: { tasks: 1, notes: 0 },
              });
              resolveEntities = null;
            },
          },
        });
      }, []);

      return (
        <QueryClientProvider client={client}>
          <TipProvider>
            <div style={{ margin: '260px 16px 0', width: 520 }}>
              <ChatInputEditor
                ref={ref}
                ariaLabel="Composer"
                slashCommands={commands}
                slashCommandsLoading={commandsLoading}
                mentionFiles={[{ kind: 'file', path: 'src/index.ts', name: 'index.ts' }]}
                searchMentionEntities={() => new Promise((resolve) => { resolveEntities = resolve; })}
              />
            </div>
          </TipProvider>
        </QueryClientProvider>
      );
    }

    createRoot(document.getElementById('root')!).render(<Fixture />);
  `, [], { css: true });
}, 120_000);

afterAll(async () => {
  await fixture?.close();
});

it('shows loading skeletons for @ and / immediately and badges leading slash commands without allowing mid-sentence slash', async () => {
  const context = await fixture.browser.newContext({ viewport: { width: 900, height: 700 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.setDefaultTimeout(5_000);

  try {
    await page.goto(fixture.url);
    const editor = page.locator('.ProseMirror[contenteditable="true"]');
    const popup = page.locator('.slash-command-popup');
    const skeletons = popup.locator('[data-slot="skeleton"]');
    await editor.click();

    // 1. `@` opens immediately with local files AND a loading skeleton while entity search is pending.
    await page.keyboard.type('@');
    await popup.waitFor();
    await popup.getByText('index.ts', { exact: true }).waitFor();
    expect(await skeletons.count()).toBeGreaterThan(0);

    // Once the async search resolves, the remote task appears and the skeleton clears.
    await page.evaluate(() => (window as unknown as { testComposer: { finishEntities(): void } }).testComposer.finishEntities());
    await popup.getByText('Async task', { exact: true }).waitFor();
    await expect.poll(() => skeletons.count()).toBe(0);

    await page.keyboard.press('Escape');
    await page.evaluate(() => (window as unknown as { testComposer: { clear(): void } }).testComposer.clear());
    await editor.click();

    // 2. `/` shows a loading skeleton while slash commands are loading, then renders commands once loaded.
    await page.keyboard.type('/');
    await popup.locator('.chat-slash-menu[aria-busy="true"]').waitFor();
    expect(await skeletons.count()).toBeGreaterThan(0);

    await page.evaluate(() => (window as unknown as { testComposer: { finishCommands(): void } }).testComposer.finishCommands());
    await popup.getByRole('button', { name: /review/ }).waitFor();
    await expect.poll(() => skeletons.count()).toBe(0);

    // 3. Selecting a slash command inserts a badge while preserving `/review` output.
    await page.keyboard.press('Enter');
    const badge = editor.locator('[data-slash-command="review"]');
    await badge.waitFor();
    expect(await page.evaluate(() => (window as unknown as { testComposer: { text(): string } }).testComposer.text())).toBe('/review');

    // Backspace deletes the badge and restores `/` with the menu open.
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    expect(await badge.count()).toBe(0);
    await popup.getByRole('button', { name: /review/ }).waitFor();

    // Typing `/review ` manually also promotes to the badge.
    await page.keyboard.type('review ');
    await badge.waitFor();

    // 4. Mid-sentence `/` stays plain text and does not open the slash menu or create a badge.
    await page.keyboard.press('Escape');
    await page.evaluate(() => (window as unknown as { testComposer: { clear(): void } }).testComposer.clear());
    await editor.click();
    await page.keyboard.type('please run /rev');
    expect(await popup.count()).toBe(0);
    expect(await editor.locator('[data-slash-command]').count()).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
}, 60_000);

it('keeps the caret after the separator when replacing a command before existing arguments', async () => {
  const context = await fixture.browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  try {
    await page.goto(fixture.url);
    const editor = page.locator('.ProseMirror[contenteditable="true"]');
    await editor.click();
    await page.evaluate(() => window.testComposer.finishCommands());
    await page.keyboard.type('/review');
    await page.locator('.slash-command-popup').getByRole('button', { name: /review/ }).waitFor();
    await page.keyboard.type(' ');
    await editor.locator('[data-slash-command="review"]').waitFor();
    await page.keyboard.type('existing args');

    await page.evaluate(() => window.testComposer.openSkills());
    await page.locator('.slash-command-popup').getByRole('button', { name: /ship/ }).click();
    await editor.locator('[data-slash-command="ship"]').waitFor();
    await page.keyboard.type('new ');

    expect(await page.evaluate(() => window.testComposer.text())).toBe('/ship new existing args');
    expect(await page.evaluate(() => window.testComposer.parts())).toEqual({
      parts: [{ type: 'text', text: '/ship new existing args' }],
    });
  } finally {
    await context.close();
  }
}, 30_000);

it('preserves the selected local mention when async results insert rows before it', async () => {
  const context = await fixture.browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  try {
    await page.goto(fixture.url);
    await page.locator('.ProseMirror[contenteditable="true"]').click();
    await page.keyboard.type('@');
    const popup = page.locator('.slash-command-popup');
    await popup.getByText('index.ts', { exact: true }).waitFor();
    await page.keyboard.press('ArrowDown');
    const selected = popup.locator('[data-mention-index][data-selected]');
    await selected.getByText('index.ts', { exact: true }).waitFor();

    await page.evaluate(() => window.testComposer.finishEntities());
    await popup.getByText('Async task', { exact: true }).waitFor();
    expect(await selected.getByText('index.ts', { exact: true }).count()).toBe(1);
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => window.testComposer.text())).toBe('@src/index.ts');
  } finally {
    await context.close();
  }
}, 30_000);

it('preserves kind focus while results load and resets selection when the query changes', async () => {
  const context = await fixture.browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  try {
    await page.goto(fixture.url);
    const editor = page.locator('.ProseMirror[contenteditable="true"]');
    await editor.click();
    await page.keyboard.type('@');
    const popup = page.locator('.slash-command-popup');
    await popup.getByText('index.ts', { exact: true }).waitFor();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const focusedKind = popup.locator('[data-kind-chip][data-focused]');
    await expect.poll(() => focusedKind.innerText()).toBe('Notes');

    await page.evaluate(() => window.testComposer.finishEntities());
    await popup.getByText('Async task', { exact: true }).waitFor();
    expect(await focusedKind.innerText()).toBe('Notes');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => window.testComposer.text())).toBe('@note:');
    expect(await focusedKind.count()).toBe(0);

    // Editing the query, including returning to an earlier one, starts at row one.
    await page.evaluate(() => window.testComposer.clear());
    await editor.click();
    await page.keyboard.type('@');
    await popup.getByText('index.ts', { exact: true }).waitFor();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    const selected = popup.locator('[data-mention-index][data-selected]');
    await selected.getByText('index.ts', { exact: true }).waitFor();
    await page.keyboard.type('i');
    await popup.getByText('index.ts', { exact: true }).waitFor();
    await page.keyboard.press('Backspace');
    await selected.getByText('Scratchpad', { exact: true }).waitFor();
  } finally {
    await context.close();
  }
}, 30_000);

it('copies a slash badge with its command in plain text and HTML and pastes it intact', async () => {
  const context = await fixture.browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  try {
    await page.goto(fixture.url);
    const editor = page.locator('.ProseMirror[contenteditable="true"]');
    await editor.click();
    await page.evaluate(() => window.testComposer.finishCommands());
    await page.keyboard.type('/review');
    await page.locator('.slash-command-popup').getByRole('button', { name: /review/ }).waitFor();
    await page.keyboard.type(' ');
    await editor.locator('[data-slash-command="review"]').waitFor();
    await page.keyboard.type('existing args');
    await page.keyboard.press('ControlOrMeta+A');
    const copied = await editor.evaluate((el) => {
      const data = new DataTransfer();
      el.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }));
      return { text: data.getData('text/plain'), html: data.getData('text/html') };
    });
    expect(copied.text).toBe('/review existing args');
    expect(await page.evaluate((html) => {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return { text: doc.body.textContent, badge: doc.querySelector('[data-slash-chip]')?.textContent };
    }, copied.html)).toEqual({ text: '/review existing args', badge: '/review' });

    await page.evaluate(() => window.testComposer.clear());
    await editor.click();
    await editor.evaluate((el, clipboard) => {
      const data = new DataTransfer();
      data.setData('text/plain', clipboard.text);
      data.setData('text/html', clipboard.html);
      el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    }, copied);
    await editor.locator('[data-slash-command="review"]').waitFor();
    expect(await page.evaluate(() => window.testComposer.text())).toBe('/review existing args');
  } finally {
    await context.close();
  }
}, 30_000);
