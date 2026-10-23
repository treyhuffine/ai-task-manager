import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, afterEach, it, expect } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { resolveHomeContext } from './context';
import { ensureHomeIdentity } from './identity';
import { resetAuthorityCache } from './authority';
import { writeTeamIntent } from './team-intent';
import * as q from '@/lib/db/queries';
import type { RequestKey } from '@/lib/auth/request-key';

let home: TestHome;
beforeEach(async () => { home = await createTestHome({ prefix: 'ri-home-context-', openDb: false }); resetAuthorityCache(); });
afterEach(async () => { await home.cleanup(); resetAuthorityCache(); });
const viewer: RequestKey = { apiKeyId: 'test', scope: 'viewer', location: 'home', sessionChatId: null, workerDeviceId: null };

it('keeps personal planning and host authority with the personal viewer', async () => {
  ensureHomeIdentity();
  expect(await resolveHomeContext(viewer)).toMatchObject({ home: { kind: 'personal' }, capabilities: { privatePlanning: true, administerMembers: false } });
  await expect(resolveHomeContext({ ...viewer, scope: 'member', memberId: 'invented' })).rejects.toThrow(/Sign in/);
});

it('derives team capabilities from the live member row and refuses removed members and host keys', async () => {
  writeTeamIntent({ creationId: 'context-test-team', name: 'Team' });
  ensureHomeIdentity();
  const owner = q.createTeamOwner({ creationId: 'context-test-team', name: 'Owner', device: { kind: 'computer', name: 'Browser' } });
  const grant = q.createTeamGrant({ kind: 'invite', role: 'member', createdByMemberId: owner.member.id });
  const member = q.redeemTeamInvite({ secret: grant.secret, name: 'Member', device: { kind: 'computer', name: 'Browser' } });
  const key = { ...viewer, apiKeyId: member.key.id, scope: 'member' as const, memberId: member.member.id, memberRole: 'owner' as const };
  expect(await resolveHomeContext(key)).toMatchObject({ home: { kind: 'team' }, viewer: { role: 'member' }, capabilities: { privatePlanning: false, deletePermanently: false, configureAgents: false } });
  expect(await resolveHomeContext({ ...key, apiKeyId: owner.key.id, memberId: owner.member.id })).toMatchObject({ capabilities: { deletePermanently: true, configureAgents: true } });
  await expect(resolveHomeContext({ ...key, memberId: owner.member.id })).rejects.toThrow(/active member/);
  await expect(resolveHomeContext({ ...viewer, scope: 'host' })).rejects.toThrow(/active member/);
  q.removeMember(member.member.id);
  await expect(resolveHomeContext(key)).rejects.toThrow(/active member/);
  fs.rmSync(path.join(home.configDir, 'team.json'), { force: true });
});
