import { teamCapabilities } from '@/lib/team/capabilities';
import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HomeBoundary } from '@/components/home/home-context';
import { WorkContext } from '@/contexts/work-context';
import { trpc } from '@/lib/trpc/client';
import { MobileAgentsView } from './mobile-agents-view';
import { TipProvider } from '@/components/ui/tip';

it('renders the ordinary agent directory for a team member without a personal dashboard or owner controls', () => {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  cache.setQueryData(trpc.homeContext.queryKey(), {
    home: { id: 'shared-home', kind: 'team', name: 'Team' }, viewer: { id: 'member', name: 'Maya', role: 'member' }, executionChoices: [],
    capabilities: { ...teamCapabilities({ role: 'member', status: 'active' }), editContent: true, deletePermanently: false, administerMembers: false, privatePlanning: false, configureAgents: false },
  });
  cache.setQueryData(['workspaces', { status: 'active' }], []);
  const noop = () => {};
  const html = renderToStaticMarkup(<QueryClientProvider client={cache}><HomeBoundary><TipProvider><WorkContext
    navigation={{ openAgent: noop, openExecution: noop, openTask: noop, openNote: noop, goHome: noop }}
    activity={{ activeSessionId: null, streamingSessionIds: new Set(), backgroundSessionIds: new Set(), pendingInputSessionIds: new Set(), setActiveExecutionId: noop, setSessionStreaming: noop }}
  ><MobileAgentsView /></WorkContext></TipProvider></HomeBoundary></QueryClientProvider>);
  expect(html).toContain('No agents yet');
  expect(html).toContain('No agents have been set up here yet.');
  expect(html).not.toContain('New agent');
  expect(html).not.toContain('Add one to get started.');
  cache.clear();
});
