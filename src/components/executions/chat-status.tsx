'use client';

import { useEffect, useState } from 'react';
import { BACKGROUND_DOT } from '@/components/workspaces/activity-style';
import { useWorkActivity } from '@/contexts/work-context';
import type { WorkspaceRecord } from '@/db/types';
import { useDevice } from '@/hooks/use-devices';
import { useDeliveries, useLastTurnEndedAt } from '@/hooks/use-execution';
import type { ChatSessionWithExecution } from '@/lib/api/dto/records';
import { preparedFolder } from '@/lib/executions/location';
import { cn } from '@/lib/utils';
import { formatCompactRelative } from '@/lib/utils/relative-time';
import { Tip } from '@/components/ui/tip';
import {
  deriveExecutionHeaderStatus,
  describeChatStatus,
  type ChatStatusDescription,
  type ChatStatusTone,
} from './execution-header-status';
import { useSteadyRunning } from './steady-running';

/**
 * One chat's status in words with its dot ("Working", "Finished 5m ago"),
 * shared by the execution header and a chat open beside an agent's main
 * chat, so both say the same thing about the same chat. The rules are in
 * `execution-header-status.ts`.
 */

export const CHAT_STATUS_DOT: Record<ChatStatusTone, string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  blue: 'bg-blue-500',
  sky: BACKGROUND_DOT,
  muted: 'bg-transparent ring-[1.5px] ring-inset ring-muted-foreground/60',
};

const CHAT_STATUS_TEXT: Record<ChatStatusTone, string> = {
  green: 'text-muted-foreground',
  amber: 'text-amber-700 dark:text-amber-400',
  rose: 'text-rose-700 dark:text-rose-400',
  blue: 'text-muted-foreground',
  sky: 'text-muted-foreground',
  muted: 'text-muted-foreground',
};

/** Re-render on an interval so "Finished 5m ago" stays true. */
function useMinuteTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);
}

/** The chat's status, from its row, its runtime and the device it runs on. */
export function useChatStatus({
  session,
  workspace,
  isRunning,
  hasBackgroundTasks,
}: {
  session: ChatSessionWithExecution;
  workspace: WorkspaceRecord | undefined;
  isRunning: boolean;
  hasBackgroundTasks: boolean;
}): ChatStatusDescription {
  useMinuteTick();
  const { pendingInputSessionIds } = useWorkActivity();
  const lastTurnEndedAt = useLastTurnEndedAt(session.id);
  const isSetupFailed = !!session.setupError;
  // Mirror ExecutionView's derivation: git workspace whose session
  // hasn't been provisioned yet. setupError wins (separate state) so
  // we don't render "setting up" forever on a failed provision.
  const isSettingUp =
    !!workspace && workspace.isGit === true && !preparedFolder(session) && !isSetupFailed;

  // Away from the home, what its device is doing shapes the status: a
  // message waiting for it, or a turn under way when it lost contact (P3.2).
  const remote = session.location && !session.location.isHome ? session.location : null;
  const device = useDevice(remote?.deviceId);
  const { data: deliveries } = useDeliveries(remote ? session.id : null);
  const elsewhere = remote
    ? {
        // Until the list loads, assume connected rather than claim it dropped.
        connected: device?.worker?.connected ?? true,
        asleep: device?.worker?.reportedState === 'asleep',
        waiting: Object.values(deliveries ?? {}).some((d) => d.state === 'waiting'),
      }
    : null;

  // Whichever knows first that a turn ended: the session, or its transcript here.
  const lastOutcomeEventAt = [session.lastOutcomeEventAt, lastTurnEndedAt].filter(Boolean).sort().at(-1) ?? null;
  const steadyRunning = useSteadyRunning(isRunning, lastOutcomeEventAt);
  const statusKind = deriveExecutionHeaderStatus({
    isArchived: session.status === 'archived',
    isSetupFailed,
    isSettingUp,
    isPending: pendingInputSessionIds.has(session.id),
    isRunning: steadyRunning,
    hasBackgroundTasks,
    lastOutcomeEventAt,
    lastViewedAt: session.lastViewedAt,
    elsewhere,
  });
  return describeChatStatus(
    statusKind,
    lastOutcomeEventAt,
    formatCompactRelative,
    remote ? { name: remote.name, lastSeenAt: device?.lastSeenAt ?? null } : null,
  );
}

/** The status as text with a dot: no border, no hover, so it never reads as a button. */
export function ChatStatusText({ status, className }: { status: ChatStatusDescription; className?: string }) {
  return (
    <Tip label={status.title}>
      <span
        aria-label={`Status: ${status.label}${status.detail ? `, ${status.detail}` : ''}`}
        className={cn('inline-flex min-w-0 cursor-default items-center gap-1.5 whitespace-nowrap text-[12px]', CHAT_STATUS_TEXT[status.tone], className)}
      >
        <span aria-hidden className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', CHAT_STATUS_DOT[status.tone], status.pulse && 'animate-pulse')} />
        <span>{status.label}</span>
        {status.detail && <span className="truncate text-muted-foreground/80">· {status.detail}</span>}
      </span>
    </Tip>
  );
}
