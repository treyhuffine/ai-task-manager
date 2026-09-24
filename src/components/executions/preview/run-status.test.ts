import { describe, it, expect } from 'vitest';
import type { PreviewState } from '@/lib/api/preview';
import { deriveRunStatus, RUN_STATUS_LABEL, runIsActive, type RunStatus } from './run-status';

function state(partial: Partial<PreviewState>): PreviewState {
  return {
    executionId: 'e1',
    service: null,
    previewName: 'ri-a3f9',
    assignedPort: 3000,
    serverStatus: 'idle',
    port: null,
    message: null,
    localUrl: null,
    pinned: false,
    activeRemoteProviderId: null,
    activeRemoteProviderLabel: null,
    remoteUrl: null,
    remoteError: null,
    manualUrls: [],
    setupStatus: null,
    setupError: null,
    ...partial,
  } as PreviewState;
}

describe('deriveRunStatus', () => {
  it('without a start command there is nothing to run', () => {
    expect(deriveRunStatus(state({ serverStatus: 'running', port: 3000 }), null)).toBe('not-configured');
    expect(deriveRunStatus(null, '   ')).toBe('not-configured');
  });

  it('a setup install in progress gates everything else', () => {
    expect(deriveRunStatus(state({ setupStatus: 'running', serverStatus: 'idle' }), 'pnpm dev')).toBe('installing');
  });

  it('maps the supervisor states', () => {
    const cases: [Partial<PreviewState>, RunStatus][] = [
      [{ serverStatus: 'idle' }, 'stopped'],
      [{ serverStatus: 'stopped' }, 'stopped'],
      [{ serverStatus: 'starting' }, 'starting'],
      [{ serverStatus: 'running', port: 3000 }, 'running'],
      [{ serverStatus: 'running', port: null }, 'running-no-port'],
      [{ serverStatus: 'crashed' }, 'crashed'],
    ];
    for (const [partial, expected] of cases) expect(deriveRunStatus(state(partial), 'pnpm dev')).toBe(expected);
  });

  it('a failed setup does not block running (the user can still start)', () => {
    expect(deriveRunStatus(state({ setupStatus: 'failed' }), 'pnpm dev')).toBe('stopped');
  });

  it('no state yet reads as stopped once a command exists', () => {
    expect(deriveRunStatus(null, 'pnpm dev')).toBe('stopped');
  });
});

describe('run status words', () => {
  it('say "Failed" for a crash and never "Ready"', () => {
    expect(RUN_STATUS_LABEL.crashed).toBe('Failed');
    for (const label of Object.values(RUN_STATUS_LABEL)) expect(label).not.toMatch(/ready/i);
  });

  it('Stop is the next action only while the process is up or coming up', () => {
    expect(runIsActive('running')).toBe(true);
    expect(runIsActive('starting')).toBe(true);
    expect(runIsActive('running-no-port')).toBe(true);
    expect(runIsActive('stopped')).toBe(false);
    expect(runIsActive('crashed')).toBe(false);
    expect(runIsActive('installing')).toBe(false);
  });
});
