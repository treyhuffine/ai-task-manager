import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { terminalsApi, type TerminalDescriptor } from '@/lib/api/terminals';

const KEY = (sessionId: string) => ['session', sessionId, 'terminals'] as const;

export function useTerminals(sessionId: string | null) {
  return useQuery({
    queryKey: KEY(sessionId ?? ''),
    queryFn: () => terminalsApi.list(sessionId!),
    enabled: !!sessionId,
    staleTime: 30_000,
  });
}

export function useCreateTerminal(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dims: { cols: number; rows: number }) =>
      terminalsApi.create(sessionId, dims),
    onSuccess: (created) => {
      qc.setQueryData<TerminalDescriptor[]>(KEY(sessionId), (prev) => {
        const list = prev ?? [];
        return [...list, created];
      });
    },
  });
}

export function useKillTerminal(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (terminalId: string) => terminalsApi.kill(sessionId, terminalId),
    onSuccess: (_res, terminalId) => {
      qc.setQueryData<TerminalDescriptor[]>(KEY(sessionId), (prev) =>
        (prev ?? []).filter((t) => t.id !== terminalId),
      );
    },
  });
}
