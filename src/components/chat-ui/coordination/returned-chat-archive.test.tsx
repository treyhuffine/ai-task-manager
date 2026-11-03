/**
 * The Archive chat control on a returned result: the chat's live state, the
 * shared archive flow (rail removal, the uncommitted-files dialog, leaving
 * the chat on screen), Reopen, and which messages get it at all.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfirmOptions } from '@/components/ui/confirm-dialog';
import { WorkContext, type WorkActivity, type WorkNavigation } from '@/contexts/work-context';
import type { ChatEventRecord } from '@/lib/api/dto/records';
import { ApiError } from '@/lib/api/client';
import { invalidateChatRows, sessionKey } from '@/lib/query/session-keys';
import { AGENT_BLOCKED_INSTRUCTIONS, AGENT_RESPONSE_INSTRUCTIONS } from '@/lib/sessions/chat-message';
import { ChatCapabilities } from '../chat-capabilities';
import { ExecutionEvent } from '../activity/execution-event';
import { ReturnedChatArchive } from './returned-chat-archive';

const server = vi.hoisted(() => ({
  chats: new Map<string, Record<string, unknown>>(),
  archive: vi.fn(),
  continueWork: vi.fn(),
  confirm: vi.fn(),
  error: vi.fn(),
  requestView: vi.fn(),
}));
vi.mock('@/lib/api/sessions', () => ({ sessionsApi: {
  get: async (id: string) => {
    const chat = server.chats.get(id);
    if (!chat) throw Object.assign(new Error('Chat not found'), { status: 404 });
    return { ...chat };
  },
  archive: server.archive,
  continueWork: server.continueWork,
} }));
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => server.confirm }));
vi.mock('@/components/executions/workbench/view-request', () => ({ requestWorkbenchView: server.requestView }));
vi.mock('sonner', () => ({ toast: { error: server.error } }));
vi.mock('@/lib/file-icons', () => ({ fileIconUrl: () => '', folderIconUrl: () => '', iconForFile: () => '', iconForFolder: () => '' }));
vi.mock('@/components/ui/tip', () => ({ Tip: ({ children }: { children: ReactNode }) => children }));
// The link's own rendering is covered with its component. Here it only marks the header.
vi.mock('@/components/chat-ui/messages/chat-message-link', () => ({
  ChatMessageLink: ({ label, sessionId }: { label: string; sessionId: string }) => createElement('a', { 'data-chat-link': sessionId }, label),
}));
vi.mock('@/components/ai-elements/message', () => ({ Message: () => null, MessageContent: () => null, MessageResponse: () => null }));
vi.mock('@/components/chat-ui/messages/copy-message-button', () => ({ CopyMessageButton: () => null }));

const WORK = 'work-chat';
const MAIN = 'main-chat';
const execution = (status: 'active' | 'archived') => ({ id: WORK, type: 'execution', status, executionId: 'execution-1', workspaceId: 'agent-1', label: 'Fix the date tests', execution: { label: 'Fix the date tests' } });
const RAIL_KEY = ['sessions', 'rail'];

let root: Root;
let container: HTMLElement;
let client: QueryClient;
let navigation: WorkNavigation;
let activity: WorkActivity;

beforeEach(() => {
  vi.clearAllMocks();
  server.chats.clear();
  server.chats.set(WORK, execution('active'));
  server.chats.set(MAIN, { id: MAIN, type: 'orchestration', status: 'active', executionId: null, workspaceId: 'agent-1', label: null });
  server.archive.mockReset().mockImplementation(async (id: string) => {
    server.chats.set(id, { ...server.chats.get(id), status: 'archived' });
    return server.chats.get(id);
  });
  server.continueWork.mockReset().mockImplementation(async (id: string) => {
    server.chats.set(id, { ...server.chats.get(id), status: 'active' });
    return server.chats.get(id);
  });
  server.confirm.mockReset().mockResolvedValue(false);
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(RAIL_KEY, { sessions: [{ id: WORK }, { id: 'other' }] });
  navigation = { openAgent: vi.fn(), openExecution: vi.fn(), openTask: vi.fn(), openNote: vi.fn(), goHome: vi.fn() };
  activity = { activeSessionId: MAIN, activeExecutionId: null, streamingSessionIds: new Set(), backgroundSessionIds: new Set(), pendingInputSessionIds: new Set(), setActiveExecutionId: vi.fn(), setSessionStreaming: vi.fn() };
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  vi.unstubAllGlobals();
});

async function render(children: ReactNode) {
  await act(async () => root.render(createElement(QueryClientProvider, { client },
    createElement(ChatCapabilities.Provider, { value: { deliveryReceipts: false, prepareResults: false } },
      createElement(WorkContext, { navigation, activity }, children)))));
  await settle();
}

/** Let queries and mutations finish and React commit what they changed. */
async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

const buttons = (label: string) => [...container.querySelectorAll('button')].filter(element => element.textContent === label);

async function click(label: string, index = 0) {
  const target = buttons(label)[index];
  expect(target, `Expected a ${label} button`).toBeDefined();
  await act(async () => target!.click());
  await settle();
}

