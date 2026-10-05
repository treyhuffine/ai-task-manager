import { useFolderScope } from '@/hooks/use-folder';
import { apiErrorBody, apiErrorStatus, apiErrorText } from '@/lib/api/client';
import { terminalsApi, type TerminalDescriptor } from '@/lib/api/terminals';
import { terminalApiBase, terminalFolder, type TerminalSource } from '@/lib/folders/source';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

/**
 * Terminals for a source: an execution's worktree, an agent's own folder,
 * or Home's shells on the box (`src/lib/folders/source.ts`).
 *
 * Keyed by the folder's scope, matching the PTY registry's ownership: a
 * shell is a shell *in the worktree*, so every chat on that execution sees
 * the same one. Keying by chat session used to mean a provider switch
 * handed you a fresh `zsh -l` in the same directory while the old shell
 * kept running, unreachable. An agent's own shells live under the
 * workspace, apart from every execution's, and Home's under one fixed
 * scope of their own.
 */
const KEY = (scope: readonly string[]) => [...scope, 'terminals'] as const;
const HOME_SCOPE = ['home-box'] as const;

/** The unresolved-scope fallback stays source-unique so a disabled query can't collide. */
function keyFor(scope: readonly string[] | null, source: TerminalSource | null) {
  return KEY(scope ?? ['unresolved', source ? terminalApiBase(source) : '__none__']);
}

/** The cache scope a source's terminals share: its folder's, or Home's own. */
function useTerminalScope(source: TerminalSource | null): readonly string[] | null {
  const folderScope = useFolderScope(terminalFolder(source));
  return source?.kind === 'home' ? HOME_SCOPE : folderScope;
}

/**
 * The folder's device isn't connected (P3.5): its shells are there, out of
 * reach until it's back. Says why, for the panel to show instead of a shell.
 */
export function terminalsUnavailable(err: unknown): string | null {
  const status = apiErrorStatus(err);
  const body = apiErrorBody(err) as { error?: string; message?: string } | null;
  if (status === 503 && body?.error === 'websocket_unavailable') return body.message ?? 'The terminal WebSocket is disconnected. Reconnecting.';
  return status === 409 && body?.error === 'unavailable' ? (body.message ?? 'Its device is not connected.') : null;
}

export function useTerminals(source: TerminalSource | null) {
  const scope = useTerminalScope(source);
  return useQuery({
    queryKey: keyFor(scope, source),
    queryFn: ({ signal }) => terminalsApi.list(terminalApiBase(source!), signal),
    enabled: !!source && !!scope,
    staleTime: 30_000,
    // An away device is said at once, and checked on until it's back.
    retry: (count, err) => !terminalsUnavailable(err) && count < 2,
    refetchInterval: (query) => (terminalsUnavailable(query.state.error) ? 5_000 : false),
  });
}

export function useCreateTerminal(source: TerminalSource) {
  const qc = useQueryClient();
  const scope = useTerminalScope(source);
  return useMutation({
    mutationFn: (dims: { cols: number; rows: number }) =>
      terminalsApi.create(terminalApiBase(source), dims),
    onSuccess: (created) => {
      qc.setQueryData<TerminalDescriptor[]>(keyFor(scope, source), (prev) => [...(prev ?? []), created]);
    },
    onError: (error) => {
      toast.error(apiErrorText(error));
      if (apiErrorStatus(error) === 424) void qc.invalidateQueries({ queryKey: keyFor(scope, source) });
    },
  });
}

export function useKillTerminal(source: TerminalSource) {
  const qc = useQueryClient();
  const scope = useTerminalScope(source);
  return useMutation({
    mutationFn: (terminalId: string) => terminalsApi.kill(terminalApiBase(source), terminalId),
    onSuccess: (_res, terminalId) => {
      qc.setQueryData<TerminalDescriptor[]>(
        keyFor(scope, source),
        (prev) => (prev ?? []).filter((t) => t.id !== terminalId),
      );
    },
    onError: (error) => {
      toast.error(apiErrorText(error));
      if (apiErrorStatus(error) === 424) void qc.invalidateQueries({ queryKey: keyFor(scope, source) });
    },
  });
}
