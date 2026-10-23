import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { closeLauncher, getLauncherState } from '@/components/workspaces/launcher/launcher-store';

const mocks = vi.hoisted(() => ({ targets: vi.fn(), push: vi.fn(), error: vi.fn(), openExecution: vi.fn(), teams: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/trpc/client', () => ({ trpcClient: { tasks: { continueTargetsGet: { query: mocks.targets } } } }));
vi.mock('@/components/spaces/space-selector', () => ({ useConnectedTeams: (enabled: boolean) => { mocks.teams(enabled); return { data: [{ id: 'team', name: 'Team Huffine' }] }; } }));
vi.mock('@/contexts/work-context', () => ({ useOptionalWorkNavigation: () => ({ openExecution: mocks.openExecution }) }));
vi.mock('@/components/ui/tip', () => ({ Tip: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/lib/api/client', () => ({ apiErrorText: (error: Error) => error.message }));
vi.mock('sonner', () => ({ toast: { error: mocks.error } }));
import { StartWithAgentButton } from './start-with-agent-button';

let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  closeLauncher();
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => { await act(async () => root.unmount()); closeLauncher(); vi.unstubAllGlobals(); });

async function click() {
  await act(async () => {
    document.querySelector('button')!.dispatchEvent(new window.Event('click', { bubbles: true }));
  });
}
async function mount() {
  await act(async () => root.render(createElement(StartWithAgentButton, {
    task: { id: 'private-reference', title: 'Shared title', sourceTeamId: 'team', status: 'todo', body: 'Shared description' },
  })));
}

it('opens the normal launcher with the private reference and cancellation starts nothing', async () => {
  mocks.targets.mockResolvedValue([]);
  await mount();
  await click();
  expect(getLauncherState()).toMatchObject({ open: true, seed: { taskId: 'private-reference', contextTitle: 'Shared title' } });
  expect(getLauncherState().seed?.contextBody).toContain("Don't change its status at Team Huffine unless this person asks");
  closeLauncher();
  expect(getLauncherState().open).toBe(false);
  expect(mocks.push).not.toHaveBeenCalled();
  expect(mocks.targets).toHaveBeenCalledTimes(1);
});

it('retains a failed lookup for retry instead of risking a duplicate chat', async () => {
  mocks.targets.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce([{ executionId: 'existing', sessionId: 'existing-chat', label: 'Earlier work' }]);
  await mount();
  await click();
  expect(getLauncherState().open).toBe(false);
  expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('Try again'));
  await click();
  expect(mocks.openExecution).toHaveBeenCalledExactlyOnceWith('existing-chat');
  expect(getLauncherState().open).toBe(false);
});

it('opens a canonical team task in its own document without a private connection read', async () => {
  await act(async () => root.render(createElement(StartWithAgentButton, {
    task: { id: 'canonical-task', title: 'Shared team work', status: 'todo' }, label: 'Team agent',
  })));
  await click();
  expect(getLauncherState()).toMatchObject({ open: true, seed: { taskId: 'canonical-task', contextTitle: 'Shared team work' } });
  expect(getLauncherState().seed?.contextBody).not.toContain('only this person');
  expect(mocks.teams).toHaveBeenCalledWith(false);
  expect(mocks.push).not.toHaveBeenCalled();
  expect(mocks.targets).not.toHaveBeenCalled();
});

it('continues an existing canonical team chat through the owning document navigation', async () => {
  mocks.targets.mockResolvedValue([{ executionId: 'team-execution', sessionId: 'team-chat', label: 'Shared work' }]);
  await act(async () => root.render(createElement(StartWithAgentButton, {
    task: { id: 'canonical-task', title: 'Shared team work', status: 'in_progress' },
  })));
  await click();
  expect(mocks.openExecution).toHaveBeenCalledExactlyOnceWith('team-chat');
  expect(mocks.push).not.toHaveBeenCalled();
  expect(getLauncherState().open).toBe(false);
});
