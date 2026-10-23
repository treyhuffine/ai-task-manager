import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { initialHomeContextForRequest, resolveHomeContext } from './context';
import { ensureHomeIdentity } from './identity';
import { resetAuthorityCache } from './authority';
import { writeTeamIntent } from './team-intent';
import * as q from '@/lib/db/queries';
import type { RequestKey } from '@/lib/auth/request-key';
import { getHarnessRuntime, resolveHarnessAuth } from '@/lib/harness/runtime';

vi.mock('@/lib/harness/runtime', () => ({ getHarnessRuntime: vi.fn(() => new Promise(() => {})), resolveHarnessAuth: vi.fn(() => new Promise(() => {})) }));

let home: TestHome;
beforeEach(async () => { vi.clearAllMocks(); home = await createTestHome({ prefix: 'ri-home-context-', openDb: false }); resetAuthorityCache(); });
afterEach(async () => { await home.cleanup(); resetAuthorityCache(); });
const viewer: RequestKey = { apiKeyId: 'test', scope: 'viewer', location: 'home', sessionChatId: null, workerDeviceId: null };

it('keeps personal planning and host authority with the personal viewer', async () => {
  ensureHomeIdentity();
  q.createWorkspace({ name: 'Personal agent', cwd: home.root, isGit: false });
  expect(await resolveHomeContext(viewer)).toMatchObject({ home: { kind: 'personal' }, capabilities: { privatePlanning: true, administerMembers: false } });
  const browser = q.createApiKey({ name: 'Browser', role: 'sign_in', deviceId: null });
  expect(await initialHomeContextForRequest(new Headers({ authorization: `Bearer ${browser.token.plaintext}` }))).toMatchObject({ viewer: { id: 'local' } });
  expect(getHarnessRuntime).not.toHaveBeenCalled(); expect(resolveHarnessAuth).not.toHaveBeenCalled();
  await expect(resolveHomeContext({ ...viewer, scope: 'member', memberId: 'invented' })).rejects.toThrow(/Sign in/);
});

it('derives team capabilities from the live member row and refuses removed members and host keys', async () => {
  writeTeamIntent({ creationId: 'context-test-team', name: 'Team' });
  ensureHomeIdentity();
  q.createWorkspace({ name: 'Shared agent', cwd: home.root, isGit: false });
  const owner = q.createTeamOwner({ creationId: 'context-test-team', name: 'Owner', device: { kind: 'computer', name: 'Browser' } });
  const grant = q.createTeamGrant({ kind: 'invite', role: 'member', createdByMemberId: owner.member.id });
  const member = q.redeemTeamInvite({ secret: grant.secret, name: 'Member', device: { kind: 'computer', name: 'Browser' } });
  const key = { ...viewer, apiKeyId: member.key.id, scope: 'member' as const, memberId: member.member.id, memberRole: 'owner' as const };
  q.saveTeamAiSettings({ enabled: true }, owner.member.id);
  expect(await resolveHomeContext(key)).toMatchObject({ home: { kind: 'team' }, viewer: { role: 'member' }, capabilities: { privatePlanning: false, deletePermanently: false, configureAgents: false } });
  expect(await resolveHomeContext({ ...key, apiKeyId: owner.key.id, memberId: owner.member.id })).toMatchObject({ capabilities: { deletePermanently: true, configureAgents: true } });
  const browserHeaders = new Headers({ authorization: `Bearer ${member.token.plaintext}` });
  expect(await initialHomeContextForRequest(browserHeaders)).toMatchObject({ viewer: { id: member.member.id, role: 'member' } });
  expect(getHarnessRuntime).not.toHaveBeenCalled(); expect(resolveHarnessAuth).not.toHaveBeenCalled();
  await expect(resolveHomeContext({ ...key, memberId: owner.member.id })).rejects.toThrow(/active member/);
  await expect(resolveHomeContext({ ...viewer, scope: 'host' })).rejects.toThrow(/active member/);
  q.removeMember(member.member.id);
  await expect(resolveHomeContext(key)).rejects.toThrow(/active member/);
  expect(await initialHomeContextForRequest(browserHeaders)).toBeUndefined();
  fs.rmSync(path.join(home.configDir, 'team.json'), { force: true });
});

it('never bootstraps an unauthenticated page or a machine credential', async () => {
  ensureHomeIdentity();
  expect(await initialHomeContextForRequest(new Headers())).toBeUndefined();
  expect(await initialHomeContextForRequest(new Headers({ 'x-ri-api-key-id': 'invented', 'x-ri-api-key-scope': 'viewer' }))).toBeUndefined();
  for (const role of ['ai_client', 'worker'] as const) {
    const machine = q.createApiKey({ name: 'Machine credential', role, deviceId: null });
    expect(await initialHomeContextForRequest(new Headers({ authorization: `Bearer ${machine.token.plaintext}` }))).toBeUndefined();
  }
});
