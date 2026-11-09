/**
 * Ri's view in a real browser, inside the MCP Apps reference host
 * (`AppBridge` from @modelcontextprotocol/ext-apps), in an opaque sandboxed
 * frame as ChatGPT and Claude draw it. A person works through it as they
 * would: ticks a task off, opens one and edits it, moves cards on the
 * board, writes a note, captures a thought, writes in the scratchpad, and
 * the host sees exactly the calls Ri's tools take.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { build } from 'esbuild';
import { chromium, type Browser, type FrameLocator, type Page } from 'playwright-core';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { DeckView, ViewTask } from './data';
import type { BoardView, CalendarView, ItemView, NotesView, SearchView, StreamView, ViewNote } from './screens';
import { TASKS_VIEW_HTML } from './tasks-view.html';

const task = (over: Partial<ViewTask>): ViewTask => ({
  id: 'task', title: 'Task', status: 'todo', area: null, deadline: null, daysUntil: null, blocked: false, recurring: false, nextOccurrence: null, reason: null, statusChangedCount: 0, url: null, ...over,
});
const note = (over: Partial<ViewNote>): ViewNote => ({ id: 'note', title: 'Note', untitled: false, excerpt: '', kind: 'note', area: null, updatedAt: new Date().toISOString(), url: null, ...over });
const day = (offset: number) => { const date = new Date(); date.setDate(date.getDate() + offset); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
const today = day(0);
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
const LAUNCH = note({ id: 'launch', title: 'Launch notes', excerpt: 'Ask about the CIMD form.', area: 'Ri', url: 'https://ri.example/note/launch' });
const ITEMS: Record<string, ItemView> = {
  'task:ship': {
    screen: 'item', type: 'task',
    task: {
      ...DECK.items[0], outcome: 'ChatGPT connects with one Allow', bodyRevision: 3, team: false, parent: null,
      body: '## Steps\n\nSee [[note:launch]] and [the spec](https://example.com/spec), with **care**.\n\n- [x] Discovery\n- [ ] Consent\n\n<img src=x onerror="parent.__pwned=1"> [bad](javascript:parent.__pwned=1)',
    },
    subtasks: [task({ id: 'faq', title: 'Write the FAQ' })],
    notes: [LAUNCH],
    links: { launch: { type: 'note', title: 'Launch notes' } },
  },
  'note:launch': {
    screen: 'item', type: 'note', links: {},
    note: { ...LAUNCH, body: 'Ask about the **CIMD** form.', bodyRevision: 1, team: false, status: 'active', task: { id: 'ship', title: 'Ship the OAuth sign-in' } },
  },
};
const BOARD: BoardView = {
  screen: 'board', url: 'https://ri.example/',
  columns: [
    { status: 'consider', more: false, items: [task({ id: 'podcast', title: 'Try a podcast', status: 'consider' })] },
    { status: 'todo', more: false, items: [DECK.items[0], task({ id: 'dentist', title: 'Book the dentist', statusChangedCount: 5 })] },
    { status: 'in_progress', more: false, items: [DECK.items[1]] },
  ],
};
const CALENDAR: CalendarView = {
  screen: 'calendar', start: today, today, status: 'ok', url: 'https://ri.example/?calendar=1',
  days: Array.from({ length: 7 }, (_, index) => ({
    date: day(index),
    allDay: index === 2 ? [{ id: 'trip', title: 'Lisbon trip', start: day(2), end: day(3), allDay: true, location: null, joinUrl: null, sourceUrl: null, color: '#4f8a5b', declined: false }] : [],
    events: index === 0 ? [{ id: 'standup', title: 'Standup', start: `${today}T09:00:00`, end: `${today}T09:15:00`, allDay: false, location: 'Kitchen', joinUrl: 'https://meet.example/standup', sourceUrl: 'https://calendar.example/standup', color: '#3b6fd8', declined: false }] : [],
    deadlines: index === 0 ? [DECK.items[0]] : [],
  })),
};
const NOTES: NotesView = { screen: 'notes', more: false, url: null, items: [LAUNCH, note({ id: 'groceries', title: 'Groceries', untitled: true, excerpt: 'Eggs, milk and bread' })] };
const SEARCH: Omit<SearchView, 'query'> = { screen: 'search', tasks: [DECK.items[0]], notes: [LAUNCH] };
const STREAM: StreamView = {
  screen: 'stream', more: false, url: null,
  items: [{ id: 'bank', text: 'Call the bank about the card before Friday', cut: false, createdAt: new Date().toISOString(), media: 'voice', proposed: true }],
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
      const items = ${JSON.stringify(ITEMS)};
      const board = ${JSON.stringify(BOARD)};
      const calendar = ${JSON.stringify(CALENDAR)};
      const notes = ${JSON.stringify(NOTES)};
      const search = ${JSON.stringify(SEARCH)};
      const stream = ${JSON.stringify(STREAM)};
      const params = new URLSearchParams(location.search);
      const theme = params.get('theme') || 'light';
      const displayMode = params.get('display') || 'inline';
      // Opened as the app (the sidebar entry, or the tab beside a chat), whatever display mode the host reports.
      const entry = params.get('entry') === '1';
      // A host that puts things in the person's message without sending them (OpenAI's ui/message extension).
      const drafts = params.get('drafts') === '1';
      let pad = 'milk\\neggs';
      window.addEventListener('message', event => { if (event.data?.method === 'ui/message') log.messages.push(event.data.params); });
      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.style.cssText = (displayMode === 'fullscreen' || entry ? 'width:1000px;height:680px;' : 'width:640px;height:520px;') + 'border:1px solid #ddd;border-radius:12px;background:' + (theme === 'dark' ? '#212121' : '#fff');
      document.body.style.background = theme === 'dark' ? '#212121' : '#fff';
      document.body.append(frame);
      const bridge = new AppBridge(null, { name: 'Reference host', version: '1.0.0' }, { openLinks: {}, serverTools: {}, updateModelContext: { text: {} }, ...(drafts ? { message: { text: {} }, experimental: { 'openai/message': {} } } : {}) }, {
        hostContext: { theme, locale: 'en-US', displayMode, styles: { variables: { '--font-sans': 'system-ui, sans-serif' } } },
      });
      const answer = (name, result) => ({ content: [{ type: 'text', text: JSON.stringify({ ok: true, action: name, result }) }] });
      const refuse = (name, error) => ({ content: [{ type: 'text', text: JSON.stringify({ ok: false, action: name, error }) }], isError: true });
      const allTasks = () => [...deck.items, ...log.added, ...board.columns.flatMap(column => column.items)];
      bridge.oncalltool = async (params) => {
        log.calls.push(params);
        const args = params.arguments;
        if (params.name === 'show_deck') {
          if (window.__failRefresh) return { content: [{ type: 'text', text: 'Ri is restarting' }], isError: true };
          return { content: [{ type: 'text', text: 'deck' }], structuredContent: deck };
        }
        if (params.name === 'show_tasks') {
          // As Ri does: a list of current tasks leaves finished ones out.
          const q = String(args.q ?? '').toLowerCase();
          const items = [...deck.items, ...log.added].filter(item => item.status !== 'done' && item.title.toLowerCase().includes(q));
          return { content: [{ type: 'text', text: 'tasks' }], structuredContent: { view: 'tasks', title: 'Tasks', items, more: false, url: deck.url } };
        }
        if (params.name === 'load_view') {
          const view = args.screen === 'item' ? items[args.type + ':' + args.id] ?? { screen: 'item', type: args.type, missing: true, id: args.id }
            : args.screen === 'board' ? { ...board, columns: board.columns.map(column => ({ ...column, items: allTasks().filter((item, index, all) => item.status === column.status && all.findIndex(other => other.id === item.id) === index) })) }
            : args.screen === 'calendar' ? { ...calendar, start: args.start ?? calendar.start }
            : args.screen === 'notes' ? notes
            : args.screen === 'search' ? { ...search, query: args.query }
            : args.screen === 'stream' ? stream
            : args.screen === 'scratchpad' ? { screen: 'scratchpad', body: pad, updatedAt: null, url: null }
            : null;
          return { content: [], structuredContent: view };
        }
        if (params.name === 'save_scratchpad') {
          // Another device wrote a line meanwhile: Ri merges rather than losing it.
          pad = window.__otherDevice ? args.body + '\\nbread' : args.body;
          const merged = Boolean(window.__otherDevice);
          window.__otherDevice = false;
          return { content: [], structuredContent: { body: pad, merged, updatedAt: new Date().toISOString() } };
        }
        if (params.name === 'create_task') {
          log.added.push({ ...deck.items[2], id: 'added-' + log.added.length, title: args.title, blocked: false, recurring: false, reason: null });
          return answer('create_task', { title: args.title });
        }
        if (params.name === 'create_note') {
          items['note:made'] = { screen: 'item', type: 'note', links: {}, note: { id: 'made', title: args.title ?? 'Untitled', untitled: !args.title, excerpt: '', kind: 'note', area: null, updatedAt: new Date().toISOString(), url: null, body: args.body, bodyRevision: 0, team: false, status: 'active', task: null } };
          return answer('create_note', { id: 'made' });
        }
        if (params.name === 'update_task') {
          if (window.__conflict) {
            window.__conflict = false;
            return refuse('update_task', { code: 'conflict', message: 'The text changed since it was read.', details: { current: { id: args.id, body: 'Their words', bodyRevision: 7, updatedAt: '' } } });
          }
          const item = items['task:' + args.id];
          Object.assign(item.task, args.title ? { title: args.title } : {}, args.body !== undefined ? { body: args.body, bodyRevision: item.task.bodyRevision + 1 } : {});
          return answer('update_task', { id: args.id });
        }
        if (params.name === 'complete_task') {
          const item = allTasks().find(entry => entry.id === args.id);
          const repeats = item.recurring;
          const next = new Date(Date.now() + 7 * 86400000).toISOString();
          const outcome = { toStatus: repeats ? 'todo' : 'done', statusChangedCount: item.statusChangedCount + 1, ...(repeats ? { recurring: true, nextRecurrenceAt: next } : {}) };
          Object.assign(item, { status: outcome.toStatus, statusChangedCount: outcome.statusChangedCount, nextOccurrence: repeats ? next : null });
          return answer('complete_task', outcome);
        }
        if (params.name === 'transition_task' && args.id === 'offsite') return refuse('transition_task', { code: 'conflict', message: 'stale' });
        if (params.name === 'transition_task') {
          const item = allTasks().find(entry => entry.id === args.id);
          const to = { start: 'in_progress', move_to_todo: 'todo', return_to_todo: 'todo', move_to_consider: 'consider', reopen: 'todo', archive: 'archived', restore: 'todo' }[args.command];
          const outcome = { toStatus: to, statusChangedCount: item.statusChangedCount + 1 };
          for (const same of allTasks().filter(entry => entry.id === args.id)) Object.assign(same, { status: to, statusChangedCount: outcome.statusChangedCount });
          return answer(params.name, outcome);
        }
        if (params.name === 'create_stream_item') {
          stream.items.unshift({ id: 'captured', text: args.rawText, cut: false, createdAt: new Date().toISOString(), media: 'text', proposed: false });
          return answer('create_stream_item', { id: 'captured' });
        }
        return answer(params.name, {});
      };
      bridge.onopenlink = async ({ url }) => { log.links.push(url); return {}; };
      bridge.onmessage = async () => ({});
      bridge.onupdatemodelcontext = async (params) => { log.context.push(params); return {}; };
      bridge.onsizechange = ({ height }) => { log.sizes.push(height); if (height && displayMode !== 'fullscreen' && !entry) frame.style.height = height + 'px'; };
      bridge.oninitialized = () => {
        void bridge.sendToolInput({ arguments: {} });
        void bridge.sendToolResult({ content: [{ type: 'text', text: 'deck' }], structuredContent: entry ? { ...deck, app: true } : deck });
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

async function open(theme: 'light' | 'dark', display: 'inline' | 'fullscreen' = 'inline', options: { drafts?: boolean; width?: number; entry?: boolean } = {}): Promise<Page> {
  const page = await browser.newPage({ viewport: options.width ? { width: options.width, height: 740 } : display === 'fullscreen' || options.entry ? { width: 1060, height: 740 } : { width: 720, height: 720 } });
  await page.goto(`${origin}/?theme=${theme}&display=${display}${options.drafts ? '&drafts=1' : ''}${options.entry ? '&entry=1' : ''}`);
  await page.frameLocator('iframe').locator('li[data-task="ship"]').first().waitFor();
  return page;
}
type Log = { calls: Array<{ name: string; arguments: Record<string, unknown> }>; links: string[]; context: Array<{ content: Array<{ text: string }> }>; sizes: number[]; messages: Array<{ role: string; content: Array<{ type: string; text: string; _meta?: Record<string, unknown> }>; _meta?: Record<string, unknown> }> };
const log = (page: Page) => page.evaluate(() => (window as unknown as { __log: Log }).__log);
const lastCall = async (page: Page, name: string) => (await log(page)).calls.filter(call => call.name === name).at(-1);
const told = async (page: Page) => (await log(page)).context.at(-1)?.content[0].text ?? '';
const tab = (view: FrameLocator, name: string) => view.getByRole('tab', { name });

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
  expect(await told(page)).toContain('marked done the task "Ship the OAuth sign-in"');
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

it('opens a task in full inside the chat, draws its body safely, and tells the model which task is open', async () => {
  const page = await open('light');
  const view = page.frameLocator('iframe');
  await view.getByRole('button', { name: 'Ship the OAuth sign-in', exact: true }).click();
  await view.locator('h1', { hasText: 'Ship the OAuth sign-in' }).waitFor();
  expect(await lastCall(page, 'load_view')).toMatchObject({ arguments: { screen: 'item', type: 'task', id: 'ship' } });
  // The model's next turn knows what "this" is.
  await expect.poll(() => told(page)).toContain('has the task "Ship the OAuth sign-in" open (ID ship');
  expect(await view.locator('.outcome').innerText()).toMatch(/Done when[\s\S]*ChatGPT connects with one Allow/i);
  const body = view.locator('.md');
  expect(await body.locator('h3').innerText()).toBe('Steps');
  expect(await body.locator('strong').innerText()).toBe('care');
  expect(await body.locator('.md-task').count()).toBe(2);
  expect(await body.locator('.md-box.on').count()).toBe(1);
  // HTML in a body is text, and only web links are links.
  expect(await body.locator('img').count()).toBe(0);
  expect(await body.innerText()).toContain('<img src=x onerror="parent.__pwned=1">');
  expect(await body.locator('a').evaluateAll(links => links.map(link => link.getAttribute('href')))).toEqual(['https://example.com/spec']);
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  await body.getByRole('link', { name: 'the spec' }).click();
  await expect.poll(async () => (await log(page)).links).toEqual(['https://example.com/spec']);
  expect(await view.locator('li[data-task="faq"]').count()).toBe(1);
  await page.screenshot({ path: path.join(os.tmpdir(), 'ri-mcp-item-task.png') });

  // A link to a note in the body opens that note, and Back returns through each.
  await body.getByRole('button', { name: 'Launch notes' }).click();
  await view.locator('h1', { hasText: 'Launch notes' }).waitFor();
  expect(await view.locator('.md strong').innerText()).toBe('CIMD');
  await expect.poll(() => told(page)).toContain('has the note "Launch notes" open');
  await view.getByRole('button', { name: 'Back' }).click();
  await view.locator('h1', { hasText: 'Ship the OAuth sign-in' }).waitFor();
  await view.getByRole('button', { name: 'Today' }).click();
  await view.locator('h2', { hasText: 'Deadlines' }).waitFor();
  expect(await view.getByRole('button', { name: /^Back$|^Today$/ }).count()).toBe(0);
  await page.close();
});

it('edits a task’s title and body against the revision it drew, and keeps the person’s words when Ri moved on', async () => {
  const page = await open('dark', 'fullscreen');
  const view = page.frameLocator('iframe');
  await view.getByRole('button', { name: 'Ship the OAuth sign-in', exact: true }).click();
  await view.getByRole('button', { name: 'Edit' }).click();
  const title = view.getByRole('textbox', { name: 'Title' });
  const body = view.getByRole('textbox', { name: 'Details, in markdown' });
  expect(await title.inputValue()).toBe('Ship the OAuth sign-in');
  expect(await body.inputValue()).toContain('- [x] Discovery');
  expect(await body.evaluate(element => element === document.activeElement)).toBe(false);
  await title.fill('Ship OAuth sign-in');
  await body.fill('Rewritten in ChatGPT');
  await page.evaluate(() => { (window as unknown as { __conflict: boolean }).__conflict = true; });
  await view.getByRole('button', { name: 'Save' }).click();
  // Refused: someone changed it. The words stay, and saving again is a knowing choice.
  await view.getByText('This changed in Ri while you were writing.', { exact: false }).waitFor();
  expect(await lastCall(page, 'update_task')).toMatchObject({ arguments: { id: 'ship', title: 'Ship OAuth sign-in', body: 'Rewritten in ChatGPT', expected_body_revision: 3 } });
  expect(await body.inputValue()).toBe('Rewritten in ChatGPT');
  await page.screenshot({ path: path.join(os.tmpdir(), 'ri-mcp-item-conflict.png') });
  await view.getByRole('button', { name: 'Save anyway' }).click();
  await view.locator('h1', { hasText: 'Ship OAuth sign-in' }).waitFor();
  expect((await lastCall(page, 'update_task'))?.arguments).toMatchObject({ expected_body_revision: 7 });
  // Only what changed is sent: the outcome stayed as it was.
  expect((await lastCall(page, 'update_task'))?.arguments).not.toHaveProperty('outcome');
  expect(await view.locator('.md').innerText()).toBe('Rewritten in ChatGPT');

  // A subtask from the viewer.
  const sub = view.getByRole('textbox', { name: 'Add a subtask' });
  await sub.fill('Test on the phone');
  await sub.press('Enter');
  await expect.poll(async () => (await lastCall(page, 'create_task'))?.arguments).toEqual({ title: 'Test on the phone', parentId: 'ship' });
  await page.close();
});

it('full screen is Ri: tabs for each part, adding a task without losing your place, and search across tasks and notes', async () => {
  const page = await open('dark', 'fullscreen');
  const view = page.frameLocator('iframe');
  expect(await view.getByRole('tab').allTextContents()).toEqual(['Today', 'Tasks', 'Board', 'Calendar', 'Notes', 'Stream', 'Scratchpad']);
  expect(await tab(view, 'Today').getAttribute('aria-selected')).toBe('true');
  await page.screenshot({ path: path.join(os.tmpdir(), 'ri-mcp-app-today.png') });

  // Add from the deck. The deck stays on screen and says where it went.
  const add = view.getByRole('textbox', { name: 'Add a task' });
  await add.click();
  await add.fill('Book the dentist');
  await add.press('Enter');
  await view.getByText('Added “Book the dentist” to your tasks.').waitFor();
  expect(await add.inputValue()).toBe('');
  expect((await lastCall(page, 'create_task'))?.arguments).toEqual({ title: 'Book the dentist' });
  expect(await tab(view, 'Today').getAttribute('aria-selected')).toBe('true');
  // The redraw after adding keeps the cursor in the field, ready for the next one.
  expect(await add.evaluate(element => element === document.activeElement)).toBe(true);

  // Tasks lists everything current.
  await tab(view, 'Tasks').click();
  await view.locator('li', { hasText: 'Book the dentist' }).waitFor();
  expect((await log(page)).calls.at(-1)).toMatchObject({ name: 'show_tasks', arguments: { limit: 50 } });
  await page.screenshot({ path: path.join(os.tmpdir(), 'ri-mcp-app-tasks.png') });

  // Ticking keeps the row where it was, though Ri's list of current tasks has dropped it, and it can be undone.
  const dentist = view.locator('li', { hasText: 'Book the dentist' });
  await view.getByRole('button', { name: 'Mark Book the dentist done' }).click();
  await expect.poll(async () => dentist.getAttribute('class')).toBe('row done');
  await expect.poll(async () => (await log(page)).calls.at(-1)?.name).toBe('show_tasks');
  await view.getByRole('button', { name: 'Reopen Book the dentist' }).click();
  await expect.poll(async () => dentist.getAttribute('class')).toBe('row');

  // Search finds tasks and notes, and a result opens in place.
  const search = view.getByRole('textbox', { name: 'Search tasks and notes' });
  await search.fill('launch');
  await search.press('Enter');
  await view.locator('h2', { hasText: 'Notes' }).waitFor();
  expect(await lastCall(page, 'load_view')).toMatchObject({ arguments: { screen: 'search', query: 'launch' } });
  expect(await view.locator('li[data-task="ship"]').count()).toBe(1);
  await view.getByRole('button', { name: 'Launch notes', exact: true }).click();
  await view.locator('h1', { hasText: 'Launch notes' }).waitFor();
  await view.getByRole('button', { name: 'Results' }).click();
  await view.locator('h2', { hasText: 'Notes' }).waitFor();
  // Escape clears the search and goes back to where it started.
  await search.press('Escape');
  await view.locator('li', { hasText: 'Book the dentist' }).waitFor();
  expect(await tab(view, 'Tasks').getAttribute('aria-selected')).toBe('true');
  await page.close();
});

it('opens as the app from the sidebar or beside a chat, whatever display mode the host reports, and fits a narrow tab', async () => {
  const page = await open('dark', 'inline', { drafts: true, entry: true, width: 400 });
  const view = page.frameLocator('iframe');
  await page.evaluate(() => { const frame = document.querySelector('iframe')!; frame.style.width = '380px'; });
  await tab(view, 'Scratchpad').waitFor();
  // Nothing wider than the panel: the tabs scroll and the search sits under them.
  const overflow = await view.locator('html').evaluate(html => html.scrollWidth - html.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const tabs = await tab(view, 'Today').boundingBox();
  const search = await view.getByRole('textbox', { name: 'Search tasks and notes' }).boundingBox();
  expect(search!.y).toBeGreaterThan(tabs!.y + tabs!.height - 1);
  await page.screenshot({ path: path.join(os.tmpdir(), 'ri-mcp-app-beside.png') });
  // The board scrolls sideways inside itself at this width, a column at a time with the next peeking in.
  await tab(view, 'Board').click();
  await view.locator('.column').first().waitFor();
  expect(await view.locator('html').evaluate(html => html.scrollWidth - html.clientWidth)).toBeLessThanOrEqual(0);
  const column = await view.locator('.column').first().boundingBox();
  expect(column!.width).toBeGreaterThan(260);
  // A card is only as tall as what it says: its arrows sit beside the title.
  const card = await view.locator('.card[data-task="podcast"]').boundingBox();
  expect(card!.height).toBeLessThan(48);
  await page.screenshot({ path: path.join(os.tmpdir(), 'ri-mcp-app-board-beside.png') });
  // The last tab, once open, stays in view through the redraws that follow.
  await tab(view, 'Scratchpad').click();
  await view.locator('textarea.pad').waitFor();
  await page.waitForTimeout(100);
  const visible = await view.locator('.tabs').evaluate(nav => {
    const on = nav.querySelector('.tab.on') as HTMLElement;
    return on.offsetLeft >= nav.scrollLeft && on.offsetLeft + on.offsetWidth <= nav.scrollLeft + nav.clientWidth;
  });
  expect(visible).toBe(true);
  await page.close();
});

it('moves cards on the board with the lifecycle’s commands, by arrow or by dragging', async () => {
  const page = await open('light', 'fullscreen');
  const view = page.frameLocator('iframe');
  await tab(view, 'Board').click();
  await view.locator('.column').first().waitFor();
  expect(await view.locator('.column-head h2').allTextContents()).toEqual(['Consider', 'Todo', 'In progress']);
  await page.screenshot({ path: path.join(os.tmpdir(), 'ri-mcp-app-board.png') });
  // An arrow moves to the next column.
  const podcast = view.locator('.card[data-task="podcast"]');
  await podcast.hover();
  await view.getByRole('button', { name: 'Move Try a podcast to Todo' }).click();
  await expect.poll(async () => (await lastCall(page, 'transition_task'))?.arguments).toMatchObject({ id: 'podcast', command: 'move_to_todo', expected_status_changed_count: 0 });
  await expect.poll(async () => view.locator('.column', { hasText: 'Todo' }).locator('.card[data-task="podcast"]').count()).toBe(1);
  // Dragging Todo straight to In progress starts it.
  await view.locator('.card[data-task="dentist"]').dragTo(view.locator('.column').nth(2));
  await expect.poll(async () => (await lastCall(page, 'transition_task'))?.arguments).toMatchObject({ id: 'dentist', command: 'start', expected_status_changed_count: 5 });
  await expect.poll(async () => view.locator('.column').nth(2).locator('.card[data-task="dentist"]').count()).toBe(1);
  // Finishing a card leaves it ticked in its column rather than vanishing.
  await view.getByRole('button', { name: 'Mark Book the dentist done' }).click();
  await expect.poll(async () => view.locator('.column').nth(2).locator('.card.done[data-task="dentist"]').count()).toBe(1);
  // A card opens in full.
  await view.getByRole('button', { name: 'Try a podcast', exact: true }).click();
  await expect.poll(async () => (await lastCall(page, 'load_view'))?.arguments).toEqual({ screen: 'item', type: 'task', id: 'podcast' });
  await page.close();
});

it('shows the week with meetings and deadlines, joins a call, and pages by week', async () => {
  const page = await open('light', 'fullscreen');
  const view = page.frameLocator('iframe');
  await tab(view, 'Calendar').click();
  await view.locator('.day').first().waitFor();
  expect(await view.locator('.day').count()).toBe(7);
  const first = view.locator('.day').first();
  expect(await first.locator('.chip', { hasText: 'Today' }).count()).toBe(1);
  expect(await first.locator('.event').innerText()).toMatch(/Standup[\s\S]*9:00[\s\S]*Kitchen/);
  expect(await first.locator('li[data-task="ship"]').count()).toBe(1);
  expect(await view.locator('.day').nth(2).locator('.event').innerText()).toMatch(/Lisbon trip[\s\S]*All day/);
  expect(await view.locator('.day').nth(3).innerText()).toContain('Nothing scheduled.');
  await page.screenshot({ path: path.join(os.tmpdir(), 'ri-mcp-app-calendar.png') });
  await first.getByRole('button', { name: 'Join' }).click();
  await expect.poll(async () => (await log(page)).links).toEqual(['https://meet.example/standup']);
  await view.getByRole('button', { name: 'The week after' }).click();
  await expect.poll(async () => (await lastCall(page, 'load_view'))?.arguments).toEqual({ screen: 'calendar', start: day(7) });
  await view.getByRole('button', { name: 'Today' }).click();
  await expect.poll(async () => (await lastCall(page, 'load_view'))?.arguments).toEqual({ screen: 'calendar' });
  await page.close();
});

it('lists notes and writes a new one, which then opens', async () => {
  const page = await open('light', 'fullscreen');
  const view = page.frameLocator('iframe');
  await tab(view, 'Notes').click();
  await view.locator('li[data-note="groceries"]').waitFor();
  expect(await view.locator('li[data-note="groceries"]').innerText()).toMatch(/Groceries[\s\S]*Eggs, milk and bread/);
  await view.getByRole('button', { name: 'New note' }).click();
  const body = view.getByRole('textbox', { name: 'Write in markdown' });
  await expect.poll(async () => body.evaluate(element => element === document.activeElement)).toBe(true);
  // Nothing to save yet says so, without a call.
  await view.getByRole('button', { name: 'Save' }).click();
  await view.getByText('Write something in the note first.').waitFor();
  expect(await lastCall(page, 'create_note')).toBeUndefined();
  await view.getByRole('textbox', { name: 'Title (optional)' }).fill('Trip ideas');
  await body.fill('Lisbon in **May**');
  await view.getByRole('button', { name: 'Save' }).click();
  await view.locator('h1', { hasText: 'Trip ideas' }).waitFor();
  expect((await lastCall(page, 'create_note'))?.arguments).toEqual({ title: 'Trip ideas', body: 'Lisbon in **May**' });
  expect(await view.locator('.md strong').innerText()).toBe('May');
  // The new note replaced the blank one, so Back goes to the list.
  await view.getByRole('button', { name: 'Notes' }).last().click();
  await view.locator('li[data-note="launch"]').waitFor();
  await page.close();
});

it('captures a thought to the Stream for Rye, and never tells the model what the Stream holds', async () => {
  const page = await open('light', 'fullscreen', { drafts: true });
  const view = page.frameLocator('iframe');
  await tab(view, 'Stream').click();
  await view.getByText('Call the bank about the card before Friday').waitFor();
  expect(await view.locator('.capture .meta').innerText()).toMatch(/Voice[\s\S]*Rye has a suggestion/);
  await expect.poll(() => told(page)).toBe('In the Ri app, the person is looking at the Stream (their capture inbox).');
  const capture = view.getByRole('textbox', { name: 'Capture a thought' });
  await capture.fill('Look into a standing desk');
  await capture.press('Enter');
  await view.getByText('Captured.', { exact: false }).waitFor();
  expect((await lastCall(page, 'create_stream_item'))?.arguments).toEqual({ rawText: 'Look into a standing desk' });
  await view.locator('.capture-text', { hasText: 'Look into a standing desk' }).waitFor();
  expect(await capture.inputValue()).toBe('');
  for (const entry of (await log(page)).context) expect(entry.content[0].text).not.toMatch(/bank|standing desk/);
  // The person hands one thought to the chat themselves.
  await view.locator('.capture', { hasText: 'Call the bank' }).hover();
  await view.locator('.capture', { hasText: 'Call the bank' }).getByRole('button', { name: 'Add this thought to your message' }).click();
  await expect.poll(async () => (await log(page)).messages.at(-1)?.content[0].text).toContain('Call the bank about the card before Friday');
  await page.screenshot({ path: path.join(os.tmpdir(), 'ri-mcp-app-stream.png') });
  await page.close();
});

it('saves the scratchpad as the person writes, merges another device’s lines, and saves before leaving', async () => {
  const page = await open('dark', 'fullscreen');
  const view = page.frameLocator('iframe');
  await tab(view, 'Scratchpad').click();
  const pad = view.getByRole('textbox', { name: 'Write anything' });
  await expect.poll(async () => pad.inputValue()).toBe('milk\neggs');
  await pad.click();
  await pad.press('End');
  await page.evaluate(() => { (window as unknown as { __otherDevice: boolean }).__otherDevice = true; });
  await pad.pressSequentially('\ncall mom');
  await view.getByText('another device’s changes merged in', { exact: false }).waitFor();
  expect((await lastCall(page, 'save_scratchpad'))?.arguments).toEqual({ body: 'milk\neggs\ncall mom', base: 'milk\neggs' });
  expect(await pad.inputValue()).toBe('milk\neggs\ncall mom\nbread');
  // The next save starts from the merged text.
  await pad.press('End');
  await pad.pressSequentially('!');
  await view.getByText('Saved', { exact: true }).waitFor();
  expect((await lastCall(page, 'save_scratchpad'))?.arguments).toEqual({ body: 'milk\neggs\ncall mom\nbread!', base: 'milk\neggs\ncall mom\nbread' });
  await page.screenshot({ path: path.join(os.tmpdir(), 'ri-mcp-app-scratchpad.png') });
  // Typing and leaving at once still saves.
  await pad.pressSequentially(' and juice');
  await tab(view, 'Today').click();
  await expect.poll(async () => (await lastCall(page, 'save_scratchpad'))?.arguments.body).toBe('milk\neggs\ncall mom\nbread! and juice');
  for (const entry of (await log(page)).context) expect(entry.content[0].text).not.toMatch(/milk|call mom/);
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
  await view.getByRole('button', { name: 'Open Ri' }).click();
  await expect.poll(async () => (await log(page)).links).toEqual(['https://ri.example/']);
  await view.getByRole('button', { name: 'Ship the OAuth sign-in', exact: true }).click();
  await view.getByRole('button', { name: 'Open in Ri' }).click();
  await expect.poll(async () => (await log(page)).links).toEqual(['https://ri.example/', 'https://ri.example/task/ship']);
  await page.close();
});
