import { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { expect, it, vi } from 'vitest';
import { TeamWorkBoundary } from './team-work-boundary';
import { WorkContext } from '@/contexts/work-context';
import { useSettingsLink } from '@/components/settings/settings-destination';
import { useChatCapabilities } from '@/components/chat-ui/chat-capabilities';
import { LinkedChatView } from '@/components/chat-ui/messages/linked-chat-view';
import type { ChatSessionWithExecution } from '@/lib/api/dto/records';

const viewer = vi.hoisted(() => ({ canConfigure: false }));
vi.mock('./home-context', () => ({ useHomeContext: () => ({ capabilities: { configureAgents: viewer.canConfigure } }) }));
const nav = vi.hoisted(() => ({ openChat: vi.fn(), openAgent: vi.fn() }));
vi.mock('@/components/team/team-context', () => ({ useTeamNav: () => ({ ...nav, openSettings() {}, openTask() {}, openNote() {}, show() {}, view: 'chat', chatId: null }) }));
vi.mock('@/hooks/use-workspaces', () => ({ useRailSessions: () => ({ data: {} }), useWorkspace: () => ({ data: null }) }));
vi.mock('@/hooks/use-global-session-stream', () => ({ useGlobalSessionStream: () => {} }));
vi.mock('@/hooks/use-user-state', () => ({ useOrchestratorName: () => 'Ri' }));
vi.mock('@/hooks/use-session-stream', () => ({ useSessionStream: () => {} }));
vi.mock('@/components/chat/harness-chat', () => ({ HarnessChatSession: () => null }));
vi.mock('@/components/executions/execution-transcript', () => ({ ExecutionTranscript: () => null }));
vi.mock('next/link', () => ({ default: (props: Record<string, unknown>) => {
  const linkProps = { ...props }; delete linkProps.prefetch;
  return createElement('a', linkProps);
} }));

it('supplies Team delivery restrictions while personal defaults retain receipts', () => {
  const seen: unknown[] = [];
  function Capture() { seen.push(useChatCapabilities()); return null; }
  renderToStaticMarkup(createElement(TeamWorkBoundary, null, createElement(Capture)));
  renderToStaticMarkup(createElement(Capture));
  expect(seen).toEqual([{ deliveryReceipts: false, prepareResults: true, coordination: false }, { deliveryReceipts: true, prepareResults: true }]);
});

it('Open current chat in a legacy Team conversation stays in the Team chat destination', async () => {
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div'), root = createRoot(container);
  try {
    const session = { id: 'legacy', workspaceId: null, executionId: null, type: 'orchestration', status: 'active' } as ChatSessionWithExecution;
    await act(async () => root.render(createElement(TeamWorkBoundary, null, createElement(LinkedChatView, { session }))));
    const link = container.querySelector('a')!;
    expect(link.textContent).toBe('Open current chat');
    await act(async () => { link.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true })); });
    expect(nav.openChat).toHaveBeenCalledWith(null);
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});

it('the real Team boundary offers Manage models only to a manager', () => {
  const seen: boolean[] = [];
  function Capture() { seen.push(Boolean(useSettingsLink('models'))); return null; }
  viewer.canConfigure = false;
  renderToStaticMarkup(createElement(TeamWorkBoundary, null, createElement(Capture)));
  viewer.canConfigure = true;
  renderToStaticMarkup(createElement(TeamWorkBoundary, null, createElement(Capture)));
  expect(seen).toEqual([false, true]);
  viewer.canConfigure = false;
});

it('a personal Open current chat link retains normal navigation without a contextual callback', async () => {
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div'); const mounted = createRoot(container);
  try {
    const navigation = { openAgent() {}, openExecution() {}, openTask() {}, openNote() {}, goHome() {} };
    const session = { id: 'personal', workspaceId: 'agent', executionId: null, type: 'orchestration', status: 'archived' } as ChatSessionWithExecution;
    await act(async () => mounted.render(createElement(WorkContext, { navigation, activity: {} as never }, createElement(LinkedChatView, { session }))));
    const event = new window.Event('click', { bubbles: true, cancelable: true });
    await act(async () => { container.querySelector('a')!.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
  } finally { await act(async () => { mounted.unmount(); }); vi.unstubAllGlobals(); }
});
