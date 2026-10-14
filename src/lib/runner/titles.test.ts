import { describe, expect, it, vi } from 'vitest';
import type { AgentSession } from '@agentex/agent';
import type { RunnerSignal, TitleRequest } from './types';
import { generateRunnerTitle, setRunnerTitle, syncRunnerTitleSnapshot } from './titles';

const request = (revision = 0): TitleRequest => ({
  harness: 'claude', description: 'Plan a launch', fallbackPrompt: 'Title prompt', fallbackModel: 'haiku',
  expectedRevision: revision, reuseExisting: true, truncateOnFailure: true,
});

describe('runner title lifecycle', () => {
  it('deduplicates concurrent generation for the same revision', async () => {
    let complete!: (title: string) => void;
    const generateNativeTitle = vi.fn(() => new Promise<string>((resolve) => { complete = resolve; }));
    const handle = { generateNativeTitle } as unknown as AgentSession;
    const signals: RunnerSignal[] = [];
    const first = generateRunnerTitle('dedup-title', handle, request(), (signal) => signals.push(signal));
    const second = generateRunnerTitle('dedup-title', handle, request(), (signal) => signals.push(signal));
    await vi.waitFor(() => expect(generateNativeTitle).toHaveBeenCalledOnce());
    complete('Launch plan');
    await Promise.all([first, second]);
    expect(signals).toEqual([{ type: 'title_suggestion', title: 'Launch plan', source: 'native', expectedRevision: 0, syncNative: true }]);
  });

  it('a manual rename cancels pending generation without publishing a suggestion', async () => {
    const generateNativeTitle = vi.fn(() => new Promise<string>(() => {}));
    const setTitle = vi.fn(async () => {});
    const handle = { generateNativeTitle, setTitle } as unknown as AgentSession;
    const signals: RunnerSignal[] = [];
    const pending = generateRunnerTitle('cancel-title', handle, request(), (signal) => signals.push(signal));
    await vi.waitFor(() => expect(generateNativeTitle).toHaveBeenCalledOnce());
    await setRunnerTitle('cancel-title', handle, 'Manual name', 1);
    await pending;
    expect(signals).toEqual([]);
    expect(setTitle).toHaveBeenCalledWith('Manual name', { timeoutMs: 5000 });
  });

  it('serializes native writes so a slow older rename cannot land after the newest one', async () => {
    let finishFirst!: () => void;
    const writes: string[] = [];
    const setTitle = vi.fn(async (title: string) => {
      if (title === 'First') await new Promise<void>((resolve) => { finishFirst = resolve; });
      writes.push(title);
    });
    const handle = { setTitle } as unknown as AgentSession;
    const first = setRunnerTitle('ordered-title', handle, 'First', 1);
    await vi.waitFor(() => expect(setTitle).toHaveBeenCalledOnce());
    const second = setRunnerTitle('ordered-title', handle, 'Second', 2);
    finishFirst();
    await Promise.all([first, second]);
    await setRunnerTitle('ordered-title', handle, 'Stale', 1);
    expect(writes).toEqual(['First', 'Second']);
  });

  it('does not reuse existing names for retrospective generation', async () => {
    const readTitle = vi.fn(async () => 'Old first-message title');
    const handle = { readTitle, generateNativeTitle: async () => 'Retrospective name' } as unknown as AgentSession;
    const signals: RunnerSignal[] = [];
    await generateRunnerTitle('retro-title', handle, { ...request(), reuseExisting: false }, (signal) => signals.push(signal));
    expect(readTitle).not.toHaveBeenCalled();
    expect(signals).toMatchObject([{ title: 'Retrospective name', source: 'native' }]);
  });
});


describe('native title synchronization on resume', () => {
  it('adopts a native rename of an automatic title instead of pushing a stale app name', async () => {
    const setTitle = vi.fn(async () => {});
    const handle = { readTitle: async () => 'Native client rename', setTitle } as unknown as AgentSession;
    const signals: RunnerSignal[] = [];
    await syncRunnerTitleSnapshot('resume-native-title', handle, { label: 'Old automatic name', source: 'fallback', revision: 1 }, (signal) => signals.push(signal));
    expect(setTitle).not.toHaveBeenCalled();
    expect(signals).toEqual([{ type: 'native_title', title: 'Native client rename' }]);
  });

  it('pushes a manual Ri name without letting an older native name replace it', async () => {
    const readTitle = vi.fn(async () => 'Older native name');
    const setTitle = vi.fn(async () => {});
    const handle = { readTitle, setTitle } as unknown as AgentSession;
    await syncRunnerTitleSnapshot('resume-manual-title', handle, { label: 'Manual Ri name', source: 'manual', revision: 3 }, () => {});
    expect(readTitle).not.toHaveBeenCalled();
    expect(setTitle).toHaveBeenCalledWith('Manual Ri name', { timeoutMs: 5000 });
  });
});


describe('existing native names', () => {
  it('preserves the native name and does not request an upstream rewrite', async () => {
    const name = 'A manually chosen native name that is deliberately longer than sixty characters.';
    const handle = { readTitle: async () => name } as unknown as AgentSession;
    const signals: RunnerSignal[] = [];
    await generateRunnerTitle('existing-native-name', handle, request(), (signal) => signals.push(signal));
    expect(signals).toEqual([{ type: 'title_suggestion', title: name, source: 'native', expectedRevision: 0, syncNative: false }]);
  });
});
