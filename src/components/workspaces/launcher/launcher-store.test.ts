import { beforeEach, describe, expect, it } from 'vitest';
import { closeLauncher, getLauncherState, openLauncher } from './launcher-store';

beforeEach(() => closeLauncher());

describe('openLauncher', () => {
  it('opens on the agent it was given', () => {
    openLauncher('ws-a');
    expect(getLauncherState()).toMatchObject({ open: true, workspaceId: 'ws-a', pickAgent: false });
  });

  it('opens with no agent picked when asked for none (the rail ➕)', () => {
    openLauncher('ws-a');
    closeLauncher();
    openLauncher({ workspaceId: null });
    expect(getLauncherState()).toMatchObject({ open: true, pickAgent: true });
  });

  it('still falls back to the last agent after an agent-less open', () => {
    openLauncher('ws-a');
    closeLauncher();
    openLauncher({ workspaceId: null });
    closeLauncher();
    // "Start with agent" on a task with no agent leaves the workspace out.
    openLauncher({ taskId: 't-1', workspaceId: undefined, contextTitle: 'Fix it' });
    expect(getLauncherState()).toMatchObject({ workspaceId: 'ws-a', pickAgent: false });
  });

  it('starts a fresh draft on every open', () => {
    openLauncher('ws-a');
    const first = getLauncherState().nonce;
    openLauncher({ workspaceId: null });
    expect(getLauncherState().nonce).toBe(first + 1);
  });
});
