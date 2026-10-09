import { afterEach, expect, it, vi } from 'vitest';
const spies = vi.hoisted(() => ({ integration: vi.fn(async () => []), local: vi.fn(async () => []), loadedLocal: vi.fn(), surfaceKind: null as string | null }));
vi.mock('@/lib/chat-sources/integration-adapter', () => ({ integrationSourceAdapter: { kind: 'integration', list: spies.integration } }));
vi.mock('@/lib/local-apps/source-adapter', () => { spies.loadedLocal(); return { localAppSourceAdapter: { kind: 'app', list: spies.local }, sourceChatAllowed: () => true }; });
vi.mock('@/lib/db/queries', () => ({ getChatEventById: () => null, getChatSessionWithExecution: () => ({ status: 'active', harness: 'claude', workspaceId: null, surfaceKind: spies.surfaceKind }) }));
import { chatSources } from '@/lib/server/chat-sources';
afterEach(() => { delete process.env.RI_LOCAL_APPS; delete process.env.RI_CHAT_SOURCES; spies.surfaceKind = null; vi.clearAllMocks(); });
it.each([[false, false], [true, false], [false, true], [true, true]])('keeps chat sources=%s independent from local apps=%s', async (sources, apps) => {
  process.env.RI_CHAT_SOURCES = sources ? '1' : '0'; process.env.RI_LOCAL_APPS = apps ? '1' : '0';
  await chatSources.search('chat', '');
  expect(spies.integration).toHaveBeenCalledTimes(sources ? 1 : 0);
  expect(spies.local).toHaveBeenCalledTimes(sources && apps ? 1 : 0);
  if (!sources || !apps) expect(spies.loadedLocal).not.toHaveBeenCalled();
});

it.each(['0', '1'])('does not expose connected or local sources to result reviewers with local apps=%s', async (localApps) => {
  process.env.RI_CHAT_SOURCES = '1';
  process.env.RI_LOCAL_APPS = localApps;
  spies.surfaceKind = 'result_review';
  await expect(chatSources.search('reviewer', '')).rejects.toMatchObject({ code: 'unavailable' });
  await expect(chatSources.resolve('reviewer', [], { qualified: true })).rejects.toMatchObject({ code: 'unavailable' });
  expect(spies.integration).not.toHaveBeenCalled();
  expect(spies.local).not.toHaveBeenCalled();
});
