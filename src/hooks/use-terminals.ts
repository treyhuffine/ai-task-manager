import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { terminalsApi, type TerminalDescriptor } from '@/lib/api/terminals';
import { useWorktreeScope, worktreeScopeFromCache } from '@/hooks/use-execution';

/**
 * Terminals for the execution's worktree.
 *
 * Keyed by execution, matching the PTY registry's ownership: a shell is a
 * shell *in the worktree*, so every chat on that execution sees the same
 * one. Keying by chat session used to mean a provider switch handed you a
 * fresh `zsh -l` in the same directory while the old shell kept running,
 * unreachable.
 */
const KEY = (scope: readonly string[]) => [...scope, 'terminals'] as const;

export function useTerminals(sessionId: string | null) {
  const scope = useWorktreeScope(sessionId);
  return useQuery({
    // The `?? [...]` fallback only applies while the scope is unresolved
    // (query disabled). It stays session-unique so a disabled query can't
    // collide with another session's entry.
    queryKey: KEY(scope ?? ['session', sessionId ?? '__none__']),
    queryFn: () => terminalsApi.list(sessionId!),
    enabled: !!sessionId && !!scope,
    staleTime: 30_000,
  });
}

export function useCreateTerminal(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dims: { cols: number; rows: number }) =>
      terminalsApi.create(sessionId, dims),
    onSuccess: (created) => {
      qc.setQueryData<TerminalDescriptor[]>(
        KEY(worktreeScopeFromCache(qc, sessionId)),
        (prev) => [...(prev ?? []), created],
      );
    },
  });
}

export function useKillTerminal(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (terminalId: string) => terminalsApi.kill(sessionId, terminalId),
    onSuccess: (_res, terminalId) => {
      qc.setQueryData<TerminalDescriptor[]>(
        KEY(worktreeScopeFromCache(qc, sessionId)),
        (prev) => (prev ?? []).filter((t) => t.id !== terminalId),
      );
    },
  });
}