const states = () => [...container.querySelectorAll('[data-returned-chat]')].map(element => element.getAttribute('data-returned-chat'));
const navigations = () => [navigation.openAgent, navigation.goHome, navigation.openExecution].flatMap(fn => vi.mocked(fn).mock.calls);

describe('the card on a returned result', () => {
  it('offers Archive chat while the chat is active', async () => {
    await render(createElement(ReturnedChatArchive, { sessionId: WORK }));
    expect(states()).toEqual(['active']);
    expect(buttons('Archive chat')).toHaveLength(1);
    expect(buttons('Archive chat')[0]!.getAttribute('aria-label')).toBe('Archive chat Fix the date tests');
  });

  it('archives through the shared flow and stays put when the chat is not on screen', async () => {
    await render(createElement(ReturnedChatArchive, { sessionId: WORK }));
    await click('Archive chat');
    expect(server.archive).toHaveBeenCalledExactlyOnceWith(WORK, { force: false });
    // The shared flow's optimistic rail removal, then its reconcile.
    expect(client.getQueryState(RAIL_KEY)?.isInvalidated).toBe(true);
    expect(navigations()).toEqual([]);
    expect(states()).toEqual(['archived']);
    expect(container.textContent).toContain('Archived');
    expect(buttons('Reopen')).toHaveLength(1);
  });

  it('leaves the chat on the click when it is the one on screen', async () => {
    activity = { ...activity, activeSessionId: WORK, activeExecutionId: 'execution-1' };
    await render(createElement(ReturnedChatArchive, { sessionId: WORK }));
    await click('Archive chat');
    expect(vi.mocked(navigation.openAgent).mock.calls).toEqual([['agent-1']]);
  });

  it('closes the chat open beside its agent through the view\'s own way out', async () => {
    navigation.leaveChat = vi.fn();
    activity = { ...activity, activeSessionId: WORK, activeExecutionId: 'execution-1' };
    await render(createElement(ReturnedChatArchive, { sessionId: WORK }));
    await click('Archive chat');
    expect(vi.mocked(navigation.leaveChat).mock.calls).toEqual([['agent-1']]);
    expect(navigations()).toEqual([]);
  });

  it('shows Archived with Reopen for a chat archived anywhere, and Reopen resumes it', async () => {
    server.chats.set(WORK, execution('archived'));
    await render(createElement(ReturnedChatArchive, { sessionId: WORK }));
    expect(states()).toEqual(['archived']);
    expect(buttons('Archive chat')).toHaveLength(0);
    await click('Reopen');
    expect(server.continueWork).toHaveBeenCalledExactlyOnceWith(WORK, undefined);
    expect(states()).toEqual(['active']);
    expect(navigations()).toEqual([]);
  });

  it('names the chat when Reopen fails, and keeps it archived', async () => {
    server.chats.set(WORK, execution('archived'));
    server.continueWork.mockRejectedValueOnce(new Error('The agent folder is gone'));
    await render(createElement(ReturnedChatArchive, { sessionId: WORK }));
    await click('Reopen');
    expect(server.error).toHaveBeenCalledExactlyOnceWith('Couldn\'t reopen "Fix the date tests"', { description: 'The agent folder is gone' });
    expect(states()).toEqual(['archived']);
  });

  it('asks about uncommitted files first, and Archive anyway archives it', async () => {
    const dirty = new ApiError(409, { code: 'dirty_worktree', label: 'Fix the date tests', files: [{ path: 'notes.md', change: 'untracked' }], omitted: 0 }, `/api/sessions/${WORK}/archive`);
    server.archive.mockRejectedValueOnce(dirty);
    server.confirm.mockImplementation(async (options: ConfirmOptions) => {
      expect(options.description).toContain('"Fix the date tests" has work that isn\'t committed');
      expect(options.secondaryAction?.label).toBe('Review changes');
      return true;
    });
    await render(createElement(ReturnedChatArchive, { sessionId: WORK }));
    await click('Archive chat');
    expect(server.confirm).toHaveBeenCalledOnce();
    expect(server.archive.mock.calls).toEqual([[WORK, { force: false }], [WORK, { force: true }]]);
    expect(states()).toEqual(['archived']);
  });

  it('keeps the chat when the person cancels the uncommitted-files dialog', async () => {
    server.archive.mockRejectedValueOnce(new ApiError(409, { code: 'dirty_worktree', label: null, files: [], omitted: 0 }, '/x'));
    await render(createElement(ReturnedChatArchive, { sessionId: WORK }));
    await click('Archive chat');
    expect(server.archive).toHaveBeenCalledOnce();
    expect(states()).toEqual(['active']);
  });

  it('keeps every card of the same chat in step, including an archive made elsewhere', async () => {
    await render([createElement(ReturnedChatArchive, { key: 'a', sessionId: WORK }), createElement(ReturnedChatArchive, { key: 'b', sessionId: WORK })]);
    expect(states()).toEqual(['active', 'active']);
    await click('Archive chat', 1);
    expect(states()).toEqual(['archived', 'archived']);

    // Reopened from the rail or by an agent: the live stream refreshes the row.
    server.chats.set(WORK, execution('active'));
    await act(async () => invalidateChatRows(client, WORK, 'execution-1'));
    await settle();
    expect(states()).toEqual(['active', 'active']);
    // The transcript under the row was left alone.
    client.setQueryData(['session', WORK, 'events'], []);
    invalidateChatRows(client, 'sibling', 'execution-1');
    expect(client.getQueryState(['session', WORK, 'events'])?.isInvalidated).toBe(false);
    expect(client.getQueryState(sessionKey(WORK))?.isInvalidated).toBe(true);
  });

  it('shows an archive in flight on every card of the chat', async () => {
    let finish!: () => void;
    server.archive.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(server.chats.get(WORK)); }));
    await render([createElement(ReturnedChatArchive, { key: 'a', sessionId: WORK }), createElement(ReturnedChatArchive, { key: 'b', sessionId: WORK })]);
    await click('Archive chat');
    expect(buttons('Archiving…')).toHaveLength(2);
    expect(buttons('Archiving…').every(element => element.disabled)).toBe(true);
    await act(async () => finish());
    await settle();
  });

  it('offers nothing for a main chat that answered, a deleted chat, or a surface without work navigation', async () => {
    await render([createElement(ReturnedChatArchive, { key: 'main', sessionId: MAIN }), createElement(ReturnedChatArchive, { key: 'gone', sessionId: 'deleted-chat' })]);
    expect(states()).toEqual([]);
    await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(ReturnedChatArchive, { sessionId: WORK }))));
    await settle();
    expect(states()).toEqual([]);
  });

  it('stays out of shared team chats', async () => {
    await act(async () => root.render(createElement(QueryClientProvider, { client },
      createElement(ChatCapabilities.Provider, { value: { deliveryReceipts: false, prepareResults: true, coordination: false } },
        createElement(WorkContext, { navigation, activity }, createElement(ReturnedChatArchive, { sessionId: WORK }))))));
    await settle();
    expect(states()).toEqual([]);
  });
});

