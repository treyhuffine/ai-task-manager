import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { preloadTeamRoutes, serveTeam, teamTrpc } from '@/test/fixtures/team-home';
import * as q from '@/lib/db/queries';
import * as processes from '@/lib/runner/harness-processes';
import { startTeamSpace } from '@/lib/team/startup';

let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>;
beforeAll(preloadTeamRoutes, 120_000);
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await fixture?.cleanup(); });
it.each([true, false])('serves content with AI enabled=%s after orphan recovery fails', async enabled => {
  fixture = await createTeamExecutionFixture(); vi.stubGlobal('fetch', serveTeam);
  q.saveTeamAiSettings({ enabled }, fixture.owner.member.id);
  vi.spyOn(processes, 'stopOrphanedHarnesses').mockRejectedValue(new Error('EMFILE'));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  await expect(startTeamSpace()).resolves.toBeUndefined();
  const member = await teamTrpc(fixture.member.token.plaintext);
  const created = await member.tasks.create.mutate({ title: 'Home still works', rawInput: 'Home still works' });
  expect((await member.tasks.get.query({ id: created.id })).title).toBe('Home still works');
  const status = await member.team.ai.status.query();
  expect(status.state).toBe(enabled ? 'unavailable' : 'off');
  if (enabled) expect(status.reason).toContain('EMFILE');
});
