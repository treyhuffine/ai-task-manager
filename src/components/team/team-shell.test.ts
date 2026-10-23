import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  space: null as { id: string; name: string; status: string } | null,
  me: { isLoading: false, data: undefined, error: undefined as { status?: number; code?: string } | undefined, refetch: vi.fn() },
}));
vi.mock('@/components/home/home-context', () => ({ HomeBoundary: ({ children }: { children: ReactNode }) => children }));
vi.mock('./use-team', () => ({ useTeamMe: () => mocks.me }));
vi.mock('@/hooks/use-execution', () => ({ useSession: () => ({}) }));
vi.mock('@/hooks/use-workspaces', () => ({ useWorkspaces: () => ({ data: [] }) }));
vi.mock('@/components/agents/agent-view', () => ({ AgentView: () => null }));
vi.mock('@/components/executions/execution-view', () => ({ ExecutionView: () => null }));
vi.mock('@/components/mobile/mobile-agents-view', () => ({ MobileAgentsView: () => null }));
vi.mock('@/components/workspaces/launcher/launch-modal', () => ({ LaunchModal: () => null }));
vi.mock('@/components/home/team-work-boundary', () => ({ TeamWorkBoundary: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/spaces/space-root', () => ({ useSpace: () => mocks.space }));
vi.mock('@/lib/api/client', async original => ({ ...await original<typeof import('@/lib/api/client')>(), apiErrorStatus: (error: { status?: number }) => error?.status, apiErrorCode: (error: { code?: string }) => error?.code, apiErrorText: () => 'Sign-in ended.' }));
vi.mock('@/hooks/use-areas', () => ({ useAreas: vi.fn() }));
vi.mock('@/hooks/use-notes', () => ({ useCreateNote: vi.fn() }));
vi.mock('@/hooks/use-tasks', () => ({ useCreateTask: vi.fn() }));
vi.mock('./team-board', () => ({ TeamBoard: () => null }));
vi.mock('@/components/notes/note-list', () => ({ NoteList: () => null }));
vi.mock('./team-chat', () => ({ TeamChat: () => null }));
vi.mock('./team-record-controls', () => ({ TeamRecordControls: () => null }));
vi.mock('./team-settings', () => ({ TeamSettings: () => null }));
vi.mock('./team-search', () => ({ TeamSearch: () => null }));
vi.mock('@/components/spaces/space-selector', () => ({ SpaceSelector: () => null }));
import { TeamHome } from '@/components/home/team-home';

beforeEach(() => {
  mocks.space = { id: 'team-fixture', name: 'Team Huffine', status: 'active' };
  mocks.me.isLoading = false;
  mocks.me.error = undefined;
});
const render = () => renderToStaticMarkup(createElement(TeamHome));

it('can return to My Ri before a slow team responds', () => {
  mocks.me.isLoading = true;
  const html = render();
  expect(html).toContain('Waiting for the computer hosting Team Huffine');
  expect(html).toContain('data-slot="skeleton"');
  expect(html).toMatch(/<a href="\/"[^>]*>Back to My Ri<\/a>/);
});

it('can return to My Ri if the team cannot be reached', () => {
  mocks.me.error = { status: 503 };
  const html = render();
  expect(html).toContain('Retry');
  expect(html).toMatch(/<a href="\/"[^>]*>Back to My Ri<\/a>/);
});

it('keeps the recovery route to My Ri settings if team membership has ended', () => {
  mocks.me.error = { code: 'team_signed_out' };
  expect(render()).toContain('Open Settings, Teams');
});

it('does not offer a personal Home link from a standalone team', () => {
  mocks.space = null;
  expect(render()).not.toContain('Back to My Ri');
  mocks.me.isLoading = true;
  expect(render()).toContain('aria-label="Loading Home"');
  expect(render()).not.toContain('Back to My Ri');
});
