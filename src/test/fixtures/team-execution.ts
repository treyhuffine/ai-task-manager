/** Disposable team Home with ordinary server workspace. No native harness evidence. */
import fs from 'node:fs';
import path from 'node:path';
import { createTestHome } from './home';
import { writeTeamIntent } from '@/lib/home/team-intent';
import { ensureHomeIdentity, resetHomeIdentityCache } from '@/lib/home/identity';
import { resetAuthorityCache } from '@/lib/home/authority';
import { setHomeFolder } from '@/lib/setups/home-context';
import * as q from '@/lib/db/queries';

export async function createTeamExecutionFixture() {
  const home = await createTestHome({ prefix: 'ri-team-dispatch-', openDb: false });
  resetHomeIdentityCache(); resetAuthorityCache();
  writeTeamIntent({ creationId: 'server-dispatch', name: 'Team' }); ensureHomeIdentity();
  const owner = q.createTeamOwner({ creationId: 'server-dispatch', name: 'Owner', device: { kind: 'computer', name: 'Browser' } });
  const invite = q.createTeamGrant({ kind: 'invite', role: 'member', createdByMemberId: owner.member.id });
  const member = q.redeemTeamInvite({ secret: invite.secret, name: 'Maya', device: { kind: 'computer', name: 'Browser' } });
  const cwd = path.join(home.root, 'project'); fs.mkdirSync(cwd);
  const workspace = q.createWorkspace({ name: 'Shared agent', cwd, isGit: false, instructions: 'Shared standing instructions.', createdByMemberId: owner.member.id, defaultDeviceId: q.getHome()!.hostDeviceId });
  await setHomeFolder(workspace.id, cwd);
  // Synthetic catalog entry is explicitly enabled by the fixture owner.
  for (const harness of ['claude', 'codex', 'cursor', 'opencode', 'antigravity'] as const) q.addCustomHarnessModel(harness, 'fake-model');
  q.saveTeamAiSettings({ enabled: true, harness: 'codex', model: 'gpt-6.1-sol' }, owner.member.id);
  return { home, owner, member, workspace,
    actor: { source: 'human' as const, memberId: member.member.id, apiKeyId: member.key.id },
    cleanup: async () => { await home.cleanup(); resetHomeIdentityCache(); resetAuthorityCache(); },
  };
}
