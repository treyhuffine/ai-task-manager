import type { PreviewState } from '@/lib/api/preview';

/**
 * The app process's status in words, as the Run tab, the tools box and the
 * Preview tab all describe it. Running is separate from previewing: this is
 * about the supervised dev server, never about whether Preview is open.
 */
export type RunStatus =
  | 'not-configured'
  | 'installing'
  | 'stopped'
  | 'starting'
  | 'running'
  | 'running-no-port'
  | 'crashed';

export function deriveRunStatus(state: PreviewState | null, command: string | null): RunStatus {
  if (!command || !command.trim()) return 'not-configured';
  // Starting against a half-installed node_modules just crash-loops, so the
  // setup script's install gates everything else.
  if (state?.setupStatus === 'running') return 'installing';
  switch (state?.serverStatus) {
    case 'starting':
      return 'starting';
    case 'running':
      return state.port === null ? 'running-no-port' : 'running';
    case 'crashed':
      return 'crashed';
    default:
      return 'stopped';
  }
}

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  'not-configured': 'Not set up',
  installing: 'Installing dependencies',
  stopped: 'Stopped',
  starting: 'Starting',
  running: 'Running',
  'running-no-port': 'Running, no port found',
  crashed: 'Failed',
};

export type RunTone = 'green' | 'amber' | 'rose' | 'blue' | 'idle';

export const RUN_STATUS_TONE: Record<RunStatus, { tone: RunTone; pulse: boolean }> = {
  'not-configured': { tone: 'idle', pulse: false },
  installing: { tone: 'blue', pulse: true },
  stopped: { tone: 'idle', pulse: false },
  starting: { tone: 'amber', pulse: true },
  running: { tone: 'green', pulse: false },
  'running-no-port': { tone: 'amber', pulse: false },
  crashed: { tone: 'rose', pulse: false },
};

/** Tailwind classes for the status dot. `idle` is a hollow ring so "off" never reads as a color. */
export function runDotClass(status: RunStatus): string {
  const { tone, pulse } = RUN_STATUS_TONE[status];
  const base =
    tone === 'green'
      ? 'bg-emerald-500'
      : tone === 'amber'
        ? 'bg-amber-500'
        : tone === 'rose'
          ? 'bg-rose-500'
          : tone === 'blue'
            ? 'bg-blue-500'
            : 'bg-transparent ring-[1.5px] ring-inset ring-muted-foreground/60';
  return `${base}${pulse ? ' animate-pulse' : ''}`;
}

/** Whether Stop (rather than Start) is the process's next action. */
export function runIsActive(status: RunStatus): boolean {
  return status === 'starting' || status === 'running' || status === 'running-no-port';
}
