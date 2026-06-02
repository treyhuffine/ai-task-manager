/**
 * `listChatEvents` paging — the tail page and the backward (`before`)
 * cursor that drives the transcript's infinite scroll-up. Exercises the
 * composite `(createdAt, id)` cursor, including the same-second tiebreak
 * where ordering falls through to the id.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { APP_SHORT_ID } from '@/constants/app';

describe('listChatEvents paging', () => {
  let tmpDir: string;
  const appRootEnv = `${APP_SHORT_ID.toUpperCase()}_ROOT`;
  const dbPathEnv = `${APP_SHORT_ID.toUpperCase()}_DB_PATH`;
  const mirrorDisabledEnv = `${APP_SHORT_ID.toUpperCase()}_MIRROR_DISABLED`;
  const saveEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-queries-chat-'));
    for (const k of [appRootEnv, dbPathEnv, mirrorDisabledEnv]) saveEnv[k] = process.env[k];
    process.env[appRootEnv] = tmpDir;
    process.env[dbPathEnv] = path.join(tmpDir, 'data.db');
    process.env[mirrorDisabledEnv] = '1';
    vi.resetModules();
  });

  afterEach(() => {
    for (const k of [appRootEnv, dbPathEnv, mirrorDisabledEnv]) {
      if (saveEnv[k] === undefined) delete process.env[k];
      else process.env[k] = saveEnv[k];
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * Seeds a session with six events in a known chronological order.
   * e3 and e4 share a `createdAt` second so the (createdAt, id) tiebreak
   * is exercised: e4's id is minted after e3's, so e3 < e4.
   */
  async function seed() {
    const q = await import('@/lib/db/queries');
    const agent = q.getOrCreateDefaultExecutor('claude');
    const session = q.createChatSession({ agentId: agent.id, type: 'execution', userId: 'local' });
    const at = (s: string) => `2026-01-01T00:00:0${s}.000Z`;
    const ids: string[] = [];
    const stamps = ['1', '2', '3', '3', '4', '5'];
    for (let i = 0; i < stamps.length; i++) {
      const row = q.insertChatEvent({
        sessionId: session.id,
        role: 'user',
        source: 'user',
        content: `e${i + 1}`,
        createdAt: at(stamps[i]),
      });
      expect(row).not.toBeNull();
      ids.push(row!.id);
    }
    return { q, sessionId: session.id, ids };
  }

  it('returns the most-recent page in ascending order', async () => {
    const { q, sessionId } = await seed();
    const page = q.listChatEvents(sessionId, { limit: 3 });
    expect(page.map((e) => e.content)).toEqual(['e4', 'e5', 'e6']);
  });

  it('with no limit returns the whole short history ascending', async () => {
    const { q, sessionId } = await seed();
    const all = q.listChatEvents(sessionId);
    expect(all.map((e) => e.content)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
  });

  it('before cursor returns events strictly older, ascending', async () => {
    const { q, sessionId, ids } = await seed();
    // ids[3] is e4 — older set is e1..e3 (e3 shares e4's second but has a
    // smaller id, so it counts as older).
    const older = q.listChatEvents(sessionId, { limit: 10, before: ids[3] });
    expect(older.map((e) => e.content)).toEqual(['e1', 'e2', 'e3']);
  });

  it('before cursor respects the same-second id tiebreak', async () => {
    const { q, sessionId, ids } = await seed();
    // ids[2] is e3 — only e1, e2 are strictly older. e4 (same second,
    // larger id) is NOT older and must be excluded.
    const older = q.listChatEvents(sessionId, { limit: 10, before: ids[2] });
    expect(older.map((e) => e.content)).toEqual(['e1', 'e2']);
  });

  it('before cursor paginates in fixed-size pages', async () => {
    const { q, sessionId, ids } = await seed();
    const firstOlder = q.listChatEvents(sessionId, { limit: 2, before: ids[5] }); // before e6
    expect(firstOlder.map((e) => e.content)).toEqual(['e4', 'e5']);
    const nextOlder = q.listChatEvents(sessionId, { limit: 2, before: firstOlder[0].id }); // before e4
    expect(nextOlder.map((e) => e.content)).toEqual(['e2', 'e3']);
  });

  it('before the oldest event returns an empty (exhausted) page', async () => {
    const { q, sessionId, ids } = await seed();
    expect(q.listChatEvents(sessionId, { before: ids[0] })).toEqual([]);
  });

  it('an unknown cursor returns nothing rather than scanning all', async () => {
    const { q, sessionId } = await seed();
    expect(q.listChatEvents(sessionId, { before: 'does-not-exist' })).toEqual([]);
  });
});
