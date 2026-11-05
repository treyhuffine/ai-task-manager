import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ConfirmOptions } from '@/components/ui/confirm-dialog';
import { WorkContext, type WorkActivity, type WorkNavigation } from '@/contexts/work-context';
import type { ChatSessionWithExecution } from '@/lib/api/dto/records';
import { ApiError } from '@/lib/api/client';
import { useArchiveExecution, type ArchiveExecutionArgs } from './use-archive-execution';

const mocks = vi.hoisted(() => ({ archive: vi.fn(), confirm: vi.fn(), error: vi.fn(), requestView: vi.fn() }));
vi.mock('@/lib/api/sessions', () => ({ sessionsApi: { archive: mocks.archive } }));
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => mocks.confirm }));
vi.mock('@/components/executions/workbench/view-request', () => ({ requestWorkbenchView: mocks.requestView }));
vi.mock('sonner', () => ({ toast: { error: mocks.error } }));
vi.mock('@/lib/file-icons', () => ({ fileIconUrl: () => '', folderIconUrl: () => '', iconForFile: () => '', iconForFolder: () => '' }));

const RAIL_KEY = ['sessions', 'rail'];
const session = { id: 'chat', executionId: 'execution', workspaceId: 'agent', status: 'archived' } as ChatSessionWithExecution;
const chat: ArchiveExecutionArgs = { id: 'chat', executionId: 'execution', workspaceId: 'agent', label: 'Chat' };
const dirty = new ApiError(409, {
  code: 'dirty_worktree', label: 'Server label', files: [{ path: 'draft.txt', change: 'untracked' }], omitted: 0,
}, '/api/sessions/chat/archive');
let client: QueryClient;
let navigation: WorkNavigation;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.archive.mockReset().mockResolvedValue(session);
  mocks.confirm.mockReset().mockResolvedValue(false);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(RAIL_KEY, { sessions: [{ id: 'chat' }, { id: 'other-chat' }] });
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

/** Every navigation the hook could make, as calls so far. */
function navigations() {
  return {
    openAgent: vi.mocked(navigation.openAgent).mock.calls,
    goHome: vi.mocked(navigation.goHome).mock.calls,
    openExecution: vi.mocked(navigation.openExecution).mock.calls,
    leaveChat: navigation.leaveChat ? vi.mocked(navigation.leaveChat).mock.calls : [],
  };
}
const NONE = { openAgent: [], goHome: [], openExecution: [], leaveChat: [] };
const LEFT_FOR_AGENT = { ...NONE, openAgent: [['agent']] };

/** A request that resolves only when the test says so. */
function heldRequest() {
  let finish!: (value: ChatSessionWithExecution) => void;
  let fail!: (err: unknown) => void;
  mocks.archive.mockReturnValueOnce(new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
  return { finish: (value = session) => finish(value), fail: (err: unknown) => fail(err) };
}

const railIds = () => (client.getQueryData<{ sessions: { id: string }[] }>(RAIL_KEY)?.sessions ?? []).map(s => s.id);

it('leaves the open execution for its agent on the click, before the request starts', async () => {
  const request = heldRequest();
  const result = archiveHook().archive(chat);
  expect(navigations()).toEqual(LEFT_FOR_AGENT);
  expect(mocks.archive).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(mocks.archive).toHaveBeenCalledWith('chat', { force: false }));
  request.finish();
  expect(await result).toBe(true);
  expect(navigations()).toEqual(LEFT_FOR_AGENT);
});

it('moves nobody when the request returns, after they have gone somewhere else', async () => {
  const request = heldRequest();
  const result = archiveHook().archive(chat);
  await vi.waitFor(() => expect(mocks.archive).toHaveBeenCalled());
  // The person carries on from the agent to something else.
  vi.mocked(navigation.openAgent).mockClear();
  request.finish();
  expect(await result).toBe(true);
  expect(navigations()).toEqual(NONE);
});

it('leaves when a rail row archives the execution of an open sibling chat', () => {
  void archiveHook({ activeSessionId: 'sibling' }).archive(chat);
  expect(navigations()).toEqual(LEFT_FOR_AGENT);
});

it.each([
  { activeSessionId: 'other-chat', activeExecutionId: 'other-execution' },
  { activeSessionId: null, activeExecutionId: null },
  // A stale execution id with no chat on screen isn't an open execution.
  { activeSessionId: null, activeExecutionId: 'execution' },
])('never moves the viewer when an execution that is not on screen is archived: %j', async activity => {
  const request = heldRequest();
  const result = archiveHook(activity).archive(chat);
  expect(navigations()).toEqual(NONE);
  await vi.waitFor(() => expect(mocks.archive).toHaveBeenCalled());
  request.finish();
  expect(await result).toBe(true);
  expect(navigations()).toEqual(NONE);
});

