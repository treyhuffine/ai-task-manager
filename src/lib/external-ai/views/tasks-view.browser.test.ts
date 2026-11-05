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
      const log = window.__log = { calls: [], links: [], context: [], sizes: [] };
      const deck = ${JSON.stringify(DECK)};
      const theme = new URLSearchParams(location.search).get('theme') || 'light';
      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.style.cssText = 'width:640px;height:520px;border:1px solid #ddd;border-radius:12px;background:' + (theme === 'dark' ? '#212121' : '#fff');
      document.body.style.background = theme === 'dark' ? '#212121' : '#fff';
      document.body.append(frame);
      const bridge = new AppBridge(null, { name: 'Reference host', version: '1.0.0' }, { openLinks: {}, serverTools: {}, updateModelContext: { text: {} } }, {
        hostContext: { theme, locale: 'en-US', displayMode: 'inline', styles: { variables: { '--font-sans': 'system-ui, sans-serif' } } },
      });
      bridge.oncalltool = async (params) => {
        log.calls.push(params);
        if (params.name === 'show_deck') {
          if (window.__failRefresh) return { content: [{ type: 'text', text: 'Ri is restarting' }], isError: true };
          return { content: [{ type: 'text', text: 'deck' }], structuredContent: deck };
        }
        if (params.name === 'complete_task') {
          const item = deck.items.find(entry => entry.id === params.arguments.id);
          const repeats = item.recurring;
          const next = new Date(Date.now() + 7 * 86400000).toISOString();
          const outcome = { toStatus: repeats ? 'todo' : 'done', statusChangedCount: item.statusChangedCount + 1, ...(repeats ? { recurring: true, nextRecurrenceAt: next } : {}) };
          deck.items = deck.items.map(entry => entry === item ? { ...entry, status: outcome.toStatus, statusChangedCount: outcome.statusChangedCount, nextOccurrence: repeats ? next : null } : entry);
          return { content: [{ type: 'text', text: JSON.stringify({ ok: true, action: 'complete_task', result: outcome }) }] };
        }
        if (params.name === 'transition_task' && params.arguments.id === 'offsite') {
          return { content: [{ type: 'text', text: JSON.stringify({ ok: false, action: 'transition_task', error: { code: 'conflict', message: 'stale' } }) }], isError: true };
        }
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, action: params.name, result: {} }) }] };
      };
      bridge.onopenlink = async ({ url }) => { log.links.push(url); return {}; };
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

async function open(theme: 'light' | 'dark'): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 720, height: 720 } });
  await page.goto(`${origin}/?theme=${theme}`);
  await page.frameLocator('iframe').locator('li[data-task="ship"]').waitFor();
  return page;
}
const log = (page: Page) => page.evaluate(() => (window as unknown as { __log: { calls: Array<{ name: string; arguments: Record<string, unknown> }>; links: string[]; context: Array<{ content: Array<{ text: string }> }>; sizes: number[] } }).__log);

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
