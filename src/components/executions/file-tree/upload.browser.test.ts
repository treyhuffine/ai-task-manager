import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Plugin } from 'esbuild';
import type { Page } from 'playwright-core';
import { browserFixture } from '@/test/fixtures/browser-fixture';

// Real tree, menus, folder hooks and multipart client. Only folder reads,
// the viewer, and the HTTP server are fixtures.
const STUBS: Record<string, string> = {
  '@/lib/trpc/client': `export const trpcClient = { workspaces: { treeGet: { query: async () => ({ entries: window.entries }) } } };`,
  '@/hooks/use-execution': `
    import { useQuery } from '@tanstack/react-query';
    export const useSessionTree = id => useQuery({ queryKey: ['worktree', id, 'tree'], queryFn: async () => ({ entries: window.entries }), enabled: !!id });
    export const useSession = () => ({ data: null });
    export const useSessionFile = () => ({});
    export const useSessionBaseFile = () => ({});
    export const useWorktreeScope = id => id ? ['worktree', id] : null;
    export const worktreeFileKey = (_qc, id, path) => ['worktree', id, 'file', path];
    export const invalidateWorktree = (qc, id) => qc.invalidateQueries({ queryKey: ['worktree', id] });
    export const useSessionDiff = () => ({ data: null });`,
  '@/hooks/use-workspaces': `export const useWorkspace = () => ({}); export const useRunOn = () => ({});`,
  '../open-worktree-button': `export const OpenWorktreeButton = () => null;`,
  '../viewer/file-viewer': `export const FileViewer = () => null;`,
  '../viewer/file-history-menu': `export const FileHistoryMenu = () => null;`,
};
const stubs: Plugin = { name: 'upload-fixture', setup(build) {
  build.onResolve({ filter: /.*/ }, args => args.path in STUBS ? { path: args.path, namespace: 'fixture' } : undefined);
  build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: STUBS[args.path], loader: 'jsx', resolveDir: process.cwd() }));
} };

let fixture: Awaited<ReturnType<typeof browserFixture>>;
beforeAll(async () => {
  fixture = await browserFixture(`
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
    import { TipProvider } from './src/components/ui/tip';
    import { Toaster } from 'sonner';
    import { FileTree } from './src/components/executions/file-tree/file-tree';
    import { FilesView } from './src/components/executions/workbench/files-view';
    window.entries = [{ path: 'docs/guide.md', name: 'guide.md', kind: 'file' }];
    window.uploads = [];
    window.chatDrops = 0;
    window.fetch = async (url, init) => {
      const form = init.body;
      const path = form.get('path');
      const file = form.get('file');
      window.uploads.push({ url: String(url), path, name: file.name, bytes: Array.from(new Uint8Array(await file.arrayBuffer())) });
      await new Promise(resolve => setTimeout(resolve, 50));
      if (path.endsWith('exists.txt')) return Response.json({ error: 'exists.txt already exists', code: 'exists' }, { status: 409 });
      window.entries = [...window.entries, { path, name: file.name, kind: 'file' }];
      return Response.json({ ok: true, path });
    };
    const params = new URLSearchParams(location.search);
    if (params.has('space')) document.documentElement.dataset.riSpace = 'team-12345678';
    function App() {
      const [selected, select] = useState(null);
      const common = { worktreeId: 'files', worktreePath: '/project', selectedPath: selected, onSelect: select };
      return <div style={{ height: 650, width: 850 }} onDrop={() => window.chatDrops++}>
        {params.has('workbench') ? <FilesView {...common} sessionId="chat" fileHistory={[]} /> : <FileTree {...common} source={{ kind: 'workspace', workspaceId: 'agent', readOnly: params.has('archived') }} />}
        <output aria-label="Selected file">{selected}</output><Toaster />
      </div>;
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><TipProvider><App /></TipProvider></QueryClientProvider>);
  `, [stubs], { css: true });
}, 120_000);
afterAll(async () => { await fixture?.close(); });

async function open(query = '') {
  const page = await fixture.browser.newPage({ viewport: { width: 1000, height: 800 } });
  page.setDefaultTimeout(6000);
  await page.goto(fixture.url + query);
  await page.getByRole('button', { name: 'docs', exact: true }).waitFor();
  return page;
}

