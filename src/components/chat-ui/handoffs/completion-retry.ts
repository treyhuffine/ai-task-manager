import type { WorkResultCompleteInput } from '@/lib/api/results';

const key = (resultId: string) => `ri.result-completion.${resultId}`;

/** Retain the complete submitted intent when the HTTP outcome is uncertain. */
export function pendingResultCompletion(resultId: string): WorkResultCompleteInput | null {
  try {
    const input = JSON.parse(sessionStorage.getItem(key(resultId)) ?? 'null');
    if (!input || typeof input !== 'object' || typeof input.requestId !== 'string' || !input.requestId
      || typeof input.taskId !== 'string' || !input.taskId || !Number.isInteger(input.expectedStatusChangedCount)
      || input.expectedStatusChangedCount < 0) return null;
    if (input.runtimeChoice !== undefined && !['keep_running', 'stop_running_agent'].includes(input.runtimeChoice)) return null;
    for (const field of ['acknowledgedChildIds', 'acknowledgedExecutionIds']) {
      if (input[field] !== undefined && (!Array.isArray(input[field]) || input[field].some((id: unknown) => typeof id !== 'string'))) return null;
    }
    return input as WorkResultCompleteInput;
  } catch { return null; }
}

export function retainResultCompletion(resultId: string, input: WorkResultCompleteInput): void {
  try { sessionStorage.setItem(key(resultId), JSON.stringify(input)); } catch { /* Browser storage may be unavailable. */ }
}

export function clearPendingResultCompletion(resultId: string): void {
  try { sessionStorage.removeItem(key(resultId)); } catch { /* Browser storage may be unavailable. */ }
}
