'use client';

import { useMemo } from 'react';
import { useSessionBuckets } from './use-session-buckets';
import { useAgentAttention } from './use-agent-attention';
import { combineActivityBuckets } from '@/lib/sessions/activity-buckets';

/** Shared live populations, independent of presentation preferences. */
export function useActivityBuckets() {
  const sessions = useSessionBuckets();
  const agents = useAgentAttention();
  return useMemo(() => combineActivityBuckets(sessions, agents), [sessions, agents]);
}
