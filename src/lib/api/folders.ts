import { api } from './client';
import type { FileResponse, TreeResponse } from './sessions';
import { folderApiBase, type FolderSource } from '@/lib/folders/source';

/**
 * Folder reads and writes that work for any source (see
 * `src/lib/folders/source.ts`): an execution's worktree or an agent's own
 * folder, the same routes under different prefixes.
 */
export const foldersApi = {
  tree(source: FolderSource): Promise<TreeResponse> {
    return api.get<TreeResponse>(`${folderApiBase(source)}/tree`);
  },

  file(source: FolderSource, path: string, opts?: { base?: boolean }): Promise<FileResponse> {
    return api.get<FileResponse>(`${folderApiBase(source)}/file`, {
      query: opts?.base ? { path, base: '1' } : { path },
    });
  },

  writeFile(source: FolderSource, path: string, content: string): Promise<{ ok: true; path: string; size: number }> {
    return api.put<{ ok: true; path: string; size: number }>(`${folderApiBase(source)}/file`, { content }, { query: { path } });
  },

  /** Write conflict-resolved content and stage it (`git add`), so git records
   *  the conflict as resolved. `content` must have no conflict markers left. */
  resolveFileConflict(source: FolderSource, path: string, content: string): Promise<{ ok: true; path: string; size: number }> {
    return api.post<{ ok: true; path: string; size: number }>(`${folderApiBase(source)}/file/resolve-conflict`, { path, content });
  },

  deleteFile(source: FolderSource, path: string): Promise<{ ok: true; path: string; kind: 'file' | 'dir' }> {
    return api.delete<{ ok: true; path: string; kind: 'file' | 'dir' }>(`${folderApiBase(source)}/file`, { query: { path } });
  },

  /** Refuses to overwrite (409), so "New File" can report a name collision. */
  createFile(source: FolderSource, path: string): Promise<{ ok: true; path: string }> {
    return api.post<{ ok: true; path: string }>(`${folderApiBase(source)}/file/create`, { path });
  },

  renamePath(source: FolderSource, from: string, to: string): Promise<{ ok: true; from: string; to: string; kind: 'file' | 'dir' }> {
    return api.post<{ ok: true; from: string; to: string; kind: 'file' | 'dir' }>(`${folderApiBase(source)}/file/rename`, { from, to });
  },

  createDir(source: FolderSource, path: string): Promise<{ ok: true; path: string }> {
    return api.post<{ ok: true; path: string }>(`${folderApiBase(source)}/dir`, { path });
  },

  deleteDir(source: FolderSource, path: string): Promise<{ ok: true; path: string; kind: 'file' | 'dir' }> {
    return api.delete<{ ok: true; path: string; kind: 'file' | 'dir' }>(`${folderApiBase(source)}/dir`, { query: { path } });
  },
};
