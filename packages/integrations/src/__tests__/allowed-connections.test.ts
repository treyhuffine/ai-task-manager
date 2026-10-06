/**
 * The `runAction` allowed-connection-set constraint (`RunActionOptions.allowedConnectionIds`): a
 * host restricts a run to a subset of the owner's connections (a workspace scoped to 2 of 3 Gmail
 * accounts). Resolution picks only within the set, rejects anything outside it with a clear
 * `account_not_allowed` that lists the allowed accounts, and never widens or starts a connect flow.
 */
import { describe, it, expect } from 'vitest';
import { makeHarness } from './_harness';
import type { ActionOutcome, Connection } from '../core/types';

const CALENDARS = { json: { items: [{ id: 'primary', summary: 'Primary', primary: true }] } };

async function threeAccounts() {
  const h = makeHarness();
  const personal = await h.connect({ email: 'personal@gmail.com' });
  const work = await h.connect({ email: 'work@gmail.com' });
  const side = await h.connect({ email: 'side@gmail.com' });
  h.env.action = () => CALENDARS;
  return { h, personal, work, side };
}

/** The connection a successful run went through, from the audit trail. */
function ranAs(h: ReturnType<typeof makeHarness>): string | undefined {
  return [...h.runs].reverse().find((e) => e.phase === 'finish' && e.status === 'ok')?.connectionId;
}

function errorOf(out: ActionOutcome): { code: string; message: string } {
  expect(out.ok).toBe(false);
  expect((out as { reason: string }).reason).toBe('error');
  return out as unknown as { code: string; message: string };
}

describe('runAction allowedConnectionIds (allowed connection set)', () => {
  it('resolves an account hint inside the set to that connection', async () => {
    const { h, work, side } = await threeAccounts();
    const out = await h.runtime.runAction('google_calendar.list_calendars', {}, {
      account: 'side@gmail.com',
      allowedConnectionIds: [work.id, side.id],
    });
    expect(out.ok).toBe(true);
    expect(ranAs(h)).toBe(side.id);
  });

  it('rejects a hint naming a connected account outside the set, listing only the allowed accounts', async () => {
    const { h, personal, work, side } = await threeAccounts();
    const out = await h.runtime.runAction('google_calendar.list_calendars', {}, {
      account: 'personal@gmail.com',
      allowedConnectionIds: [work.id, side.id],
    });
    const err = errorOf(out);
    expect(err.code).toBe('account_not_allowed');
    expect(err.message).toContain('"personal@gmail.com" is not available here');
    expect(err.message).toContain('"work@gmail.com"');
    expect(err.message).toContain('"side@gmail.com"');
    expect(err.message).not.toContain(personal.id);
    // Never ran against anything, and the audit records the refusal.
    expect(h.runs.some((e) => e.phase === 'finish' && e.status === 'ok')).toBe(false);
    expect(h.runs.at(-1)).toMatchObject({ phase: 'finish', errorCode: 'account_not_allowed' });
  });

  it('rejects a connectionId outside the set without echoing the opaque id', async () => {
    const { h, personal, work, side } = await threeAccounts();
    const out = await h.runtime.runAction('google_calendar.list_calendars', {}, {
      connectionId: personal.id,
      allowedConnectionIds: [work.id, side.id],
    });
    const err = errorOf(out);
    expect(err.code).toBe('account_not_allowed');
    expect(err.message).toContain('that connection is not available here');
    expect(err.message).not.toContain(personal.id);
  });

  it('runs a connectionId inside the set', async () => {
    const { h, work, side } = await threeAccounts();
    const out = await h.runtime.runAction('google_calendar.list_calendars', {}, {
      connectionId: work.id,
      allowedConnectionIds: [work.id, side.id],
    });
    expect(out.ok).toBe(true);
    expect(ranAs(h)).toBe(work.id);
  });

  it('with no hint and 2+ allowed, asks to choose among the allowed accounts only', async () => {
    const { h, personal, work, side } = await threeAccounts();
    const out = await h.runtime.runAction('google_calendar.list_calendars', {}, {
      allowedConnectionIds: [work.id, side.id],
    });
    expect(out).toMatchObject({ ok: false, reason: 'needs_account' });
    const ids = (out as { choices: { connectionId: string }[] }).choices.map((c) => c.connectionId).sort();
    expect(ids).toEqual([work.id, side.id].sort());
    expect(ids).not.toContain(personal.id);
  });

  it('an unknown hint with 2+ allowed falls back to the restricted choice (never the first)', async () => {
    const { h, work, side } = await threeAccounts();
    const out = await h.runtime.runAction('google_calendar.list_calendars', {}, {
      account: 'nobody@gmail.com',
      allowedConnectionIds: [work.id, side.id],
    });
    expect(out).toMatchObject({ ok: false, reason: 'needs_account' });
    expect((out as { choices: unknown[] }).choices).toHaveLength(2);
  });

  it('a set with one live connection runs it with no hint, even when the owner has several', async () => {
    const { h, work } = await threeAccounts();
    const out = await h.runtime.runAction('google_calendar.list_calendars', {}, { allowedConnectionIds: [work.id] });
    expect(out.ok).toBe(true);
    expect(ranAs(h)).toBe(work.id);
  });

  it('fails closed on an empty set or a set of connections that no longer exist (no connect flow)', async () => {
    const { h } = await threeAccounts();
    for (const allowedConnectionIds of [[], ['gone-1', 'gone-2']]) {
      const out = await h.runtime.runAction('google_calendar.list_calendars', {}, { allowedConnectionIds });
      expect(errorOf(out).code).toBe('connection_not_found');
    }
    // Even with no connection at all, a constrained run does not start an authorization flow.
    const fresh = makeHarness();
    const out = await fresh.runtime.runAction('google_calendar.list_calendars', {}, { allowedConnectionIds: [] });
    expect(errorOf(out).code).toBe('connection_not_found');
  });

  it('ignores ids of other owners in the set (ownership still bounds resolution)', async () => {
    const h = makeHarness();
    const mine: Connection = await h.connect({ email: 'me@gmail.com' });
    const theirs: Connection = await h.connect({ ownerId: 'someone-else', email: 'them@gmail.com' });
    h.env.action = () => CALENDARS;
    const out = await h.runtime.runAction('google_calendar.list_calendars', {}, {
      connectionId: theirs.id,
      allowedConnectionIds: [mine.id, theirs.id],
    });
    expect(errorOf(out).code).toBe('connection_not_found');
  });

  it('leaves unconstrained resolution unchanged: any connected account by hint', async () => {
    const { h, personal } = await threeAccounts();
    const out = await h.runtime.runAction('google_calendar.list_calendars', {}, { account: 'personal@gmail.com' });
    expect(out.ok).toBe(true);
    expect(ranAs(h)).toBe(personal.id);
  });
});
