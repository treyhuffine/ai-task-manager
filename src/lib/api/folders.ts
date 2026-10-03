import { type FolderSource } from '@/lib/folders/source';
import { trpcClient } from '@/lib/trpc/client';

/**
 * Folder reads and writes that work for any source (see
 * `src/lib/folders/source.ts`): an execution's worktree or an agent's own
 * folder, the same routes under different prefixes.
 */
export const foldersApi = {
  tree(source: FolderSource) {
    const id = source.kind === 'session' ? source.sessionId : source.workspaceId;
    return source.kind === 'session'
      ? trpcClient.sessions.treeGet.query({ params: { id } })
      : trpcClient.workspaces.treeGet.query({ params: { id } });
  },

  file(source: FolderSource, path: string, opts?: { base?: boolean }) {
    const id = source.kind === 'session' ? source.sessionId : source.workspaceId;
    return source.kind === 'session'
      ? trpcClient.sessions.fileGet.query({ params: { id }, query: { path, ...(opts?.base ? { base: '1' } : {}) } })
      : trpcClient.workspaces.fileGet.query({ params: { id }, query: { path, ...(opts?.base ? { base: '1' } : {}) } });
  },

  writeFile(source: FolderSource, path: string, content: string) {
    const id = source.kind === 'session' ? source.sessionId : source.workspaceId;
    return source.kind === 'session'
      ? trpcClient.sessions.filePut.mutate({ params: { id }, query: { path }, body: { content } })
      : trpcClient.workspaces.filePut.mutate({ params: { id }, query: { path }, body: { content } });
  },

  /** Write conflict-resolved content and stage it (`git add`), so git records
   *  the conflict as resolved. `content` must have no conflict markers left. */
  resolveFileConflict(source: FolderSource, path: string, content: string) {
    const id = source.kind === 'session' ? source.sessionId : source.workspaceId;
    return source.kind === 'session'
      ? trpcClient.sessions.fileResolveConflictPost.mutate({ params: { id }, body: { path, content } })
      : trpcClient.workspaces.fileResolveConflictPost.mutate({ params: { id }, body: { path, content } });
  },

  deleteFile(source: FolderSource, path: string) {
    const id = source.kind === 'session' ? source.sessionId : source.workspaceId;
    return source.kind === 'session'
      ? trpcClient.sessions.fileDelete.mutate({ params: { id }, query: { path } })
      : trpcClient.workspaces.fileDelete.mutate({ params: { id }, query: { path } });
  },

  /** Refuses to overwrite (409), so "New File" can report a name collision. */
  createFile(source: FolderSource, path: string) {
    const id = source.kind === 'session' ? source.sessionId : source.workspaceId;
    return source.kind === 'session'
      ? trpcClient.sessions.fileCreatePost.mutate({ params: { id }, body: { path } })
      : trpcClient.workspaces.fileCreatePost.mutate({ params: { id }, body: { path } });
  },

  renamePath(source: FolderSource, from: string, to: string) {
    const id = source.kind === 'session' ? source.sessionId : source.workspaceId;
    return source.kind === 'session'
      ? trpcClient.sessions.fileRenamePost.mutate({ params: { id }, body: { from, to } })
      : trpcClient.workspaces.fileRenamePost.mutate({ params: { id }, body: { from, to } });
  },

  createDir(source: FolderSource, path: string) {
    const id = source.kind === 'session' ? source.sessionId : source.workspaceId;
    return source.kind === 'session'
      ? trpcClient.sessions.dirPost.mutate({ params: { id }, body: { path } })
      : trpcClient.workspaces.dirPost.mutate({ params: { id }, body: { path } });
  },

  deleteDir(source: FolderSource, path: string) {
    const id = source.kind === 'session' ? source.sessionId : source.workspaceId;
    return source.kind === 'session'
      ? trpcClient.sessions.dirDelete.mutate({ params: { id }, query: { path } })
      : trpcClient.workspaces.dirDelete.mutate({ params: { id }, query: { path } });
  },
};
