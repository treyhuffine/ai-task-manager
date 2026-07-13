import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  streamApi,
  type ManualTriageInput,
  type TriageCorrectionInput,
  type StreamAutomationMode,
} from '@/lib/api/stream';
import type { CreateStreamInput, StreamFilter, StreamAutonomyConfig } from '@/db/types';

const STREAM_KEY = ['stream'] as const;
const DECISIONS_KEY = ['stream', 'decisions'] as const;
const PASSES_KEY = ['stream', 'passes'] as const;
const AUTONOMY_KEY = ['stream', 'autonomy'] as const;

/** Triage mutations can create/modify tasks and notes — invalidate all. */
function useInvalidateTriage() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: STREAM_KEY });
    void qc.invalidateQueries({ queryKey: ['tasks'] });
    void qc.invalidateQueries({ queryKey: ['notes'] });
  };
}

export function useStream(filter?: StreamFilter) {
  return useQuery({
    queryKey: [...STREAM_KEY, filter],
    queryFn: () => streamApi.list(filter),
  });
}

export function usePendingStreamCount() {
  const { data } = useStream({ status: 'pending' });
  return data?.length ?? 0;
}

/**
 * The ambient signal is BINARY (spec §1.10): something awaits the user's
 * call, or nothing does. Never surface a raw unprocessed count in
 * navigation.
 */
export function useNeedsYourCall(): boolean {
  const { data } = useStream({ status: 'proposed' });
  return (data?.length ?? 0) > 0;
}

export function useProposedDecisions() {
  return useQuery({
    queryKey: [...DECISIONS_KEY, 'proposed'],
    queryFn: () => streamApi.listDecisions({ state: 'proposed' }),
  });
}

export function useTriagePasses(limit = 10) {
  return useQuery({
    queryKey: [...PASSES_KEY, limit],
    queryFn: () => streamApi.passes(limit),
  });
}

export function useStreamAutonomy() {
  return useQuery({
    queryKey: AUTONOMY_KEY,
    queryFn: () => streamApi.autonomy(),
  });
}

export function useCreateStream() {
  const invalidate = useInvalidateTriage();
  return useMutation({
    mutationFn: (input: CreateStreamInput) => streamApi.create(input),
    onSuccess: invalidate,
  });
}

export function useDismissStream() {
  const invalidate = useInvalidateTriage();
  return useMutation({
    mutationFn: (id: string) => streamApi.dismiss(id),
    onSuccess: invalidate,
  });
}

export function useReopenStream() {
  const invalidate = useInvalidateTriage();
  return useMutation({
    mutationFn: (id: string) => streamApi.reopen(id),
    onSuccess: invalidate,
  });
}

export function useRetryStream() {
  const invalidate = useInvalidateTriage();
  return useMutation({
    mutationFn: (id: string) => streamApi.retry(id),
    onSuccess: invalidate,
  });
}

/** Manual triage from the UI — promote/merge/combine/journal/dismiss. */
export function useTriageDecide() {
  const invalidate = useInvalidateTriage();
  return useMutation({
    mutationFn: (input: ManualTriageInput) => streamApi.decide(input),
    onSuccess: invalidate,
  });
}

export function useAcceptDecision() {
  const invalidate = useInvalidateTriage();
  return useMutation({
    mutationFn: (id: string) => streamApi.acceptDecision(id),
    onSuccess: invalidate,
  });
}

export function useCorrectDecision() {
  const invalidate = useInvalidateTriage();
  return useMutation({
    mutationFn: ({ id, correction }: { id: string; correction: TriageCorrectionInput }) =>
      streamApi.correctDecision(id, correction),
    onSuccess: invalidate,
  });
}

export function useUndoDecision() {
  const invalidate = useInvalidateTriage();
  return useMutation({
    mutationFn: (id: string) => streamApi.undoDecision(id),
    onSuccess: invalidate,
  });
}

export function useStartTriageSweep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => streamApi.triage(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: PASSES_KEY }),
  });
}

export function useMarkPassSeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => streamApi.markPassSeen(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: PASSES_KEY }),
  });
}

export function useSetStreamAutonomy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: StreamAutonomyConfig & { mode?: StreamAutomationMode }) =>
      streamApi.setAutonomy(config),
    onSuccess: () => void qc.invalidateQueries({ queryKey: AUTONOMY_KEY }),
  });
}
