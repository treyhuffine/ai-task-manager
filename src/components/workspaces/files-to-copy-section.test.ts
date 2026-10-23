import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { FilesToCopySection } from './files-to-copy-section';

const fixtures = vi.hoisted(() => ({
  calls: [] as { cwd: string; globs: string[]; resolve: (files: string[]) => void; reject: (error: Error) => void }[],
}));

vi.mock('@/lib/api/workspaces', () => ({
  workspacesApi: {
    previewFilesToCopy: (cwd: string, globs: string[]) =>
      new Promise((resolve, reject) => {
        fixtures.calls.push({
          cwd,
          globs,
          resolve: (files) => resolve({ root: cwd, files, truncated: false }),
          reject,
        });
      }),
  },
}));
vi.mock('@/components/ui/tip', () => ({ Tip: ({ children }: { children: unknown }) => children }));

let root: Root;
let client: QueryClient;
let container: HTMLElement;
let onChange: ReturnType<typeof vi.fn<(next: string[]) => void>>;

function render(value: string[], cwd = '/repo') {
  act(() => root.render(createElement(QueryClientProvider, { client }, createElement(FilesToCopySection, { value, onChange, cwd }))));
}

const textarea = () => container.querySelector('textarea') as unknown as HTMLTextAreaElement;
const reactProps = <T,>(el: Element) => {
  const key = Object.keys(el).find((k) => k.startsWith('__reactProps$'))!;
  return (el as unknown as Record<string, T>)[key];
};
// What React renders into the textarea. Linkedom doesn't reflect a
// textarea's initial value, so read the prop React was given.
const shownText = () => reactProps<{ value: string }>(textarea()).value;
const spinning = () => container.querySelector('.animate-spin') !== null;
const summary = () => container.querySelector('button')?.textContent ?? '';

// Linkedom does not implement React's input event tracking, so call the
// mounted textarea's own handler.
function typeText(value: string) {
  const props = reactProps<{ onChange: (e: { target: { value: string } }) => void }>(textarea());
  act(() => props.onChange({ target: { value } }));
}

async function settle() {
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
}

beforeEach(() => {
  vi.useFakeTimers();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const { window, document } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fixtures.calls = [];
  onChange = vi.fn<(next: string[]) => void>();
  container = document.getElementById('root') as unknown as HTMLElement;
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  client.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('FilesToCopySection text', () => {
  it('fills the textarea from the value, and follows a new value from the caller', () => {
    render(['.env']);
    expect(shownText()).toBe('.env');
    render(['.env', 'config/*.local']);
    expect(shownText()).toBe('.env\nconfig/*.local');
  });

  it('keeps blank lines being typed when the caller echoes the parsed globs back', () => {
    render(['.env']);
    typeText('.env\n\n');
    expect(onChange).toHaveBeenLastCalledWith(['.env']);
    render(['.env']);
    expect(shownText()).toBe('.env\n\n');

    typeText('.env\n\nsecrets/*');
    render(['.env', 'secrets/*']);
    expect(shownText()).toBe('.env\n\nsecrets/*');
  });

  it('changes nothing when the caller passes an equal new array each render', () => {
    render(['.env']);
    typeText('.env\n');
    render(['.env']);
    render(['.env']);
    expect(shownText()).toBe('.env\n');
  });
});

describe('FilesToCopySection preview', () => {
  it('shows loading until the preview for the current globs answers', async () => {
    render(['.env']);
    expect(spinning()).toBe(true);
    expect(summary()).toContain('Scanning');
    await settle();
    expect(fixtures.calls).toHaveLength(1);
    await act(async () => fixtures.calls[0].resolve(['.env']));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(spinning()).toBe(false);
    expect(summary()).toContain('1 file will be copied from /repo');
  });

  it('keeps the last answer up while the next one loads, and ignores a superseded answer', async () => {
    render(['.env']);
    await settle();
    await act(async () => fixtures.calls[0].resolve(['.env']));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    render(['.env', 'a/*']);
    expect(spinning()).toBe(true);
    expect(summary()).toContain('1 file will be copied');
    await settle();
    render(['.env', 'b/*']);
    await settle();
    expect(fixtures.calls).toHaveLength(3);
    await act(async () => fixtures.calls[1].resolve(['stale']));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(spinning()).toBe(true);
    await act(async () => fixtures.calls[2].resolve(['.env', 'b/one', 'b/two']));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(spinning()).toBe(false);
    expect(summary()).toContain('3 files will be copied');
  });

  it('reports a failed preview', async () => {
    render(['.env']);
    await settle();
    await act(async () => fixtures.calls[0].reject(new Error('Folder not found')));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(spinning()).toBe(false);
    expect(summary()).toContain('Preview failed');
    expect(container.textContent).toContain('Folder not found');
  });

  it('drops the answer with nothing to preview, so a later preview starts clean', async () => {
    render(['.env']);
    await settle();
    await act(async () => fixtures.calls[0].resolve(['.env']));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    render(['.env'], '');
    expect(container.textContent).toContain('Pick a folder above');
    render(['.env'], '/other');
    expect(spinning()).toBe(true);
    expect(summary()).toContain('Scanning');
  });
});
