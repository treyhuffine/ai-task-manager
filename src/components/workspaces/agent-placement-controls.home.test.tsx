import { teamCapabilities } from '@/lib/team/capabilities';
import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HomeBoundary } from '@/components/home/home-context';
import { trpc } from '@/lib/trpc/client';
import { AgentCreationFolder, AgentPinnedFolder } from './agent-placement-controls';
import type { WorkspaceRecord } from '@/db/types';

it('uses the ordinary server folder picker and names the shared destination', () => {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  cache.setQueryData(trpc.homeContext.queryKey(), {
    home: { id: 'team', kind: 'team', name: 'Shared' }, viewer: { id: 'owner', role: 'owner', name: 'Owner' },
    executionChoices: [{ id: 'team:team', homeId: 'team', name: "This team's server", kind: 'team_server', audience: 'team' }],
    capabilities: { ...teamCapabilities({ role: 'owner', status: 'active' }), privatePlanning: false },
  });
  const html = renderToStaticMarkup(<QueryClientProvider client={cache}><HomeBoundary>
    <AgentCreationFolder cwd="/work/project" onChange={() => {}} onDismiss={() => {}} />
    <AgentPinnedFolder workspace={{ cwd: '/work/project' } as WorkspaceRecord} />
  </HomeBoundary></QueryClientProvider>);
  expect(html).toContain('/work/project');
  expect(html).toContain('Git is detected automatically');
  expect(html).toContain('visible to every team member');
  expect(html).toContain('lucide-folder-open');
  cache.clear();
});
