import { expect, it, vi } from 'vitest';
import { ViewerTransitions } from './viewer-transitions';

function steps(overrides: Partial<Parameters<ViewerTransitions<string>['run']>[1]> = {}) {
  return { prepare: vi.fn(async () => true), stage: vi.fn(async () => {}), open: vi.fn(async () => {}), rollback: vi.fn(), commit: vi.fn(), ...overrides };
}
it('keeps an accepted view and pending sign-in retry on rejected session or navigation', async () => {
  for (const failing of ['prepare', 'stage', 'open'] as const) {
    const transitions = new ViewerTransitions<string>();
    await transitions.run('old', steps());
    const rejected = steps({ [failing]: vi.fn(async () => { throw new Error('offline'); }) });
    await expect(transitions.run('new', rejected)).rejects.toThrow('offline');
    expect(transitions.current).toBe('old');
    expect(transitions.pending).toBe('new');
    expect(rejected.rollback).toHaveBeenCalledWith('old');
    expect(rejected.commit).not.toHaveBeenCalled();
    await transitions.run(transitions.pending!, steps());
    expect(transitions.current).toBe('new');
    expect(transitions.pending).toBeUndefined();
  }
});
it('does not change session or privilege while drafts refuse the transition', async () => {
  const transitions = new ViewerTransitions<string>();
  await transitions.run('old', steps());
  const blocked = steps({ prepare: vi.fn(async () => false) });
  await transitions.run('new', blocked);
  expect(transitions.current).toBe('old');
  expect(transitions.pending).toBe('new');
  expect(blocked.stage).not.toHaveBeenCalled();
  expect(blocked.commit).not.toHaveBeenCalled();
});
it('serializes overlapping controller and Open transitions, including after failure', async () => {
  const transitions = new ViewerTransitions<string>();
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const first = steps({ stage: async () => { await gate; throw new Error('failed'); } });
  const second = steps();
  const one = transitions.run('one', first);
  const two = transitions.run('two', second);
  await Promise.resolve();
  expect(second.prepare).not.toHaveBeenCalled();
  finish();
  await expect(one).rejects.toThrow('failed');
  await two;
  expect(first.rollback).toHaveBeenCalledWith(undefined);
  expect(second.prepare).toHaveBeenCalledWith(undefined);
  expect(transitions.current).toBe('two');
  expect(transitions.pending).toBeUndefined();
});
