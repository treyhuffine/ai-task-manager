// What the tree says when the read fails or stops early. Loading rows used to
// stay up forever on a failed read, with nothing to tell the person why.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { TipProvider } from '@/components/ui/tip';
import { workspaceFolder } from '@/lib/folders/source';

type TreeState = {
  data?: { entries: Array<{ path: string; name: string; kind: 'file' }>; truncated?: boolean };
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
};
let tree: TreeState;

const mutation = () => ({ isPending: false, mutateAsync: async () => {} });
vi.mock('@/hooks/use-folder', () => ({
  useFolderTree: () => tree,
  useCreateDir: mutation,
  useCreateFile: mutation,
  useDeleteDir: mutation,
  useDeletePath: mutation,
  useRenamePath: mutation,
  useUploadFile: mutation,
  writeFileMutationKey: () => ['write-file'],
}));
vi.mock('../open-worktree-button', () => ({ OpenWorktreeButton: () => null }));
vi.mock('../skeletons', () => ({ TreeRowsSkeleton: () => createElement('div', null, 'loading rows') }));
vi.mock('./tree-list', () => ({ TreeList: () => createElement('div', null, 'the file list') }));

const { FileTree } = await import('./file-tree');

function render(worktreePath: string | null = '/agents/blog') {
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client: new QueryClient() },
      createElement(TipProvider, null,
        createElement(FileTree, {
          source: workspaceFolder('agent'),
          worktreeId: 'workspace-agent',
          selectedPath: null,
          onSelect: () => {},
          worktreePath,
        }))),
  );
}

const entry = { path: 'a.md', name: 'a.md', kind: 'file' as const };
const failure = new Error("The agent's folder does not exist: /agents/blog");

beforeEach(() => {
  tree = { isFetching: false, error: null, refetch: () => {} };
});

it('says why when the read failed with nothing to show, and offers another try', () => {
  tree = { ...tree, error: failure };
  const html = render();
  expect(html).toContain('list these files');
  expect(html).toContain('/agents/blog');
  expect(html).toContain('Try again');
  expect(html).not.toContain('loading rows');
});

it('says so even when the folder is not known, which would otherwise load forever', () => {
  tree = { ...tree, error: failure };
  expect(render(null)).toContain('list these files');
});

it('goes back to loading rows while trying again', () => {
  tree = { ...tree, error: failure, isFetching: true };
  const html = render();
  expect(html).toContain('loading rows');
  expect(html).not.toContain('list these files');
});

it('keeps the list on screen when a later read fails', () => {
  tree = { ...tree, data: { entries: [entry] }, error: failure };
  const html = render();
  expect(html).toContain('the file list');
  expect(html).not.toContain('list these files');
});

it('says when the list was cut short, and how far it goes', () => {
  tree = { ...tree, data: { entries: [entry], truncated: true } };
  expect(render()).toContain('Showing the first 1 files');
});

it('says nothing about a whole list', () => {
  tree = { ...tree, data: { entries: [entry], truncated: false } };
  expect(render()).not.toContain('Showing the first');
});
