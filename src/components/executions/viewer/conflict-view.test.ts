import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { ConflictView } from './conflict-view';

const fixtures = vi.hoisted(() => ({ files: new Map<string, { content: string }>() }));
const file = (path: string, content: string) => fixtures.files.set(path, { content });

vi.mock('@/hooks/use-folder', () => ({
  useFolderFile: (_source: unknown, path: string) => ({ data: fixtures.files.get(path), isLoading: false, error: null }),
  useResolveFileConflict: () => ({ mutateAsync: vi.fn(), isPending: false, isSuccess: false }),
}));
vi.mock('../skeletons', () => ({ FileSkeleton: () => null }));
vi.mock('@/components/ui/tip', () => ({ Tip: ({ children }: { children: unknown }) => children }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const conflict = (current: string, incoming: string) =>
  `<<<<<<< HEAD\n${current}\n=======\n${incoming}\n>>>>>>> feature\n`;
const source = { kind: 'execution', executionId: 'exec-1' } as never;

let root: Root;
let container: HTMLElement;

const render = (path: string) => act(() => root.render(createElement(ConflictView, { source, path })));
const hunks = () => [...container.querySelectorAll('div.my-1\\.5')];
const button = (scope: Element, label: string) =>
  [...scope.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!;
const click = (el: Element) => act(() => { (el as unknown as HTMLElement).click(); });

beforeEach(() => {
  const { window, document } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fixtures.files.clear();
  container = document.getElementById('root') as unknown as HTMLElement;
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe('ConflictView', () => {
  it('numbers conflicts among themselves, with context between them', () => {
    file('a.ts', `top\n${conflict('one', 'uno')}middle\n${conflict('two', 'dos')}end\n`);
    render('a.ts');
    expect(hunks().map((h) => h.textContent?.match(/Conflict \d of \d/)?.[0])).toEqual([
      'Conflict 1 of 2',
      'Conflict 2 of 2',
    ]);
  });

  it("records each conflict's choice as its own", () => {
    file('a.ts', `top\n${conflict('one', 'uno')}middle\n${conflict('two', 'dos')}end\n`);
    render('a.ts');
    click(button(hunks()[1], 'Accept incoming'));
    expect(hunks()[0].textContent).toContain('Current change');
    expect(hunks()[1].textContent).toContain('Using incoming change');
    expect(container.textContent).toContain('1/2 resolved');
  });

  it('starts another file with nothing chosen', () => {
    file('a.ts', conflict('one', 'uno'));
    file('b.ts', conflict('two', 'dos'));
    render('a.ts');
    click(button(hunks()[0], 'Accept both'));
    expect(container.textContent).toContain('1/1 resolved');

    render('b.ts');
    expect(container.textContent).toContain('0/1 resolved');
    expect(hunks()[0].textContent).toContain('Current change');
  });
});
