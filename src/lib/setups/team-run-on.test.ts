import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import * as q from '@/lib/db/queries';
import { agentDeviceFor, runOnFor } from './run-on';
let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>;
beforeEach(async () => { fixture = await createTeamExecutionFixture(); });
afterEach(async () => { await fixture.cleanup(); });
it('uses this Home and its ordinary folder setup, independent of optional AI', () => {
  const homeId = q.getHome()!.hostDeviceId;
  expect(runOnFor(fixture.workspace.id)).toMatchObject({ defaultId: homeId, livesOn: { isHome: true, folder: fixture.workspace.cwd }, choices: [{ deviceId: homeId, isHome: true, ready: true }] });
  expect(agentDeviceFor(fixture.workspace.id)).toBeNull();
  q.saveTeamAiSettings({ enabled: false }, fixture.owner.member.id);
  expect(agentDeviceFor(fixture.workspace.id)).toBeNull();
});
