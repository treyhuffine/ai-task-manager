import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { HarnessId } from '@/lib/harness/registry';

vi.mock('@agentex/agent', () => ({
  getProvider: () => ({ capabilities: { concurrentSend: true } }),
  listInstalledSkills: vi.fn(async () => ({})),
  commandInventoryFromEvent: () => null,
}));
vi.mock('@/lib/executor/adapter', () => ({
  dispatch: vi.fn(async () => {}),
  abort: vi.fn(async () => {}),
  ExecutorError: class extends Error {},
}));

const TEST_DB = path.join(os.tmpdir(), `ri-registry-test-${process.pid}.db`);

beforeEach(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  process.env.RI_DB_PATH = TEST_DB;
});

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
});

async function seed() {
  const { getDb, resetDb } = await import('@/lib/db');
  resetDb();
  const db = getDb();
  const { uuidv7 } = await import('uuidv7');
  const { workspaces } = await import('@/lib/db/schema');
  const wsId = uuidv7();
  db.insert(workspaces).values({
    id: wsId, name: 'TestWs', slug: 'testws-' + Date.now(),
    cwd: '/tmp/testws', isGit: false, status: 'active', filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: true,
  }).run();
  return { wsId };
}

/** Plant the user's default provider (user_state row 1, which migrations may pre-seed). */
async function setDefaultProvider(provider: HarnessId) {
  const { getDb } = await import('@/lib/db');
  const { userState } = await import('@/lib/db/schema');
  getDb().insert(userState)
    .values({ id: 1, defaultHarness: provider })
    .onConflictDoUpdate({ target: userState.id, set: { defaultHarness: provider } })
    .run();
}

function findAction(name: string) {
  return import('./registry').then((m) => {
    const a = m.actions.find((x) => x.name === name);
    if (!a) throw new Error(`action ${name} missing`);
    return a;
  });
}

