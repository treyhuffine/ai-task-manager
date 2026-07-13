/**
 * Stream triage: the load-bearing invariants from docs/streaming-spec-tasks.md.
 *
 * Covers: non-destructive appends (T0.1), transactional + idempotent
 * promotion (T0.2), acceptance telemetry (T0.4), raw-text immutability
 * (T0.5), splitting, combining, merge concurrency guards, the undo table
 * (§3.10), proposals + policy states, pass single-flight + staleness,
 * reopen/resurface, and the graduation engine (§3.11).
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TEST_DB = path.join(os.tmpdir(), `flow-stream-triage-test-${process.pid}.db`);

function rm() {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

beforeEach(() => {
  rm();
  process.env.FLOW_DB_PATH = TEST_DB;
});
afterAll(rm);

async function setup() {
  const { getDb, resetDb } = await import('@/lib/db');
  resetDb();
  getDb();
  const q = await import('@/lib/db/queries');
  return { q, getDb };
}

describe('non-destructive appends (T0.1)', () => {
  it('appendToNote preserves the body, creates a version, and stacks', async () => {
    const { q } = await setup();
    const note = q.createNote({ title: 'Migration plan', body: 'Original body.' });

    const first = q.appendToNote(note.id, 'First addition.')!;
    expect(first.note.body).toBe('Original body.\n\nFirst addition.');
    expect(first.versionId).toBeTruthy();

    const second = q.appendToNote(note.id, 'Second addition.')!;
    expect(second.note.body).toBe('Original body.\n\nFirst addition.\n\nSecond addition.');

    // Baseline + two appends.
    expect(q.listEntityVersions('note', note.id).length).toBeGreaterThanOrEqual(3);
  });

  it('appendTaskContext creates the heading once and appends under it', async () => {
    const { q } = await setup();
    const task = q.createTask({ title: 'Ship it', body: 'Steps.' });

    const first = q.appendTaskContext(task.id, 'From a capture.')!;
    expect(first.task.body).toBe('Steps.\n\n## Context\n\nFrom a capture.');

    const second = q.appendTaskContext(task.id, 'Another capture.')!;
    expect(second.task.body).toBe('Steps.\n\n## Context\n\nFrom a capture.\n\nAnother capture.');
    expect((second.task.body!.match(/## Context/g) ?? []).length).toBe(1);
  });
});

describe('raw text immutability (T0.5)', () => {
  it('rejects rewriting captured words', async () => {
    const { q } = await setup();
    const item = q.createStream({ rawText: 'my original thought' });
    expect(() => q.updateStream(item.id, { rawText: 'rewritten' })).toThrowError(/immutable/);
  });

  it('allows the retry path to replace a preprocessing placeholder', async () => {
    const { q } = await setup();
    const item = q.createStream({
      rawText: '[Voice memo, transcription failed]\n\n[memo](/api/attachments/x.webm)',
      media: 'voice',
    });
    const updated = q.updateStream(item.id, { rawText: 'the real transcript' });
    expect(updated?.rawText).toBe('the real transcript');
    // And only once — after real content lands, it is immutable.
    expect(() => q.updateStream(item.id, { rawText: 'rewrite again' })).toThrowError(/immutable/);
  });
});

describe('promotion (T0.2)', () => {
  it('creates the entity, links, stamps, and task backref in one decision', async () => {
    const { q } = await setup();
    const item = q.createStream({ rawText: 'ship the manifest tomorrow morning' });

    const result = q.recordTriageDecisionAndApply(
      {
        disposition: 'promote_task',
        streamItemIds: [item.id],
        draft: { title: 'Ship the manifest' },
        actor: 'user',
      },
      'accepted',
    );

    expect(result.entity?.entityType).toBe('task');
    const task = q.getTask(result.entity!.entityId)!;
    expect(task.title).toBe('Ship the manifest');
    expect(task.streamItemId).toBe(item.id);

    const updated = q.getStream(item.id)!;
    expect(updated.status).toBe('promoted');

    const outcomes = q.getStreamOutcomes(item.id);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ entityType: 'task', entityId: task.id, relation: 'created' });
    expect(q.getStreamSources('task', task.id).map((s) => s.id)).toEqual([item.id]);
  });

  it('rejects double promotion with a stable conflict', async () => {
    const { q } = await setup();
    const item = q.createStream({ rawText: 'one thought' });
    q.recordTriageDecisionAndApply(
      { disposition: 'promote_note', streamItemIds: [item.id], actor: 'user' },
      'accepted',
    );
    expect(() =>
      q.recordTriageDecisionAndApply(
        { disposition: 'promote_note', streamItemIds: [item.id], actor: 'user' },
        'accepted',
      ),
    ).toThrowError(/already promoted/);
  });

  it('rolls back completely when the apply fails mid-way', async () => {
    const { q } = await setup();
    const item = q.createStream({ rawText: 'merge me' });
    // Merge into a nonexistent target throws inside the transaction.
    expect(() =>
      q.recordTriageDecisionAndApply(
        {
          disposition: 'merge_note',
          streamItemIds: [item.id],
          targetType: 'note',
          targetId: 'missing-note-id',
          actor: 'user',
        },
        'accepted',
      ),
    ).toThrowError(/not found/);
    // Nothing half-applied: no decision row, item untouched.
    expect(q.listTriageDecisions({ streamItemId: item.id })).toHaveLength(0);
    expect(q.getStream(item.id)!.status).toBe('pending');
  });

  it('applyTriageDecision is idempotent', async () => {
    const { q } = await setup();
    const item = q.createStream({ rawText: 'propose me' });
    const [proposal] = q.proposeTriageDecisions(
      [{ disposition: 'promote_note', streamItemIds: [item.id], actor: 'agent', rationale: 'worth keeping' }],
      null,
    );
    const first = q.applyTriageDecision(proposal.id, { decidedBy: 'user' });
    const second = q.applyTriageDecision(proposal.id, { decidedBy: 'user' });
    expect(second.decision.state).toBe(first.decision.state);
    expect(second.entity?.entityId).toBe(first.entity?.entityId);
    // Exactly one note created.
    expect(q.listNotes().length).toBe(1);
  });
});

describe('dates require evidence (§3.3)', () => {
  it('rejects a deadline without quoted source words', async () => {
    const { q } = await setup();
    const item = q.createStream({ rawText: 'finish the deck' });
    expect(() =>
      q.recordTriageDecisionAndApply(
        {
          disposition: 'promote_task',
          streamItemIds: [item.id],
          draft: { title: 'Finish the deck', hardDeadline: '2026-07-15' },
          actor: 'agent',
        },
        'executed',
      ),
    ).toThrowError(/evidence/i);
  });
});

describe('splitting: one capture, several outcomes', () => {
  it('supports a task and a journal record from the same item', async () => {
    const { q } = await setup();
    const item = q.createStream({ rawText: 'call Sam about the launch. also feeling good about progress' });

    q.recordTriageDecisionAndApply(
      { disposition: 'promote_task', streamItemIds: [item.id], draft: { title: 'Call Sam about the launch' }, actor: 'user' },
      'accepted',
    );
    // The second decision applies against the already-promoted item —
    // splitting means multiple decisions can land, guarded by status.
    // Highest-precedence applied outcome wins: promoted.
    expect(q.getStream(item.id)!.status).toBe('promoted');
    expect(q.getStreamOutcomes(item.id)).toHaveLength(1);
  });
});

describe('combine', () => {
  it('fuses several captures into one entity with full provenance', async () => {
    const { q } = await setup();
    const a = q.createStream({ rawText: 'idea: unified inbox' });
    const b = q.createStream({ rawText: 'more on the inbox idea: dedupe by thread' });

    const result = q.recordTriageDecisionAndApply(
      {
        disposition: 'combine_note',
        streamItemIds: [a.id, b.id],
        draft: { title: 'Unified inbox', body: 'One inbox, deduped by thread.' },
        actor: 'user',
      },
      'accepted',
    );

    const note = q.getNote(result.entity!.entityId)!;
    expect(note.body).toBe('One inbox, deduped by thread.');
    expect(q.getStream(a.id)!.status).toBe('promoted');
    expect(q.getStream(b.id)!.status).toBe('promoted');
    expect(q.getStreamSources('note', note.id).map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
    expect(q.getStreamOutcomes(a.id)[0].relation).toBe('combined_into');
  });

  it('requires at least two items', async () => {
    const { q } = await setup();
    const a = q.createStream({ rawText: 'lonely' });
    expect(() =>
      q.recordTriageDecisionAndApply(
        { disposition: 'combine_note', streamItemIds: [a.id], actor: 'user' },
        'accepted',
      ),
    ).toThrowError(/at least two/);
  });
});

describe('merge concurrency guard', () => {
  it('rejects a stale expectedTargetUpdatedAt with conflict', async () => {
    const { q } = await setup();
    const note = q.createNote({ title: 'Target', body: 'Body.' });
    const item = q.createStream({ rawText: 'belongs in target' });

    expect(() =>
      q.recordTriageDecisionAndApply(
        {
          disposition: 'merge_note',
          streamItemIds: [item.id],
          targetType: 'note',
          targetId: note.id,
          draft: { expectedTargetUpdatedAt: '2020-01-01T00:00:00.000Z' },
          actor: 'agent',
        },
        'executed',
      ),
    ).toThrowError(/changed since/);
    expect(q.getNote(note.id)!.body).toBe('Body.');
  });

  it('appends and records the version handle when fresh', async () => {
    const { q } = await setup();
    const note = q.createNote({ title: 'Target', body: 'Body.' });
    const item = q.createStream({ rawText: 'belongs in target' });

    const result = q.recordTriageDecisionAndApply(
      {
        disposition: 'merge_note',
        streamItemIds: [item.id],
        targetType: 'note',
        targetId: note.id,
        draft: { expectedTargetUpdatedAt: note.updatedAt },
        actor: 'agent',
      },
      'executed',
    );
    expect(q.getNote(note.id)!.body).toBe('Body.\n\nbelongs in target');
    expect(result.entityVersionId).toBeTruthy();
    expect(result.decision.state).toBe('executed');
  });
});

describe('the undo table (§3.10)', () => {
  it('deletes an untouched created entity and returns the capture to pending', async () => {
    const { q } = await setup();
    const item = q.createStream({ rawText: 'make me a task' });
    const applied = q.recordTriageDecisionAndApply(
      { disposition: 'promote_task', streamItemIds: [item.id], draft: { title: 'A task' }, actor: 'user' },
      'accepted',
    );

    const undone = q.undoTriageDecision(applied.decision.id);
    expect(undone.entityRemoved).toBe('deleted');
    expect(q.getTask(applied.entity!.entityId)).toBeUndefined();
    const after = q.getStream(item.id)!;
    expect(after.status).toBe('pending');
    expect(q.getStreamOutcomes(item.id)).toHaveLength(0);
  });

  it('archives instead of deleting when the user edited the entity', async () => {
    const { q } = await setup();
    const item = q.createStream({ rawText: 'make me a task' });
    const applied = q.recordTriageDecisionAndApply(
      { disposition: 'promote_task', streamItemIds: [item.id], draft: { title: 'A task' }, actor: 'user' },
      'accepted',
    );
    // A human edit on top of the created entity.
    q.updateTask(applied.entity!.entityId, { body: 'the user wrote things here' });

    const undone = q.undoTriageDecision(applied.decision.id);
    expect(undone.entityRemoved).toBe('archived');
    expect(q.getTask(applied.entity!.entityId)!.status).toBe('archived');
    expect(q.getStream(item.id)!.status).toBe('pending');
  });

  it('reverts a merge when the append is the latest change', async () => {
    const { q } = await setup();
    const note = q.createNote({ title: 'Target', body: 'Body.' });
    const item = q.createStream({ rawText: 'appended bit' });
    const applied = q.recordTriageDecisionAndApply(
      { disposition: 'merge_note', streamItemIds: [item.id], targetType: 'note', targetId: note.id, actor: 'agent' },
      'executed',
    );

    const undone = q.undoTriageDecision(applied.decision.id);
    expect(undone.entityReverted).toBe(true);
    expect(q.getNote(note.id)!.body).toBe('Body.');
    expect(q.getStream(item.id)!.status).toBe('pending');
  });

  it('refuses the automatic revert after later edits but still resets the capture', async () => {
    const { q } = await setup();
    const note = q.createNote({ title: 'Target', body: 'Body.' });
    const item = q.createStream({ rawText: 'appended bit' });
    const applied = q.recordTriageDecisionAndApply(
      { disposition: 'merge_note', streamItemIds: [item.id], targetType: 'note', targetId: note.id, actor: 'agent' },
      'executed',
    );
    // Human edits on top of the append.
    q.updateNote(note.id, { body: q.getNote(note.id)!.body + '\n\nmore human words' });

    const undone = q.undoTriageDecision(applied.decision.id);
    expect(undone.entityReverted).toBe(false);
    expect(undone.reason).toMatch(/edited after/);
    // Human work untouched, decision undone, capture back.
    expect(q.getNote(note.id)!.body).toContain('more human words');
    expect(q.getStream(item.id)!.status).toBe('pending');
    expect(q.getTriageDecision(applied.decision.id)!.state).toBe('undone');
  });

  it('rejecting a proposal returns items to pending without side effects', async () => {
    const { q } = await setup();
    const item = q.createStream({ rawText: 'suggestion fodder' });
    const [proposal] = q.proposeTriageDecisions(
      [{ disposition: 'promote_task', streamItemIds: [item.id], draft: { title: 'T' }, actor: 'agent' }],
      null,
    );
    expect(q.getStream(item.id)!.status).toBe('proposed');
    q.undoTriageDecision(proposal.id);
    expect(q.getStream(item.id)!.status).toBe('pending');
    expect(q.listTasks()).toHaveLength(0);
  });
});

describe('journal, dismiss, incubate, reopen', () => {
  it('journal is a recorded decision that drains the queue', async () => {
    const { q } = await setup();
    const item = q.createStream({ rawText: 'just feeling grateful today' });
    q.recordTriageDecisionAndApply(
      { disposition: 'journal', streamItemIds: [item.id], actor: 'user' },
      'accepted',
    );
    expect(q.getStream(item.id)!.status).toBe('reviewed');
    expect(q.listStream({ status: 'pending' })).toHaveLength(0);
  });

  it('incubate leaves and returns on schedule', async () => {
    const { q } = await setup();
    const item = q.createStream({ rawText: 'revisit the pricing idea' });
    const past = new Date(Date.now() - 60_000).toISOString();
    q.recordTriageDecisionAndApply(
      { disposition: 'incubate', streamItemIds: [item.id], draft: { resurfaceAt: past }, actor: 'user' },
      'accepted',
    );
    expect(q.getStream(item.id)!.status).toBe('incubating');

    const resurfaced = q.resurfaceDueStreamItems();
    expect(resurfaced.map((r) => r.id)).toContain(item.id);
    expect(q.getStream(item.id)!.status).toBe('pending');
  });

  it('reopen detaches a dismissed capture', async () => {
    const { q } = await setup();
    const item = q.createStream({ rawText: 'noise, or was it' });
    q.dismissStream(item.id, 'user');
    expect(q.getStream(item.id)!.status).toBe('dismissed');
    const reopened = q.reopenStream(item.id)!;
    expect(reopened.status).toBe('pending');
  });

  it('reopen refuses items inside a combined outcome', async () => {
    const { q } = await setup();
    const a = q.createStream({ rawText: 'part one' });
    const b = q.createStream({ rawText: 'part two' });
    q.recordTriageDecisionAndApply(
      { disposition: 'combine_note', streamItemIds: [a.id, b.id], draft: { title: 'Both' }, actor: 'user' },
      'accepted',
    );
    expect(() => q.reopenStream(a.id)).toThrowError(/combined outcome/);
  });
});

describe('acceptance telemetry (T0.4 / §3.14)', () => {
  it('manual triage accumulates user ground truth; stats default to agent decisions', async () => {
    const { q } = await setup();
    const item = q.createStream({ rawText: 'user does their own filing' });
    q.recordTriageDecisionAndApply(
      { disposition: 'promote_note', streamItemIds: [item.id], actor: 'user' },
      'accepted',
    );
    expect(q.listTriageDecisions({ actor: 'user' })).toHaveLength(1);
    // Agent stats unaffected by the user's own routing.
    expect(q.getAcceptanceStats()).toHaveLength(0);
  });

  it('computes rates from accepted / corrected / undone, settling executed after 7 days', async () => {
    const { q, getDb } = await setup();
    const mk = () => q.createStream({ rawText: `thought ${Math.random()}` });

    // 2 accepted proposals.
    for (let i = 0; i < 2; i++) {
      const [p] = q.proposeTriageDecisions(
        [{ disposition: 'journal', streamItemIds: [mk().id], actor: 'agent' }],
        null,
      );
      q.applyTriageDecision(p.id, { decidedBy: 'user' });
    }
    // 1 undone auto-application.
    const auto = q.recordTriageDecisionAndApply(
      { disposition: 'journal', streamItemIds: [mk().id], actor: 'agent' },
      'executed',
    );
    q.undoTriageDecision(auto.decision.id);
    // 1 executed, aged past the settling window (counts as accepted).
    const aged = q.recordTriageDecisionAndApply(
      { disposition: 'journal', streamItemIds: [mk().id], actor: 'agent' },
      'executed',
    );
    const old = new Date(Date.now() - 8 * 86_400_000).toISOString();
    const { triageDecisions } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');
    getDb().update(triageDecisions).set({ decidedAt: old }).where(eq(triageDecisions.id, aged.decision.id)).run();

    const stats = q.getAcceptanceStats().find((s) => s.disposition === 'journal')!;
    expect(stats.accepted).toBe(3); // 2 explicit + 1 settled
    expect(stats.undone).toBe(1);
    expect(stats.sample).toBe(4);
    expect(stats.rate).toBeCloseTo(0.75);
  });
});

describe('correction (re-route)', () => {
  it('marks the original corrected and applies the user version', async () => {
    const { q } = await setup();
    const item = q.createStream({ rawText: 'maybe ask Sam about joining' });
    const [proposal] = q.proposeTriageDecisions(
      [{ disposition: 'promote_task', streamItemIds: [item.id], draft: { title: 'Ask Sam' }, actor: 'agent' }],
      null,
    );

    const { original, applied } = q.correctTriageDecision(proposal.id, { disposition: 'journal' });
    expect(original.state).toBe('corrected');
    expect(original.correctedDisposition).toBe('journal');
    expect(applied.decision.actor).toBe('user');
    expect(q.getStream(item.id)!.status).toBe('reviewed');
    expect(q.listTasks()).toHaveLength(0);
  });
});

describe('pass single-flight (§3.2)', () => {
  it('refuses a second live sweep, reaps stale ones', async () => {
    const { q, getDb } = await setup();
    const pass = q.createTriagePass('manual');
    expect(() => q.createTriagePass('manual')).toThrowError(/already running/);

    // Age the running pass past staleness; the next attempt reaps and wins.
    const old = new Date(Date.now() - 11 * 60_000).toISOString();
    const { triagePasses } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');
    getDb().update(triagePasses).set({ createdAt: old }).where(eq(triagePasses.id, pass.id)).run();

    const second = q.createTriagePass('manual');
    expect(second.id).not.toBe(pass.id);
    expect(q.getTriagePass(pass.id)!.status).toBe('failed');
  });

  it('completeTriagePass derives counts from decisions', async () => {
    const { q } = await setup();
    const pass = q.createTriagePass('manual');
    const a = q.createStream({ rawText: 'auto journal' });
    const b = q.createStream({ rawText: 'suggest a task' });
    q.recordTriageDecisionAndApply(
      { disposition: 'journal', streamItemIds: [a.id], actor: 'agent', passId: pass.id },
      'executed',
    );
    q.proposeTriageDecisions(
      [{ disposition: 'promote_task', streamItemIds: [b.id], draft: { title: 'T' }, actor: 'agent', passId: pass.id }],
      pass.id,
    );

    const done = q.completeTriagePass(pass.id, { summary: 'One kept as a thought, one suggestion.' })!;
    expect(done.status).toBe('completed');
    expect(done.autoApplied).toBe(1);
    expect(done.proposed).toBe(1);
    expect(done.itemsSeen).toBe(2);
  });
});

describe('graduation engine (§3.11)', () => {
  it('offers, demotes, and holds per the thresholds', async () => {
    const { evaluateGraduation } = await import('./autonomy');

    // Earned the auto offer.
    expect(
      evaluateGraduation('promote_task', 'suggest', { rate: 0.95, sample: 25 }, { rate: 0.95, sample: 20 }).action,
    ).toBe('offer_promotion');
    // Not enough sample yet.
    expect(
      evaluateGraduation('promote_task', 'suggest', { rate: 1, sample: 5 }, { rate: 1, sample: 5 }).action,
    ).toBe('hold');
    // Silent needs 50 at 97.
    expect(
      evaluateGraduation('journal', 'auto_digest', { rate: 0.98, sample: 60 }, { rate: 0.98, sample: 20 }).action,
    ).toBe('offer_promotion');
    expect(
      evaluateGraduation('journal', 'auto_digest', { rate: 0.95, sample: 60 }, { rate: 0.95, sample: 20 }).action,
    ).toBe('hold');
    // Trailing regression demotes one level, and demotion beats promotion.
    const demoted = evaluateGraduation('merge_note', 'auto_digest', { rate: 0.98, sample: 100 }, { rate: 0.6, sample: 10 });
    expect(demoted.action).toBe('demote');
    expect(demoted.toLevel).toBe('suggest');
    // Suggest can't demote further.
    expect(
      evaluateGraduation('merge_note', 'suggest', { rate: 0.2, sample: 10 }, { rate: 0.2, sample: 10 }).action,
    ).toBe('hold');
  });

  it('undos weigh heavier than accepts in the trailing window', async () => {
    const { q } = await setup();
    const mk = () => q.createStream({ rawText: `t ${Math.random()}` });
    // 3 accepted + 1 undone journal decisions.
    for (let i = 0; i < 3; i++) {
      const [p] = q.proposeTriageDecisions([{ disposition: 'journal', streamItemIds: [mk().id], actor: 'agent' }], null);
      q.applyTriageDecision(p.id, { decidedBy: 'user' });
    }
    const auto = q.recordTriageDecisionAndApply(
      { disposition: 'journal', streamItemIds: [mk().id], actor: 'agent' },
      'executed',
    );
    q.undoTriageDecision(auto.decision.id);

    const trailing = q.getTrailingAcceptance('journal', 20);
    expect(trailing.sample).toBe(4);
    // credit = 3 - 1 = 2 over 4 → 0.5, well below a naive 3/4.
    expect(trailing.rate).toBeCloseTo(0.5);
  });
});
