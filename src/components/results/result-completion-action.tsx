'use client';

import { useState } from 'react';
import { CheckCheck, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAcceptResultComplete } from '@/hooks/use-results';
import type { WorkResultDetailResponse } from '@/lib/api/results';
import { pendingResultCompletion } from './completion-retry';

export function ResultCompletionAction({ resultId, options }: { resultId: string; options: WorkResultDetailResponse['completionOptions'] }) {
  const complete = useAcceptResultComplete(resultId);
  const [selectedId, setSelectedId] = useState('');
  const choices = options?.choices ?? [];
  const pending = pendingResultCompletion(resultId);
  const selected = choices.length === 1 ? choices[0] : choices.find((choice) => choice.id === selectedId);
  if (!choices.length && !pending) return null;
  const reason = options?.staleReason === 'superseded' ? 'This handoff has a newer snapshot. Open that snapshot before completing a task.'
    : options?.staleReason === 'revision_mismatch' ? 'The work has changed since this handoff. Save a current snapshot before completing a task.' : null;
  return <div className="w-full space-y-2 rounded-md border bg-muted/20 p-3">
    {pending && !complete.isPending && <p className="text-xs text-muted-foreground">The earlier submission&apos;s outcome is uncertain. Retry that same acceptance and task completion to confirm it.</p>}
    {!pending && choices.length > 1 && <label className="block space-y-1 text-xs"><span>Choose the task to complete</span><select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} disabled={complete.isPending} className="block w-full max-w-full rounded-md border bg-background px-2 py-2"><option value="">Select a linked task</option>{choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.title || 'Untitled task'}</option>)}</select></label>}
    {!pending && choices.length === 1 && <p className="break-words text-xs text-muted-foreground">Complete {choices[0].title || 'the linked task'}</p>}
    {!pending && reason && <p className="text-xs text-muted-foreground">{reason}</p>}
    {!pending && !reason && options?.codeFreshness === 'unknown' && <p className="text-xs text-muted-foreground">Code identity is unknown. This handoff is not confirmed to match current work.</p>}
    {!pending && !!selected?.recurrence && <p className="text-xs text-muted-foreground">Records this occurrence and keeps the recurring task&apos;s schedule.</p>}
    <Button size="xs" variant="outline" disabled={(!selected || !!reason) && !pending || complete.isPending} onClick={() => {
      if (pending?.taskId) complete.mutate({ ...pending, taskId: pending.taskId });
      else if (selected) complete.mutate({ taskId: selected.id, expectedStatusChangedCount: selected.statusChangedCount });
    }}>{complete.isPending ? <Loader2 className="animate-spin" /> : <CheckCheck />}{complete.isPending ? 'Accepting and completing' : pending ? 'Retry acceptance and completion' : 'Accept and complete'}</Button>
  </div>;
}
