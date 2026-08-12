/**
 * `skill_usage` — the decayed running count that lets the `/` menu rank by
 * habit. The score has to encode recency AND frequency in one number, so the
 * cases that matter are: repeat use compounds, and a stale lead decays away.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { APP_SHORT_ID } from '@/constants/app';

/**
 * One database for the whole file, truncated between tests. The per-test
 * `vi.resetModules()` pattern the other query suites use costs a full migrate
 * each time, which is enough extra parallel load to time out unrelated suites.
 * Nothing here depends on module state, so a shared DB is both cheaper and
 * equivalent.
 */
let tmpDir: string;
let q: typeof import('@/lib/db/queries');
let db: typeof import('@/lib/db');
let schema: typeof import('@/lib/db/schema');
let drizzle: typeof import('drizzle-orm');

const appRootEnv = `${APP_SHORT_ID.toUpperCase()}_ROOT`;
const dbPathEnv = `${APP_SHORT_ID.toUpperCase()}_DB_PATH`;
const mirrorDisabledEnv = `${APP_SHORT_ID.toUpperCase()}_MIRROR_DISABLED`;
const saveEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-skill-usage-'));
  for (const k of [appRootEnv, dbPathEnv, mirrorDisabledEnv]) saveEnv[k] = process.env[k];
  process.env[appRootEnv] = tmpDir;
  process.env[dbPathEnv] = path.join(tmpDir, 'data.db');
  process.env[mirrorDisabledEnv] = '1';

  q = await import('@/lib/db/queries');
  db = await import('@/lib/db');
  schema = await import('@/lib/db/schema');
  drizzle = await import('drizzle-orm');
});

afterAll(() => {
  for (const k of [appRootEnv, dbPathEnv, mirrorDisabledEnv]) {
    if (saveEnv[k] === undefined) delete process.env[k];
    else process.env[k] = saveEnv[k];
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  db.getDb().delete(schema.skillUsage).run();
});

/** Backdate a row so decay has something to act on. */
function setLastUsed(name: string, daysAgo: number, score?: number) {
  db.getDb()
    .update(schema.skillUsage)
    .set({
      lastUsedAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
      ...(score === undefined ? {} : { score, useCount: Math.round(score) }),
    })
    .where(drizzle.eq(schema.skillUsage.name, name))
    .run();
}

describe('decaySkillScore', () => {
  it('halves a score after exactly one half-life', () => {
    const now = Date.UTC(2026, 0, 30);
    const then = new Date(now - q.SKILL_USAGE_HALF_LIFE_DAYS * 86_400_000).toISOString();
    expect(q.decaySkillScore(8, then, now)).toBeCloseTo(4, 6);
  });

  it('quarters it after two half-lives', () => {
    const now = Date.UTC(2026, 0, 30);
    const then = new Date(now - 2 * q.SKILL_USAGE_HALF_LIFE_DAYS * 86_400_000).toISOString();
    expect(q.decaySkillScore(8, then, now)).toBeCloseTo(2, 6);
  });

  it('leaves a score used this instant alone', () => {
    const now = Date.UTC(2026, 0, 30);
    expect(q.decaySkillScore(5, new Date(now).toISOString(), now)).toBe(5);
  });

  it('does not inflate on a future-dated row (clock skew)', () => {
    const now = Date.UTC(2026, 0, 30);
    expect(q.decaySkillScore(5, new Date(now + 86_400_000).toISOString(), now)).toBe(5);
  });

  it('is zero for an unused command', () => {
    expect(q.decaySkillScore(0, null)).toBe(0);
  });
});

describe('recordSkillUse', () => {
  it('creates a row on first use', () => {
    q.recordSkillUse('implementing-specs');
    const [row] = q.listSkillUsage();
    expect(row?.name).toBe('implementing-specs');
    expect(row?.useCount).toBe(1);
    expect(row?.score).toBe(1);
    expect(row?.lastUsedAt).toBeTruthy();
  });

  it('compounds on repeat use', () => {
    q.recordSkillUse('ship');
    q.recordSkillUse('ship');
    q.recordSkillUse('ship');
    const [row] = q.listSkillUsage();
    expect(row?.useCount).toBe(3);
    // Three uses inside one tick decay by ~nothing, so the score tracks the
    // raw count. Decay only separates them once time passes.
    expect(row?.score).toBeCloseTo(3, 3);
    expect(q.listSkillUsage()).toHaveLength(1);
  });

  it('keeps commands separate', () => {
    q.recordSkillUse('ship');
    q.recordSkillUse('ship');
    q.recordSkillUse('qa');
    const scores = q.getSkillUsageScores();
    expect(scores.get('ship')).toBeGreaterThan(scores.get('qa')!);
  });

  it('normalizes case and whitespace so `/Ship` and `/ship` are one command', () => {
    q.recordSkillUse('Ship');
    q.recordSkillUse('  ship ');
    expect(q.listSkillUsage()).toHaveLength(1);
    expect(q.listSkillUsage()[0]?.useCount).toBe(2);
  });

  it('ignores an empty name', () => {
    q.recordSkillUse('   ');
    expect(q.listSkillUsage()).toEqual([]);
  });

  it('orders by score, most-used first', () => {
    q.recordSkillUse('qa');
    q.recordSkillUse('ship');
    q.recordSkillUse('ship');
    expect(q.listSkillUsage().map((r) => r.name)).toEqual(['ship', 'qa']);
  });

  it('decays an existing score before adding to it', () => {
    q.recordSkillUse('ship');
    setLastUsed('ship', q.SKILL_USAGE_HALF_LIFE_DAYS, 4);
    q.recordSkillUse('ship');
    // 4 halved to 2, then +1 for this use.
    expect(q.listSkillUsage()[0]?.score).toBeCloseTo(3, 3);
  });

  it('a stale lead decays below a fresher command', () => {
    // `old` was used five times, but a quarter ago.
    q.recordSkillUse('old');
    setLastUsed('old', 90, 5);
    // `fresh` was used twice, today.
    q.recordSkillUse('fresh');
    q.recordSkillUse('fresh');

    const scores = q.getSkillUsageScores();
    expect(scores.get('fresh')!).toBeGreaterThan(scores.get('old')!);
  });

  it('drops a decayed-to-noise command out of the score map', () => {
    q.recordSkillUse('ancient');
    setLastUsed('ancient', 5000);

    expect(q.getSkillUsageScores().has('ancient')).toBe(false);
    // The row survives for its useCount history; only the ranking signal is gone.
    expect(q.listSkillUsage()).toHaveLength(1);
  });
});
