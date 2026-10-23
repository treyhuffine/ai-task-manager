import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { WorkContext, useWorkActivity, useWorkNavigation, type WorkNavigation, type WorkActivity } from './work-context';

const navigation = (): WorkNavigation => ({ openAgent: vi.fn(), openExecution: vi.fn(), openTask: vi.fn(), openNote: vi.fn(), goHome: vi.fn() });
const activity = (activeSessionId: string): WorkActivity => ({ activeSessionId, streamingSessionIds: new Set([activeSessionId]), backgroundSessionIds: new Set(), pendingInputSessionIds: new Set(), setActiveExecutionId: vi.fn(), setSessionStreaming: vi.fn() });

it('binds shared work surfaces to each document without a personal dashboard or ambient navigation', () => {
  const personal = navigation(), team = navigation();
  function Surface() {
    const nav = useWorkNavigation(); const state = useWorkActivity();
    nav.openExecution('same-canonical-id');
    return createElement('span', null, state.activeSessionId);
  }
  const html = renderToStaticMarkup(createElement(WorkContext, { navigation: personal, activity: activity('personal-chat') },
    createElement('div', null, createElement(Surface), createElement(WorkContext, { navigation: team, activity: activity('team-chat') }, createElement(Surface))),
  ));
  expect(html).toContain('personal-chat'); expect(html).toContain('team-chat');
  expect(personal.openExecution).toHaveBeenCalledExactlyOnceWith('same-canonical-id');
  expect(team.openExecution).toHaveBeenCalledExactlyOnceWith('same-canonical-id');
});
