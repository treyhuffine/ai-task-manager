import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { ChatCapabilities } from './chat-capabilities';
import { ChatMenu } from './chat-menu';

const h = vi.hoisted(() => ({ canStop: undefined as boolean | undefined, pass: ({ children }: { children: ReactNode }) => children }));
// The popover's content renders inline so the menu's sections can be read.
vi.mock('@/components/ui/popover', () => ({ Popover: h.pass, PopoverTrigger: h.pass, PopoverContent: h.pass }));
vi.mock('@/components/ui/tip', () => ({ Tip: h.pass }));
vi.mock('@/hooks/use-execution', () => ({ useRuntimeStatus: () => ({ data: { running: false, backgroundTasks: false, backgroundTaskIds: [], canStop: h.canStop } }) }));
vi.mock('@/components/executions/restart-menu-item', () => ({ RestartMenuItem: ({ sessionId }: { sessionId: string }) => createElement('button', { 'data-restart': sessionId }, 'Restart chat') }));
vi.mock('@/components/chat-ui/coordination/controls', () => ({ CoordinationSettings: () => createElement('p', null, 'Messages to other chats') }));

const render = (coordination: boolean, sessionId: string | null = 'chat') => renderToStaticMarkup(
  createElement(ChatCapabilities.Provider, { value: { deliveryReceipts: false, prepareResults: true, coordination } }, createElement(ChatMenu, { sessionId })),
);
beforeEach(() => { h.canStop = undefined; });

it('gives a personal chat its coordination preferences and Restart chat', () => {
  const html = render(true);
  expect(html).toContain('aria-label="Chat menu"'); expect(html).toContain('Messages to other chats'); expect(html).toContain('data-restart="chat"');
});
it('gives a shared chat Restart chat alone, for whoever may stop it', () => {
  h.canStop = true;
  const html = render(false);
  expect(html).toContain('data-restart="chat"'); expect(html).not.toContain('Messages to other chats');
  h.canStop = false;
  expect(render(false)).toBe('');
});
it('leaves Restart out for a viewer who may not stop the chat', () => {
  h.canStop = false;
  const html = render(true);
  expect(html).toContain('Messages to other chats'); expect(html).not.toContain('Restart chat');
});
it('renders nothing before there is a chat', () => {
  expect(render(true, null)).toBe('');
});
