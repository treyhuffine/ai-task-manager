import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeSource, encodeSource } from '@/lib/chat-sources/reference';

const mocks = vi.hoisted(() => ({ metadata: vi.fn(), authority: vi.fn(), wouldAsk: vi.fn(), enabled: vi.fn() }));
vi.mock('@/lib/integrations/source-metadata', () => ({ integrationSourceMetadata: mocks.metadata }));
vi.mock('@/lib/integrations/runtime', () => ({ getIntegrationOwnerId: () => 'local', readWouldAsk: mocks.wouldAsk }));
vi.mock('@/lib/integrations/approval', () => ({ sessionCaller: (id: string) => ({ type: 'mcp', id: `session:${id}` }) }));
vi.mock('./service', () => ({ authority: mocks.authority, mcpAppsEnabled: mocks.enabled }));
import { mentionItem, readMentionedResource, searchAppMentions, searchRefusal, MENTIONS_PER_APP } from './mentions';

const chatId = '01900111-1111-7111-8111-111111111111';
const account = { v: 1 as const, kind: 'integration' as const, toolkitId: 'mcp_bits_bolts', account: { accountId: 'bits_bolts', authConfigId: null } };
const accountRef = encodeSource(account);

// Bits & Bolts as it runs: its library (36 parts, `mcp://bits-and-bolts/parts/<id>`), its
// `search_mentions` tool as the OpenAI SDK registers it (typescript/src/server/mentions.ts),
// and its handler (plugins/bits-and-bolts/src/server/register.ts), which returns up to 30
// resource links named by file and titled by part.
const parts = Array.from({ length: 36 }, (_, i) => ({ id: `part_${i}`, name: i === 0 ? 'Translucent agent keycap (1U)' : `Part ${i}`, fileName: i === 0 ? 'keycap-agent.stl' : `part-${i}.stl`, description: 'Recreated in Blender from official product photos.' }));
const bitsAndBoltsSearch = ({ query }: { query: string }) => ({ items: parts.filter(part => [part.id, part.name, part.fileName, part.description].join(' ').toLowerCase().includes(query.trim().toLowerCase())).slice(0, 30)
  .map(part => ({ type: 'resource_link', uri: `mcp://bits-and-bolts/parts/${part.id}`, name: part.fileName, title: part.name, mimeType: 'text/markdown' })) });
const searchTool = { name: 'search_mentions', annotations: { readOnlyHint: true }, _meta: { 'openai/extensions': { 'mentions/search': {} }, ui: { visibility: ['app'] } } };
const icon = { src: 'data:image/svg+xml,%3Csvg%2F%3E', mimeType: 'image/svg+xml', theme: 'dark' as const };

let servers: { entry: Record<string, unknown>; capabilities: { tools: Record<string, unknown>[] } }[];
let runAction: ReturnType<typeof vi.fn>, readResource: ReturnType<typeof vi.fn>;
const bitsAndBolts = (id = 'bits', overrides: Record<string, unknown> = {}) => ({
  entry: { id, slug: id === 'bits' ? 'bits_bolts' : id, displayName: id === 'bits' ? 'Bits & Bolts' : id, enabled: true, url: 'http://localhost:3917/mcp',
    protocol: { checkedAt: 'now', extensions: { 'openai/mentions': { searchTool: 'search_mentions' } }, info: { icons: [icon] } }, ...overrides },
  capabilities: { tools: [searchTool, { name: 'cad.browse' }] },
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.enabled.mockReturnValue(true);
  mocks.wouldAsk.mockReturnValue(false);
  servers = [bitsAndBolts()];
  mocks.metadata.mockImplementation(async () => ({ servers, toolkits: [], connections: [{ id: 'mcp-bits_bolts', providerId: 'mcp_bits_bolts', accountId: 'bits_bolts', status: 'active', label: 'Bits & Bolts' }] }));
  runAction = vi.fn(async (_action: string, input: { query: string }, options: { captureOriginalResult(value: unknown): void }) => {
    options.captureOriginalResult({ content: [], structuredContent: bitsAndBoltsSearch(input) });
    return { ok: true };
  });
  readResource = vi.fn(async ({ uri }: { uri: string }) => ({ contents: [{ uri, mimeType: 'text/markdown', text: '# Translucent agent keycap (1U)\n\nRecreated in Blender from official product photos.\n\nTags: keycap, agent' }] }));
  mocks.authority.mockImplementation(async () => ({ runtime: { runAction }, connection: { id: 'mcp-bits_bolts' }, sourceRef: accountRef, transport: { tools: [searchTool], readResource } }));
});
afterEach(() => { vi.useRealTimers(); });

