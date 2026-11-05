/**
 * Ri's MCP views (docs/mcp-oauth.md, "Views"): the committed page is the
 * current build, Ri's own MCP Apps host accepts it, and an outside assistant
 * discovers and draws it with the same data as the deck and task list.
 */
import fs from 'node:fs';
import { NextRequest } from 'next/server';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { prepareResource } from '@/lib/mcp-apps/resource';
import { todayLocalDate } from '@/lib/deck/date';
import { GENERATED_VIEW_FILE, renderGeneratedViews } from '../../../../scripts/build-mcp-views';
import { HOME_CONTENT_ACTIONS, HOME_MCP_PATH, contentToolAnnotations } from '../policy';
import { MCP_APP_MIME, TASKS_VIEW_URI } from './tools';
import { TASKS_VIEW_HTML } from './tasks-view.html';

vi.mock('@/lib/embeddings/embed', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/embeddings/embed')>()), generateEmbedding: vi.fn(async () => { throw new Error('No model in this test'); }), upsertEmbedding: vi.fn(async () => {}), deleteEmbedding: vi.fn() }));
vi.mock('@/lib/sessions/workstream', () => ({ coordinateLifecycleChange: vi.fn(async () => {}) }));
vi.mock('@/lib/sessions/workstream-runtime', () => ({ inProcessWorkstreamRuntime: {} }));
vi.mock('@/lib/executor/status-snapshot', () => ({ listRunningSessions: () => [] }));
vi.setConfig({ testTimeout: 60_000 });

const BASE = 'https://home.test';

it('commits the page the client code builds today', async () => {
  // Stale means someone edited ./client without running `pnpm mcp-views:build`.
  expect(fs.readFileSync(GENERATED_VIEW_FILE, 'utf8')).toBe(await renderGeneratedViews());
});

it('is a standard MCP Apps page that reaches nothing on the network', () => {
  const resource = { contents: [{ uri: TASKS_VIEW_URI, mimeType: MCP_APP_MIME, text: TASKS_VIEW_HTML }] };
  expect(() => prepareResource(resource, TASKS_VIEW_URI, false)).not.toThrow();
  expect(TASKS_VIEW_HTML).not.toMatch(/https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
  expect(Buffer.byteLength(TASKS_VIEW_HTML)).toBeLessThan(40_000);
});

it('hints every content tool as reading or changing work, from its own action', async () => {
  const { actions } = await import('@/lib/orchestrator/registry');
  const reads = HOME_CONTENT_ACTIONS.filter(name => contentToolAnnotations(actions.find(action => action.name === name)!).readOnlyHint);
  expect([...reads].sort()).toEqual(['get_area', 'get_deck', 'get_note', 'get_task', 'list_areas', 'list_backlinks', 'list_deadlines', 'list_notes', 'list_outgoing_links', 'list_tasks', 'search']);
});

describe('over MCP', () => {
  let home: TestHome;
  const clients: Client[] = [];

  beforeAll(async () => { await Promise.all([import('@/proxy'), import('@/app/api/orchestrator/[transport]/route')]); }, 120_000);
  beforeEach(async () => {
    home = await createTestHome({ prefix: 'ri-mcp-views-' });
    const { setRemoteBaseUrl } = await import('@/lib/auth/bootstrap');
    setRemoteBaseUrl(BASE);
  });
  afterEach(async () => {
    await Promise.all(clients.splice(0).map(client => client.close()));
    await home.cleanup();
  });

  function forwarded(auth: Response): Headers {
    const headers = new Headers();
    for (const [name, value] of auth.headers) if (name.startsWith('x-middleware-request-')) headers.set(name.slice('x-middleware-request-'.length), value);
    return headers;
  }
  async function serve(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const request = new NextRequest(input instanceof Request ? input : String(input), { ...init, signal: init?.signal ?? undefined });
    const { proxy } = await import('@/proxy');
    const auth = proxy(request);
    if (auth.headers.get('x-middleware-next') !== '1') return auth;
    const route = await import('@/app/api/orchestrator/[transport]/route');
    return route[request.method as 'GET' | 'POST' | 'DELETE'](new NextRequest(request, { headers: forwarded(auth) }));
  }
  async function assistant(): Promise<Client> {
    const q = await import('@/lib/db/queries');
    const { token } = q.createPersonalAiClient('ChatGPT', 'chatgpt');
    const client = new Client({ name: 'chatgpt', version: '1.0.0' });
    clients.push(client);
    await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}${HOME_MCP_PATH}`), { fetch: serve as typeof fetch, requestInit: { headers: { authorization: `Bearer ${token.plaintext}` } } }));
    return client;
  }

  async function seed() {
    const q = await import('@/lib/db/queries');
    const area = q.createArea({ name: 'Ri' } as Parameters<typeof q.createArea>[0]);
    const day = (offset: number) => todayLocalDate(new Date(Date.now() + offset * 86_400_000));
    const ship = q.createTask({ title: 'Ship the OAuth sign-in', areaId: area.id, hardDeadline: day(0) });
    const docs = q.createTask({ title: 'Write the docs', areaId: area.id });
    const taxes = q.createTask({ title: 'File the taxes', hardDeadline: day(-2) });
    const later = q.createTask({ title: 'Plan the offsite' });
    q.transitionTask({ taskId: docs.id, command: 'start', idempotencyKey: 'seed-start', meta: { source: 'human' } });
    q.supersedeAndInsertDeck({ forDate: todayLocalDate(), origin: 'manual', framing: 'Finish the sign-in, then write it up.', items: [
      { taskId: ship.id, rationale: 'It unblocks ChatGPT.', continuityContext: null, source: 'ai' },
      { taskId: docs.id, rationale: 'People need the steps.', continuityContext: null, source: 'ai' },
    ], alternatives: [] } as Parameters<typeof q.supersedeAndInsertDeck>[0]);
    return { area, ship, docs, taxes, later };
  }

  it('lists the view and its render tools with MCP Apps and Apps SDK metadata, and serves the page', async () => {
    const client = await assistant();
    const tools = (await client.listTools()).tools;
    const deck = tools.find(tool => tool.name === 'show_deck')!;
    expect(deck._meta).toMatchObject({ ui: { resourceUri: TASKS_VIEW_URI }, 'openai/outputTemplate': TASKS_VIEW_URI });
    expect(deck.annotations).toMatchObject({ readOnlyHint: true });
    expect(tools.find(tool => tool.name === 'get_deck')!._meta?.ui).toBeUndefined();
    expect(tools.find(tool => tool.name === 'create_task')!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: false });
    expect(tools.find(tool => tool.name === 'complete_task')!._meta).toMatchObject({ 'openai/widgetAccessible': true });
    const listed = (await client.listResources()).resources;
    expect(listed).toEqual([expect.objectContaining({ uri: TASKS_VIEW_URI, mimeType: MCP_APP_MIME })]);
    const read = await client.readResource({ uri: TASKS_VIEW_URI });
    expect(read.contents[0]).toMatchObject({ uri: TASKS_VIEW_URI, mimeType: MCP_APP_MIME, text: TASKS_VIEW_HTML, _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: true } } });
  });

  it('shows today’s deck as Ri does: deadlines pinned once, the ranked stack, what’s in progress', async () => {
    const { ship, docs, taxes } = await seed();
    const client = await assistant();
    const result = await client.callTool({ name: 'show_deck', arguments: {} });
    const view = result.structuredContent as unknown as import('./data').DeckView;
    expect(view).toMatchObject({ view: 'deck', isToday: true, framing: 'Finish the sign-in, then write it up.', inProgress: 1, url: `${BASE}/` });
    expect(view.items.map(item => [item.title, item.status, item.reason])).toEqual([
      ['Ship the OAuth sign-in', 'todo', 'It unblocks ChatGPT.'],
      ['Write the docs', 'in_progress', 'People need the steps.'],
    ]);
    expect(view.items[0]).toMatchObject({ area: 'Ri', daysUntil: 0, url: `${BASE}/task/${ship.id}` });
    // Overdue and not on the deck, so it's in the band. Ship is due today but already in the stack.
    expect(view.deadlines.map(task => [task.id, task.daysUntil])).toEqual([[taxes.id, -2]]);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain('Deadlines:\n- File the taxes (overdue 2d)');
    expect(text).toContain(`2. Write the docs (in progress, Ri) [${docs.id}]`);
  });

  it('shows named tasks in order, or a filtered list, and acts on them with the content tools', async () => {
    const { ship, later, docs } = await seed();
    const client = await assistant();
    const named = (await client.callTool({ name: 'show_tasks', arguments: { title: 'Added to Ri', ids: [later.id, ship.id] } })).structuredContent as unknown as import('./data').TasksView;
    expect(named).toMatchObject({ view: 'tasks', title: 'Added to Ri', more: false });
    expect(named.items.map(item => item.title)).toEqual(['Plan the offsite', 'Ship the OAuth sign-in']);
    const working = (await client.callTool({ name: 'show_tasks', arguments: { status: 'in_progress' } })).structuredContent as unknown as import('./data').TasksView;
    expect(working.items.map(item => item.id)).toEqual([docs.id]);

    // What the view sends when the person ticks a task off.
    const done = await client.callTool({ name: 'complete_task', arguments: { id: later.id, idempotency_key: 'view-1', expected_status_changed_count: named.items[0].statusChangedCount } });
    expect(JSON.parse((done.content as Array<{ text: string }>)[0].text)).toMatchObject({ ok: true });
    const stale = await client.callTool({ name: 'transition_task', arguments: { id: later.id, command: 'reopen', idempotency_key: 'view-2', expected_status_changed_count: named.items[0].statusChangedCount } });
    expect(JSON.parse((stale.content as Array<{ text: string }>)[0].text)).toMatchObject({ ok: false, error: { code: 'conflict' } });
  });

  it('shows a repeating task as done until its next date, from Ri’s own answer', async () => {
    const q = await import('@/lib/db/queries');
    const plants = q.createTask({ title: 'Water the plants', recurrence: 'weekly' });
    const client = await assistant();
    const show = async () => client.callTool({ name: 'show_tasks', arguments: { ids: [plants.id] } });
    const before = ((await show()).structuredContent as unknown as import('./data').TasksView).items[0];
    expect(before).toMatchObject({ recurring: true, nextOccurrence: null });
    const finished = await client.callTool({ name: 'complete_task', arguments: { id: plants.id, idempotency_key: 'view-plants', expected_status_changed_count: before.statusChangedCount } });
    const outcome = JSON.parse((finished.content as Array<{ text: string }>)[0].text).result;
    expect(outcome).toMatchObject({ toStatus: 'todo', statusChangedCount: before.statusChangedCount + 1, nextRecurrenceAt: expect.any(String) });
    const after = await show();
    expect((after.structuredContent as unknown as import('./data').TasksView).items[0]).toMatchObject({ status: 'todo', nextOccurrence: outcome.nextRecurrenceAt });
    expect((after.content as Array<{ text: string }>)[0].text).toMatch(/Water the plants \(done for now, next \d{4}-\d{2}-\d{2}\)/);
    // Once its date has passed, it's due again and looks it.
    const { tasksView } = await import('./data');
    const later = new Date(new Date(outcome.nextRecurrenceAt).getTime() + 86_400_000);
    expect(tasksView({ ids: [plants.id] }, later).items[0].nextOccurrence).toBeNull();
  });

  it('shows every named task, and says when a filter finds more than it shows', async () => {
    const q = await import('@/lib/db/queries');
    const made = Array.from({ length: 30 }, (_, index) => q.createTask({ title: `Task ${index + 1}` }));
    const client = await assistant();
    const named = (await client.callTool({ name: 'show_tasks', arguments: { ids: made.map(task => task.id) } })).structuredContent as unknown as import('./data').TasksView;
    expect(named.items).toHaveLength(30);
    expect(named.more).toBe(false);
    const filtered = (await client.callTool({ name: 'show_tasks', arguments: { limit: 5 } })).structuredContent as unknown as import('./data').TasksView;
    expect(filtered.items).toHaveLength(5);
    expect(filtered.more).toBe(true);
  });

  it('says there’s no deck without making one', async () => {
    const client = await assistant();
    const result = await client.callTool({ name: 'show_deck', arguments: {} });
    expect(result.structuredContent).toMatchObject({ view: 'deck', items: [], forDate: null, isToday: false });
    expect((result.content as Array<{ text: string }>)[0].text).toContain('There is no deck yet');
    const q = await import('@/lib/db/queries');
    expect(q.getLatestDeck()).toBeNull();
  });
});