describe('orchestrator trigger + run actions', () => {
  it('exposes the full trigger + run + skill surface', async () => {
    const { actions } = await import('./registry');
    const names = actions.map((a) => a.name);
    expect(names).toEqual(expect.arrayContaining([
      'list_triggers', 'get_trigger', 'create_trigger',
      'update_trigger', 'delete_trigger', 'run_trigger',
      'list_runs', 'get_run', 'cancel_run', 'list_skills',
    ]));
  });

  it('create_trigger stores the default harness on an orchestrator trigger when provider is omitted', async () => {
    await seed();
    const action = await findAction('create_trigger');
    const result = await action.handler({ remote: false }, {
      name: 'auto-agent', targetKind: 'orchestrator',
      prompt: 'X', kind: 'cron', cronExpression: '0 9 * * *',
    } as never) as { trigger: { harness: string; provider: string } };
    expect(result.trigger).toMatchObject({ harness: 'claude', provider: 'claude' });
  });

  it('create_trigger stores the default harness on a workspace trigger when provider is omitted', async () => {
    const { wsId } = await seed();
    const action = await findAction('create_trigger');
    const result = await action.handler({ remote: false }, {
      name: 'auto-ws', targetKind: 'workspace', workspaceId: wsId,
      prompt: 'X', kind: 'at',
      runAt: new Date(Date.now() + 60_000).toISOString(),
    } as never) as { trigger: { harness: string; provider: string } };
    expect(result.trigger).toMatchObject({ harness: 'claude', provider: 'claude' });
  });

  it('create_trigger rejects an invalid cron expression', async () => {
    const { wsId } = await seed();
    const action = await findAction('create_trigger');
    expect(() =>
      action.handler({ remote: false }, {
        name: 'bad', workspaceId: wsId, targetKind: 'workspace',
        prompt: 'X', kind: 'cron', cronExpression: 'not-cron',
      } as never),
    ).toThrow(/Invalid cron/);
  });

  it('create_trigger + create_trigger (webhook) returns plaintext secret once', async () => {
    await seed();
    const action = await findAction('create_trigger');
    const result = await action.handler({ remote: false }, {
      name: 'inbox', targetKind: 'orchestrator',
      prompt: 'Triage', kind: 'webhook',
    } as never) as { trigger: { webhookPublicId: string | null }; webhookSecret: string };
    expect(result.webhookSecret).toBeTruthy();
    expect(result.trigger.webhookPublicId).toBeTruthy();
  });

  it('update_trigger recomputes nextRunAt when the cron expression changes', async () => {
    await seed();
    const createAction = await findAction('create_trigger');
    const created = await createAction.handler({ remote: false }, {
      name: 'daily', targetKind: 'orchestrator',
      prompt: 'X', kind: 'cron', cronExpression: '0 9 * * *',
    } as never) as { trigger: { id: string; nextRunAt: string } };
    const updateAction = await findAction('update_trigger');
    const before = created.trigger.nextRunAt;
    const updated = await updateAction.handler({ remote: false }, {
      id: created.trigger.id, cronExpression: '0 18 * * *',
    } as never) as { nextRunAt: string };
    expect(updated.nextRunAt).not.toBe(before);
  });

  it('delete_trigger preserves runs via SET NULL', async () => {
    const { wsId } = await seed();
    const create = await findAction('create_trigger');
    const created = await create.handler({ remote: false }, {
      name: 'tmp', workspaceId: wsId, targetKind: 'workspace',
      prompt: 'X', kind: 'at',
      runAt: new Date(Date.now() + 60_000).toISOString(),
    } as never) as { trigger: { id: string } };
    const del = await findAction('delete_trigger');
    const result = await del.handler({ remote: false }, { id: created.trigger.id } as never);
    expect(result).toMatchObject({ deleted: true });
  });

  it('cancel_run on a terminal run returns it unchanged', async () => {
    await seed();
    const queries = await import('@/lib/db/queries');
    const run = queries.createRun({
      harness: 'claude', triggerKind: 'manual', status: 'completed',
    });
    const cancel = await findAction('cancel_run');
    // As the server runs it.
    const result = await cancel.handler({ remote: true }, { id: run.id } as never) as {
      id: string;
      status: string;
    };
    expect(result.status).toBe('completed');
  });

  it('runs and cancels in the server when called from the home CLI, where the harness can be reached', async () => {
    await seed();
    const queries = await import('@/lib/db/queries');
    const run = queries.createRun({ harness: 'claude', triggerKind: 'manual', status: 'running' });
    // No server runs in this test: the CLI's call must go to it, not act here.
    for (const [name, input] of [['cancel_run', { id: run.id }], ['run_trigger', { id: 'any' }]] as const) {
      const action = await findAction(name);
      // It reaches for the server (the closed test port, src/test/setup-env.ts,
      // or stops earlier without a token) instead of acting in this process.
      await expect(action.handler({ remote: false }, input as never)).rejects.toThrow(
        /App server unreachable at http:\/\/localhost:9|No local auth token/,
      );
    }
    expect(queries.getRun(run.id)?.status).toBe('running');
  });

  async function seedTelegramChannel() {
    const queries = await import('@/lib/db/queries');
    return queries.createNotificationChannel({
      kind: 'connector', providerId: 'telegram', connectionId: 'conn-1',
      config: { chatId: '42' }, events: [],
    });
  }

  it('list_notification_channels returns the user channels, filterable by provider', async () => {
    await seed();
    await seedTelegramChannel();
    const action = await findAction('list_notification_channels');
    const all = await action.handler({ remote: false }, {} as never) as {
      channels: Array<{ providerId: string | null }>;
    };
    expect(all.channels).toHaveLength(1);
    expect(all.channels[0].providerId).toBe('telegram');
    const none = await action.handler({ remote: false }, { providerId: 'slack' } as never) as {
      channels: unknown[];
    };
    expect(none.channels).toHaveLength(0);
  });

  it('create_trigger binds + de-dupes a digest channel for orchestrator targets', async () => {
    await seed();
    const ch = await seedTelegramChannel();
    const action = await findAction('create_trigger');
    const result = await action.handler({ remote: false }, {
      name: 'email-digest', targetKind: 'orchestrator',
      prompt: 'Review my email and write a digest',
      kind: 'cron', cronExpression: '0 8 * * *',
      deliverResultTo: [ch.id, ch.id], // duplicate proves de-dupe
    } as never) as { trigger: { deliverResultTo: string[] } };
    expect(result.trigger.deliverResultTo).toEqual([ch.id]);
  });

  it('create_trigger rejects a digest binding on a workspace target', async () => {
    const { wsId } = await seed();
    const ch = await seedTelegramChannel();
    const action = await findAction('create_trigger');
    expect(() => action.handler({ remote: false }, {
      name: 'ws-digest', targetKind: 'workspace', workspaceId: wsId,
      prompt: 'X', kind: 'at', runAt: new Date(Date.now() + 60_000).toISOString(),
      deliverResultTo: [ch.id],
    } as never)).toThrow(/orchestrator/);
  });

  it('create_trigger rejects an unknown digest channel id', async () => {
    await seed();
    const action = await findAction('create_trigger');
    expect(() => action.handler({ remote: false }, {
      name: 'bad-digest', targetKind: 'orchestrator',
      prompt: 'X', kind: 'cron', cronExpression: '0 8 * * *',
      deliverResultTo: ['no-such-channel'],
    } as never)).toThrow(/notification channel not found/);
  });

  it('update_trigger replaces the digest binding (and [] unbinds)', async () => {
    await seed();
    const ch = await seedTelegramChannel();
    const create = await findAction('create_trigger');
    const created = await create.handler({ remote: false }, {
      name: 'digest-edit', targetKind: 'orchestrator',
      prompt: 'X', kind: 'cron', cronExpression: '0 8 * * *',
    } as never) as { trigger: { id: string; deliverResultTo: string[] } };
    expect(created.trigger.deliverResultTo).toEqual([]);

    const update = await findAction('update_trigger');
    const bound = await update.handler({ remote: false }, {
      id: created.trigger.id, deliverResultTo: [ch.id],
    } as never) as { deliverResultTo: string[] };
    expect(bound.deliverResultTo).toEqual([ch.id]);

    const unbound = await update.handler({ remote: false }, {
      id: created.trigger.id, deliverResultTo: [],
    } as never) as { deliverResultTo: string[] };
    expect(unbound.deliverResultTo).toEqual([]);
  });

  describe('provider selection', () => {
    it('create_trigger falls back to Claude when the user has no default provider', async () => {
      await seed();
      const action = await findAction('create_trigger');
      const result = await action.handler({ remote: false }, {
        name: 'no-default', targetKind: 'orchestrator',
        prompt: 'X', kind: 'cron', cronExpression: '0 9 * * *',
      } as never) as { trigger: { harness: string; provider: string } };
      expect(result.trigger).toMatchObject({ harness: 'claude', provider: 'claude' });
    });

    it('create_trigger follows the user default provider when provider is omitted', async () => {
      const { wsId } = await seed();
      await setDefaultProvider('codex');
      const action = await findAction('create_trigger');
      const result = await action.handler({ remote: false }, {
        name: 'follows-default', targetKind: 'workspace', workspaceId: wsId,
        prompt: 'X', kind: 'manual',
      } as never) as { trigger: { harness: string; provider: string } };
      expect(result.trigger).toMatchObject({ harness: 'codex', provider: 'codex' });
    });

    it('create_trigger honors an explicit provider over the user default', async () => {
      await seed();
      await setDefaultProvider('claude');
      const action = await findAction('create_trigger');
      const result = await action.handler({ remote: false }, {
        name: 'explicit-codex', targetKind: 'orchestrator', provider: 'codex',
        prompt: 'X', kind: 'cron', cronExpression: '0 9 * * *',
        model: 'gpt-5.5', effort: 'high',
      } as never) as { trigger: { harness: string; provider: string; model: string; effort: string } };
      expect(result.trigger).toMatchObject({ harness: 'codex', provider: 'codex', model: 'gpt-5.5', effort: 'high' });
    });

    it('create_trigger rejects a model from another provider', async () => {
      await seed();
      const action = await findAction('create_trigger');
      expect(() =>
        action.handler({ remote: false }, {
          name: 'mismatch', targetKind: 'orchestrator', provider: 'codex',
          prompt: 'X', kind: 'cron', cronExpression: '0 9 * * *', model: 'opus',
        } as never),
      ).toThrow(/does not run on codex/);
    });

    it('create_trigger accepts a model the user pinned by hand', async () => {
      await seed();
      const queries = await import('@/lib/db/queries');
      queries.ensureHarnessSettings('codex');
      queries.upsertHarnessSettings({
        ...queries.getHarnessSettings('codex')!,
        customModels: ['my-private-codex-model'],
      });
      const action = await findAction('create_trigger');
      const result = await action.handler({ remote: false }, {
        name: 'pinned', targetKind: 'orchestrator', provider: 'codex',
        prompt: 'X', kind: 'cron', cronExpression: '0 9 * * *', model: 'my-private-codex-model',
      } as never) as { trigger: { model: string } };
      expect(result.trigger.model).toBe('my-private-codex-model');
    });

    it('create_trigger rejects the removed agentId param instead of ignoring it', async () => {
      await seed();
      const action = await findAction('create_trigger');
      // Silently dropping it would run the trigger on the default engine
      // rather than the one the caller meant to pin.
      expect(() =>
        action.handler({ remote: false }, {
          name: 'legacy', agentId: 'any-old-id', provider: 'codex', targetKind: 'orchestrator',
          prompt: 'X', kind: 'cron', cronExpression: '0 9 * * *',
        } as never),
      ).toThrow(/agentId was removed. Use provider/);
    });

    it('list_runs filters by harness and rejects the removed agentId filter', async () => {
      await seed();
      const queries = await import('@/lib/db/queries');
      const claudeRun = queries.createRun({ harness: 'claude', triggerKind: 'manual', status: 'completed' });
      const codexRun = queries.createRun({ harness: 'codex', triggerKind: 'manual', status: 'completed' });
      const list = await findAction('list_runs');

      const codexOnly = await list.handler({ remote: false }, { harness: 'codex' } as never) as Array<{ id: string }>;
      expect(codexOnly.map((r) => r.id)).toContain(codexRun.id);
      expect(codexOnly.map((r) => r.id)).not.toContain(claudeRun.id);

      expect(() =>
        list.handler({ remote: false }, { agentId: 'any-old-id' } as never),
      ).toThrow(/agentId was removed/);
    });

    it('update_trigger switches provider and resets model + effort it did not restate', async () => {
      await seed();
      const create = await findAction('create_trigger');
      const created = await create.handler({ remote: false }, {
        name: 'switch-me', targetKind: 'orchestrator', provider: 'claude',
        prompt: 'X', kind: 'cron', cronExpression: '0 9 * * *', model: 'opus', effort: 'max',
      } as never) as { trigger: { id: string; harness: string } };
      expect(created.trigger.harness).toBe('claude');

      const update = await findAction('update_trigger');
      const switched = await update.handler({ remote: false }, {
        id: created.trigger.id, provider: 'codex',
      } as never) as { harness: string; provider: string; model: string | null; effort: string | null };
      expect(switched).toMatchObject({ harness: 'codex', provider: 'codex', model: null, effort: null });
    });

    it('update_trigger keeps a restated model on a provider switch, and vets it', async () => {
      await seed();
      const create = await findAction('create_trigger');
      const created = await create.handler({ remote: false }, {
        name: 'switch-with-model', targetKind: 'orchestrator', provider: 'claude',
        prompt: 'X', kind: 'cron', cronExpression: '0 9 * * *', model: 'opus',
      } as never) as { trigger: { id: string } };
      const update = await findAction('update_trigger');

      expect(() =>
        update.handler({ remote: false }, {
          id: created.trigger.id, provider: 'codex', model: 'sonnet',
        } as never),
      ).toThrow(/does not run on codex/);

      const switched = await update.handler({ remote: false }, {
        id: created.trigger.id, provider: 'codex', model: 'gpt-5.5', effort: 'low',
      } as never) as { provider: string; model: string; effort: string };
      expect(switched).toMatchObject({ provider: 'codex', model: 'gpt-5.5', effort: 'low' });
    });

    it('update_trigger vets a model-only change against the current provider', async () => {
      await seed();
      const create = await findAction('create_trigger');
      const created = await create.handler({ remote: false }, {
        name: 'model-only', targetKind: 'orchestrator', provider: 'codex',
        prompt: 'X', kind: 'cron', cronExpression: '0 9 * * *',
      } as never) as { trigger: { id: string } };
      const update = await findAction('update_trigger');
      expect(() =>
        update.handler({ remote: false }, { id: created.trigger.id, model: 'opus' } as never),
      ).toThrow(/does not run on codex/);
    });

    it('update_trigger lets an app-managed trigger switch provider but keeps its identity locked', async () => {
      await seed();
      const queries = await import('@/lib/db/queries');
      const { RESERVED_TRIGGER_IDS } = await import('@/lib/triggers/reserved');
      queries.createTrigger({
        id: RESERVED_TRIGGER_IDS.morningDeck,
        name: 'Morning deck refresh',
        enabled: true,
        harness: 'claude',
        workspaceId: null,
        targetKind: 'orchestrator',
        prompt: 'refresh',
        kind: 'cron',
        cronExpression: '0 7 * * *',
      });
      const update = await findAction('update_trigger');
      const switched = await update.handler({ remote: false }, {
        id: RESERVED_TRIGGER_IDS.morningDeck, provider: 'codex',
      } as never) as { provider: string; name: string };
      expect(switched).toMatchObject({ provider: 'codex', name: 'Morning deck refresh' });

      expect(() =>
        update.handler({ remote: false }, {
          id: RESERVED_TRIGGER_IDS.morningDeck, prompt: 'hijack',
        } as never),
      ).toThrow(/managed by the app/);
    });

    it('list_triggers and get_trigger report each trigger\'s provider', async () => {
      await seed();
      const create = await findAction('create_trigger');
      const created = await create.handler({ remote: false }, {
        name: 'listed', targetKind: 'orchestrator', provider: 'codex',
        prompt: 'X', kind: 'cron', cronExpression: '0 9 * * *',
      } as never) as { trigger: { id: string } };

      const list = await findAction('list_triggers');
      const rows = await list.handler({ remote: false }, {} as never) as Array<{ id: string; provider: string }>;
      expect(rows.find((r) => r.id === created.trigger.id)?.provider).toBe('codex');

      const get = await findAction('get_trigger');
      const row = await get.handler({ remote: false }, { id: created.trigger.id } as never) as { provider: string };
      expect(row.provider).toBe('codex');
    });
  });
});