describe('which transcript messages get it', () => {
  const event = (input: Partial<ChatEventRecord>): ChatEventRecord => ({ id: 'returned', createdAt: '2026-11-02T12:00:00.000Z', updatedAt: '2026-11-02T12:00:00.000Z', sessionId: MAIN, senderSessionId: WORK, authorMemberId: null, role: 'user', source: 'user', content: 'The date tests pass.', toolName: null, toolInput: null, toolIsError: null, toolExitCode: null, raw: null, externalEventId: null, externalMessageId: null, externalTurnId: null, externalToolCallId: null, externalParentToolCallId: null, sourcePartIndex: 0, partRevision: null, attachments: [], ...input } as ChatEventRecord);
  const coordination = (kind: string, senderKind = 'agent') => ({ agentCoordination: { deliveryId: `delivery-${kind}`, kind, senderKind, sourceSessionId: WORK, content: 'The date tests pass.', originalRequest: 'Fix the date tests.' } });

  it.each([
    ['an answer with no task linked', event({ raw: coordination('answer') })],
    ['a failed outcome the chat produced', event({ source: 'error', role: 'system', senderSessionId: null, raw: coordination('failed', 'system') })],
    ['an older answer saved before coordination metadata', event({ content: `[Ri agent request r1: response.]\nRequest: Fix the date tests.\nResponding chat: ${WORK}\nThe date tests pass.\n\n${AGENT_RESPONSE_INSTRUCTIONS}` })],
  ])('offers Archive chat beside the responding chat: %s', async (_name, returned) => {
    await render(createElement(ExecutionEvent, { event: returned, sessionId: MAIN, handoffActions: false }));
    expect(container.querySelector(`[data-chat-link="${WORK}"]`)).not.toBeNull();
    expect(states()).toEqual(['active']);
  });

  it.each([
    ['a blocked update', event({ source: 'error', role: 'system', senderSessionId: null, raw: coordination('blocked', 'system') })],
    ['an older blocked update', event({ content: `[Ri agent request r1: blocked.]\nRequest: Fix the date tests.\nResponding chat: ${WORK}\nWaiting on a permission.\n\n${AGENT_BLOCKED_INSTRUCTIONS}` })],
    ['a cancellation', event({ source: 'error', role: 'system', senderSessionId: null, raw: coordination('cancelled', 'system') })],
    ['an assignment from another chat', event({ raw: coordination('request') })],
    ['a message from another chat', event({ raw: coordination('message') })],
    ['something the person shared', event({ raw: coordination('answer', 'human') })],
  ])('offers nothing on %s', async (_name, other) => {
    await render(createElement(ExecutionEvent, { event: other, sessionId: MAIN, handoffActions: false }));
    expect(container.querySelector(`[data-chat-link="${WORK}"]`)).not.toBeNull();
    expect(states()).toEqual([]);
  });
});
