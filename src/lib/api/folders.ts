import { api } from './client';
import type { FileResponse, TreeResponse } from './sessions';
import { folderApiBase, type FolderSource } from '@/lib/folders/source';

/** Folder reads that work for any source (see `src/lib/folders/source.ts`). */
export const foldersApi = {
  tree(source: FolderSource): Promise<TreeResponse> {
    return api.get<TreeResponse>(`${folderApiBase(source)}/tree`);
  },

  file(source: FolderSource, path: string, opts?: { base?: boolean }): Promise<FileResponse> {
    return api.get<FileResponse>(`${folderApiBase(source)}/file`, {
      query: opts?.base ? { path, base: '1' } : { path },
    });
  },
};
