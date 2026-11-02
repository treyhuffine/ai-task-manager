import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkContext, type WorkActivity, type WorkNavigation } from '@/contexts/work-context';
import type { ChatSessionWithExecution } from '@/lib/api/dto/records';
import { ApiError } from '@/lib/api/client';
import { useArchiveExecution } from './use-archive-execution';

const mocks = vi.hoisted(() => ({ archive: vi.fn(), confirm: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/api/sessions', () => ({ sessionsApi: { archive: mocks.archive } }));
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => mocks.confirm }));
vi.mock('sonner', () => ({ toast: { error: mocks.error } }));
vi.mock('@/lib/file-icons', () => ({ fileIconUrl: () => '', folderIconUrl: () => '', iconForFile: () => '', iconForFolder: () => '' }));

const session = { id: 'chat', executionId: 'execution', workspaceId: 'agent', status: 'archived' } as ChatSessionWithExecution;
const dirty = new ApiError(409, {
  code: 'dirty_worktree', label: 'Chat', files: [{ path: 'draft.txt', change: 'untracked' }], omitted: 0,
}, '/api/sessions/chat/archive');
let client: QueryClient;
let navigation: WorkNavigation;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.archive.mockReset().mockResolvedValue(session);
  mocks.confirm.mockReset().mockResolvedValue(false);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  navigation = { openAgent: vi.fn(), openExecution: vi.fn(), openTask: vi.fn(), openNote: vi.fn(), goHome: vi.fn() };
});
afterEach(() => client.clear());

function archiveHook(activity: Partial<WorkActivity> = {}) {
  const capture = vi.fn<(hook: ReturnType<typeof useArchiveExecution>) => void>();
  function Harness() { capture(useArchiveExecution()); return null; }
  renderToStaticMarkup(createElement(QueryClientProvider, { client },
    createElement(WorkContext, { navigation, activity: {
      activeSessionId: 'chat', activeExecutionId: 'execution', streamingSessionIds: new Set<string>(),
      backgroundSessionIds: new Set<string>(), pendingInputSessionIds: new Set<string>(),
      setActiveExecutionId: vi.fn(), setSessionStreaming: vi.fn(), ...activity,
    } }, createElement(Harness)),
  ));
  return capture.mock.calls[0][0];
}

function expectNoNavigation() {
  expect(navigation.openAgent).not.toHaveBeenCalled();
  expect(navigation.goHome).not.toHaveBeenCalled();
}

it('returns to the owning agent after the open execution is archived successfully', async () => {
  let finish!: (value: ChatSessionWithExecution) => void;
  mocks.archive.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const result = archiveHook().archive({ id: 'chat', label: 'Chat' });
  expectNoNavigation();
  // The archive mutation starts after its optimistic cache update.
  await vi.waitFor(() => expect(mocks.archive).toHaveBeenCalled());
  finish(session);
  expect(await result).toBe(true);
  expect(navigation.openAgent).toHaveBeenCalledExactlyOnceWith('agent');
  expect(navigation.goHome).not.toHaveBeenCalled();
});

it('returns to the agent when a rail row archives the execution of an open sibling chat', async () => {
  expect(await archiveHook({ activeSessionId: 'sibling' }).archive({ id: 'chat', label: 'Chat' })).toBe(true);
  expect(navigation.openAgent).toHaveBeenCalledExactlyOnceWith('agent');
});

it.each([
  { activeSessionId: 'other-chat', activeExecutionId: 'other-execution' },
  { activeSessionId: null, activeExecutionId: null },
])('keeps the current screen when another execution is archived: %j', async activity => {
  expect(await archiveHook(activity).archive({ id: 'chat', label: 'Chat' })).toBe(true);
  expectNoNavigation();
});

it('returns Home if the archived execution has no owning agent', async () => {
  mocks.archive.mockResolvedValue({ ...session, workspaceId: null });
  expect(await archiveHook().archive({ id: 'chat', label: 'Chat' })).toBe(true);
  expect(navigation.goHome).toHaveBeenCalledOnce();
  expect(navigation.openAgent).not.toHaveBeenCalled();
});

it('returns to the agent after confirming archive with uncommitted files', async () => {
  mocks.archive.mockRejectedValueOnce(dirty).mockResolvedValueOnce(session);
  mocks.confirm.mockImplementation(async () => { expectNoNavigation(); return true; });
  expect(await archiveHook().archive({ id: 'chat', label: 'Chat' })).toBe(true);
  expect(mocks.archive.mock.calls).toEqual([['chat', { force: false }], ['chat', { force: true }]]);
  expect(navigation.openAgent).toHaveBeenCalledExactlyOnceWith('agent');
});

it('keeps the execution open when the uncommitted-files dialog is cancelled', async () => {
  mocks.archive.mockRejectedValueOnce(dirty);
  expect(await archiveHook().archive({ id: 'chat', label: 'Chat' })).toBe(false);
  expect(mocks.archive).toHaveBeenCalledTimes(1);
  expect(mocks.confirm).toHaveBeenCalledOnce();
  expectNoNavigation();
});

it.each([false, true])('keeps the execution open if archive fails (forced: %s)', async force => {
  if (force) {
    mocks.archive.mockRejectedValueOnce(dirty).mockRejectedValueOnce(new Error('Archive failed'));
    mocks.confirm.mockResolvedValue(true);
  } else {
    mocks.archive.mockRejectedValueOnce(new Error('Archive failed'));
  }
  expect(await archiveHook().archive({ id: 'chat', label: 'Chat' })).toBe(false);
  expect(mocks.error).toHaveBeenCalledWith("Couldn't archive execution", { description: 'Archive failed' });
  expectNoNavigation();
});
