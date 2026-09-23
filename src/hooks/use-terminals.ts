import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { terminalsApi, type TerminalDescriptor } from '@/lib/api/terminals';
import { useFolderScope } from '@/hooks/use-folder';
import { folderApiBase, type FolderSource } from '@/lib/folders/source';

/**
 * Terminals for a folder: an execution's worktree or an agent's own folder
 * (`src/lib/folders/source.ts`).
 *
 * Keyed by the folder's scope, matching the PTY registry's ownership: a
 * shell is a shell *in the worktree*, so every chat on that execution sees
 * the same one. Keying by chat session used to mean a provider switch
 * handed you a fresh `zsh -l` in the same directory while the old shell
 * kept running, unreachable. An agent's own shells live under the
 * workspace, apart from every execution's.
 */
const KEY = (scope: readonly string[]) => [...scope, 'terminals'] as const;

/** The unresolved-scope fallback stays source-unique so a disabled query can't collide. */
function keyFor(scope: readonly string[] | null, source: FolderSource | null) {
  return KEY(scope ?? ['unresolved', source ? folderApiBase(source) : '__none__']);
}

export function useTerminals(source: FolderSource | null) {
  const scope = useFolderScope(source);
  return useQuery({
    queryKey: keyFor(scope, source),
    queryFn: () => terminalsApi.list(folderApiBase(source!)),
    enabled: !!source && !!scope,
    staleTime: 30_000,
  });
}

export function useCreateTerminal(source: FolderSource) {
  const qc = useQueryClient();
  const scope = useFolderScope(source);
  return useMutation({
    mutationFn: (dims: { cols: number; rows: number }) =>
      terminalsApi.create(folderApiBase(source), dims),
    onSuccess: (created) => {
      qc.setQueryData<TerminalDescriptor[]>(keyFor(scope, source), (prev) => [...(prev ?? []), created]);
    },
  });
}

export function useKillTerminal(source: FolderSource) {
  const qc = useQueryClient();
  const scope = useFolderScope(source);
  return useMutation({
    mutationFn: (terminalId: string) => terminalsApi.kill(folderApiBase(source), terminalId),
    onSuccess: (_res, terminalId) => {
      qc.setQueryData<TerminalDescriptor[]>(
        keyFor(scope, source),
        (prev) => (prev ?? []).filter((t) => t.id !== terminalId),
      );
    },
  });
}
