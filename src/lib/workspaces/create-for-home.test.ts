import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { preloadTeamRoutes, serveTeam, teamTrpc } from '@/test/fixtures/team-home';
import * as q from '@/lib/db/queries';
import { createWorkspaceForHome } from './create-for-home';
import { createTestHome } from '@/test/fixtures/home';
import { ensureHomeIdentity } from '@/lib/home/identity';
let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>;
beforeAll(preloadTeamRoutes);
beforeEach(async () => { fixture = await createTeamExecutionFixture(); vi.stubGlobal('fetch', serveTeam); });
afterEach(async () => { await fixture.cleanup(); vi.unstubAllGlobals(); });
it('creates an ordinary owner-configured folder and setup while AI is off', async () => {
  q.saveTeamAiSettings({ enabled: false }, fixture.owner.member.id);
  const cwd = path.join(fixture.home.root, 'new-agent'); fs.mkdirSync(cwd);
  const owner = await teamTrpc(fixture.owner.token.plaintext);
  const agent = await owner.workspaces.create.mutate({ body: { name: 'Shared agent', cwd, purpose: 'Shared work', instructions: 'Keep records current.' } });
  expect(agent).toMatchObject({ cwd, isGit: false, createdByMemberId: fixture.owner.member.id, defaultDeviceId: q.getHome()!.hostDeviceId, browserEnabled: false });
  expect(q.getWorkspaceSetup(agent.id, q.getHome()!.hostDeviceId)?.sourcePath).toBe(cwd);
  const member = await teamTrpc(fixture.member.token.plaintext);
  await expect(member.workspaces.create.mutate({ body: { name: 'Denied', cwd } })).rejects.toMatchObject({ data: { httpStatus: 403 } });
});
it('refuses missing folders, another device and personal connector scopes', async () => {
  const owner = await teamTrpc(fixture.owner.token.plaintext);
  await expect(owner.workspaces.create.mutate({ body: { name: 'Missing', cwd: path.join(fixture.home.root, 'missing') } })).rejects.toThrow(/folder/i);
  await expect(owner.workspaces.create.mutate({ body: { name: 'Wrong placement', cwd: fixture.workspace.cwd, defaultDeviceId: 'another-device' } })).rejects.toThrow(/this server/);
  await expect(owner.workspaces.create.mutate({ body: { name: 'Connectors', cwd: fixture.workspace.cwd, integrationScopes: [{ toolkitId: 'gmail' }] } })).rejects.toThrow(/Connectors/);
});
it('keeps personal creation on the same operation and ordinary setup path', async () => {
  await fixture.cleanup(); const personal = await createTestHome(); fixture.cleanup = personal.cleanup;
  ensureHomeIdentity(); const cwd = path.join(personal.root, 'personal-agent'); fs.mkdirSync(cwd);
  const agent = await createWorkspaceForHome({ name: 'Personal agent', cwd, isGit: false }, null);
  expect(agent.createdByMemberId).toBeNull(); expect(q.getWorkspaceSetup(agent.id, q.getHome()!.hostDeviceId)?.sourcePath).toBe(cwd);
});
