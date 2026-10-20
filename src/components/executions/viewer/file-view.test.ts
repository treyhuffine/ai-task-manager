import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { FileView, type FileViewHandle } from './file-view';

type EditorProps = {
  value: string;
  onChange: (value: string) => void;
  onBlur: (event: { relatedTarget: unknown; currentTarget: { contains: (node: unknown) => boolean } }) => void;
};

const fixtures = vi.hoisted(() => ({
  files: new Map<string, { content: string }>(),
  editor: null as EditorProps | null,
  // Every value the editor was rendered with, in order.
  painted: [] as string[],
}));

vi.mock('@uiw/react-codemirror', () => ({
  default: (props: EditorProps) => {
    fixtures.editor = props;
    fixtures.painted.push(props.value);
    return null;
  },
}));
vi.mock('@codemirror/view', () => ({
  EditorView: { editable: { of: () => ({}) }, lineWrapping: {} },
  keymap: { of: () => ({}) },
}));
vi.mock('./language-for', () => ({ languageFor: () => ({}) }));
vi.mock('./cm-theme', () => ({ cmTheme: () => ({}) }));
vi.mock('./inline-diff', () => ({ inlineDiffExtension: () => ({}) }));
vi.mock('../skeletons', () => ({ FileSkeleton: () => null }));
vi.mock('@/contexts/dashboard-context', () => ({ useDashboard: () => ({ theme: 'light' }) }));
vi.mock('@/hooks/use-folder', () => ({
  // The same object while a file's content is unchanged, as a query cache gives.
  useFolderFile: (_source: unknown, path: string) => ({ data: fixtures.files.get(path), isLoading: false, error: null }),
  useFolderBaseFile: () => ({ data: undefined }),
}));

const source = { kind: 'execution', executionId: 'exec-1' } as never;
let root: Root;
let handle: ReturnType<typeof createRef<FileViewHandle>>;
let onDirtyChange: ReturnType<typeof vi.fn<(dirty: boolean) => void>>;
let onSaveRequest: ReturnType<typeof vi.fn<() => void>>;

function render(path: string) {
  act(() => root.render(createElement(FileView, { ref: handle, source, path, onDirtyChange, onSaveRequest })));
}

/** The agent (or a save) changes the file on disk, and the query refetches. */
function serverWrites(path: string, content: string) {
  fixtures.files.set(path, { content });
}

const editor = () => fixtures.editor!;
const type = (value: string) => act(() => editor().onChange(value));

beforeEach(() => {
  const { window, document } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fixtures.files.clear();
  fixtures.editor = null;
  fixtures.painted = [];
  handle = createRef<FileViewHandle>();
  onDirtyChange = vi.fn<(dirty: boolean) => void>();
  onSaveRequest = vi.fn<() => void>();
  root = createRoot(document.getElementById('root') as unknown as HTMLElement);
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe('FileView buffer', () => {
  it('opens on the file content, clean', () => {
    serverWrites('a.ts', 'one');
    render('a.ts');
    expect(editor().value).toBe('one');
    expect(fixtures.painted).toEqual(['one']);
    expect(onDirtyChange).not.toHaveBeenCalled();
  });

  it('marks typing dirty, and keeps the edit when the agent writes the file meanwhile', () => {
    serverWrites('a.ts', 'one');
    render('a.ts');
    type('one, edited');
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    serverWrites('a.ts', 'agent version');
    render('a.ts');
    expect(editor().value).toBe('one, edited');
  });

  it('rebases a clean buffer onto what the agent wrote', () => {
    serverWrites('a.ts', 'one');
    render('a.ts');
    serverWrites('a.ts', 'agent version');
    render('a.ts');
    expect(editor().value).toBe('agent version');
    expect(onDirtyChange).not.toHaveBeenCalled();
  });

  it('turns clean on save without pulling in server content older than the save', () => {
    serverWrites('a.ts', 'one');
    render('a.ts');
    type('saved text');
    // The write landed, but the file query hasn't refetched: it still says "one".
    act(() => handle.current!.markSaved('saved text'));
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(editor().value).toBe('saved text');
    expect(handle.current!.getValue()).toBe('saved text');
  });

  it('keeps typing done while a save was in flight', () => {
    serverWrites('a.ts', 'one');
    render('a.ts');
    type('saved');
    type('saved, and more');
    act(() => handle.current!.markSaved('saved'));
    expect(editor().value).toBe('saved, and more');
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it('reverts to the latest server content', () => {
    serverWrites('a.ts', 'one');
    render('a.ts');
    type('local edit');
    serverWrites('a.ts', 'agent version');
    render('a.ts');
    expect(editor().value).toBe('local edit');

    act(() => handle.current!.revertToServer());
    expect(editor().value).toBe('agent version');
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("never paints one file's text under another's path", () => {
    serverWrites('a.ts', 'file a');
    serverWrites('b.ts', 'file b');
    render('a.ts');
    type('file a, edited');
    fixtures.painted = [];

    render('b.ts');
    expect(fixtures.painted).toEqual(['file b']);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });
});

describe('FileView autosave on blur', () => {
  const inside = { id: 'search-field' };
  const outside = { closest: (selector: string) => (selector === '[data-skip-autosave]' ? null : null) };
  const discard = { closest: (selector: string) => (selector === '[data-skip-autosave]' ? {} : null) };
  const leave = (relatedTarget: unknown) =>
    act(() => editor().onBlur({ relatedTarget, currentTarget: { contains: (node) => node === inside } }));

  beforeEach(() => {
    serverWrites('a.ts', 'one');
    render('a.ts');
  });

  it('does nothing when the buffer is clean', () => {
    leave(outside);
    expect(onSaveRequest).not.toHaveBeenCalled();
  });

  it('saves unsaved edits when focus leaves the editor', () => {
    type('edited');
    leave(outside);
    leave(null);
    expect(onSaveRequest).toHaveBeenCalledTimes(2);
  });

  it('waits while focus moves within the editor, or to an element that opts out', () => {
    type('edited');
    leave(inside);
    leave(discard);
    expect(onSaveRequest).not.toHaveBeenCalled();
  });
});
