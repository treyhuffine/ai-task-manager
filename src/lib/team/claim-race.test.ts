/**
 * Claims on a team raced from separate processes (docs/homes-spec.md P6.5):
 * the desktop's setup helper and the team's service are different
 * processes on one database, and two people can open one link at once.
 * Each contender opens the database first, then all claim together, so
 * exactly one wins and the rest are told why.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

interface Outcome { ok: boolean; memberId?: string; role?: string; code?: string }

const TSX = path.resolve('node_modules/.bin/tsx');
const CHILD = path.resolve('src/lib/team/claim-race.child.ts');

/** Start every contender, wait until each has the database open, then release them at once. */
async function race(claims: string[][]): Promise<Outcome[]> {
  const children = claims.map((args) => spawn(TSX, [CHILD, ...args], { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] }));
  const output = children.map(() => '');
  const ready = children.map((child, i) => new Promise<void>((resolve, reject) => {
    child.stdout.on('data', (data: Buffer) => {
      output[i] += String(data);
      if (output[i].includes('ready\n')) resolve();
    });
    child.stderr.on('data', (data: Buffer) => { output[i] += String(data); });
    child.on('exit', (code) => reject(new Error(`A contender exited (${code}) before it was ready:\n${output[i]}`)));
  }));
  await Promise.all(ready);
  const done = children.map((child) => new Promise<void>((resolve) => child.on('exit', () => resolve())));
  for (const child of children) child.stdin.write('go\n');
  await Promise.all(done);
  return output.map((text) => {
    const line = text.split('\n').find((l) => l.startsWith('{'));
    if (!line) throw new Error(`A contender gave no outcome:\n${text}`);
    return JSON.parse(line) as Outcome;
  });
}

let home: TestHome;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-team-race-', openDb: false });
  const { writeTeamIntent } = await import('@/lib/home/team-intent');
  writeTeamIntent({ creationId: 'race-create', name: 'Acme' });
  const { resetHomeIdentityCache, ensureHomeIdentity } = await import('@/lib/home/identity');
  (await import('@/lib/home/authority')).resetAuthorityCache();
  resetHomeIdentityCache();
  ensureHomeIdentity();
});

afterEach(async () => {
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  (await import('@/lib/home/authority')).resetAuthorityCache();
  await home.cleanup();
});

describe('claims raced from separate processes', () => {
  it('makes exactly one first owner', async () => {
    const outcomes = await race([['owner', 'create-a', 'Ana'], ['owner', 'create-b', 'Bo'], ['owner', 'create-c', 'Cy']]);
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    expect(outcomes.filter((o) => !o.ok).map((o) => o.code)).toEqual(['conflict', 'conflict']);
    const { listMembers } = await import('@/lib/db/queries');
    expect(listMembers().filter((m) => m.role === 'owner')).toHaveLength(1);
  }, 60_000);

  it('lets one setup link make one owner', async () => {
    const { createTeamGrant, listMembers } = await import('@/lib/db/queries');
    const { secret } = createTeamGrant({ kind: 'setup', createdByMemberId: null });
    const outcomes = await race([['setup', secret, 'Ana'], ['setup', secret, 'Bo'], ['setup', secret, 'Cy']]);
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    expect(outcomes.filter((o) => !o.ok).every((o) => o.code === 'used' || o.code === 'conflict')).toBe(true);
    expect(listMembers().filter((m) => m.role === 'owner')).toHaveLength(1);
  }, 60_000);

  it('admits one person with one invitation', async () => {
    const { createTeamGrant, createTeamOwner, listMembers } = await import('@/lib/db/queries');
    const owner = createTeamOwner({ creationId: 'race-create', name: 'Trey', device: { name: 'Mac', kind: 'computer' } });
    const { secret } = createTeamGrant({ kind: 'invite', createdByMemberId: owner.member.id });
    const outcomes = await race([['invite', secret, 'Ana'], ['invite', secret, 'Bo'], ['invite', secret, 'Cy']]);
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    expect(outcomes.filter((o) => !o.ok).map((o) => o.code)).toEqual(['used', 'used']);
    expect(listMembers().map((m) => m.role).sort()).toEqual(['member', 'owner']);
  }, 60_000);
});
