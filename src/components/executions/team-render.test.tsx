import { ArtifactPreviewProvider } from '@/components/chat-ui/artifacts/artifact-preview-provider';
// Probe: the ordinary ExecutionHeader (rendered unconditionally by ExecutionView) and AgentOverview's
// SessionRowMenu inside the Team document tree: WorkContext + ConfirmProvider + QueryClient, no DashboardProvider.
import { parseHTML } from 'linkedom';
import { PERMISSION_MODE_META } from '@/lib/permission-modes';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {}, replace() {}, back() {} }), useSearchParams: () => new URLSearchParams(), usePathname: () => '/' }));
vi.mock('@/lib/file-icons', () => ({ fileIconUrl: () => '', folderIconUrl: () => '', iconForFile: () => '', iconForFolder: () => '' }));
import { WorkContext } from '@/contexts/work-context';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { TipProvider } from '@/components/ui/tip';
import { ExecutionHeader } from '@/components/executions/execution-header';
import { SessionRowMenu } from '@/components/workspaces/session-row-menu';

const navigation = { openAgent: () => {}, openExecution: () => {}, openTask: () => {}, openNote: () => {}, goHome: () => {} };
const activity = { activeSessionId: null, streamingSessionIds: new Set<string>(), backgroundSessionIds: new Set<string>(), pendingInputSessionIds: new Set<string>(), setActiveExecutionId: () => {}, setSessionStreaming: () => {} };
const wrap = (child: ReturnType<typeof createElement>) => createElement(QueryClientProvider, { client: new QueryClient() },
  createElement(TipProvider, null, createElement(ConfirmProvider, null, createElement(WorkContext, { navigation, activity }, child))));
const attempt = (child: ReturnType<typeof createElement>) => { try { renderToStaticMarkup(wrap(child)); return 'rendered'; } catch (e) { return String(e); } };

it('ExecutionHeader in a Team document', () => {
  const session = { id: 'team-chat', label: 'Shared', workspaceId: 'agent', executionId: 'exec', status: 'active', harness: 'claude', createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z' } as never;
  expect(attempt(createElement(ExecutionHeader, { session, workspace: undefined, onClose: () => {}, isRunning: false, hasBackgroundTasks: false }))).toBe('rendered');
});

it('SessionRowMenu (AgentOverview chat rows) in a Team document', () => {
  expect(attempt(createElement(SessionRowMenu, { sessionId: 'team-chat', workspaceId: 'agent', isUnread: false, isPinned: false, label: 'Shared' } as never))).toBe('rendered');
});

it('renders loaded ExecutionView, AgentView and AgentOverview in the real Team provider tree', async () => {
  const { createTeamExecutionFixture } = await import('@/test/fixtures/team-execution');
  const fixture = await createTeamExecutionFixture();
  const q = await import('@/lib/db/queries');
  const { trpc } = await import('@/lib/trpc/client');
  const { teamCapabilities } = await import('@/lib/team/capabilities');
  const { HomeBoundary } = await import('@/components/home/home-context');
  const { ExecutionView } = await import('./execution-view');
  const { ExecutionComposer } = await import('./execution-composer');
  const { AgentView } = await import('@/components/agents/agent-view');
  const { AgentOverview } = await import('@/components/agents/agent-overview');
  const { toRailSessionDTOs } = await import('@/lib/api/dto/rail-session');
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  try {
    const { session } = q.createExecutionWithChat({ workspaceId: fixture.workspace.id, harness: 'claude', label: 'Shared execution', worktreePath: fixture.workspace.cwd, surfaceKind: q.TEAM_CHAT_SURFACE, createdByMemberId: fixture.owner.member.id });
    client.setQueryData(trpc.homeContext.queryKey(), { home: { id: q.getHome()!.id, kind: 'team', name: 'Team' }, viewer: fixture.member.member, capabilities: { ...teamCapabilities(fixture.member.member), privatePlanning: false }, executionChoices: [] });
    client.setQueryData(['session', session.id], q.getChatSessionWithExecution(session.id));
    client.setQueryData(['workspaces', fixture.workspace.id], fixture.workspace);
    client.setQueryData(['sessions', 'rail'], { sessions: toRailSessionDTOs(q.listRailSessions()), runningSessionIds: [], pendingSessionIds: [], backgroundSessionIds: [], mainChats: [] });
    const draft = renderToStaticMarkup(<QueryClientProvider client={client}><TipProvider><HomeBoundary><ArtifactPreviewProvider><WorkContext navigation={navigation} activity={activity}><ExecutionComposer sessionId="" permissionMode="auto_all" harness={null} model={null} effort={null} onSend={() => {}} /></WorkContext></ArtifactPreviewProvider></HomeBoundary></TipProvider></QueryClientProvider>);
    const { document } = parseHTML(draft);
    const mode = [...document.querySelectorAll('button')].find(button => button.textContent === PERMISSION_MODE_META.auto_all.shortTitle);
    expect(mode?.hasAttribute('disabled')).toBe(true);
    for (const child of [<ExecutionView key="execution" sessionId={session.id}/>, <AgentView key="agent" workspaceId={fixture.workspace.id}/>, <AgentOverview key="overview" workspace={fixture.workspace} onSelectTab={() => {}}/>]) {
      const html = renderToStaticMarkup(<QueryClientProvider client={client}><TipProvider><ConfirmProvider><HomeBoundary><ArtifactPreviewProvider><WorkContext navigation={navigation} activity={activity}>{child}</WorkContext></ArtifactPreviewProvider></HomeBoundary></ConfirmProvider></TipProvider></QueryClientProvider>);
      expect(html).toContain(child.key === 'agent' ? 'Shared agent' : 'Shared execution');
      expect(html).not.toContain('Opening Home');
      expect(html).not.toContain('This Ri could not be opened');
    }
  } finally { client.clear(); await fixture.cleanup(); }
}, 30_000);
