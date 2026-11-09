/**
 * The tasks view in a real browser, inside the MCP Apps reference host
 * (`AppBridge` from @modelcontextprotocol/ext-apps), in an opaque sandboxed
 * frame as ChatGPT and Claude draw it. A person ticks a task off, starts
 * another and opens one in Ri, and the host sees exactly the calls Ri's
 * tools take.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { build } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright-core';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { DeckView, ViewTask } from './data';
import { TASKS_VIEW_HTML } from './tasks-view.html';

const task = (over: Partial<ViewTask>): ViewTask => ({
  id: 'task', title: 'Task', status: 'todo', area: null, deadline: null, daysUntil: null, blocked: false, recurring: false, nextOccurrence: null, reason: null, statusChangedCount: 0, url: null, ...over,
});
const today = new Date().toISOString().slice(0, 10);
const DECK: DeckView = {
  view: 'deck', forDate: today, isToday: true, framing: 'Finish the sign-in, then write it up so people can use it.', inProgress: 1, url: 'https://ri.example/',
  deadlines: [task({ id: 'taxes', title: 'File the quarterly taxes', deadline: today, daysUntil: -2, statusChangedCount: 3 })],
  items: [
    task({ id: 'ship', title: 'Ship the OAuth sign-in', area: 'Ri', deadline: today, daysUntil: 0, reason: 'It unblocks ChatGPT and Claude on the phone.', statusChangedCount: 1, url: 'https://ri.example/task/ship' }),
    task({ id: 'docs', title: 'Write the connection docs', status: 'in_progress', area: 'Ri', reason: 'People need the steps.', statusChangedCount: 2 }),
    task({ id: 'offsite', title: 'Plan the team offsite', blocked: true, recurring: true }),
    task({ id: 'plants', title: 'Water the plants', recurring: true, statusChangedCount: 4 }),
  ],
};

let server: http.Server;
let browser: Browser;
let origin = '';

beforeAll(async () => {
  // The reference host, resolved where the host package keeps it.
  const host = await build({
    stdin: { resolveDir: path.resolve('packages/mcp-apps-host'), loader: 'ts', contents: `
      import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
      const log = window.__log = { calls: [], links: [], context: [], sizes: [], added: [], messages: [] };
      const deck = ${JSON.stringify(DECK)};
      const theme = new URLSearchParams(location.search).get('theme') || 'light';
      const displayMode = new URLSearchParams(location.search).get('display') || 'inline';
      // A host that puts things in the person's message without sending them (OpenAI's ui/message extension).
      const drafts = new URLSearchParams(location.search).get('drafts') === '1';
      window.addEventListener('message', event => { if (event.data?.method === 'ui/message') log.messages.push(event.data.params); });
      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.style.cssText = (displayMode === 'fullscreen' ? 'width:1000px;height:680px;' : 'width:640px;height:520px;') + 'border:1px solid #ddd;border-radius:12px;background:' + (theme === 'dark' ? '#212121' : '#fff');
      document.body.style.background = theme === 'dark' ? '#212121' : '#fff';
      document.body.append(frame);
      const bridge = new AppBridge(null, { name: 'Reference host', version: '1.0.0' }, { openLinks: {}, serverTools: {}, updateModelContext: { text: {} }, ...(drafts ? { message: { text: {} }, experimental: { 'openai/message': {} } } : {}) }, {
        hostContext: { theme, locale: 'en-US', displayMode, styles: { variables: { '--font-sans': 'system-ui, sans-serif' } } },
      });
      bridge.oncalltool = async (params) => {
        log.calls.push(params);
        if (params.name === 'show_deck') {
          if (window.__failRefresh) return { content: [{ type: 'text', text: 'Ri is restarting' }], isError: true };
          return { content: [{ type: 'text', text: 'deck' }], structuredContent: deck };
        }
        if (params.name === 'show_tasks') {
          // As Ri does: a list of current tasks leaves finished ones out.
          const q = String(params.arguments.q ?? '').toLowerCase();
          const items = [...deck.items, ...log.added].filter(item => item.status !== 'done' && item.title.toLowerCase().includes(q));
          return { content: [{ type: 'text', text: 'tasks' }], structuredContent: { view: 'tasks', title: 'Tasks', items, more: false, url: deck.url } };
        }
        if (params.name === 'create_task') {
          log.added.push({ ...deck.items[2], id: 'added-' + log.added.length, title: params.arguments.title, blocked: false, recurring: false, reason: null });
          return { content: [{ type: 'text', text: JSON.stringify({ ok: true, action: 'create_task', result: { title: params.arguments.title } }) }] };
        }
        if (params.name === 'complete_task') {
          const item = [...deck.items, ...log.added].find(entry => entry.id === params.arguments.id);
          const repeats = item.recurring;
          const next = new Date(Date.now() + 7 * 86400000).toISOString();
          const outcome = { toStatus: repeats ? 'todo' : 'done', statusChangedCount: item.statusChangedCount + 1, ...(repeats ? { recurring: true, nextRecurrenceAt: next } : {}) };
          Object.assign(item, { status: outcome.toStatus, statusChangedCount: outcome.statusChangedCount, nextOccurrence: repeats ? next : null });
          return { content: [{ type: 'text', text: JSON.stringify({ ok: true, action: 'complete_task', result: outcome }) }] };
        }
        if (params.name === 'transition_task' && params.arguments.id === 'offsite') {
          return { content: [{ type: 'text', text: JSON.stringify({ ok: false, action: 'transition_task', error: { code: 'conflict', message: 'stale' } }) }], isError: true };
        }
        if (params.name === 'transition_task') {
          const item = [...deck.items, ...log.added].find(entry => entry.id === params.arguments.id);
          const outcome = { toStatus: params.arguments.command === 'start' ? 'in_progress' : 'todo', statusChangedCount: item.statusChangedCount + 1 };
          Object.assign(item, { status: outcome.toStatus, statusChangedCount: outcome.statusChangedCount });
          return { content: [{ type: 'text', text: JSON.stringify({ ok: true, action: params.name, result: outcome }) }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, action: params.name, result: {} }) }] };
      };
      bridge.onopenlink = async ({ url }) => { log.links.push(url); return {}; };
      bridge.onmessage = async () => ({});
      bridge.onupdatemodelcontext = async (params) => { log.context.push(params); return {}; };
      bridge.onsizechange = ({ height }) => { log.sizes.push(height); if (height) frame.style.height = height + 'px'; };
      bridge.oninitialized = () => {
        void bridge.sendToolInput({ arguments: {} });
        void bridge.sendToolResult({ content: [{ type: 'text', text: 'deck' }], structuredContent: deck });
      };
      frame.srcdoc = ${JSON.stringify(TASKS_VIEW_HTML)};
      void bridge.connect(new PostMessageTransport(frame.contentWindow, frame.contentWindow));
    ` }, bundle: true, write: false, format: 'iife', platform: 'browser',
  });
  server = http.createServer((req, res) => {
    if (req.url?.startsWith('/host.js')) { res.setHeader('content-type', 'text/javascript'); res.end(host.outputFiles[0].text); return; }
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><html><body style="margin:24px;font-family:system-ui"><script src="/host.js"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true, chromiumSandbox: true, args: ['--disable-features=IsolateSandboxedIframes'] });
}, 60_000);
afterAll(async () => { await browser?.close(); server?.closeAllConnections(); await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve()); });

async function open(theme: 'light' | 'dark', display: 'inline' | 'fullscreen' = 'inline', options: { drafts?: boolean; width?: number } = {}): Promise<Page> {
  const page = await browser.newPage({ viewport: options.width ? { width: options.width, height: 740 } : display === 'fullscreen' ? { width: 1060, height: 740 } : { width: 720, height: 720 } });
  await page.goto(`${origin}/?theme=${theme}&display=${display}${options.drafts ? '&drafts=1' : ''}`);
  await page.frameLocator('iframe').locator('li[data-task="ship"]').waitFor();
  return page;
}
const log = (page: Page) => page.evaluate(() => (window as unknown as { __log: { calls: Array<{ name: string; arguments: Record<string, unknown> }>; links: string[]; context: Array<{ content: Array<{ text: string }> }>; sizes: number[]; messages: Array<{ role: string; content: Array<{ type: string; text: string; _meta?: Record<string, unknown> }>; _meta?: Record<string, unknown> }> } }).__log);

it('draws the deck as Ri does: deadlines pinned on top, the ranked stack, quiet meta', async () => {
  const page = await open('light');
  const view = page.frameLocator('iframe');
  await expect.poll(async () => (await view.locator('h2').allTextContents()).map(text => text.toLowerCase())).toEqual(['deadlines', 'today']);
  expect(await view.locator('li[data-task="taxes"]').innerText()).toMatch(/File the quarterly taxes[\s\S]*Overdue 2 days/);
  expect(await view.locator('ol > li').evaluateAll(rows => rows.map(row => row.getAttribute('data-task')))).toEqual(['ship', 'docs', 'offsite', 'plants']);
  expect(await view.locator('li[data-task="ship"] .meta').innerText()).toMatch(/Ri\s*·\s*Due today/);
  expect(await view.locator('li[data-task="docs"] .meta').innerText()).toMatch(/In progress/);
  expect(await view.locator('li[data-task="offsite"] .meta').innerText()).toMatch(/Blocked[\s\S]*Repeats/);
  expect(await view.locator('.aside').innerText()).toBe('1 in progress');
  // The height it reports is the page it drew, so the host shows it whole.
  await expect.poll(async () => Math.max(0, ...(await log(page)).sizes)).toBeGreaterThan(200);
  await page.screenshot({ path: path.join(os.tmpdir(), 'ri-mcp-deck-light.png') });
  await page.close();
});

it('finishes a task with the content tool, checked against what the view saw, then redraws from Ri', async () => {
  const page = await open('dark');
  const view = page.frameLocator('iframe');
  expect(await view.locator('html').getAttribute('data-theme')).toBe('dark');
  await view.getByRole('button', { name: 'Mark Ship the OAuth sign-in done' }).click();
  await expect.poll(async () => (await log(page)).calls.map(call => call.name)).toEqual(['complete_task', 'show_deck']);
  const [complete] = (await log(page)).calls;
  expect(complete.arguments).toMatchObject({ id: 'ship', expected_status_changed_count: 1, idempotency_key: expect.any(String) });
  await expect.poll(async () => view.locator('li[data-task="ship"]').getAttribute('class')).toContain('done');
  expect((await log(page)).context.at(-1)?.content[0].text).toContain('marked done the task "Ship the OAuth sign-in"');
  await page.screenshot({ path: path.join(os.tmpdir(), 'ri-mcp-deck-dark.png') });
  await page.close();
});

it('stays a card in a chat, with no tabs or add field, and never offers to write a message a host would send', async () => {
  const page = await open('light');
  const view = page.frameLocator('iframe');
  expect(await view.getByRole('tab').count()).toBe(0);
  expect(await view.getByRole('textbox').count()).toBe(0);
  // This host would send a ui/message as the person, so the view doesn't offer one.
  expect(await view.getByRole('button', { name: /to your message$/ }).count()).toBe(0);
  await page.close();
});

it('adds a task to the message being written, labeled and unsent, where the host can hold a draft', async () => {
  const page = await open('light', 'inline', { drafts: true });
  const view = page.frameLocator('iframe');
  await view.locator('li[data-task="ship"]').hover();
  await view.getByRole('button', { name: 'Add Ship the OAuth sign-in to your message' }).click();
  await view.getByText('Added to your message.').waitFor();
  const [message] = (await log(page)).messages;
  expect(message).toMatchObject({ role: 'user', _meta: { 'openai/message': { target: 'active', send: false } } });
  expect(message.content).toEqual([{ type: 'text', text: expect.stringContaining('Its ID is ship'), _meta: { 'openai/title': 'Ship the OAuth sign-in' } }]);
  expect((await log(page)).calls).toEqual([]);
  await page.close();
});

it('fits beside a chat, as a narrow tab', async () => {
  const page = await open('dark', 'fullscreen', { drafts: true, width: 400 });
  const view = page.frameLocator('iframe');
  await page.evaluate(() => { const frame = document.querySelector('iframe')!; frame.style.width = '380px'; });
  await view.getByRole('tab', { name: 'Tasks' }).waitFor();
  // Nothing wider than the panel: the add field wraps under the tabs.
  const overflow = await view.locator('html').evaluate(html => html.scrollWidth - html.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const tabs = await view.getByRole('tab', { name: 'Today' }).boundingBox();
  const add = await view.getByRole('textbox', { name: 'Add a task' }).boundingBox();
  expect(add!.y).toBeGreaterThan(tabs!.y + tabs!.height - 1);
  await page.screenshot({ path: path.join(os.tmpdir(), 'ri-mcp-app-beside.png') });
  await page.close();
});

it('full screen is a small app: Today, Tasks with a search, and adding a task without losing your place', async () => {
  const page = await open('dark', 'fullscreen');
  const view = page.frameLocator('iframe');
  expect(await view.getByRole('tab', { name: 'Today' }).getAttribute('aria-selected')).toBe('true');
  await page.screenshot({ path: path.join(os.tmpdir(), 'ri-mcp-app-today.png') });

  // Add from the deck. The deck stays on screen and says where it went.
  const add = view.getByRole('textbox', { name: 'Add a task' });
  await add.click();
  await add.fill('Book the dentist');
  await add.press('Enter');
  await view.getByText('Added “Book the dentist” to your tasks.').waitFor();
  expect(await add.inputValue()).toBe('');
  expect((await log(page)).calls.find(call => call.name === 'create_task')?.arguments).toEqual({ title: 'Book the dentist' });
  expect(await view.getByRole('tab', { name: 'Today' }).getAttribute('aria-selected')).toBe('true');
  // The redraw after adding keeps the cursor in the field, ready for the next one.
  expect(await add.evaluate(element => element === document.activeElement)).toBe(true);

  // Tasks lists everything, and search narrows it.
  await view.getByRole('tab', { name: 'Tasks' }).click();
  await view.getByRole('textbox', { name: 'Search tasks' }).waitFor();
  await view.locator('li', { hasText: 'Book the dentist' }).waitFor();
  expect((await log(page)).calls.at(-1)).toMatchObject({ name: 'show_tasks', arguments: { limit: 50 } });
  const search = view.getByRole('textbox', { name: 'Search tasks' });
  await search.fill('dentist');
  await search.press('Enter');
  await expect.poll(async () => view.locator('li[data-task]').count()).toBe(1);
  expect((await log(page)).calls.at(-1)).toMatchObject({ name: 'show_tasks', arguments: { limit: 50, q: 'dentist' } });
  await page.screenshot({ path: path.join(os.tmpdir(), 'ri-mcp-app-tasks.png') });

  // A change on a filtered list keeps the filter when it redraws.
  await view.locator('li[data-task]').hover();
  await view.getByRole('button', { name: 'Start Book the dentist' }).click();
  await expect.poll(async () => (await log(page)).calls.at(-1)?.name).toBe('show_tasks');
  expect((await log(page)).calls.at(-1)?.arguments).toMatchObject({ q: 'dentist' });
  expect(await search.inputValue()).toBe('dentist');

  // Ticking keeps the row where it was, though Ri's list of current tasks has dropped it, and it can be undone.
  const dentist = view.locator('li', { hasText: 'Book the dentist' });
  await view.getByRole('button', { name: 'Mark Book the dentist done' }).click();
  await expect.poll(async () => dentist.getAttribute('class')).toBe('row done');
  await expect.poll(async () => (await log(page)).calls.at(-1)?.name).toBe('show_tasks');
  await view.getByRole('button', { name: 'Reopen Book the dentist' }).click();
  await expect.poll(async () => dentist.getAttribute('class')).toBe('row');
  expect(await view.locator('li[data-task]').count()).toBe(1);

  await view.getByRole('tab', { name: 'Today' }).click();
  await expect.poll(async () => view.getByRole('tab', { name: 'Today' }).getAttribute('aria-selected')).toBe('true');
  await view.locator('h2', { hasText: 'Deadlines' }).waitFor();
  await page.close();
});

it('keeps a finished repeating task done until its next date, so it can’t be finished twice by accident', async () => {
  const page = await open('light');
  const view = page.frameLocator('iframe');
  await view.getByRole('button', { name: 'Mark Water the plants done' }).click();
  await expect.poll(async () => (await log(page)).calls.map(call => call.name)).toEqual(['complete_task', 'show_deck']);
  const row = view.locator('li[data-task="plants"]');
  await expect.poll(async () => row.getAttribute('class')).toBe('row done');
  expect(await row.locator('.meta').innerText()).toMatch(/Next /);
  expect(await row.locator('.meta').innerText()).not.toMatch(/Repeats/);
  expect(await row.locator('.check').isDisabled()).toBe(true);
  expect(await row.locator('.check').getAttribute('aria-label')).toMatch(/^Water the plants is done until /);
  expect(await row.locator('.start').count()).toBe(0);
  await page.close();
});

it('says when it can’t update, keeps what Ri answered so the next change works, and tries again', async () => {
  const page = await open('light');
  const view = page.frameLocator('iframe');
  await page.evaluate(() => { (window as unknown as { __failRefresh: boolean }).__failRefresh = true; });
  await view.getByRole('button', { name: 'Mark Ship the OAuth sign-in done' }).click();
  await view.getByText('This view may be out of date.', { exact: false }).waitFor();
  const row = view.locator('li[data-task="ship"]');
  expect(await row.getAttribute('class')).toBe('row done');
  // A repeating task shows Ri's next date even though the redraw failed.
  await view.getByRole('button', { name: 'Mark Water the plants done' }).click();
  await expect.poll(async () => view.locator('li[data-task="plants"] .meta').innerText()).toMatch(/Next /);
  // Undoing sends the count Ri just answered, not the one the view was drawn with.
  await row.getByRole('button', { name: 'Reopen Ship the OAuth sign-in' }).click();
  await expect.poll(async () => (await log(page)).calls.find(call => call.name === 'transition_task')?.arguments.expected_status_changed_count).toBe(2);
  await page.evaluate(() => { (window as unknown as { __failRefresh: boolean }).__failRefresh = false; });
  await view.getByRole('button', { name: 'Try again' }).click();
  await expect.poll(async () => view.getByText('This view may be out of date.', { exact: false }).count()).toBe(0);
  await page.close();
});

it('starts a task, says so when Ri refuses a change, and opens a task in Ri through the host', async () => {
  const page = await open('light');
  const view = page.frameLocator('iframe');
  await view.locator('li[data-task="offsite"]').hover();
  await view.getByRole('button', { name: 'Start Plan the team offsite' }).click();
  await expect.poll(async () => view.locator('li[data-task="offsite"] [role="alert"]').count()).toBe(1);
  expect(await view.locator('li[data-task="offsite"] [role="alert"]').innerText()).toMatch(/changed in Ri/);
  expect(await view.locator('li[data-task="offsite"] .meta').innerText()).not.toMatch(/In progress/);
  await view.getByRole('button', { name: 'Ship the OAuth sign-in', exact: true }).click();
  await expect.poll(async () => (await log(page)).links).toEqual(['https://ri.example/task/ship']);
  await view.getByRole('button', { name: 'Open Ri' }).click();
  await expect.poll(async () => (await log(page)).links).toEqual(['https://ri.example/task/ship', 'https://ri.example/']);
  await page.close();
});
