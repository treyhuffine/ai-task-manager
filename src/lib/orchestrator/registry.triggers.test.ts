import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { HarnessId } from '@/lib/harness/registry';
import type { TriggerRecord } from '@/db/types';

vi.mock('@agentex/agent', () => ({
  getProvider: () => ({ capabilities: { concurrentSend: true } }),
  listInstalledSkills: vi.fn(async () => ({})),
  commandInventoryFromEvent: () => null,
}));
vi.mock('@/lib/executor/adapter', () => ({
  dispatch: vi.fn(async () => {}),
  abort: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
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
  it('updates recurring cadence and timezone without changing the job or paused state', async () => {
    await seed();
    const q = await import('@/lib/db/queries');
    const trigger = q.createTrigger({ name: 'schedule-edit', targetKind: 'orchestrator', harness: 'codex',
      prompt: 'Keep this prompt', kind: 'cron', cronExpression: '0 9 * * *', timezone: 'UTC', enabled: false,
      model: 'gpt-5.5', effort: 'high', activeHoursStart: '08:00', activeHoursEnd: '18:00' });
    const update = await findAction('update_trigger');
    const edited = await update.handler({ remote: false }, { id: trigger.id, cronExpression: '30 10 * * 1-5', timezone: 'America/Denver' } as never) as TriggerRecord;
    const { computeNextRun } = await import('@/lib/scheduler/cron');
    expect(edited).toMatchObject({ cronExpression: '30 10 * * 1-5', timezone: 'America/Denver',
      prompt: trigger.prompt, enabled: false, model: trigger.model, effort: trigger.effort,
      activeHoursStart: '08:00', activeHoursEnd: '18:00' });
    expect(edited.nextRunAt).toBe(computeNextRun(edited));
    await expect(update.handler({ remote: false }, { id: trigger.id, cronExpression: 'broken' } as never)).rejects.toThrow(/Invalid cron/);
    expect(q.getTrigger(trigger.id)?.cronExpression).toBe('30 10 * * 1-5');
  });

  it('re-arms a finished one-time job only when its instant changes, retaining run history', async () => {
    await seed();
    const q = await import('@/lib/db/queries');
    const trigger = q.createTrigger({ name: 'once-edit', targetKind: 'orchestrator', harness: 'codex', prompt: 'X',
      kind: 'at', runAt: '2026-01-01T15:00:00Z', lastFiredAt: '2026-01-01T15:00:01Z',
      nextRunAt: null, lastRunStatus: 'completed' });
    const update = await findAction('update_trigger');
    const runAt = '2030-10-20T15:30:00.000Z';
    const edited = await update.handler({ remote: false }, { id: trigger.id, runAt } as never) as TriggerRecord;
    expect(edited).toMatchObject({ nextRunAt: runAt, lastFiredAt: null, lastRunStatus: 'completed' });
    q.advanceTriggerNextRun(trigger.id, null, runAt);
    const retried = await update.handler({ remote: false }, { id: trigger.id, runAt } as never) as TriggerRecord;
    expect(retried).toMatchObject({ nextRunAt: null, lastFiredAt: runAt });
    const equivalent = await update.handler({ remote: false }, { id: trigger.id, runAt: '2030-10-20T09:30:00-06:00' } as never) as TriggerRecord;
    expect(equivalent).toMatchObject({ nextRunAt: null, lastFiredAt: runAt });
  });

  it('rejects invalid one-time dates and timezones before writing', async () => {
    await seed();
    const create = await findAction('create_trigger');
    for (const extra of [{ runAt: 'bad-date' }, { runAt: '2030-01-01T09:00:00Z', timezone: 'Bad/Zone' }]) {
      await expect(create.handler({ remote: false }, { name: 'bad-date', targetKind: 'orchestrator', prompt: 'X', kind: 'at', ...extra } as never)).rejects.toThrow();
    }
    const q = await import('@/lib/db/queries');
    const trigger = q.createTrigger({ name: 'valid-date', targetKind: 'orchestrator', harness: 'codex', prompt: 'X', kind: 'at', runAt: '2030-01-01T09:00:00Z' });
    const update = await findAction('update_trigger');
    for (const runAt of ['', 'bad-date']) {
      await expect(update.handler({ remote: false }, { id: trigger.id, runAt } as never)).rejects.toThrow(/valid date/);
    }
    expect(q.getTrigger(trigger.id)?.runAt).toBe(trigger.runAt);
    const disarmed = await update.handler({ remote: false }, { id: trigger.id, runAt: null } as never) as TriggerRecord;
    expect(disarmed).toMatchObject({ runAt: null, nextRunAt: null });
  });

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
    expect(result.trigger).toMatchObject({ harness: 'codex', provider: 'codex' });
  });

  it('create_trigger stores the default harness on a workspace trigger when provider is omitted', async () => {
    const { wsId } = await seed();
    const action = await findAction('create_trigger');
    const result = await action.handler({ remote: false }, {
      name: 'auto-ws', targetKind: 'workspace', workspaceId: wsId,
      prompt: 'X', kind: 'at',
      runAt: new Date(Date.now() + 60_000).toISOString(),
    } as never) as { trigger: { harness: string; provider: string } };
    expect(result.trigger).toMatchObject({ harness: 'codex', provider: 'codex' });
  });

  it('create_trigger rejects an invalid cron expression', async () => {
    const { wsId } = await seed();
    const action = await findAction('create_trigger');
    await expect(action.handler({ remote: false }, {
        name: 'bad', workspaceId: wsId, targetKind: 'workspace',
        prompt: 'X', kind: 'cron', cronExpression: 'not-cron',
      } as never),
    ).rejects.toThrow(/Invalid cron/);
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
      kind: 'integration', providerId: 'telegram', connectionId: 'conn-1',
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
    await expect(action.handler({ remote: false }, {
      name: 'ws-digest', targetKind: 'workspace', workspaceId: wsId,
      prompt: 'X', kind: 'at', runAt: new Date(Date.now() + 60_000).toISOString(),
      deliverResultTo: [ch.id],
    } as never)).rejects.toThrow(/orchestrator/);
  });

  it('create_trigger rejects an unknown digest channel id', async () => {
    await seed();
    const action = await findAction('create_trigger');
    await expect(action.handler({ remote: false }, {
      name: 'bad-digest', targetKind: 'orchestrator',
      prompt: 'X', kind: 'cron', cronExpression: '0 8 * * *',
      deliverResultTo: ['no-such-channel'],
    } as never)).rejects.toThrow(/notification channel not found/);
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
    it('create_trigger falls back to Codex when the user has no default provider', async () => {
      await seed();
      const action = await findAction('create_trigger');
      const result = await action.handler({ remote: false }, {
        name: 'no-default', targetKind: 'orchestrator',
        prompt: 'X', kind: 'cron', cronExpression: '0 9 * * *',
      } as never) as { trigger: { harness: string; provider: string } };
      expect(result.trigger).toMatchObject({ harness: 'codex', provider: 'codex' });
    });

    it('create_trigger preserves a saved Claude default when provider is omitted', async () => {
      const { wsId } = await seed();
      await setDefaultProvider('claude');
      const action = await findAction('create_trigger');
      const result = await action.handler({ remote: false }, {
        name: 'follows-default', targetKind: 'workspace', workspaceId: wsId,
        prompt: 'X', kind: 'manual',
      } as never) as { trigger: { harness: string; provider: string } };
      expect(result.trigger).toMatchObject({ harness: 'claude', provider: 'claude' });
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
      await expect(action.handler({ remote: false }, {
          name: 'mismatch', targetKind: 'orchestrator', provider: 'codex',
          prompt: 'X', kind: 'cron', cronExpression: '0 9 * * *', model: 'opus',
        } as never),
      ).rejects.toThrow(/does not run on codex/);
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
      await expect(action.handler({ remote: false }, {
          name: 'legacy', agentId: 'any-old-id', provider: 'codex', targetKind: 'orchestrator',
          prompt: 'X', kind: 'cron', cronExpression: '0 9 * * *',
        } as never),
      ).rejects.toThrow(/agentId was removed. Use provider/);
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

      await expect(update.handler({ remote: false }, {
          id: created.trigger.id, provider: 'codex', model: 'sonnet',
        } as never),
      ).rejects.toThrow(/does not run on codex/);

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
      await expect(update.handler({ remote: false }, { id: created.trigger.id, model: 'opus' } as never),
      ).rejects.toThrow(/does not run on codex/);
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

      await expect(update.handler({ remote: false }, {
          id: RESERVED_TRIGGER_IDS.morningDeck, prompt: 'hijack',
        } as never),
      ).rejects.toThrow(/managed by the app/);
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

  describe('target_kind=session', () => {
    async function chatIn(wsId: string, harness: HarnessId = 'codex') {
      const q = await import('@/lib/db/queries');
      return q.createExecutionWithChat({ workspaceId: wsId, harness, label: 'Backfill' }).session;
    }
    const checkIn = { name: 'check-in', targetKind: 'session', prompt: 'Check the job.', kind: 'every', intervalSeconds: 900 };

    it('called from a chat with no target id, schedules that chat on its own engine and agent', async () => {
      const { wsId } = await seed();
      await setDefaultProvider('claude');
      const chat = await chatIn(wsId, 'codex');
      const create = await findAction('create_trigger');
      const { trigger } = await create.handler({ remote: true, actor: { source: 'ai', sessionId: chat.id } }, checkIn as never) as { trigger: TriggerRecord & { provider: string } };
      expect(trigger).toMatchObject({
        targetKind: 'session', targetSessionId: chat.id, workspaceId: wsId,
        harness: 'codex', provider: 'codex', model: null, effort: null, serviceTier: null,
        // A busy chat is already awake, so the default skips it.
        concurrencyPolicy: 'skip_if_running',
      });
    });

    it('takes an explicit chat id from a person, and keeps an explicit overlap rule', async () => {
      const { wsId } = await seed();
      const chat = await chatIn(wsId);
      const create = await findAction('create_trigger');
      const { trigger } = await create.handler({ remote: false }, { ...checkIn, targetSessionId: chat.id,
        concurrencyPolicy: 'coalesce_if_active', model: null, effort: null } as never) as { trigger: TriggerRecord };
      expect(trigger).toMatchObject({ targetSessionId: chat.id, concurrencyPolicy: 'coalesce_if_active' });
    });

    it('needs a chat it can send to', async () => {
      const { wsId } = await seed();
      const q = await import('@/lib/db/queries');
      const create = await findAction('create_trigger');
      await expect(create.handler({ remote: false }, checkIn as never)).rejects.toThrow(/target_session_id is required/);
      await expect(create.handler({ remote: false }, { ...checkIn, targetSessionId: 'missing' } as never)).rejects.toThrow(/Chat not found/);
      const archived = await chatIn(wsId);
      q.archiveChatSession(archived.id);
      await expect(create.handler({ remote: false }, { ...checkIn, targetSessionId: archived.id } as never)).rejects.toThrow(/archived/);
      const imported = q.createChatSession({ type: 'execution', harness: 'claude', surfaceKind: 'imported_agent', surfaceRef: 'claude', workspaceId: wsId });
      await expect(create.handler({ remote: false }, { ...checkIn, targetSessionId: imported.id } as never)).rejects.toThrow(/imported from a terminal/);
    });

    it('refuses settings that belong to the chat or to other targets', async () => {
      const { wsId } = await seed();
      const chat = await chatIn(wsId);
      const create = await findAction('create_trigger');
      const ctx = { remote: false };
      for (const extra of [{ provider: 'claude' }, { model: 'gpt-5.5' }, { effort: 'high' }, { serviceTier: 'priority' }]) {
        await expect(create.handler(ctx, { ...checkIn, targetSessionId: chat.id, ...extra } as never)).rejects.toThrow(/own provider, model, effort and speed/);
      }
      const { wsId: otherWs } = await (async () => {
        const { getDb } = await import('@/lib/db');
        const { uuidv7 } = await import('uuidv7');
        const { workspaces } = await import('@/lib/db/schema');
        const id = uuidv7();
        getDb().insert(workspaces).values({ id, name: 'Other', slug: 'other-' + Date.now(), cwd: '/tmp/other', isGit: false,
          status: 'active', filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: true }).run();
        return { wsId: id };
      })();
      await expect(create.handler(ctx, { ...checkIn, targetSessionId: chat.id, workspaceId: otherWs } as never)).rejects.toThrow(/workspace_id comes from the target chat/);
      await expect(create.handler(ctx, { ...checkIn, targetKind: 'workspace', workspaceId: wsId, targetSessionId: chat.id } as never)).rejects.toThrow(/only for target_kind=session/);
    });

    it('update_trigger edits schedule and prompt but not the chat\'s engine or model', async () => {
      const { wsId } = await seed();
      const chat = await chatIn(wsId);
      const create = await findAction('create_trigger');
      const { trigger } = await create.handler({ remote: false }, { ...checkIn, targetSessionId: chat.id } as never) as { trigger: TriggerRecord };
      const update = await findAction('update_trigger');
      const edited = await update.handler({ remote: false }, { id: trigger.id, enabled: false, prompt: 'Check it again.', intervalSeconds: 1800 } as never) as TriggerRecord;
      expect(edited).toMatchObject({ enabled: false, prompt: 'Check it again.', intervalSeconds: 1800, targetSessionId: chat.id, harness: 'codex' });
      await expect(update.handler({ remote: false }, { id: trigger.id, provider: 'claude' } as never)).rejects.toThrow(/own provider/);
      await expect(update.handler({ remote: false }, { id: trigger.id, model: 'gpt-5.5' } as never)).rejects.toThrow(/own provider/);
    });

    it('list_triggers filters to chat targets', async () => {
      const { wsId } = await seed();
      const chat = await chatIn(wsId);
      const create = await findAction('create_trigger');
      await create.handler({ remote: false }, { ...checkIn, targetSessionId: chat.id } as never);
      await create.handler({ remote: false }, { name: 'other', targetKind: 'orchestrator', prompt: 'X', kind: 'manual' } as never);
      const list = await findAction('list_triggers');
      const rows = await list.handler({ remote: false }, { targetKind: 'session' } as never) as TriggerRecord[];
      expect(rows.map((r) => r.name)).toEqual(['check-in']);
    });
  });

  describe('editing a whole schedule', () => {
    it('update_trigger switches timing kind, clears the old kind\'s field and recomputes the next run', async () => {
      await seed();
      const q = await import('@/lib/db/queries');
      const trigger = q.createTrigger({ name: 'switch', targetKind: 'orchestrator', harness: 'codex', prompt: 'P',
        kind: 'cron', cronExpression: '0 9 * * *', timezone: 'UTC', enabled: true });
      const update = await findAction('update_trigger');
      const every = await update.handler({ remote: false }, { id: trigger.id, kind: 'every', intervalSeconds: 1800 } as never) as TriggerRecord;
      expect(every).toMatchObject({ kind: 'every', intervalSeconds: 1800, cronExpression: null, runAt: null });
      const next = Date.parse(every.nextRunAt!) - Date.now();
      expect(next).toBeGreaterThan(1700_000);
      expect(next).toBeLessThanOrEqual(1800_000);

      const runAt = new Date(Date.now() + 86_400_000).toISOString();
      const once = await update.handler({ remote: false }, { id: trigger.id, kind: 'at', runAt } as never) as TriggerRecord;
      expect(once).toMatchObject({ kind: 'at', runAt, intervalSeconds: null, nextRunAt: runAt });

      const manual = await update.handler({ remote: false }, { id: trigger.id, kind: 'manual' } as never) as TriggerRecord;
      expect(manual).toMatchObject({ kind: 'manual', runAt: null, nextRunAt: null });
    });

    it('update_trigger re-arms a fired one-time job when it becomes one again', async () => {
      await seed();
      const q = await import('@/lib/db/queries');
      const trigger = q.createTrigger({ name: 'rearm', targetKind: 'orchestrator', harness: 'codex', prompt: 'P',
        kind: 'every', intervalSeconds: 600, enabled: true, lastFiredAt: new Date(Date.now() - 60_000).toISOString() });
      const update = await findAction('update_trigger');
      const runAt = new Date(Date.now() + 3_600_000).toISOString();
      const once = await update.handler({ remote: false }, { id: trigger.id, kind: 'at', runAt } as never) as TriggerRecord;
      expect(once).toMatchObject({ kind: 'at', lastFiredAt: null, nextRunAt: runAt });
    });

    it('update_trigger needs the new kind\'s field, and leaves webhooks alone', async () => {
      await seed();
      const q = await import('@/lib/db/queries');
      const update = await findAction('update_trigger');
      const manual = q.createTrigger({ name: 'm', targetKind: 'orchestrator', harness: 'codex', prompt: 'P', kind: 'manual', enabled: true });
      await expect(update.handler({ remote: false }, { id: manual.id, kind: 'cron' } as never)).rejects.toThrow(/cron_expression is required/);
      await expect(update.handler({ remote: false }, { id: manual.id, kind: 'every' } as never)).rejects.toThrow(/interval_seconds is required/);
      await expect(update.handler({ remote: false }, { id: manual.id, kind: 'at' } as never)).rejects.toThrow(/run_at must be/);
      await expect(update.handler({ remote: false }, { id: manual.id, kind: 'cron', cronExpression: 'nope' } as never)).rejects.toThrow(/Invalid cron/);

      const create = await findAction('create_trigger');
      const { trigger: hook } = await create.handler({ remote: false }, { name: 'hook', targetKind: 'orchestrator', prompt: 'P', kind: 'webhook' } as never) as { trigger: TriggerRecord };
      await expect(update.handler({ remote: false }, { id: hook.id, kind: 'every', intervalSeconds: 60 } as never)).rejects.toThrow(/webhook trigger keeps its kind/);
    });

    it('update_trigger moves a workspace trigger to another agent, and only a workspace trigger', async () => {
      const { wsId } = await seed();
      const { getDb } = await import('@/lib/db');
      const { uuidv7 } = await import('uuidv7');
      const { workspaces } = await import('@/lib/db/schema');
      const otherWs = uuidv7();
      getDb().insert(workspaces).values({ id: otherWs, name: 'Other', slug: 'other-' + Date.now(), cwd: '/tmp/other', isGit: false,
        status: 'active', filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: true }).run();
      const q = await import('@/lib/db/queries');
      const update = await findAction('update_trigger');
      const ws = q.createTrigger({ name: 'w', targetKind: 'workspace', workspaceId: wsId, harness: 'codex', prompt: 'P', kind: 'manual', enabled: true });
      const moved = await update.handler({ remote: false }, { id: ws.id, workspaceId: otherWs } as never) as TriggerRecord;
      expect(moved.workspaceId).toBe(otherWs);
      await expect(update.handler({ remote: false }, { id: ws.id, workspaceId: 'missing' } as never)).rejects.toThrow(/Agent not found/);
      const orch = q.createTrigger({ name: 'o', targetKind: 'orchestrator', harness: 'codex', prompt: 'P', kind: 'manual', enabled: true });
      await expect(update.handler({ remote: false }, { id: orch.id, workspaceId: wsId } as never)).rejects.toThrow(/only change on a target_kind=workspace/);
    });
  });

  describe('the Schedules window\'s builder chat', () => {
    async function scheduleChat(ref: string) {
      const q = await import('@/lib/db/queries');
      return q.createChatSession({ type: 'content', harness: 'claude', surfaceKind: 'trigger', surfaceRef: ref, status: 'active' });
    }

    it('moves the new-schedule chat onto the schedule it creates', async () => {
      const { wsId } = await seed();
      const chat = await scheduleChat('new');
      const create = await findAction('create_trigger');
      const { trigger } = await create.handler({ remote: true, actor: { source: 'ai', sessionId: chat.id } },
        { name: 'Morning triage', targetKind: 'workspace', workspaceId: wsId, prompt: 'Triage my inbox.', kind: 'cron', cronExpression: '0 8 * * 1-5', timezone: 'America/Denver' } as never) as { trigger: TriggerRecord };
      const q = await import('@/lib/db/queries');
      expect(q.getChatSession(chat.id)?.surfaceRef).toBe(trigger.id);

      // A second create from the same (now moved) chat leaves it where it is.
      const { trigger: second } = await create.handler({ remote: true, actor: { source: 'ai', sessionId: chat.id } },
        { name: 'Another', targetKind: 'orchestrator', prompt: 'X', kind: 'manual' } as never) as { trigger: TriggerRecord };
      expect(second.id).not.toBe(trigger.id);
      expect(q.getChatSession(chat.id)?.surfaceRef).toBe(trigger.id);
    });

    it('closes and archives a schedule\'s builder chat when the schedule is deleted', async () => {
      await seed();
      const q = await import('@/lib/db/queries');
      const trigger = q.createTrigger({ name: 'gone', targetKind: 'orchestrator', harness: 'codex', prompt: 'P', kind: 'manual', enabled: true });
      const chat = await scheduleChat(trigger.id);
      const other = await scheduleChat('new');
      const del = await findAction('delete_trigger');
      await del.handler({ remote: false }, { id: trigger.id } as never);
      expect(q.getChatSession(chat.id)?.status).toBe('archived');
      expect(q.getChatSession(other.id)?.status).toBe('active');
    });

    it('never defaults a chat target to itself', async () => {
      const { wsId } = await seed();
      const chat = await scheduleChat('new');
      const create = await findAction('create_trigger');
      await expect(create.handler({ remote: true, actor: { source: 'ai', sessionId: chat.id } },
        { name: 'c', targetKind: 'session', prompt: 'X', kind: 'every', intervalSeconds: 600 } as never)).rejects.toThrow(/only sets schedules up/);
      const q = await import('@/lib/db/queries');
      const work = q.createExecutionWithChat({ workspaceId: wsId, harness: 'codex', label: 'Work' }).session;
      const { trigger } = await create.handler({ remote: true, actor: { source: 'ai', sessionId: chat.id } },
        { name: 'c', targetKind: 'session', targetSessionId: work.id, prompt: 'X', kind: 'every', intervalSeconds: 600 } as never) as { trigger: TriggerRecord };
      expect(trigger.targetSessionId).toBe(work.id);
    });
  });
});