it('goes Home on the click when the execution has no agent', async () => {
  const result = archiveHook().archive({ ...chat, workspaceId: null });
  expect(navigations()).toEqual({ ...NONE, goHome: [[]] });
  expect(await result).toBe(true);
  expect(navigations()).toEqual({ ...NONE, goHome: [[]] });
});

it("leaves through the view's own way out where it has one (a chat beside an agent)", async () => {
  navigation.leaveChat = vi.fn();
  const result = archiveHook().archive(chat);
  expect(navigations()).toEqual({ ...NONE, leaveChat: [['agent']] });
  expect(await result).toBe(true);
  expect(navigations()).toEqual({ ...NONE, leaveChat: [['agent']] });
});

it('asks about uncommitted files wherever the person is, naming the chat, and Archive anyway does not move them', async () => {
  mocks.archive.mockRejectedValueOnce(dirty).mockResolvedValueOnce(session);
  mocks.confirm.mockImplementation(async (options: ConfirmOptions) => {
    expect(options.description).toContain('"Chat" has work that isn\'t committed');
    expect(navigations()).toEqual(LEFT_FOR_AGENT);
    return true;
  });
  expect(await archiveHook().archive(chat)).toBe(true);
  expect(mocks.archive.mock.calls).toEqual([['chat', { force: false }], ['chat', { force: true }]]);
  expect(mocks.confirm).toHaveBeenCalledOnce();
  expect(navigations()).toEqual(LEFT_FOR_AGENT);
});

it("names the chat by the server's label when the caller had none", async () => {
  mocks.archive.mockRejectedValueOnce(dirty);
  await archiveHook().archive({ ...chat, label: ' ' });
  expect((mocks.confirm.mock.calls[0][0] as ConfirmOptions).description).toContain('"Server label" has work');
});

it('Cancel on the uncommitted-files dialog leaves the person where they are and brings the row back', async () => {
  const request = heldRequest();
  const result = archiveHook({ activeSessionId: 'other-chat', activeExecutionId: 'other-execution' }).archive(chat);
  await vi.waitFor(() => expect(mocks.archive).toHaveBeenCalled());
  expect(railIds()).toEqual(['other-chat']);
  request.fail(dirty);
  expect(await result).toBe(false);
  expect(mocks.archive).toHaveBeenCalledOnce();
  expect(mocks.confirm).toHaveBeenCalledOnce();
  expect(railIds()).toEqual(['chat', 'other-chat']);
  expect(navigations()).toEqual(NONE);
});

it('Review changes reopens the chat on its Changes, the one move the dialog makes', async () => {
  mocks.archive.mockRejectedValueOnce(dirty);
  mocks.confirm.mockImplementation(async (options: ConfirmOptions) => {
    options.secondaryAction!.onSelect();
    return false;
  });
  expect(await archiveHook().archive(chat)).toBe(false);
  expect(mocks.requestView).toHaveBeenCalledExactlyOnceWith('chat', 'changes');
  expect(navigations()).toEqual({ ...LEFT_FOR_AGENT, openExecution: [['chat']] });
  expect(mocks.archive).toHaveBeenCalledOnce();
});

it.each([false, true])('a failed archive is a toast naming the chat, the row comes back and nobody moves (forced: %s)', async force => {
  if (force) {
    mocks.archive.mockRejectedValueOnce(dirty).mockRejectedValueOnce(new Error('Archive failed'));
    mocks.confirm.mockResolvedValue(true);
  } else {
    mocks.archive.mockRejectedValueOnce(new Error('Archive failed'));
  }
  expect(await archiveHook({ activeSessionId: 'other-chat', activeExecutionId: 'other-execution' }).archive(chat)).toBe(false);
  expect(mocks.error).toHaveBeenCalledExactlyOnceWith('Couldn\'t archive "Chat"', { description: 'Archive failed' });
  expect(railIds()).toEqual(['chat', 'other-chat']);
  expect(navigations()).toEqual(NONE);
});

it('a failure after leaving the open execution makes no second move', async () => {
  mocks.archive.mockRejectedValueOnce(new Error('Archive failed'));
  expect(await archiveHook().archive({ ...chat, label: null })).toBe(false);
  expect(mocks.error).toHaveBeenCalledExactlyOnceWith("Couldn't archive the chat", { description: 'Archive failed' });
  expect(navigations()).toEqual(LEFT_FOR_AGENT);
});