describe('@ search items', () => {
  it('normalizes resource links and OpenAI resource items, and drops anything else on its own', () => {
    const link = mentionItem({ type: 'resource_link', uri: 'mcp://bits-and-bolts/parts/part_0', name: 'keycap-agent.stl', title: 'Translucent agent keycap (1U)', description: 'A keycap', mimeType: 'text/markdown', icons: [icon, { src: 'javascript:alert(1)' }] }, account)!;
    expect(link).toEqual({ sourceRef: expect.any(String), uri: 'mcp://bits-and-bolts/parts/part_0', title: 'Translucent agent keycap (1U)', name: 'keycap-agent.stl', subtitle: 'A keycap', mimeType: 'text/markdown', icons: [icon] });
    expect(decodeSource(link.sourceRef)).toEqual({ ...account, resource: { uri: 'mcp://bits-and-bolts/parts/part_0', title: 'Translucent agent keycap (1U)', name: 'keycap-agent.stl' } });
    expect(mentionItem({ type: 'resource', resourceUri: 'cad://parts/washer', title: 'M6 washer', subtitle: 'Hardware' }, account)).toMatchObject({ uri: 'cad://parts/washer', title: 'M6 washer', subtitle: 'Hardware' });
    expect(mentionItem({ type: 'resource_link', uri: 'cad://a', name: 'a', title: 'x'.repeat(500) }, account)!.title).toHaveLength(120);
    for (const bad of [{ type: 'resource_link', uri: 'cad://a' }, { type: 'resource_link', uri: 'not a uri', name: 'x' }, { type: 'resource', resourceUri: 'cad://a' },
      { type: 'text', text: 'hi' }, null, 'cad://a', { type: 'resource_link', uri: `cad://${'x'.repeat(2000)}`, name: 'x' }])
      expect(mentionItem(bad, account)).toBeNull();
  });

  it('refuses a search tool that is not read-only, not visible to apps, off, or set to ask first', () => {
    expect(searchRefusal(searchTool, true, false)).toBeNull();
    expect(searchRefusal({ ...searchTool, _meta: {} }, true, false)).toBeNull();
    expect(searchRefusal(undefined, true, false)).toMatch('does not list');
    expect(searchRefusal({ ...searchTool, annotations: {} }, true, false)).toMatch('read-only');
    expect(searchRefusal({ ...searchTool, _meta: { ui: { visibility: ['model'] } } }, true, false)).toMatch('available to apps');
    expect(searchRefusal(searchTool, false, false)).toMatch('turned off');
    expect(searchRefusal(searchTool, true, true)).toMatch('Ask first');
  });
});

