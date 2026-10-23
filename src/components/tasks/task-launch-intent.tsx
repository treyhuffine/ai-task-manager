'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useTask } from '@/hooks/use-tasks';
import { myRiClient } from '@/lib/spaces/my-ri-client';
import { StartWithAgentButton } from './start-with-agent-button';
import type { RouterOutputs } from '@/lib/trpc/router';
import { apiErrorText } from '@/lib/api/client';

/** The destination Home resolves the reference, then uses the ordinary Continue flow. */
export function TaskLaunchIntent() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get('workTask');
  const teamId = params.get('workTeam');
  const local = useTask(teamId ? null : id);
  const intent = JSON.stringify([teamId, id]);
  const [preparation, setPrepared] = useState<{ intent: string; value: RouterOutputs['spaces']['prepareAgentTask'] } | null>(null);
  const [failure, setError] = useState<{ intent: string; error: unknown } | null>(null);
  const prepared = preparation?.intent === intent ? preparation.value : null;
  const error = failure?.intent === intent ? failure.error : null;
  useEffect(() => {
    if (!id || !teamId) return;
    let abandoned = false;
    void myRiClient.spaces.prepareAgentTask.mutate({ teamId, taskId: id }).then(value => {
      if (!abandoned) setPrepared({ intent, value });
      else if (value.prepared) void myRiClient.spaces.discardPreparedAgentTask.mutate({ id: value.task.id, createdAt: value.task.createdAt, restoreReleased: value.restoreReleased, preparedUpdatedAt: value.preparedUpdatedAt, preparedFingerprint: value.preparedFingerprint, preparedExecutionCount: value.preparedExecutionCount });
    }).catch(error => { if (!abandoned) setError({ intent, error }); });
    return () => { abandoned = true; };
  }, [id, teamId, intent]);
  const task = teamId ? prepared?.task : local.data;
  if (!id) return null;
  if (error || local.error) return <div role="alert">Could not open this task. {apiErrorText(error ?? local.error)}</div>;
  if (!task) return null;
  return <div className="hidden"><StartWithAgentButton key={task.id} task={task} autoOpen onHandled={() => {
    const next = new URLSearchParams(window.location.search);
    next.delete('workTask'); next.delete('workTeam');
    router.replace(next.size ? `/?${next}` : '/', { scroll: false });
  }} onCancel={prepared?.prepared ? () => { void myRiClient.spaces.discardPreparedAgentTask.mutate({ id: task.id, createdAt: task.createdAt, restoreReleased: prepared.restoreReleased, preparedUpdatedAt: prepared.preparedUpdatedAt, preparedFingerprint: prepared.preparedFingerprint, preparedExecutionCount: prepared.preparedExecutionCount }); } : undefined}/></div>;
}
