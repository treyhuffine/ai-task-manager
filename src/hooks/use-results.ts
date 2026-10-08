'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiErrorStatus, apiErrorText } from '@/lib/api/client';
import { entityKeys } from '@/lib/query/entity-keys';
import { workResultsApi, type WorkResultDecisionInput, type WorkResultReviewInput, type WorkResultListInput, type WorkResultCompleteInput, type WorkResultCompleteResponse } from '@/lib/api/results';
import { useLifecycleGuard } from '@/components/tasks/lifecycle-guard';
import { clearResultRequestKey, resultRequestKey } from '@/components/results/request-key';
import { clearPendingResultCompletion, pendingResultCompletion, retainResultCompletion } from '@/components/results/completion-retry';

export const resultKey = (id: string | null) => ['results', id] as const;

export function useResults(input: WorkResultListInput, enabled = true) {
  return useQuery({ queryKey: ['results', 'list', input], queryFn: () => workResultsApi.list(input), enabled });
}

export function useInfiniteResults(input: Omit<WorkResultListInput, 'limit' | 'offset'>) {
  const limit = 30;
  return useInfiniteQuery({
    queryKey: ['results', 'list', 'pages', input],
    queryFn: ({ pageParam }) => workResultsApi.list({ ...input, limit, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _pages, offset) => lastPage.length === limit ? offset + limit : undefined,
  });
}

export function useResultCapabilities() {
  return useQuery({
    queryKey: ['results', 'capabilities'],
    queryFn: workResultsApi.capabilities,
    staleTime: 5_000,
    refetchInterval: 15_000,
  });
}

export function useResult(id: string | null) {
  return useQuery({
    queryKey: resultKey(id),
    queryFn: () => workResultsApi.get(id!),
    enabled: !!id,
    refetchInterval: (query) => query.state.data?.aiReviews.some((review) => review.status === 'queued' || review.status === 'running') || Object.values(query.state.data?.feedbackDelivery ?? {}).some((delivery) => delivery?.status === 'queued' || delivery?.status === 'running') ? 2_000 : false,
  });
}

function showError(error: unknown) {
  toast.error(apiErrorText(error));
}

export function useSaveHandoff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: workResultsApi.save,
    onError: showError,
    onSettled: (_data, _error, input) => {
      void qc.invalidateQueries({ queryKey: ['session', input.sourceChatSessionId, 'events'] });
      void qc.invalidateQueries({ queryKey: ['results'] });
    },
  });
}

export function usePrepareHandoff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: workResultsApi.prepare,
    onError: showError,
    onSettled: (_data, _error, input) => {
      void qc.invalidateQueries({ queryKey: ['session', input.sourceChatSessionId] });
      void qc.invalidateQueries({ queryKey: ['results'] });
    },
  });
}

export function useResultDecision(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WorkResultDecisionInput) => workResultsApi.decide(id, input),
    onError: showError,
    onSettled: () => { void qc.invalidateQueries({ queryKey: resultKey(id) }); },
  });
}

export function useAcceptResultComplete(id: string) {
  const qc = useQueryClient();
  const guard = useLifecycleGuard();
  return useMutation({
    mutationFn: async (input: Omit<WorkResultCompleteInput, 'requestId'> & { taskId: string }) => {
      let outcome: WorkResultCompleteResponse | null = null;
      const pending = pendingResultCompletion(id);
      const { requestId: previousRequestId, ...submitted } = pending ?? { ...input, requestId: undefined };
      await guard.resolve({ taskId: submitted.taskId!, command: 'complete' }, async (acknowledgments) => {
        const payload = { ...submitted, ...acknowledgments };
        const intent = { resultId: id, ...payload };
        const requestId = previousRequestId && !Object.keys(acknowledgments).length ? previousRequestId : resultRequestKey('accept-complete', intent);
        retainResultCompletion(id, { ...payload, requestId });
        try {
          outcome = await workResultsApi.complete(id, { ...payload, requestId });
          clearPendingResultCompletion(id);
          clearResultRequestKey('accept-complete', intent);
        } catch (error) {
          const status = apiErrorStatus(error);
          if (status !== undefined && status < 500) clearPendingResultCompletion(id);
          throw error;
        }
      });
      return outcome;
    },
    onError: showError,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: entityKeys.tasks.all });
      for (const root of ['results', 'sessions', 'executions']) void qc.invalidateQueries({ queryKey: [root] });
    },
  });
}

export function useRetryResultFeedback(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reviewId: string) => workResultsApi.retryFeedback(id, reviewId),
    onError: showError,
    onSettled: () => { void qc.invalidateQueries({ queryKey: resultKey(id) }); },
  });
}

export function useRequestResultReview(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WorkResultReviewInput) => workResultsApi.requestReview(id, input),
    onError: showError,
    onSettled: () => { void qc.invalidateQueries({ queryKey: resultKey(id) }); },
  });
}

export function useCancelResultReview(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: workResultsApi.cancelReview,
    onError: showError,
    onSettled: () => { void qc.invalidateQueries({ queryKey: resultKey(id) }); },
  });
}
