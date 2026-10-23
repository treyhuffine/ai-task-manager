import { teamCapabilities } from '@/lib/team/capabilities';
import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HomeBoundary } from '@/components/home/home-context';
import { trpc } from '@/lib/trpc/client';
import { HARNESS_IDS } from '@/lib/harness/registry';
import { ModelList } from './model-list';
import { useDefaultSelection } from '@/hooks/use-default-selection';

function cacheFor(role: 'member' | 'owner') {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  cache.setQueryData(trpc.homeContext.queryKey(), {
    home: { id: 'team-home', kind: 'team', name: 'Team' }, viewer: { id: role, name: 'Maya', role }, executionChoices: [],
    capabilities: { ...teamCapabilities({ role, status: 'active' }), privatePlanning: false },
  });
  for (const harness of HARNESS_IDS) {
    const ready = harness === 'codex';
    cache.setQueryData<unknown>(trpc.harness.authGet.queryKey({ body: { harness } }), { binary: { installed: ready }, hasSubscription: ready });
    const models = { models: ready ? [{ id: 'shared-model', label: 'Server model', enabled: true, availability: 'available' }] : [], source: 'config' };
    cache.setQueryData<unknown>(trpc.harness.modelsGet.queryKey({ query: { provider: harness } }), models);
    cache.setQueryData<unknown>(trpc.harness.modelsGet.queryKey({ query: { provider: harness, scope: 'catalog' } }), models);
  }
  return cache;
}
it.each(['member', 'owner'] as const)('uses ordinary server models and server-derived %s controls', role => {
  const cache = cacheFor(role);
  const html = renderToStaticMarkup(<QueryClientProvider client={cache}><HomeBoundary><><ModelList selected={{ harness: 'codex', model: 'shared-model' }} onPick={() => {}} onManageModels={() => {}} /></></HomeBoundary></QueryClientProvider>);
  expect(html).toContain('Server model');
  expect(html).toContain('Manage models');
  if (role === 'member') {
    expect(html).not.toContain('Pin a model ID');
    expect(html).not.toContain('claude auth login');
    expect(html).toContain('owner');
  } else {
    expect(html).toContain('Pin a model ID');
  }
  cache.clear();
});
function Default() {
  const selected = useDefaultSelection();
  return <output>{selected?.harness}:{selected?.model}:{selected?.effort}</output>;
}
it('resolves the current Home default from its ordinary settings', () => {
  const cache = cacheFor('member');
  cache.setQueryData<unknown>(trpc.userState.list.queryKey({}), { defaultHarness: 'codex', defaultModel: 'server-default', defaultEffort: 'low' });
  const html = renderToStaticMarkup(<QueryClientProvider client={cache}><HomeBoundary><Default /></HomeBoundary></QueryClientProvider>);
  expect(html).toContain('codex:server-default:low');
  cache.clear();
});
