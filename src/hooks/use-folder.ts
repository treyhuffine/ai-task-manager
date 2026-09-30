import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { foldersApi } from '@/lib/api/folders';
import type { FileResponse } from '@/lib/api/sessions';
import type { FolderSource } from '@/lib/folders/source';
import {
  invalidateWorktree,
  useSession,
  useSessionBaseFile,
  useSessionFile,
  useSessionTree,
  useWorktreeScope,
  worktreeFileKey,
} from '@/hooks/use-execution';
import { useRunOn, useWorkspace } from '@/hooks/use-workspaces';
import { preparedFolder } from '@/lib/executions/location';

/**
 * Folder reads and writes for either source (`src/lib/folders/source.ts`).
 * A session source delegates to the worktree hooks, so it shares their
 * cache entries with the rest of the execution view. A workspace source
 * reads the agent's own folder under its own key root, kept apart from
 * `['workspaces', …]` so a workspace update never re-runs the (slow) tree
 * read.
 *
 * Every hook is called unconditionally with the other kind's argument set
 * to null, which keeps the rules of hooks while only one query runs.
 */

const workspaceScope = (workspaceId: string) => ['workspace-folder', workspaceId] as const;
/** One file read in an agent folder. Reads and the post-save seed share it. */
const workspaceFileKey = (workspaceId: string, path: string | null) => [...workspaceScope(workspaceId), 'file', path] as const;

/** Cache scope for anything derived from the folder (tree, files, terminals). */
export function useFolderScope(source: FolderSource | null): readonly [string, string] | null {
  const sessionScope = useWorktreeScope(source?.kind === 'session' ? source.sessionId : null);
  if (!source) return null;
  return source.kind === 'workspace' ? workspaceScope(source.workspaceId) : sessionScope;
}

export function useFolderTree(source: FolderSource | null) {
  const sessionTree = useSessionTree(source?.kind === 'session' ? source.sessionId : null);
  const workspaceId = source?.kind === 'workspace' ? source.workspaceId : null;
  const workspaceTree = useQuery({
    queryKey: [...workspaceScope(workspaceId ?? '__none__'), 'tree'],
    queryFn: () => foldersApi.tree(source!),
    enabled: !!workspaceId,
    // Same safety-net cadence as the worktree tree: nothing reports edits
    // made outside the app, and the read runs several git subprocesses.
    refetchInterval: 180_000,
    staleTime: 5_000,
  });
  return workspaceId ? workspaceTree : sessionTree;
}

export function useFolderFile(source: FolderSource | null, path: string | null) {
  const sessionFile = useSessionFile(source?.kind === 'session' ? source.sessionId : null, path);
  const workspaceId = source?.kind === 'workspace' ? source.workspaceId : null;
  const workspaceFile = useQuery({
    queryKey: workspaceFileKey(workspaceId ?? '__none__', path),
    queryFn: () => foldersApi.file(source!, path!),
    enabled: !!workspaceId && !!path,
    staleTime: 30_000,
  });
  return workspaceId ? workspaceFile : sessionFile;
}

/** The diff "old" side: the base commit (HEAD for an agent's own checkout). */
export function useFolderBaseFile(source: FolderSource | null, path: string | null) {
  const sessionFile = useSessionBaseFile(source?.kind === 'session' ? source.sessionId : null, path);
  const workspaceId = source?.kind === 'workspace' ? source.workspaceId : null;
  const workspaceFile = useQuery({
    queryKey: [...workspaceScope(workspaceId ?? '__none__'), 'file', path, 'base'],
    queryFn: () => foldersApi.file(source!, path!, { base: true }),
    enabled: !!workspaceId && !!path,
    staleTime: 60_000,
  });
  return workspaceId ? workspaceFile : sessionFile;
}

/**
 * Absolute path of the folder, on the device it's on (P3.5): the
 * execution's worktree wherever it runs, or the agent's folder on the
 * device it lives on.
 */