describe('searchAppMentions', () => {
  it('asks Bits & Bolts with the query, as the app, on its exact account, and caps its items', async () => {
    const result = await searchAppMentions(chatId, 'part');
    expect(runAction).toHaveBeenCalledWith('mcp.bits_bolts.search_mentions', { query: 'part' }, expect.objectContaining({
      connectionId: 'mcp-bits_bolts', allowedConnectionIds: ['mcp-bits_bolts'], toolAudience: 'app', caller: { type: 'mcp', id: `session:${chatId}` } }));
    expect(mocks.authority).toHaveBeenCalledWith('bits', chatId);
    expect(result.skipped).toEqual([]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({ serverId: 'bits', app: 'Bits & Bolts', icons: [icon] });
    expect(result.groups[0].items).toHaveLength(MENTIONS_PER_APP);
    expect(result.groups[0].items[0]).toMatchObject({ uri: 'mcp://bits-and-bolts/parts/part_0', title: 'Translucent agent keycap (1U)', name: 'keycap-agent.stl' });
  });

  it('passes an empty query through, as OpenAI\'s search allows', async () => {
    await searchAppMentions(chatId, '');
    expect(runAction.mock.calls[0][1]).toEqual({ query: '' });
  });

  it('skips a server whose tool breaks the spec without calling it, and keeps the others', async () => {
    servers = [bitsAndBolts(), { ...bitsAndBolts('writer'), capabilities: { tools: [{ ...searchTool, annotations: { readOnlyHint: false } }] } }];
    const result = await searchAppMentions(chatId, 'keycap');
    expect(result.groups.map(group => group.serverId)).toEqual(['bits']);
    expect(result.skipped).toEqual([{ serverId: 'writer', app: 'writer', reason: 'Its search tool is not marked read-only.' }]);
    expect(runAction).toHaveBeenCalledTimes(1);
  });

  it('never runs a search the person set to ask first, so typing raises no approvals', async () => {
    mocks.wouldAsk.mockReturnValue(true);
    const result = await searchAppMentions(chatId, 'keycap');
    expect(result.groups).toEqual([]);
    expect(result.skipped[0].reason).toMatch('Ask first');
    expect(runAction).not.toHaveBeenCalled();
    expect(mocks.wouldAsk).toHaveBeenCalledWith('mcp.bits_bolts.search_mentions', { id: 'mcp-bits_bolts', providerId: 'mcp_bits_bolts' });
  });

  it('leaves out an app the chat may not use', async () => {
    mocks.authority.mockRejectedValueOnce(new Error('This exact account is not available to this chat'));
    const result = await searchAppMentions(chatId, 'keycap');
    expect(result).toEqual({ groups: [], skipped: [{ serverId: 'bits', app: 'Bits & Bolts', reason: 'This exact account is not available to this chat' }] });
  });

  it('goes on without a slow server after three seconds', async () => {
    vi.useFakeTimers();
    servers = [bitsAndBolts(), bitsAndBolts('slow', { slug: 'slow' })];
    mocks.authority.mockImplementation(async (serverId: string) => ({
      runtime: { runAction: serverId === 'slow' ? vi.fn(() => new Promise(() => {})) : runAction },
      connection: { id: `mcp-${serverId}` }, sourceRef: accountRef, transport: { tools: [searchTool], readResource },
    }));
    const pending = searchAppMentions(chatId, 'keycap');
    await vi.advanceTimersByTimeAsync(3_000);
    const result = await pending;
    expect(result.groups.map(group => group.serverId)).toEqual(['bits']);
    expect(result.skipped).toEqual([{ serverId: 'slow', app: 'slow', reason: 'It did not answer in time.' }]);
  });

  it('drops invalid items and duplicates, and reports a server that returns no list', async () => {
    runAction.mockImplementationOnce(async (_a: string, _i: unknown, options: { captureOriginalResult(value: unknown): void }) => {
      options.captureOriginalResult({ content: [], structuredContent: { items: [{ type: 'resource_link', uri: 'cad://a', name: 'a' }, { type: 'resource_link', uri: 'cad://a', name: 'a' }, { type: 'bogus' }] } });
      return { ok: true };
    });
    expect((await searchAppMentions(chatId, 'x')).groups[0].items.map(item => item.uri)).toEqual(['cad://a']);
    runAction.mockImplementationOnce(async (_a: string, _i: unknown, options: { captureOriginalResult(value: unknown): void }) => { options.captureOriginalResult({ content: [] }); return { ok: true }; });
    expect((await searchAppMentions(chatId, 'x')).skipped[0].reason).toBe('Its search returned no items list.');
  });

  it('does nothing when connected apps are off for this Home', async () => {
    mocks.enabled.mockReturnValue(false);
    expect(await searchAppMentions(chatId, 'keycap')).toEqual({ groups: [], skipped: [] });
    expect(mocks.metadata).not.toHaveBeenCalled();
  });
});

describe('readMentionedResource', () => {
  const mention = { ...account, resource: { uri: 'mcp://bits-and-bolts/parts/part_0', title: 'Translucent agent keycap (1U)', name: 'keycap-agent.stl' } };

  it('reads the item through the server, on the account, for this chat', async () => {
    expect(await readMentionedResource(mention, chatId)).toEqual({ app: 'Bits & Bolts', title: 'Translucent agent keycap (1U)', uri: 'mcp://bits-and-bolts/parts/part_0', name: 'keycap-agent.stl',
      mimeType: 'text/markdown', content: '# Translucent agent keycap (1U)\n\nRecreated in Blender from official product photos.\n\nTags: keycap, agent' });
    expect(mocks.authority).toHaveBeenCalledWith('bits', chatId);
    expect(readResource).toHaveBeenCalledWith({ uri: 'mcp://bits-and-bolts/parts/part_0' });
  });

  it('gives no content once the chat lost the account, and says why', async () => {
    mocks.authority.mockRejectedValueOnce(new Error('This exact account is not available to this chat'));
    const read = await readMentionedResource(mention, chatId);
    expect(read).toMatchObject({ error: 'Ri could not read this item: This exact account is not available to this chat' });
    expect(read.content).toBeUndefined();
    expect(readResource).not.toHaveBeenCalled();
  });

  it('refuses when the server now answers for another account', async () => {
    mocks.authority.mockResolvedValueOnce({ runtime: {}, connection: {}, sourceRef: encodeSource({ ...account, account: { accountId: 'other', authConfigId: null } }), transport: { readResource } });
    expect((await readMentionedResource(mention, chatId)).error).toMatch('account changed');
  });

  it('caps text at 32 KiB, names binary items without their bytes, and says when the app is gone', async () => {
    readResource.mockResolvedValueOnce({ contents: [{ uri: 'x', mimeType: 'text/plain', text: 'é'.repeat(40_000) }] });
    const long = await readMentionedResource(mention, chatId);
    expect(long.truncated).toBe(true);
    expect(new TextEncoder().encode(long.content!).length).toBeLessThanOrEqual(32 * 1024);
    expect(long.content!.endsWith('é')).toBe(true);
    readResource.mockResolvedValueOnce({ contents: [{ uri: 'x', mimeType: 'model/stl', blob: 'AAAA' }] });
    expect(await readMentionedResource(mention, chatId)).toMatchObject({ mimeType: 'model/stl', error: 'This item is binary, so only its name and URI are shared.' });
    servers = [];
    expect((await readMentionedResource(mention, chatId)).error).toBe('The app this item came from is no longer connected.');
  });
});
