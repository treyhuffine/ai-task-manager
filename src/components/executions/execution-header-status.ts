export type ExecutionHeaderStatusKind =
  | 'archived'
  | 'setup-failed'
  | 'setting-up'
  | 'pending'
  | 'working'
  | 'background'
  | 'respond'
  | 'idle'
  | 'ready';

interface DeriveExecutionHeaderStatusInput {
  isArchived: boolean;
  isSetupFailed: boolean;
  isSettingUp: boolean;
  isPending: boolean;
  isRunning: boolean;
  hasBackgroundTasks: boolean;
  lastOutcomeEventAt: string | null;
  lastViewedAt: string | null;
}

export function deriveExecutionHeaderStatus({
  isArchived,
  isSetupFailed,
  isSettingUp,
  isPending,
  isRunning,
  hasBackgroundTasks,
  lastOutcomeEventAt,
  lastViewedAt,
}: DeriveExecutionHeaderStatusInput): ExecutionHeaderStatusKind {
  const needsResponse =
    !isRunning &&
    !hasBackgroundTasks &&
    !isArchived &&
    !!lastOutcomeEventAt &&
    lastOutcomeEventAt > (lastViewedAt ?? '1970-01-01');

  return isArchived
    ? 'archived'
    : isSetupFailed
      ? 'setup-failed'
      : isSettingUp
        ? 'setting-up'
        : isPending
          ? 'pending'
          : isRunning
            ? 'working'
            : hasBackgroundTasks
              ? 'background'
              : needsResponse
                ? 'respond'
                : lastOutcomeEventAt
                  ? 'idle'
                  : 'ready';
}
