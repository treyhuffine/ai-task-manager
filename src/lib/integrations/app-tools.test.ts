import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('./runtime', () => ({ getMcpServerStore: () => ({ list: () => [] }) }));
const { appDescription, appLine, appToolMode, appToolName, describeAppTools, isAppLoaded, planAppTools } = await import('./app-tools');

/**
 * Loading personal apps' tools per chat (docs/personal-apps.md "Loading app tools"): allowed and
 * loaded are separate, so an automatic app costs a chat one line until a request needs it.
 */
describe('planAppTools', () => {
  const toolkits = ['gmail', 'app_reading_log', 'app_bloom', 'app_finances'];

  it('lists connectors directly and keeps every app automatic by default', () => {
    expect(planAppTools(toolkits, null, true)).toEqual({ direct: ['gmail'], automatic: ['app_reading_log', 'app_bloom', 'app_finances'] });
  });

  it('lists an app switched on directly, and leaves an app switched off out entirely', () => {
    const tools = { modes: { app_bloom: 'on' as const, app_finances: 'off' as const } };
    expect(planAppTools(toolkits, tools, true)).toEqual({ direct: ['gmail', 'app_bloom'], automatic: ['app_reading_log'] });
  });

  it('lists apps directly when there is no chat to remember a load in', () => {
    expect(planAppTools(toolkits, null, false)).toEqual({ direct: toolkits, automatic: [] });
  });
});

describe('a chat\'s switch', () => {
  it('reads automatic, on and off, and what is loaded', () => {
    const tools = { modes: { app_bloom: 'on' as const, app_finances: 'off' as const }, loaded: ['app_reading_log', 'app_finances'] };
    expect(appToolMode(tools, 'app_reading_log')).toBe('auto');
    expect(appToolMode(tools, 'app_bloom')).toBe('on');
    expect(isAppLoaded(tools, 'app_reading_log')).toBe(true);
    expect(isAppLoaded(tools, 'app_bloom')).toBe(true);
    // Off wins over a load from before it was switched off.
    expect(isAppLoaded(tools, 'app_finances')).toBe(false);
    expect(isAppLoaded(null, 'app_reading_log')).toBe(false);
  });
});

describe('what the model sees of an app', () => {
  const toolkit = {
    id: 'app_reading_log', displayName: 'Reading Log',
    actions: [
      { id: 'app_reading_log.list_books', description: 'List books', input: z.object({ status: z.string().optional() }) },
      { id: 'app_reading_log.save_book', description: 'Add a book', input: z.object({ title: z.string() }) },
      { id: 'app_reading_log.hidden', description: 'App only', input: z.object({}), modelVisible: false },
    ],
  };

  it('is one line, its name and what it does, until it is loaded', () => {
    expect(appLine(toolkit, 'Track what you read.')).toBe('app_reading_log: Reading Log. Track what you read.');
    expect(appDescription(toolkit as never)).toBe('Tools: list_books, save_book');
  });

  it('describes its tools with input schemas when loaded, without the ones only its screens use', () => {
    const described = describeAppTools(toolkit as never);
    expect(described.tools.map(tool => tool.name)).toEqual(['list_books', 'save_book']);
    expect(described.tools[1]).toMatchObject({ description: 'Add a book', input_schema: { type: 'object', properties: { title: { type: 'string' } } } });
    expect(appToolName('app_reading_log.save_book')).toBe('save_book');
  });
});

describe('apps loaded straight away for a message', () => {
  it('describes an app the person @-tagged or has open beside the chat, once, and only one this chat may use', async () => {
    vi.resetModules();
    const toolkit = (id: string, name: string) => ({ id, providerId: id, displayName: name, actions: [{ id: `${id}.list`, description: 'List', input: z.object({}) }] });
    const runtime = { getToolkits: () => [toolkit('app_reading_log', 'Reading Log'), toolkit('app_bloom', 'Bloom'), toolkit('gmail', 'Gmail')] };
    vi.doMock('./runtime', () => ({
      getMcpServerStore: () => ({ list: () => [] }),
      getIntegrationRuntime: async () => runtime,
      getIntegrationOwnerId: () => 'local',
      resolveWorkspaceIntegrationFilter: async () => ({ toolkits: [], connectionPins: {}, allowedAccounts: {} }),
    }));
    // Ri's own chats may use Reading Log, not Bloom (no connection of its own).
    vi.doMock('./workspace-filter', () => ({ resolveRiIntegrationFilter: async () => ({ toolkits: ['app_reading_log', 'gmail'], connectionPins: { app_reading_log: 'c-ri' } }) }));
    const q = await import('@/lib/db/queries');
    const { encodeSource, sourceMarker } = await import('@/lib/chat-sources/reference');
    const { messageAppToolsContext } = await import('./app-tools');
    const chat = q.createChatSession({ harness: 'claude', type: 'orchestration' });
    const mention = (toolkitId: string) => sourceMarker(encodeSource({ v: 1, kind: 'integration', toolkitId, account: { accountId: 'place:ri', authConfigId: null } }));

    const first = await messageAppToolsContext(chat.id, `What am I reading? ${mention('app_reading_log')} ${mention('app_bloom')}`, null);
    expect(first).toContain('<ri-app-tools>');
    expect(first).toContain('"name":"Reading Log"');
    expect(first).not.toContain('Bloom');
    expect(q.getChatSession(chat.id)?.appTools).toEqual({ loaded: ['app_reading_log'] });
    // Already loaded in this chat: not described again.
    expect(await messageAppToolsContext(chat.id, mention('app_reading_log'), null)).toBe('');

    // Open beside the chat: its screen's context names it. Off in this chat: never described.
    const other = q.createChatSession({ harness: 'claude', type: 'orchestration' });
    expect(await messageAppToolsContext(other.id, 'Add this one', [{ sourceRef: encodeSource({ v: 1, kind: 'integration', toolkitId: 'app_reading_log', account: { accountId: 'place:ri', authConfigId: null } }) }])).toContain('Reading Log');
    const off = q.createChatSession({ harness: 'claude', type: 'orchestration' });
    q.updateChatSession(off.id, { appTools: { modes: { app_reading_log: 'off' } } });
    expect(await messageAppToolsContext(off.id, mention('app_reading_log'), null)).toBe('');
    vi.doUnmock('./runtime');
    vi.doUnmock('./workspace-filter');
  });
});
