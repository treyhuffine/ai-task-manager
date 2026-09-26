export type ExecutionHeaderStatusKind =
  | 'archived'
  | 'setup-failed'
  | 'setting-up'
  | 'pending'
  /** A message is saved at the home, waiting for its computer (P3.2). */
  | 'waiting'
  /** Its computer lost contact in the middle of a turn: unknown, not stopped. */
  | 'disconnected'
  /** Its computer said it's asleep. */
  | 'asleep'
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
  /**
   * For an execution on another computer: whether its worker is connected,
   * whether it said it's asleep, and whether a message is waiting for it.
   */
  elsewhere?: { connected: boolean; asleep: boolean; waiting: boolean } | null;
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
  elsewhere = null,
}: DeriveExecutionHeaderStatusInput): ExecutionHeaderStatusKind {
  // Away from its computer, a turn under way is only known to have been
  // under way when contact was lost, and a message only waits.
  const away = !!elsewhere && !elsewhere.connected;
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
          : isRunning && away
            ? elsewhere!.asleep ? 'asleep' : 'disconnected'
            : isRunning
              ? 'working'
              : elsewhere?.waiting
                ? away && elsewhere.asleep ? 'asleep' : 'waiting'
                : hasBackgroundTasks
              ? 'background'
              : needsResponse
                ? 'respond'
                : lastOutcomeEventAt
                  ? 'idle'
                  : 'ready';
}

export type ChatStatusTone = 'green' | 'amber' | 'rose' | 'blue' | 'muted';

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
  /** The computer an execution elsewhere runs on, for the states that name it. */
  where: { name: string; lastSeenAt: string | null } | null = null,
): ChatStatusDescription {
  const name = where?.name ?? 'Its computer';
  const heard = where?.lastSeenAt ? formatAgo(where.lastSeenAt) : '';
  const lastHeard = !heard ? undefined : heard === 'now' ? 'last heard from just now' : /^\d/.test(heard) ? `last heard from ${heard} ago` : `last heard from ${heard}`;
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
    case 'waiting':
      return {
        label: `Waiting for ${name}`,
        detail: 'your message is saved',
        tone: 'amber',
        pulse: false,
        title: `${name} isn't connected. Your message is saved here and goes to it when it connects. You can cancel it from the message until then.`,
      };
    case 'disconnected':
      return {
        label: `${name} disconnected`,
        detail: lastHeard,
        tone: 'amber',
        pulse: false,
        title: `${name} lost contact while this chat was working. What it sent last is below. It may still be working, and whatever it does meanwhile arrives when it reconnects.`,
      };
    case 'asleep':
      return {
        label: `${name} is asleep`,
        detail: lastHeard,
        tone: 'muted',
        pulse: false,
        title: `${name} said it was going to sleep. Its work continues when it wakes, and a message sent meanwhile waits for it.`,
      };
    case 'background':
      return {
        label: lastOutcomeEventAt ? finished : 'Turn finished',
        detail: 'background task running',
        tone: 'amber',
        pulse: true,
        title: 'This chat finished its turn, but work it started is still running.',
      };
    case 'respond':
    case 'idle':
      return { label: finished, tone: 'muted', pulse: false, title: turnNote };
    case 'ready':
      return { label: 'Not started', tone: 'muted', pulse: false, title: 'This chat has no turns yet.' };
  }
}
