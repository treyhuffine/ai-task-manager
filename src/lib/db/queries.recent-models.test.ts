import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import type { CreateChatSessionInput } from '@/db/types';

vi.mock('@/lib/harness/model-discovery', async original => ({
  ...await original<typeof import('@/lib/harness/model-discovery')>(),
  getHarnessModels: async () => ({ source: 'config', models: [] }),
}));

let home: TestHome;
let q: typeof import('./queries');
let sequence = 0;
const now = new Date('2026-10-23T12:00:00Z');

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-recent-models-' });
  q = await import('./queries');
});
afterEach(async () => { await home?.cleanup(); });

function used(harness: 'codex' | 'claude', model: string, at: string, overrides: Partial<CreateChatSessionInput> = {}) {
  return q.createChatSession({ harness, model, type: 'orchestration', externalSessionId: `native-${++sequence}`, lastActivityAt: at, ...overrides });
}

describe('recent harness model history', () => {
  it('retains choices across model switches and deletion without changing settings', async () => {
    const before = q.ensureHarnessSettings('claude');
    const chat = used('claude', 'opus', '2026-10-23T11:57:00Z');
    q.recordHarnessModelUse('claude', 'opus', new Date('2026-10-23T11:57:00Z'));
    q.updateChatSession(chat.id, { model: 'fable' });
    q.recordHarnessModelUse('claude', 'fable', new Date('2026-10-23T11:58:00Z'));
    expect(q.deleteChatSessionIfEmpty(chat.id)).toBe(true);
    expect(q.listRecentHarnessModelIds('claude', { now })).toEqual(['fable', 'opus']);
    expect(q.getHarnessSettings('claude')).toEqual(before);
    const { getRawDb } = await import('@/lib/db');
    expect(getRawDb().prepare('SELECT count(*) AS n FROM harness_model_usage').get()).toEqual({ n: 2 });
  });

  it('upserts one choice per provider and model and never moves its recency backward', () => {
    q.recordHarnessModelUse('claude', 'opus', new Date('2026-10-23T11:59:00Z'));
    q.recordHarnessModelUse('claude', 'fable', new Date('2026-10-23T11:58:00Z'));
    q.recordHarnessModelUse('claude', 'opus', new Date('2026-10-01T12:00:00Z'));
    q.recordHarnessModelUse('codex', 'opus', new Date('2026-10-23T11:59:30Z'));
    q.recordHarnessModelUse('claude', 'sonnet', new Date('2026-09-01T12:00:00Z'));
    expect(q.listRecentHarnessModelIds('claude', { now })).toEqual(['opus', 'fable']);
    expect(q.listRecentHarnessModelIds('codex', { now })).toEqual(['opus']);
  });

  it('deduplicates and orders recent choices independently for each provider', () => {
    used('codex', 'gpt-6.1-sol', '2026-10-22T09:00:00Z');
    used('codex', 'gpt-6.1-sol', '2026-10-23T11:58:00Z');
    used('codex', 'gpt-6-astra', '2026-10-23T11:59:00Z');
    used('codex', 'gpt-6-sol', '2026-10-01T09:00:00Z');
    used('codex', 'gpt-6-luna', '2026-09-01T09:00:00Z');
    used('claude', 'opus', '2026-10-23T11:59:30Z');
    used('claude', 'fable', '2026-10-23T11:30:00Z');
    expect(q.listRecentHarnessModelIds('codex', { now })).toEqual(['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-sol']);
    expect(q.listRecentHarnessModelIds('claude', { now })).toEqual(['opus', 'fable']);
  });

  it('ignores blank drafts, scheduled chats and reviewer sessions while retaining archived work', () => {
    used('claude', 'sonnet', '2026-10-23T11:59:59Z', { externalSessionId: null });
    const run = q.createRun({ harness: 'claude', triggerKind: 'manual', status: 'completed' });
    used('claude', 'haiku', '2026-10-23T11:59:59Z', { createdByRunId: run.id });
    used('claude', 'sonnet', '2026-10-23T11:59:59Z', { surfaceKind: 'result_review' });
    used('claude', 'opus', '2026-10-23T11:58:00Z', { status: 'archived' });
    used('claude', 'fable', '2026-10-23T11:57:00Z');
    expect(q.listRecentHarnessModelIds('claude', { now })).toEqual(['opus', 'fable']);
  });

  it('counts native history imports without reading or requiring transcript events', () => {
    const imported = used('claude', 'fable', '2026-10-23T11:59:00Z', { externalSessionId: null });
    q.createExternalSessionImport({ chatSessionId: imported.id, providerType: 'claude', externalSessionId: 'imported-native', sourceKind: 'file', status: 'current' });
    expect(q.listRecentHarnessModelIds('claude', { now })).toEqual(['fable']);
  });

  it('compares ISO and legacy SQLite timestamps chronologically', () => {
    used('claude', 'fable', '2026-10-23 11:59:30');
    used('claude', 'opus', '2026-10-23T11:59:00Z');
    used('claude', 'sonnet', '2026-09-23 11:59:59');
    expect(q.listRecentHarnessModelIds('claude', { now })).toEqual(['fable', 'opus']);
  });

  it('bounds the history response independently of the number of old or custom models', () => {
    for (let i = 0; i < 40; i++) used('codex', `gpt-custom-${i}`, new Date(now.getTime() - i * 60_000).toISOString());
    const models = q.listRecentHarnessModelIds('codex', { now });
    expect(models).toHaveLength(32);
    expect(models[0]).toBe('gpt-custom-0');
    expect(models.at(-1)).toBe('gpt-custom-31');
    expect(q.listRecentHarnessModelIds('codex', { now, modelIds: ['gpt-custom-39'] })).toEqual(['gpt-custom-39']);
    expect(q.listRecentHarnessModelIds('codex', { now, modelIds: [] })).toEqual([]);
  });

  it('returns recent metadata alongside the full enabled model list without changing settings', async () => {
    const { GET } = await import('@/app/api/harness/models/route');
    used('claude', 'opus', new Date(Date.now() - 60_000).toISOString());
    used('claude', 'fable', new Date(Date.now() - 120_000).toISOString());
    const before = q.ensureHarnessSettings('claude');
    const response = await GET(new Request('http://localhost/api/harness/models?provider=claude'));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.recentModelIds).toEqual(['opus', 'fable']);
    expect(data.models.map((model: { id: string }) => model.id)).toEqual(['opus', 'sonnet', 'haiku', 'fable']);
    expect(q.getHarnessSettings('claude')).toEqual(before);
  });
});
