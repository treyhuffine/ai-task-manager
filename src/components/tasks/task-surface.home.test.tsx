/** Host navigation and Team filters survive main's Board merge at the shared surface boundary. */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { afterEach, expect, it, vi } from 'vitest';
import { TaskSurface } from './task-surface';
const h = vi.hoisted(() => ({ list: {} as Record<string, unknown>, board: {} as Record<string, unknown> }));
vi.mock('./task-list', async () => { const React = await import('react'); return { TaskList: (props: Record<string, unknown>) => { h.list = props; return React.createElement('button', { onClick: () => (props.onViewChange as (v: string) => void)('board') }, 'Board'); } }; });
vi.mock('./task-kanban', async () => { const React = await import('react'); return { TaskKanban: (props: Record<string, unknown>) => { h.board = props; return React.createElement('div', null, 'Inline board', props.leading as never); } }; });
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); vi.unstubAllGlobals(); });
async function mount(props: Parameters<typeof TaskSurface>[0]) {
  const { window, document } = parseHTML('<html><body></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.HTMLElement.prototype.scrollIntoView = () => {};
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const storage = new Map(); vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  storage.set('ri.tasks.view', 'board');
  const container = document.createElement('div'); root = createRoot(container);
  await act(async () => root!.render(createElement(TaskSurface, props)));
  return { container, window };
}
it('personal Tasks opens the host Board overlay even with a saved legacy inline-board preference', async () => {
  const openBoard = vi.fn(); const { container, window } = await mount({ onOpenTask: vi.fn(), onOpenBoard: openBoard });
  expect(container.textContent).toBe('Board');
  await act(async () => container.querySelector('button')!.dispatchEvent(new window.Event('click', { bubbles: true })));
  expect(openBoard).toHaveBeenCalledOnce(); expect(container.textContent).toBe('Board');
});
it('Team List and inline Board retain assignment, Area, create defaults, and member-scoped column preferences', async () => {
  const filter = vi.fn(), openTask = vi.fn(); const defaults = { areaId: 'team-area', assigneeMemberId: 'maya' };
  const { container, window } = await mount({ onOpenTask: openTask, privatePlanning: false, viewKey: 'ri.tasks.view:home:maya', assigneeMemberId: 'maya', areaFilter: 'team-area', onAreaFilterChange: filter, createDefaults: defaults });
  expect(h.list).toMatchObject({ privatePlanning: false, initialLane: 'all', assigneeMemberId: 'maya', areaFilter: 'team-area', createDefaults: defaults });
  await act(async () => container.querySelector('button')!.dispatchEvent(new window.Event('click', { bubbles: true })));
  expect(container.textContent).toContain('Inline board');
  expect(h.board).toMatchObject({ agents: true, assigneeMemberId: 'maya', areaFilter: 'team-area', createDefaults: defaults, columnPreferenceKey: 'ri.tasks.view:home:maya:columns', onOpenTask: openTask, onAreaFilterChange: filter });
});