export function useFolderRoot(source: FolderSource | null): string | null {
  const { data: session } = useSession(source?.kind === 'session' ? source.sessionId : null);
  const workspaceId = source?.kind === 'workspace' ? source.workspaceId : null;
  const { data: workspace } = useWorkspace(workspaceId);
  const { data: runOn } = useRunOn(workspaceId);
  if (!source) return null;
  if (source.kind === 'session') return session ? preparedFolder(session) : null;
  const livesOn = runOn?.livesOn;
  if (livesOn && !livesOn.isHome) return livesOn.folder;
  return workspace?.cwd ?? null;
}

// ─── Writes ──────────────────────────────────────────────────────────────

/**
 * File mutations behind the viewer and the tree, for either source. Each
 * one invalidates the folder's whole cache scope, so a save, create,
 * delete or rename ripples through status flags, diffs and any sibling
 * viewer reading the touched file. For a worktree that also covers the
 * session row and the rail's diff badges (`invalidateWorktree`).
 *
 * Not optimistic: the tree carries git status flags and mtimes we'd have to
 * synthesize to match `git status`. The request is local (~10ms), so a
 * round trip is the simpler correctness story.
 */

function folderFileKey(qc: QueryClient, source: FolderSource, path: string): readonly unknown[] {
  return source.kind === 'session'
    ? worktreeFileKey(qc, source.sessionId, path)
    : workspaceFileKey(source.workspaceId, path);
}

function invalidateFolder(qc: QueryClient, source: FolderSource): void {
  if (source.kind === 'session') invalidateWorktree(qc, source.sessionId);
  else qc.invalidateQueries({ queryKey: workspaceScope(source.workspaceId) });
}

/** Put just-written content in the file cache, so navigating away and back
 *  doesn't flash the old version before the background refetch lands. */
function seedFile(qc: QueryClient, source: FolderSource, path: string, content: string): void {
  qc.setQueryData<FileResponse>(folderFileKey(qc, source, path), (prev) => (prev ? { ...prev, content } : prev));
}

/** Mutation key for saves, so the tree can show a spinner on the file being
 *  saved (autosave on blur fires them from the viewer). */
export function writeFileMutationKey(source: FolderSource): readonly unknown[] {
  return source.kind === 'session'
    ? ['session', source.sessionId, 'write-file']
    : [...workspaceScope(source.workspaceId), 'write-file'];
}

export function useWriteFile(source: FolderSource) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: writeFileMutationKey(source),
    mutationFn: ({ path, content }: { path: string; content: string }) => foldersApi.writeFile(source, path, content),
    onSuccess: (_data, vars) => {
      seedFile(qc, source, vars.path, vars.content);
      invalidateFolder(qc, source);
    },
  });
}

/** Write the resolved file and `git add` it, so it leaves the tree's
 *  Conflicts section. */
export function useResolveFileConflict(source: FolderSource) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      foldersApi.resolveFileConflict(source, path, content),
    onSuccess: (_data, vars) => {
      seedFile(qc, source, vars.path, vars.content);
      invalidateFolder(qc, source);
    },
  });
}

export function useDeletePath(source: FolderSource) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => foldersApi.deleteFile(source, path),
    onSuccess: () => invalidateFolder(qc, source),
  });
}

export function useCreateFile(source: FolderSource) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => foldersApi.createFile(source, path),
    onSuccess: () => invalidateFolder(qc, source),
  });
}

export function useRenamePath(source: FolderSource) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) => foldersApi.renamePath(source, from, to),
    onSuccess: () => invalidateFolder(qc, source),
  });
}

export function useCreateDir(source: FolderSource) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => foldersApi.createDir(source, path),
    onSuccess: () => invalidateFolder(qc, source),
  });
}

export function useDeleteDir(source: FolderSource) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => foldersApi.deleteDir(source, path),
    onSuccess: () => invalidateFolder(qc, source),
  });
}
