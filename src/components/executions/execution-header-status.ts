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

/** `sky` is background work: the turn is over but something it started still runs. */
export type ChatStatusTone = 'green' | 'amber' | 'rose' | 'blue' | 'sky' | 'muted';

export interface ChatStatusDescription {
  /** The status in words, e.g. "Working" or "Finished 5m ago". */
  label: string;
  /** Optional trailing detail, e.g. "background task running". */
  detail?: string;
  tone: ChatStatusTone;
  /** Live activity: the dot pulses. */
  pulse: boolean;
  /** Tooltip explaining what the status covers. */
  title: string;
}

/**
 * Words for the selected chat's status, shown next to the execution title.
 * Precise on purpose: a finished turn is not finished work, so the label
 * says "Finished 5m ago" rather than a vague "Ready". Background work that
 * outlives the turn stays visible as a detail.
 *
 * `formatAgo` is injected so tests don't depend on the clock. It returns
 * compact forms like "now", "5m", "2h", "Mar 12".
 */
export function describeChatStatus(
  kind: ExecutionHeaderStatusKind,
  lastOutcomeEventAt: string | null,
  formatAgo: (iso: string | null) => string,
): ChatStatusDescription {
  const ago = lastOutcomeEventAt ? formatAgo(lastOutcomeEventAt) : '';
  const finished = !ago ? 'Finished' : ago === 'now' ? 'Finished just now' : /^\d/.test(ago) ? `Finished ${ago} ago` : `Finished ${ago}`;
  const turnNote = 'This chat finished its last turn. That is not the same as the task being done.';

  switch (kind) {
    case 'archived':
      return { label: 'Archived', tone: 'muted', pulse: false, title: 'This execution is archived. Opening it resumes it.' };
    case 'setup-failed':
      return { label: 'Setup failed', tone: 'rose', pulse: false, title: 'The worktree could not be created. See the chat to retry.' };
    case 'setting-up':
      return { label: 'Setting up', tone: 'blue', pulse: true, title: 'Creating the worktree for this execution.' };
    case 'pending':
      return { label: 'Needs input', tone: 'amber', pulse: true, title: 'This chat is waiting on you. The question is above the message box.' };
    case 'working':
      return { label: 'Working', tone: 'green', pulse: true, title: 'This chat is working.' };
    case 'background':
      return {
        label: lastOutcomeEventAt ? finished : 'Turn finished',
        detail: 'background task running',
        // Not working: sky and still, never the green pulse of a live turn.
        tone: 'sky',
        pulse: false,
        title: 'This chat finished its turn, but work it started is still running.',
      };
    case 'respond':
    case 'idle':
      return { label: finished, tone: 'muted', pulse: false, title: turnNote };
    case 'ready':
      return { label: 'Not started', tone: 'muted', pulse: false, title: 'This chat has no turns yet.' };
  }
}
