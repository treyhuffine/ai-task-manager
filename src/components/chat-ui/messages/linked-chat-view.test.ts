import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ChatSessionWithExecution } from '@/lib/api/dto/records';
import { LinkedChatView } from './linked-chat-view';

const calls = vi.hoisted(() => ({ transcript: vi.fn(), live: vi.fn(), stream: vi.fn() }));
vi.mock('@/components/executions/execution-transcript', () => ({ ExecutionTranscript: (props: { session: { id: string } }) => { calls.transcript(props); return createElement('p', {}, `Transcript ${props.session.id}`); } }));
vi.mock('@/components/chat/harness-chat', () => ({ HarnessChatSession: (props: { sessionId: string }) => { calls.live(props); return createElement('p', {}, `Live chat ${props.sessionId}`); } }));
vi.mock('@/hooks/use-workspaces', () => ({ useWorkspace: () => ({ data: { name: 'Research' } }) }));
vi.mock('@/hooks/use-user-state', () => ({ useOrchestratorName: () => 'Ri' }));
vi.mock('@/hooks/use-session-stream', () => ({ useSessionStream: calls.stream }));
vi.mock('next/link', () => ({ default: (props: Record<string, unknown>) => createElement('a', props) }));
beforeEach(() => vi.clearAllMocks());

it('opens an archived main chat as its exact transcript without a composer or resume action', () => {
  const session = { id: 'original-main', type: 'orchestration', status: 'archived', label: 'Earlier date review', workspaceId: 'research' } as ChatSessionWithExecution;
  const html = renderToStaticMarkup(createElement(LinkedChatView, { session }));
  expect(html).toContain('Earlier date review');
  expect(html).toContain('Archived chat');
  expect(html).toContain('Transcript original-main');
  expect(calls.transcript).toHaveBeenCalledWith(expect.objectContaining({ session, isRunning: false }));
  expect(calls.live).not.toHaveBeenCalled();
  expect(calls.stream).toHaveBeenCalledWith('original-main');
});

it('keeps an active exact main chat interactive without changing the scope current chat', () => {
  const session = { id: 'original-main', type: 'orchestration', status: 'active', workspaceId: null } as ChatSessionWithExecution;
  const html = renderToStaticMarkup(createElement(LinkedChatView, { session }));
  expect(html).toContain('Live chat original-main');
  expect(calls.live).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'original-main', autoFocusComposer: false }));
  expect(calls.transcript).not.toHaveBeenCalled();
  expect(calls.stream).toHaveBeenCalledWith(null);
});
