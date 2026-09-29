import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { documentSaves } from '@/lib/client/document-saves';
import { AreaSlideout } from './area-slideout';

const fixtures = vi.hoisted(() => ({
  area: { id: 'review-area', name: 'Original name', description: 'Original description', status: 'active', attachments: [] },
  write: vi.fn(async () => {}),
}));
vi.mock('@/hooks/use-areas', () => ({
  useArea: () => ({ data: fixtures.area }),
  useUpdateArea: () => ({ mutate: vi.fn(), mutateAsync: fixtures.write }),
}));
vi.mock('@/hooks/use-tasks', () => ({ useTasks: () => ({ data: [] }), useCreateTask: () => ({}) }));
vi.mock('@/hooks/use-notes', () => ({ useNotes: () => ({ data: [] }), useCreateNote: () => ({}) }));
vi.mock('@/hooks/use-task-lifecycle', () => ({ useTaskLifecycle: () => ({}) }));
vi.mock('@/contexts/dashboard-context', () => ({ useDashboard: () => ({}) }));
vi.mock('@/components/tasks/lifecycle-status-control', () => ({ LifecycleStatusControl: () => null }));
vi.mock('@/components/shared/note-icon', () => ({ NoteIcon: () => null }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), warning: vi.fn() } }));
vi.mock('radix-ui', () => {
  const wrapper = ({ children }: { children?: ReactNode }) => children;
  return { Dialog: { Root: wrapper, Portal: wrapper, Content: wrapper, Title: wrapper, Overlay: () => null } };
});
vi.mock('@/components/ui/dropdown-menu', () => {
  const wrapper = ({ children }: { children?: ReactNode }) => children;
  return { DropdownMenu: wrapper, DropdownMenuTrigger: wrapper, DropdownMenuContent: wrapper, DropdownMenuItem: wrapper };
});

let root: Root | undefined;
let container: HTMLElement;

beforeEach(async () => {
  vi.useFakeTimers();
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  const stored = new Map<string, string>();
  Object.assign(window, { localStorage: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  } });
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', vi.fn());
  fixtures.write.mockClear();
  container = document.createElement('div');
  root = createRoot(container);
  await act(async () => root!.render(createElement(AreaSlideout, {
    areaId: fixtures.area.id, onClose: vi.fn(), onCloseAll: vi.fn(), hasHistory: false,
  })));
});

afterEach(async () => {
  await act(async () => root?.unmount());
  await documentSaves.flushAll();
  root = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Linkedom does not implement React's native input event tracking. Invoke the
// real mounted input callback while retaining the actual component and hook.
async function change(selector: string, value: string) {
  const input = container.querySelector(selector)!;
  const propsKey = Object.keys(input).find(key => key.startsWith('__reactProps$'))!;
  const props = (input as unknown as Record<string, { onChange: (event: { target: { value: string } }) => void }>)[propsKey];
  await act(async () => props.onChange({ target: { value } }));
}

it('retains an undo to the saved area name and description before the debounce', async () => {
  await change('input[placeholder="Area name"]', 'Intermediate name');
  await change('textarea', 'Intermediate description');
  await change('input[placeholder="Area name"]', fixtures.area.name);
  await change('textarea', fixtures.area.description);
  expect(fixtures.write).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(fixtures.write).toHaveBeenCalledExactlyOnceWith({
    id: fixtures.area.id, name: fixtures.area.name, description: fixtures.area.description,
  });
  expect(documentSaves.has()).toBe(false);
});
