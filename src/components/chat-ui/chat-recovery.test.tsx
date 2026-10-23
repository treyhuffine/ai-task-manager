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
