import type { BackgroundTaskStatus } from '@/lib/executor/background-task-event';

export type BackgroundTaskOutcomeTone = 'success' | 'failure' | 'stopped' | 'neutral';

/** User-facing terminal meaning for one persisted background-task outcome. */
export function backgroundTaskOutcomePresentation(
  status: BackgroundTaskStatus | null | undefined,
): { label: 'finished' | 'failed' | 'stopped'; tone: BackgroundTaskOutcomeTone } {
  if (status === 'failed') return { label: 'failed', tone: 'failure' };
  if (status === 'stopped' || status === 'killed') {
    return { label: 'stopped', tone: 'stopped' };
  }
  if (status === 'completed') return { label: 'finished', tone: 'success' };
  return { label: 'finished', tone: 'neutral' };
}
