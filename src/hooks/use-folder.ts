import { useQuery } from '@tanstack/react-query';
import { foldersApi } from '@/lib/api/folders';
import type { FolderSource } from '@/lib/folders/source';
import {
  useSession,
  useSessionBaseFile,
  useSessionFile,
  useSessionTree,
  useWorktreeScope,
} from '@/hooks/use-execution';
import { useWorkspace } from '@/hooks/use-workspaces';

/**
 * Folder reads for either source (`src/lib/folders/source.ts`). A session
 * source delegates to the worktree hooks, so it shares their cache entries
 * with the rest of the execution view. A workspace source reads the agent's
 * own folder under its own key root, kept apart from `['workspaces', …]`
 * so a workspace update never re-runs the (slow) tree read.
 *
 * Every hook is called unconditionally with the other kind's argument set
 * to null, which keeps the rules of hooks while only one query runs.
 */

const workspaceScope = (workspaceId: string) => ['workspace-folder', workspaceId] as const;

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
    queryKey: [...workspaceScope(workspaceId ?? '__none__'), 'file', path],
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

/** Absolute path of the folder: the worktree, or the agent's folder. */
export function useFolderRoot(source: FolderSource | null): string | null {
  const { data: session } = useSession(source?.kind === 'session' ? source.sessionId : null);
  const { data: workspace } = useWorkspace(source?.kind === 'workspace' ? source.workspaceId : null);
  if (!source) return null;
  return source.kind === 'workspace' ? workspace?.cwd ?? null : session?.worktreePath ?? null;
}
