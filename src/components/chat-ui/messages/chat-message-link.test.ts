import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatMessageLink } from './chat-message-link';

const state = vi.hoisted(() => ({ session: null as unknown, error: null as unknown, navigate: vi.fn() }));
vi.mock('@/hooks/use-execution', () => ({ useSession: () => ({ data: state.session, error: state.error }) }));
vi.mock('@/hooks/use-workspaces', () => ({ useWorkspace: () => ({ data: { name: 'Research' } }) }));
vi.mock('@/hooks/use-user-state', () => ({ useOrchestratorName: () => 'Ri' }));
vi.mock('@/contexts/dashboard-context', () => ({ useOptionalDashboard: () => ({ setActiveView: state.navigate }) }));
vi.mock('@/components/ui/tip', () => ({ Tip: ({ children }: { children: unknown }) => children }));
vi.mock('next/link', () => ({ default: (props: Record<string, unknown>) => {
  const attributes = { ...props };
  delete attributes.prefetch;
  return createElement('a', attributes);
} }));

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  root = createRoot(container);
  state.session = { id: 'peer-chat', type: 'execution', label: 'Review date handling', workspaceId: 'research' };
  state.error = null;
  state.navigate.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

describe('linked chat identity', () => {
  it('exposes a real link with readable origin and context, and keeps dashboard navigation', async () => {
    await act(async () => root.render(createElement(ChatMessageLink, { sessionId: 'peer-chat', label: 'Request from', direction: 'incoming' })));
    const link = container.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('/?session=peer-chat&history=1');
    expect(link.textContent).toContain('Request from');
    expect(link.textContent).toContain('Research');
    expect(link.textContent).toContain('Review date handling');
    await act(async () => { link.dispatchEvent(Object.assign(new window.Event('click', { bubbles: true, cancelable: true }), { button: 0 })); });
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith({ kind: 'execution', id: 'peer-chat', history: true });
  });

  it.each([null, 'research'])('preserves the exact archived main chat instead of the scope current chat (%s)', async (workspaceId) => {
    state.session = { id: 'peer-chat', type: 'orchestration', status: 'archived', label: 'Earlier date review', workspaceId };
    await act(async () => root.render(createElement(ChatMessageLink, { sessionId: 'peer-chat', label: 'Sent to', direction: 'outgoing' })));
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/?session=peer-chat&history=1');
    expect(container.textContent).toContain('Earlier date review');
    await act(async () => { container.querySelector('a')!.dispatchEvent(Object.assign(new window.Event('click', { bubbles: true, cancelable: true }), { button: 0 })); });
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith({ kind: 'execution', id: 'peer-chat', history: true });
  });

  it('preserves modified clicks so a chat can be opened in another tab', async () => {
    await act(async () => root.render(createElement(ChatMessageLink, { sessionId: 'peer-chat', label: 'Sent to', direction: 'outgoing', preview: 'Check the dates.' })));
    const event = Object.assign(new window.Event('click', { bubbles: true, cancelable: true }), { button: 0, metaKey: true });
    await act(async () => { container.querySelector('a')!.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
    expect(state.navigate).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Check the dates.');
  });

  it('keeps the relationship visible when the other chat is deleted, without a broken link', async () => {
    state.session = null;
    state.error = { status: 404 };
    await act(async () => root.render(createElement(ChatMessageLink, { sessionId: 'peer-chat', label: 'Message from', direction: 'incoming' })));
    expect(container.textContent).toContain('Message from');
    expect(container.textContent).toContain('Deleted chat');
    expect(container.querySelector('a')).toBeNull();
  });

  it('does not mistake a temporary connection failure for a deleted conversation', async () => {
    state.error = { status: 503 };
    await act(async () => root.render(createElement(ChatMessageLink, { sessionId: 'peer-chat', label: 'Sent to', direction: 'outgoing' })));
    expect(container.querySelector('a')?.textContent).toContain('Review date handling');
    expect(container.textContent).not.toContain('Deleted chat');
  });
});