async function drag(page: Page, selector: string, type: 'dragenter' | 'dragover' | 'drop' | 'dragleave', files: Array<{ name: string; bytes: number[] }>) {
  await page.locator(selector).evaluate((target, { type, files }) => {
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(new File([new Uint8Array(file.bytes)], file.name));
    target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, { type, files });
}

const uploaded = (page: Page) => page.evaluate(() => (window as unknown as { uploads: Array<{ path: string; bytes: number[]; url: string }> }).uploads);

it.each(['', '?workbench=1'])('opens the multi-file picker from the + menu and refreshes the tree (%s)', async (query) => {
  const page = await open(query);
  try {
    await page.getByRole('button', { name: query ? 'New' : 'Create new', exact: true }).click();
    const [picker] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('menuitem', { name: 'Upload files', exact: true }).click(),
    ]);
    expect(picker.isMultiple()).toBe(true);
    await picker.setFiles([{ name: 'a.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([0, 255, 128]) },
      { name: 'b.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }]);
    await expect.poll(() => uploaded(page)).toHaveLength(2);
    expect((await uploaded(page))[0]).toMatchObject({ path: 'a.bin', bytes: [0, 255, 128] });
    await page.getByRole('button', { name: 'a.bin', exact: true }).waitFor();
    await expect.poll(() => page.getByLabel('Selected file').textContent()).toBe('a.bin');
    // Resetting the input lets the same file be selected again after a failure.
    expect(await page.locator('input[type=file]').inputValue()).toBe('');
  } finally { await page.close(); }
}, 30_000);

it('targets a folder, shows the destination, expands it and keeps the drop out of chat', async () => {
  const page = await open();
  try {
    const selector = '[data-file-drop-directory="docs"]';
    const files = [{ name: 'photo.png', bytes: [137, 80, 0, 255] }];
    await drag(page, selector, 'dragenter', files);
    await page.getByText('Upload to docs', { exact: true }).waitFor();
    await drag(page, selector, 'drop', files);
    await page.getByRole('button', { name: 'photo.png', exact: true }).waitFor();
    expect((await uploaded(page))[0]).toMatchObject({ path: 'docs/photo.png', bytes: files[0].bytes });
    expect(await page.evaluate(() => (window as unknown as { chatDrops: number }).chatDrops)).toBe(0);
    expect(await page.getByText('Upload to docs', { exact: true }).count()).toBe(0);
  } finally { await page.close(); }
});

it('continues after a collision and uploads a drop on blank space to the root', async () => {
  const page = await open();
  try {
    const selector = '[data-tree-search]';
    await drag(page, selector, 'drop', [{ name: 'exists.txt', bytes: [1] }, { name: 'kept.txt', bytes: [2] }]);
    await page.getByText('exists.txt: exists.txt already exists', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'kept.txt', exact: true }).waitFor();
    expect((await uploaded(page)).map(file => file.path)).toEqual(['exists.txt', 'kept.txt']);
  } finally { await page.close(); }
});

it('targets the parent of a file row and clears the destination when a drag leaves', async () => {
  const page = await open();
  try {
    await page.getByRole('button', { name: 'docs', exact: true }).click();
    await page.getByRole('button', { name: 'guide.md', exact: true }).waitFor();
    const selector = '[data-file-drop-directory="docs"]:has-text("guide.md")';
    const files = [{ name: 'beside.txt', bytes: [10] }];
    await drag(page, selector, 'dragenter', files);
    await page.getByText('Upload to docs', { exact: true }).waitFor();
    await drag(page, selector, 'dragleave', files);
    await expect.poll(() => page.getByText('Upload to docs', { exact: true }).count()).toBe(0);
    await drag(page, selector, 'drop', files);
    await page.getByRole('button', { name: 'beside.txt', exact: true }).waitFor();
    expect((await uploaded(page))[0].path).toBe('docs/beside.txt');
  } finally { await page.close(); }
});

it('refuses uploads to an archived agent and leaves ordinary text drags alone', async () => {
  const page = await open('?archived=1');
  try {
    expect(await page.getByRole('button', { name: 'Create new', exact: true }).count()).toBe(0);
    expect(await page.locator('input[type=file]').count()).toBe(0);
    await drag(page, '[data-tree-search]', 'drop', [{ name: 'no.txt', bytes: [1] }]);
    expect(await uploaded(page)).toEqual([]);
    const prevented = await page.locator('[data-tree-search]').evaluate(target => {
      const transfer = new DataTransfer();
      transfer.setData('text/plain', 'a reference');
      const event = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(prevented).toBe(false);
  } finally { await page.close(); }
});

it('uploads to the team being viewed in a space document', async () => {
  const page = await open('?space=1');
  try {
    await drag(page, '[data-tree-search]', 'drop', [{ name: 'team.txt', bytes: [1] }]);
    await expect.poll(() => uploaded(page)).toHaveLength(1);
    expect((await uploaded(page))[0].url).toContain('/api/space/team-12345678/workspaces/agent/file/upload');
  } finally { await page.close(); }
});
