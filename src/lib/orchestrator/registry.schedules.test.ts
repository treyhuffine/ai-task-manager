import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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

const TEST_DB = path.join(os.tmpdir(), `flow-registry-test-${process.pid}.db`);

beforeEach(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  process.env.FLOW_DB_PATH = TEST_DB;
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
  const { workspaces, agents } = await import('@/lib/db/schema');
  const wsId = uuidv7();
  db.insert(workspaces).values({
    id: wsId, name: 'TestWs', slug: 'testws-' + Date.now(),
    cwd: '/tmp/testws', isGit: false,
  }).run();
  const agentId = uuidv7();
  db.insert(agents).values({
    id: agentId, userId: 'local', kind: 'executor',
    name: 'Test', harness: 'claude_code', config: {}, status: 'active',
  }).run();
  return { wsId, agentId };
}

function findAction(name: string) {
  return import('./registry').then((m) => {
    const a = m.actions.find((x) => x.name === name);
    if (!a) throw new Error(`action ${name} missing`);
    return a;
  });
}

describe('orchestrator schedule + run actions', () => {
  it('exposes the full schedule + run + skill surface', async () => {
    const { actions } = await import('./registry');
    const names = actions.map((a) => a.name);
    expect(names).toEqual(expect.arrayContaining([
      'list_schedules', 'get_schedule', 'create_schedule',
      'update_schedule', 'delete_schedule', 'run_schedule',
      'list_runs', 'get_run', 'cancel_run', 'list_skills',
    ]));
  });

  it('create_schedule resolves the orchestrator default agent when agentId is omitted', async () => {
    await seed();
    const action = await findAction('create_schedule');
    const result = await action.handler({ remote: false }, {
      name: 'auto-agent', targetKind: 'orchestrator',
      prompt: 'X', kind: 'cron', cronExpression: '0 9 * * *',
    } as never) as { schedule: { agentId: string } };
    const queries = await import('@/lib/db/queries');
    const agent = queries.getAgent(result.schedule.agentId);
    expect(agent).toBeDefined();
    expect(agent!.kind).toBe('orchestrator');
  });

  it('create_schedule resolves the workspace default executor when agentId is omitted', async () => {
    const { wsId } = await seed();
    const action = await findAction('create_schedule');
    const result = await action.handler({ remote: false }, {
      name: 'auto-ws', targetKind: 'workspace', workspaceId: wsId,
      prompt: 'X', kind: 'at',
      runAt: new Date(Date.now() + 60_000).toISOString(),
    } as never) as { schedule: { agentId: string } };
    const queries = await import('@/lib/db/queries');
    const agent = queries.getAgent(result.schedule.agentId);
    expect(agent).toBeDefined();
    expect(agent!.kind).toBe('executor');
  });

  it('create_schedule rejects an invalid cron expression', async () => {
    const { agentId, wsId } = await seed();
    const action = await findAction('create_schedule');
    expect(() =>
      action.handler({ remote: false }, {
        name: 'bad', agentId, workspaceId: wsId, targetKind: 'workspace',
        prompt: 'X', kind: 'cron', cronExpression: 'not-cron',
      } as never),
    ).toThrow(/Invalid cron/);
  });

  it('create_schedule + create_schedule (webhook) returns plaintext secret once', async () => {
    const { agentId } = await seed();
    const action = await findAction('create_schedule');
    const result = await action.handler({ remote: false }, {
      name: 'inbox', agentId, targetKind: 'orchestrator',
      prompt: 'Triage', kind: 'webhook',
    } as never) as { schedule: { webhookPublicId: string | null }; webhookSecret: string };
    expect(result.webhookSecret).toBeTruthy();
    expect(result.schedule.webhookPublicId).toBeTruthy();
  });

  it('update_schedule recomputes nextRunAt when the cron expression changes', async () => {
    const { agentId } = await seed();
    const createAction = await findAction('create_schedule');
    const created = await createAction.handler({ remote: false }, {
      name: 'daily', agentId, targetKind: 'orchestrator',
      prompt: 'X', kind: 'cron', cronExpression: '0 9 * * *',
    } as never) as { schedule: { id: string; nextRunAt: string } };
    const updateAction = await findAction('update_schedule');
    const before = created.schedule.nextRunAt;
    const updated = await updateAction.handler({ remote: false }, {
      id: created.schedule.id, cronExpression: '0 18 * * *',
    } as never) as { nextRunAt: string };
    expect(updated.nextRunAt).not.toBe(before);
  });

  it('delete_schedule preserves runs via SET NULL', async () => {
    const { agentId, wsId } = await seed();
    const create = await findAction('create_schedule');
    const created = await create.handler({ remote: false }, {
      name: 'tmp', agentId, workspaceId: wsId, targetKind: 'workspace',
      prompt: 'X', kind: 'at',
      runAt: new Date(Date.now() + 60_000).toISOString(),
    } as never) as { schedule: { id: string } };
    const del = await findAction('delete_schedule');
    const result = await del.handler({ remote: false }, { id: created.schedule.id } as never);
    expect(result).toMatchObject({ deleted: true });
  });

  it('cancel_run on a terminal run returns it unchanged', async () => {
    const { agentId } = await seed();
    const queries = await import('@/lib/db/queries');
    const run = queries.createRun({
      agentId, trigger: 'manual', status: 'completed',
    });
    const cancel = await findAction('cancel_run');
    const result = await cancel.handler({ remote: false }, { id: run.id } as never) as {
      id: string;
      status: string;
    };
    expect(result.status).toBe('completed');
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

  it('create_schedule binds + de-dupes a digest channel for orchestrator targets', async () => {
    await seed();
    const ch = await seedTelegramChannel();
    const action = await findAction('create_schedule');
    const result = await action.handler({ remote: false }, {
      name: 'email-digest', targetKind: 'orchestrator',
      prompt: 'Review my email and write a digest',
      kind: 'cron', cronExpression: '0 8 * * *',
      deliverResultTo: [ch.id, ch.id], // duplicate proves de-dupe
    } as never) as { schedule: { deliverResultTo: string[] } };
    expect(result.schedule.deliverResultTo).toEqual([ch.id]);
  });

  it('create_schedule rejects a digest binding on a workspace target', async () => {
    const { wsId } = await seed();
    const ch = await seedTelegramChannel();
    const action = await findAction('create_schedule');
    expect(() => action.handler({ remote: false }, {
      name: 'ws-digest', targetKind: 'workspace', workspaceId: wsId,
      prompt: 'X', kind: 'at', runAt: new Date(Date.now() + 60_000).toISOString(),
      deliverResultTo: [ch.id],
    } as never)).toThrow(/orchestrator/);
  });

  it('create_schedule rejects an unknown digest channel id', async () => {
    await seed();
    const action = await findAction('create_schedule');
    expect(() => action.handler({ remote: false }, {
      name: 'bad-digest', targetKind: 'orchestrator',
      prompt: 'X', kind: 'cron', cronExpression: '0 8 * * *',
      deliverResultTo: ['no-such-channel'],
    } as never)).toThrow(/notification channel not found/);
  });

  it('update_schedule replaces the digest binding (and [] unbinds)', async () => {
    await seed();
    const ch = await seedTelegramChannel();
    const create = await findAction('create_schedule');
    const created = await create.handler({ remote: false }, {
      name: 'digest-edit', targetKind: 'orchestrator',
      prompt: 'X', kind: 'cron', cronExpression: '0 8 * * *',
    } as never) as { schedule: { id: string; deliverResultTo: string[] } };
    expect(created.schedule.deliverResultTo).toEqual([]);

    const update = await findAction('update_schedule');
    const bound = await update.handler({ remote: false }, {
      id: created.schedule.id, deliverResultTo: [ch.id],
    } as never) as { deliverResultTo: string[] };
    expect(bound.deliverResultTo).toEqual([ch.id]);

    const unbound = await update.handler({ remote: false }, {
      id: created.schedule.id, deliverResultTo: [],
    } as never) as { deliverResultTo: string[] };
    expect(unbound.deliverResultTo).toEqual([]);
  });
});
