import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getProvider } from '@agentex/agent';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import type { OperationContext } from '@/lib/server/operation';

let home: TestHome;
let fake: FakeHarness;
const ctx: OperationContext = {
  headers: new Headers(), url: 'http://localhost', nextUrl: new URL('http://localhost'), signal: new AbortController().signal,
};

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-recent-model-dispatch-' });
  fake = installFakeHarness('claude');
  getProvider('claude').listModels = async () => [
    { id: 'opus', name: 'Opus' }, { id: 'fable', name: 'Fable' }, { id: 'sonnet', name: 'Sonnet' },
  ];
});
afterEach(async () => {
  const { _resetExecutorState } = await import('./adapter');
  _resetExecutorState();
  fake?.restore();
  await home?.cleanup();
});

describe('deliberate model choices populate recents', () => {
  it('records accepted work and model changes within the same conversation', async () => {
    const q = await import('@/lib/db/queries');
    const { dispatch } = await import('./adapter');
    const { PATCH } = await import('@/lib/server/operations/sessions/[id]');
    const chat = q.createChatSession({ type: 'orchestration', harness: 'claude', model: 'opus' });
    const before = q.ensureHarnessSettings('claude');
    expect(q.listRecentHarnessModelIds('claude')).toEqual([]);
    await dispatch(chat.id, 'First turn');
    expect(q.listRecentHarnessModelIds('claude')).toEqual(['opus']);
    expect((await PATCH({ params: { id: chat.id }, body: { model: 'fable' } }, ctx)).status).toBe(200);
    expect(q.getChatSession(chat.id)?.model).toBe('fable');
    expect(q.listRecentHarnessModelIds('claude')).toEqual(['fable', 'opus']);
    expect(q.getHarnessSettings('claude')).toEqual(before);
  });

  it('does not record drafts, rejected sends or rejected model changes', async () => {
    const q = await import('@/lib/db/queries');
    const { dispatch } = await import('./adapter');
    const { PATCH } = await import('@/lib/server/operations/sessions/[id]');
    const draft = q.createChatSession({ type: 'orchestration', harness: 'claude', model: 'opus' });
    const invalid = q.createChatSession({ type: 'orchestration', harness: 'claude', model: 'sonnet', serviceTier: 'fast' });
    await expect(dispatch(invalid.id, 'Must not start')).rejects.toThrow();
    expect((await PATCH({ params: { id: draft.id }, body: { model: 'no-such-model' } }, ctx)).status).toBe(400);
    expect(q.listRecentHarnessModelIds('claude')).toEqual([]);
    expect(fake.sessions).toHaveLength(0);
  });

  it('does not let background schedules populate the personal shortlist', async () => {
    const q = await import('@/lib/db/queries');
    const { dispatchRun } = await import('@/lib/runs/dispatch');
    const trigger = q.createTrigger({ name: 'Background work', harness: 'claude', model: 'sonnet', prompt: 'Check in', kind: 'manual', targetKind: 'orchestrator' });
    const fire = await dispatchRun({ trigger, triggerKind: 'manual' });
    await vi.waitFor(() => expect(q.getRun(fire.run.id)?.status).toBe('completed'), { timeout: 15_000 });
    expect(fake.sessions).toHaveLength(1);
    expect(q.listRecentHarnessModelIds('claude')).toEqual([]);
  });
});
