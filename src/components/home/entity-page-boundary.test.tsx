import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc/client';
import { teamCapabilities } from '@/lib/team/capabilities';
import { useWorkActivity, useWorkNavigation } from '@/contexts/work-context';
import { HomeBoundary } from './home-context';
import { EntityPageBoundary } from './entity-page-boundary';

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));
vi.mock('@/components/spaces/space-root', () => ({ useSpace: () => null }));
let root: Root, cache: QueryClient, container: HTMLElement;
beforeEach(() => {
  const { document, window } = parseHTML('<html data-ri-authority="personal"><body></body></html>');
  vi.stubGlobal('document', document); vi.stubGlobal('window', window); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); root = createRoot(container);
  cache = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  vi.clearAllMocks();
});
afterEach(async () => { await act(async () => root.unmount()); cache.clear(); vi.unstubAllGlobals(); });
function SharedControl() {
  const navigation = useWorkNavigation(), activity = useWorkActivity();
  return <><button onClick={() => navigation.openNote('a note')}>Open note</button>
    <button onClick={() => activity.setActiveExecutionId('work')}>Track work</button><output>{activity.activeExecutionId ?? 'Idle'}</output></>;
}
async function render(kind: 'task' | 'note', team = false) {
  document.documentElement.dataset.riAuthority = team ? 'team' : 'personal';
  document.documentElement.dataset.riHome = 'home'; document.documentElement.dataset.riViewer = team ? 'member' : 'local';
  cache.setQueryData(trpc.homeContext.queryKey(), { home: { id: 'home', name: 'Home', kind: team ? 'team' : 'personal' }, viewer: { id: team ? 'member' : 'local', name: 'Person', role: team ? 'member' : 'personal' }, executionChoices: [], capabilities: { ...teamCapabilities({ role: 'member', status: 'active' }), privatePlanning: !team } });
  await act(async () => root.render(<QueryClientProvider client={cache}><HomeBoundary><EntityPageBoundary kind={kind} id="record"><SharedControl /></EntityPageBoundary></HomeBoundary></QueryClientProvider>));
}
it.each(['task', 'note'] as const)('provides live shared navigation and activity on a standalone %s page', async kind => {
  await render(kind);
  await act(async () => container.querySelectorAll('button')[0].click());
  expect(navigation.push).toHaveBeenCalledWith('/note/a%20note');
  await act(async () => container.querySelectorAll('button')[1].click());
  expect(container.querySelector('output')?.textContent).toBe('work');
});
it.each(['task', 'note'] as const)('redirects a legacy Team %s URL before mounting personal controls', async kind => {
  await render(kind, true);
  expect(navigation.replace).toHaveBeenCalledWith(`/?${kind}=record`);
  expect(container.querySelector('button')).toBeNull();
});
