import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { ChatRecovery } from './chat-recovery';
vi.mock('@/components/executions/restart-menu-item', () => ({ RestartMenuItem: ({ active, sessionId }: { active: boolean; sessionId: string }) => active ? createElement('button', { 'data-chat': sessionId }, 'Restart chat') : null }));
it('shows a chat-specific process diagnostic and recovery action on the shared surface', () => {
  const html = renderToStaticMarkup(createElement(ChatRecovery, { sessionId: 'execution', runtime: { running: false, backgroundTasks: false, backgroundTaskIds: [], closeUnconfirmed: true, closeProblem: 'The previous harness is still running: pid 123 (node).' } }));
  expect(html).toContain('pid 123 (node)'); expect(html).toContain('data-chat="execution"'); expect(html).toContain('Restart chat');
  expect(renderToStaticMarkup(createElement(ChatRecovery, { sessionId: 'healthy' }))).not.toContain('Restart chat');
});
it('shows only for a blocked chat: never while it runs or works in the background, and never to a viewer who may not stop it', () => {
  const base = { backgroundTaskIds: [], canStop: true };
  expect(renderToStaticMarkup(createElement(ChatRecovery, { sessionId: 'busy', runtime: { ...base, running: true, backgroundTasks: true } }))).toBe('<div class="ml-auto w-44"></div>');
  const blocked = renderToStaticMarkup(createElement(ChatRecovery, { sessionId: 'blocked', runtime: { ...base, running: false, backgroundTasks: false, closeUnconfirmed: true } }));
  expect(blocked).toContain('Your next message checks again'); expect(blocked).toContain('Restart chat');
  expect(renderToStaticMarkup(createElement(ChatRecovery, { sessionId: 'viewer', runtime: { ...base, running: false, backgroundTasks: false, closeUnconfirmed: true, canStop: false } }))).not.toContain('Restart chat');
});
