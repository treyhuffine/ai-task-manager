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

const TEST_DB = path.join(os.tmpdir(), `flow-registry-stream-test-${process.pid}.db`);

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

async function resetDb() {
  const { getDb, resetDb: reset } = await import('@/lib/db');
  reset();
  getDb();
}

async function findAction(name: string) {
  const m = await import('./registry');
  const a = m.actions.find((x) => x.name === name);
  if (!a) throw new Error(`action ${name} missing`);
  return a;
}

/** Trusted local CLI context — dispositions attribute to the user. */
const ctx = { remote: false } as const;
/** Remote (MCP) context — the agent side of the trust boundary. */
const remoteCtx = { remote: true } as const;

async function capture(rawText: string): Promise<{ id: string }> {
  const create = await findAction('create_stream_item');
  return (await create.handler(ctx, { rawText } as never)) as { id: string };
}

interface DispositionResult {
  proposed: boolean;
  decisionId: string;
  entity: { entityType: string; entityId: string } | null;
  created: { id: string; title?: string; body?: string; streamItemId?: string | null } | null;
  streamItems: Array<{ id: string; status: string; dismissedBy: string | null }>;
}

describe('stream triage actions', () => {
  it('exposes the full triage surface', async () => {
    const { actions } = await import('./registry');
    const names = actions.map((a) => a.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'list_stream', 'get_stream_item', 'create_stream_item',
        'promote_stream', 'merge_stream', 'combine_stream', 'mark_stream_reviewed',
        'dismiss_stream', 'incubate_stream', 'propose_stream_triage',
        'undo_triage_decision', 'begin_stream_sweep', 'finish_stream_sweep',
        'get_triage_metrics',
      ]),
    );
  });

  it('captures into the inbox and lists pending by default', async () => {
    await resetDb();
    const item = await capture('remember to look at the zeppelin budget');
    const list = await findAction('list_stream');

    const pending = (await list.handler(ctx, {} as never)) as Array<{ id: string; status: string }>;
    expect(pending.some((s) => s.id === item.id)).toBe(true);
    expect(pending.every((s) => s.status === 'pending')).toBe(true);
  });

  it('promotes to a task: entity + provenance link + stamps + backref, one decision', async () => {
    await resetDb();
    const item = await capture('need to renew the docking permit before friday\nmore context here');
    const promote = await findAction('promote_stream');

    const result = (await promote.handler(ctx, {
      id: item.id, to: 'task', title: 'Renew the docking permit', effort: 'small',
    } as never)) as DispositionResult;

    expect(result.proposed).toBe(false);
    expect(result.created?.title).toBe('Renew the docking permit');
    expect(result.created?.body).toContain('docking permit'); // raw text carried as body
    expect(result.created?.streamItemId).toBe(item.id);

    const streamRow = result.streamItems[0];
    expect(streamRow.status).toBe('promoted');

    const q = await import('@/lib/db/queries');
    expect(q.getStreamOutcomes(item.id)).toEqual([
      expect.objectContaining({ entityType: 'task', entityId: result.created!.id, relation: 'created' }),
    ]);
    expect(q.getStreamSources('task', result.created!.id).map((s) => s.id)).toEqual([item.id]);
    expect(q.getTriageDecision(result.decisionId)!.state).toBe('accepted'); // local ctx = user

    // The created task is real and queryable.
    const getTask = await findAction('get_task');
    const task = await getTask.handler(ctx, { id: result.created!.id } as never) as { title: string };
    expect(task.title).toBe('Renew the docking permit');
  });

  it('promotes to a note, defaulting the title-less body to the raw text', async () => {
    await resetDb();
    const item = await capture('interesting essay on harbor logistics: example.com/essay');
    const promote = await findAction('promote_stream');

    const result = (await promote.handler(ctx, { id: item.id, to: 'note' } as never)) as DispositionResult;
    expect(result.entity?.entityType).toBe('note');
    expect(result.streamItems[0].status).toBe('promoted');
    expect(result.created?.body).toContain('harbor logistics');
  });

  it('falls back to a first-line title when none is given for a task', async () => {
    await resetDb();
    const item = await capture('book the slipway\nlong second line that should not be in the title');
    const promote = await findAction('promote_stream');
    const result = (await promote.handler(ctx, { id: item.id, to: 'task' } as never)) as DispositionResult;
    expect(result.created?.title).toBe('book the slipway');
  });

  it('refuses double-triage: promoted and dismissed items conflict', async () => {
    await resetDb();
    const promote = await findAction('promote_stream');
    const dismiss = await findAction('dismiss_stream');

    const a = await capture('promote me once');
    await promote.handler(ctx, { id: a.id, to: 'note' } as never);
    await expect(
      (async () => promote.handler(ctx, { id: a.id, to: 'task' } as never))(),
    ).rejects.toMatchObject({ code: 'conflict' });

    const b = await capture('dismiss me once');
    const dismissed = (await dismiss.handler(remoteCtx, { id: b.id } as never)) as DispositionResult;
    expect(dismissed.streamItems[0].status).toBe('dismissed');
    expect(dismissed.streamItems[0].dismissedBy).toBe('agent'); // remote ctx = the agent decided
    await expect(
      (async () => dismiss.handler(ctx, { id: b.id } as never))(),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('journal (mark_stream_reviewed) keeps the item as a recorded thought', async () => {
    await resetDb();
    const item = await capture('the harbor at dusk was something else');
    const journal = await findAction('mark_stream_reviewed');
    const result = (await journal.handler(ctx, { id: item.id } as never)) as DispositionResult;
    expect(result.streamItems[0].status).toBe('reviewed');
  });

  it('merges into an existing note non-destructively', async () => {
    await resetDb();
    const q = await import('@/lib/db/queries');
    const note = q.createNote({ title: 'Logistics', body: 'Existing body.' });
    const item = await capture('new logistics detail: the crane is booked mondays');
    const merge = await findAction('merge_stream');

    const result = (await merge.handler(ctx, {
      id: item.id, targetType: 'note', targetId: note.id,
    } as never)) as DispositionResult;

    expect(result.entity?.entityId).toBe(note.id);
    expect(q.getNote(note.id)!.body).toBe('Existing body.\n\nnew logistics detail: the crane is booked mondays');
  });

  it('combines several captures into one entity', async () => {
    await resetDb();
    const a = await capture('idea: floating market');
    const b = await capture('floating market: start with four stalls');
    const combine = await findAction('combine_stream');

    const result = (await combine.handler(ctx, {
      ids: [a.id, b.id], to: 'note', title: 'Floating market', body: 'Four stalls to start.',
    } as never)) as DispositionResult;
    expect(result.streamItems).toHaveLength(2);
    expect(result.streamItems.every((s) => s.status === 'promoted')).toBe(true);
  });

  it('policy: a sweep call at suggest level becomes a proposal, not a mutation', async () => {
    await resetDb();
    const q = await import('@/lib/db/queries');
    const pass = q.createTriagePass('manual');
    const item = await capture('the agent thinks this is a task');
    const promote = await findAction('promote_stream');

    // promote_task starts at 'suggest' — with a pass_id the action layer
    // must park it as a proposal regardless of what the agent wanted.
    const result = (await promote.handler(remoteCtx, {
      id: item.id, to: 'task', title: 'Agent idea', passId: pass.id,
    } as never)) as { proposed: boolean; decisionId: string };

    expect(result.proposed).toBe(true);
    expect(q.getStream(item.id)!.status).toBe('proposed');
    expect(q.listTasks()).toHaveLength(0);
    expect(q.getTriageDecision(result.decisionId)!.state).toBe('proposed');
  });

  it('policy: the kill switch forces every remote call to propose', async () => {
    await resetDb();
    const q = await import('@/lib/db/queries');
    q.setStreamAutonomy({ killSwitch: true });
    const item = await capture('agent tries to journal this');

    // Journal defaults to auto_digest, but the kill switch overrides all.
    const journal = await findAction('mark_stream_reviewed');
    const result = (await journal.handler(remoteCtx, { id: item.id } as never)) as { proposed: boolean };
    expect(result.proposed).toBe(true);
    expect(q.getStream(item.id)!.status).toBe('proposed');
  });

  it('policy: journal auto-applies inside a sweep (auto_digest default)', async () => {
    await resetDb();
    const q = await import('@/lib/db/queries');
    const pass = q.createTriagePass('manual');
    const item = await capture('musing about clouds');
    const journal = await findAction('mark_stream_reviewed');

    const result = (await journal.handler(remoteCtx, { id: item.id, passId: pass.id } as never)) as DispositionResult;
    expect(result.proposed).toBe(false);
    expect(result.streamItems[0].status).toBe('reviewed');
    // Auto-applied by policy → executed (settles into accepted after 7 days).
    expect(q.getTriageDecision(result.decisionId)!.state).toBe('executed');
  });

  it('undo_triage_decision reverses through the wire surface', async () => {
    await resetDb();
    const item = await capture('make and unmake');
    const promote = await findAction('promote_stream');
    const undo = await findAction('undo_triage_decision');

    const applied = (await promote.handler(ctx, { id: item.id, to: 'task', title: 'Make it' } as never)) as DispositionResult;
    const undone = (await undo.handler(ctx, { decisionId: applied.decisionId } as never)) as {
      entityRemoved: string | null;
      streamItems: Array<{ status: string }>;
    };
    expect(undone.entityRemoved).toBe('deleted');
    expect(undone.streamItems[0].status).toBe('pending');
  });

  it('throws not_found for unknown items', async () => {
    await resetDb();
    const get = await findAction('get_stream_item');
    await expect(
      (async () => get.handler(ctx, { id: 'nope' } as never))(),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
